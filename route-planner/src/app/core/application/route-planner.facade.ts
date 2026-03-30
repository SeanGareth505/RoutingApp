import { inject, Injectable, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import {
  RouteLegOverride,
  RoutePlan,
  RouteStop,
  RouteSummary,
  RouteVersionSnapshot,
  RouteViaPoint
} from '../domain/route.models';
import { ExternalRouteSubmission, PublicIntakeLink } from '../domain/submission.models';
import { EXTERNAL_SUBMISSION_PORT, GEOCODING_PORT, ROUTE_OPTIMIZATION_PORT, ROUTE_REPOSITORY } from '../tokens/ports.tokens';
import { ExternalSubmissionPort } from '../ports/external-submission.port';
import { GeocodingPort } from '../ports/geocoding.port';
import { RouteOptimizationPort } from '../ports/route-optimization.port';
import { RouteRepository } from '../ports/route-repository.port';

@Injectable({ providedIn: 'root' })
export class RoutePlannerFacade {
  private static readonly MAX_HISTORY_ENTRIES = 80;
  private readonly repository = inject<RouteRepository>(ROUTE_REPOSITORY);
  private readonly optimization = inject<RouteOptimizationPort>(ROUTE_OPTIMIZATION_PORT);
  private readonly geocoding = inject<GeocodingPort>(GEOCODING_PORT);
  private readonly externalSubmissions = inject<ExternalSubmissionPort>(EXTERNAL_SUBMISSION_PORT);
  private readonly messageService = inject(MessageService);

  readonly routes = signal<RouteSummary[]>([]);
  readonly activeRoute = signal<RoutePlan | null>(null);
  readonly submissions = signal<ExternalRouteSubmission[]>([]);
  readonly links = signal<PublicIntakeLink[]>([]);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  private computeSequence = 0;
  private readonly undoStack: RoutePlan[] = [];
  private readonly redoStack: RoutePlan[] = [];

  async initialize(): Promise<void> {
    await this.refreshRoutes();
  }

  async refreshRoutes(): Promise<void> {
    const routes = await this.repository.list();
    this.routes.set(routes);
  }

  async loadRoute(routeId: string): Promise<void> {
    const route = await this.repository.getById(routeId);
    if (!route) {
      this.activeRoute.set(null);
      return;
    }
    this.activeRoute.set(this.ensureRouteDefaults(route));
    this.clearHistory();
  }

  newDraftRoute(): void {
    const nowIso = new Date().toISOString();
    this.activeRoute.set({
      id: crypto.randomUUID(),
      name: `Route ${new Date().toLocaleDateString()}`,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      manualOverride: false,
      manualRouteLocked: false,
      metrics: { totalDistanceKm: 0, estimatedMinutes: 0 },
      stops: [],
      legOverrides: [],
      routePath: {
        coordinates: [],
        metrics: { totalDistanceKm: 0, estimatedMinutes: 0 }
      },
      routeAlternatives: [],
      versions: []
    });
    this.clearHistory();
  }

  async addStop(stop: RouteStop): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const stops = [...route.stops, stop];
    await this.updateStops(stops, false);
  }

  async updateStops(stops: RouteStop[], trackHistory = true): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    if (trackHistory) {
      this.recordHistory(route);
    }
    const normalizedRoute = this.ensureRouteDefaults(route);
    const previousLegOverrides = normalizedRoute.legOverrides ?? [];
    const validLegOverrides = this.sanitizeLegOverrides(stops, previousLegOverrides);
    if (validLegOverrides.length !== previousLegOverrides.length) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Manual path updated',
        detail: 'Some manual leg overrides were removed because stop order changed.'
      });
    }
    const currentSequence = ++this.computeSequence;
    this.activeRoute.set({
      ...normalizedRoute,
      stops,
      legOverrides: validLegOverrides
    });
    const result = await this.optimization.optimize({
      stops,
      lockFixedStops: false,
      preserveOrder: true,
      includeAlternatives: true,
      manualRouteLocked: normalizedRoute.manualRouteLocked,
      legOverrides: validLegOverrides
    });
    if (currentSequence !== this.computeSequence) {
      return;
    }
    this.applyOptimizationResult(result, normalizedRoute.manualOverride);
  }

  async optimizeRoute(): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const normalizedRoute = this.ensureRouteDefaults(route);
    if (normalizedRoute.manualRouteLocked) {
      await this.updateStops(normalizedRoute.stops, false);
      return;
    }
    const currentSequence = ++this.computeSequence;
    const result = await this.optimization.optimize({
      stops: normalizedRoute.stops,
      lockFixedStops: true,
      preserveOrder: false,
      includeAlternatives: true,
      manualRouteLocked: false,
      legOverrides: normalizedRoute.legOverrides
    });
    if (currentSequence !== this.computeSequence) {
      return;
    }
    this.applyOptimizationResult(result, false);
  }

  async setLegViaPoints(legKey: string, viaPoints: RouteViaPoint[]): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const normalizedRoute = this.ensureRouteDefaults(route);
    const nextOverrides = upsertLegOverride(
      normalizedRoute.legOverrides ?? [],
      legKey,
      viaPoints.map((point) => ({ ...point }))
    );
    this.activeRoute.set({
      ...normalizedRoute,
      manualRouteLocked: true,
      legOverrides: nextOverrides
    });
    await this.updateStops(normalizedRoute.stops, false);
  }

  async clearLegOverride(legKey: string): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const normalizedRoute = this.ensureRouteDefaults(route);
    const nextOverrides = (normalizedRoute.legOverrides ?? []).filter(
      (override) => override.legKey !== legKey
    );
    this.activeRoute.set({
      ...normalizedRoute,
      legOverrides: nextOverrides
    });
    await this.updateStops(normalizedRoute.stops, false);
  }

  async clearAllLegOverrides(): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const normalizedRoute = this.ensureRouteDefaults(route);
    this.activeRoute.set({
      ...normalizedRoute,
      legOverrides: [],
      manualRouteLocked: false
    });
    await this.updateStops(normalizedRoute.stops, false);
  }

  toggleManualRouteLock(): void {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const normalizedRoute = this.ensureRouteDefaults(route);
    this.activeRoute.set({
      ...normalizedRoute,
      manualRouteLocked: !normalizedRoute.manualRouteLocked
    });
  }

  async saveActiveRoute(reason = 'Manual save'): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }

    const nowIso = new Date().toISOString();
    const payload: RoutePlan = {
      ...route,
      updatedAtIso: nowIso
    };

    const existing = await this.repository.getById(payload.id);
    if (existing) {
      await this.repository.update(payload);
      await this.repository.appendVersion(payload.id, this.buildVersionSnapshot(payload, reason));
    } else {
      await this.repository.create(payload);
      await this.repository.appendVersion(payload.id, this.buildVersionSnapshot(payload, 'Initial version'));
    }

    this.messageService.add({
      severity: 'success',
      summary: 'Route saved',
      detail: `${payload.name} was stored locally.`
    });
    await this.refreshRoutes();
  }

  async removeRoute(routeId: string): Promise<void> {
    await this.repository.delete(routeId);
    if (this.activeRoute()?.id === routeId) {
      this.activeRoute.set(null);
    }
    await this.refreshRoutes();
  }

  async restoreVersion(routeId: string, version: RouteVersionSnapshot): Promise<void> {
    const route = await this.repository.getById(routeId);
    if (!route) {
      return;
    }
    this.recordHistory(route);
    const updated: RoutePlan = {
      ...route,
      stops: structuredClone(version.stops),
      manualOverride: version.manualOverride,
      manualRouteLocked: version.manualRouteLocked ?? false,
      legOverrides: structuredClone(version.legOverrides ?? []),
      routePath: version.routePath,
      routeAlternatives: [],
      metrics:
        version.routePath?.metrics ?? {
          totalDistanceKm: 0,
          estimatedMinutes: 0
        },
      updatedAtIso: new Date().toISOString()
    };
    await this.repository.update(updated);
    await this.refreshRoutes();
    this.activeRoute.set(updated);
  }

  undoLastEdit(): void {
    const currentRoute = this.activeRoute();
    const previousRoute = this.undoStack.pop();
    if (!currentRoute || !previousRoute) {
      return;
    }
    this.redoStack.push(structuredClone(currentRoute));
    this.activeRoute.set(structuredClone(previousRoute));
    this.updateHistoryFlags();
  }

  redoLastEdit(): void {
    const currentRoute = this.activeRoute();
    const nextRoute = this.redoStack.pop();
    if (!currentRoute || !nextRoute) {
      return;
    }
    this.undoStack.push(structuredClone(currentRoute));
    this.activeRoute.set(structuredClone(nextRoute));
    this.updateHistoryFlags();
  }

  async listVersions(routeId: string): Promise<RouteVersionSnapshot[]> {
    return this.repository.listVersions(routeId);
  }

  searchAddress(query: string) {
    return this.geocoding.searchAddress(query);
  }

  resolveAddress(query: string, magicKey?: string) {
    return this.geocoding.resolveAddress(query, magicKey);
  }

  async loadRouteSubmissions(routeId: string): Promise<void> {
    this.submissions.set(await this.externalSubmissions.listSubmissionsForRoute(routeId));
  }

  async loadRouteLinks(routeId: string): Promise<void> {
    this.links.set(await this.externalSubmissions.listLinks(routeId));
  }

  async createPublicLink(routeId: string): Promise<PublicIntakeLink> {
    const link = await this.externalSubmissions.createLink(routeId);
    await this.loadRouteLinks(routeId);
    return link;
  }

  async revokePublicLink(routeId: string, linkId: string): Promise<void> {
    await this.externalSubmissions.revokeLink(linkId);
    await this.loadRouteLinks(routeId);
  }

  async submitPublicIntake(
    publicLinkId: string,
    payload: Omit<
      ExternalRouteSubmission,
      'id' | 'routeId' | 'publicLinkId' | 'submittedAtIso' | 'convertedToRoute'
    >
  ) {
    const routeId = await this.externalSubmissions.resolveRouteIdFromLink(publicLinkId);
    if (!routeId) {
      throw new Error('The public link is no longer active.');
    }
    return this.externalSubmissions.createSubmission({
      ...payload,
      routeId,
      publicLinkId
    });
  }

  async convertSubmissionToStops(routeId: string, submission: ExternalRouteSubmission): Promise<void> {
    const route = await this.repository.getById(routeId);
    if (!route) {
      return;
    }

    const addresses = [
      submission.pickupAddress,
      ...submission.additionalStops,
      submission.destinationAddress
    ];

    const resolvedStops: RouteStop[] = [];
    for (let index = 0; index < addresses.length; index += 1) {
      const address = addresses[index];
      const suggestions = await this.searchAddress(address);
      const selectedSuggestion = suggestions[0];
      if (!selectedSuggestion) {
        continue;
      }
      const selected = await this.resolveAddress(
        selectedSuggestion.displayName,
        selectedSuggestion.magicKey
      );
      if (!selected || selected.lat === undefined || selected.lng === undefined) {
        continue;
      }
      resolvedStops.push({
        id: crypto.randomUUID(),
        label: `Stop ${index + 1}`,
        address: selected.displayName,
        lat: selected.lat,
        lng: selected.lng,
        notes: submission.notes
      });
    }

    if (!resolvedStops.length) {
      return;
    }

    const mergedStops = [...route.stops, ...resolvedStops];
    this.activeRoute.set({
      ...route,
      stops: mergedStops
    });
    await this.updateStops(mergedStops);
    const updatedRoute = this.activeRoute();
    if (!updatedRoute) {
      return;
    }
    await this.repository.update({
      ...updatedRoute,
      updatedAtIso: new Date().toISOString()
    });
    await this.externalSubmissions.attachSubmissionToRoute(routeId, submission.id);
    await this.loadRouteSubmissions(routeId);
    await this.refreshRoutes();
  }

  private buildVersionSnapshot(route: RoutePlan, reason: string): RouteVersionSnapshot {
    return {
      id: crypto.randomUUID(),
      createdAtIso: new Date().toISOString(),
      reason,
      stops: structuredClone(route.stops),
      manualOverride: route.manualOverride,
      manualRouteLocked: route.manualRouteLocked ?? false,
      legOverrides: structuredClone(route.legOverrides ?? []),
      routePath: route.routePath
    };
  }

  private applyOptimizationResult(
    result: Awaited<ReturnType<RouteOptimizationPort['optimize']>>,
    manualOverride: boolean
  ): void {
    const currentRoute = this.activeRoute();
    if (!currentRoute) {
      return;
    }
    this.activeRoute.set({
      ...currentRoute,
      manualOverride,
      manualRouteLocked: currentRoute.manualRouteLocked ?? false,
      stops: result.stops,
      metrics: result.metrics,
      legOverrides: currentRoute.legOverrides ?? [],
      routePath: result.routePath,
      routeAlternatives: result.routeAlternatives ?? []
    });
  }

  private ensureRouteDefaults(route: RoutePlan): RoutePlan {
    return {
      ...route,
      manualRouteLocked: route.manualRouteLocked ?? false,
      legOverrides: route.legOverrides ?? []
    };
  }

  private sanitizeLegOverrides(stops: RouteStop[], legOverrides: RouteLegOverride[]): RouteLegOverride[] {
    const validLegKeys = buildLegKeys(stops);
    return legOverrides.filter((override) => validLegKeys.has(override.legKey));
  }

  private clearHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.updateHistoryFlags();
  }

  private recordHistory(route: RoutePlan): void {
    this.undoStack.push(structuredClone(route));
    if (this.undoStack.length > RoutePlannerFacade.MAX_HISTORY_ENTRIES) {
      this.undoStack.splice(0, this.undoStack.length - RoutePlannerFacade.MAX_HISTORY_ENTRIES);
    }
    this.redoStack.length = 0;
    this.updateHistoryFlags();
  }

  private updateHistoryFlags(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }
}

function buildLegKeys(stops: RouteStop[]): Set<string> {
  const keys = new Set<string>();
  for (let index = 0; index < stops.length - 1; index += 1) {
    keys.add(`${stops[index].id}->${stops[index + 1].id}`);
  }
  return keys;
}

function upsertLegOverride(
  legOverrides: RouteLegOverride[],
  legKey: string,
  viaPoints: RouteViaPoint[]
): RouteLegOverride[] {
  if (viaPoints.length === 0) {
    return legOverrides.filter((override) => override.legKey !== legKey);
  }
  const withoutCurrent = legOverrides.filter((override) => override.legKey !== legKey);
  return [...withoutCurrent, { legKey, viaPoints }];
}
