import { inject, Injectable } from '@angular/core';
import { RouteLegOverride, RouteStop } from '../domain/route.models';
import { RouteOptimizationPort } from '../ports/route-optimization.port';
import { buildMetrics, haversineDistanceKm } from '../../shared/utils/geo';
import { SettingsStore } from '../application/settings.store';

interface ProxyRouteResponse {
  provider: string;
  primary?: {
    coordinates: Array<{ lat: number; lng: number }>;
    metrics: {
      totalDistanceKm: number;
      estimatedMinutes: number;
    };
  };
  alternatives?: Array<{
    coordinates: Array<{ lat: number; lng: number }>;
    metrics: {
      totalDistanceKm: number;
      estimatedMinutes: number;
    };
  }>;
}

interface RouteCoordinate {
  lat: number;
  lng: number;
}

@Injectable({ providedIn: 'root' })
export class RouteOptimizationAdapter implements RouteOptimizationPort {
  private readonly settingsStore = inject(SettingsStore);

  async optimize(input: {
    stops: RouteStop[];
    lockFixedStops: boolean;
    preserveOrder?: boolean;
    includeAlternatives?: boolean;
    manualRouteLocked?: boolean;
    legOverrides?: RouteLegOverride[];
  }) {
    if (input.stops.length <= 1) {
      return {
        stops: input.stops,
        metrics: buildMetrics(input.stops),
        routePath: {
          coordinates: input.stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
          metrics: buildMetrics(input.stops)
        },
        routeAlternatives: []
      };
    }

    const stops = input.preserveOrder || input.manualRouteLocked
      ? [...input.stops]
      : optimizeStopOrder(input.stops, input.lockFixedStops);
    const expandedCoordinates = buildExpandedCoordinates(stops, input.legOverrides ?? []);

    try {
      const routeData = await this.fetchDrivingRoute(
        expandedCoordinates,
        Boolean(input.includeAlternatives)
      );
      if (!routeData?.primary) {
        throw new Error('Missing primary route path');
      }

      return {
        stops,
        metrics: routeData.primary.metrics,
        routePath: {
          coordinates: routeData.primary.coordinates,
          metrics: routeData.primary.metrics
        },
        routeAlternatives: (routeData.alternatives ?? []).map((alternative) => ({
          coordinates: alternative.coordinates,
          metrics: alternative.metrics
        })),
        provider: routeData.provider
      };
    } catch {
      const fallbackMetrics = buildMetrics(stops);
      return {
        stops,
        metrics: fallbackMetrics,
        routePath: {
          coordinates: expandedCoordinates,
          metrics: fallbackMetrics
        },
        routeAlternatives: []
      };
    }
  }

  private async fetchDrivingRoute(
    coordinates: RouteCoordinate[],
    includeAlternatives: boolean
  ): Promise<ProxyRouteResponse> {
    const proxyResponse = await this.fetchRouteViaProxy(coordinates, includeAlternatives);
    if (proxyResponse) {
      return proxyResponse;
    }

    const directResponse = await this.fetchRouteDirectOsrm(coordinates, includeAlternatives);
    if (!directResponse) {
      throw new Error('Route provider request failed');
    }
    return directResponse;
  }

  private async fetchRouteViaProxy(
    coordinates: RouteCoordinate[],
    includeAlternatives: boolean
  ): Promise<ProxyRouteResponse | null> {
    const endpoint = this.buildApiEndpoint('/route/driving');
    if (!endpoint) {
      return null;
    }

    try {
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stops: coordinates,
          includeAlternatives
        })
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as ProxyRouteResponse;
    } catch {
      return null;
    }
  }

  private async fetchRouteDirectOsrm(
    coordinates: RouteCoordinate[],
    includeAlternatives: boolean
  ): Promise<ProxyRouteResponse | null> {
    const queryCoordinates = coordinates.map((item) => `${item.lng},${item.lat}`).join(';');
    const endpoint = new URL(`https://router.project-osrm.org/route/v1/driving/${queryCoordinates}`);
    endpoint.searchParams.set('overview', 'full');
    endpoint.searchParams.set('geometries', 'geojson');
    endpoint.searchParams.set('steps', 'false');
    endpoint.searchParams.set('alternatives', includeAlternatives ? 'true' : 'false');

    try {
      const response = await fetch(endpoint.toString());
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: Array<[number, number]> };
        }>;
      };
      const routes = payload.routes ?? [];
      if (!routes.length) {
        return null;
      }

      const mapped = routes.map((route) => ({
        coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        metrics: {
          totalDistanceKm: round(route.distance / 1000),
          estimatedMinutes: Math.round(route.duration / 60)
        }
      }));
      return {
        provider: 'osrm-direct',
        primary: mapped[0],
        alternatives: mapped.slice(1)
      };
    } catch {
      return null;
    }
  }

  private buildApiEndpoint(path: string): URL | null {
    const baseUrl = this.settingsStore.settings().apiBaseUrl.trim();
    if (!baseUrl) {
      return null;
    }
    if (/^https?:\/\//i.test(baseUrl)) {
      return new URL(`${trimTrailingSlash(baseUrl)}${path}`);
    }
    return new URL(`${normalizeBasePath(baseUrl)}${path}`, window.location.origin);
  }
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return trimTrailingSlash(withLeadingSlash);
}

function buildExpandedCoordinates(
  stops: RouteStop[],
  legOverrides: RouteLegOverride[]
): RouteCoordinate[] {
  if (!stops.length) {
    return [];
  }

  const overridesByLegKey = new Map<string, RouteLegOverride>(
    legOverrides.map((override) => [override.legKey, override])
  );
  const expanded: RouteCoordinate[] = [{ lat: stops[0].lat, lng: stops[0].lng }];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const fromStop = stops[index];
    const toStop = stops[index + 1];
    const legKey = createLegKey(fromStop.id, toStop.id);
    const viaPoints = overridesByLegKey.get(legKey)?.viaPoints ?? [];

    viaPoints.forEach((point) => {
      expanded.push({ lat: point.lat, lng: point.lng });
    });
    expanded.push({ lat: toStop.lat, lng: toStop.lng });
  }

  return expanded;
}

function createLegKey(fromStopId: string, toStopId: string): string {
  return `${fromStopId}->${toStopId}`;
}

function optimizeStopOrder(stops: RouteStop[], lockFixedStops: boolean): RouteStop[] {
  if (stops.length <= 2) {
    return [...stops];
  }

  const [start, ...rest] = stops;
  const locked = rest.filter((stop) => stop.locked && lockFixedStops);
  const movable = rest.filter((stop) => !stop.locked || !lockFixedStops);
  const orderedMovable = nearestNeighbor(start, movable);
  return [start, ...orderedMovable, ...locked];
}

function nearestNeighbor(seed: RouteStop, candidates: RouteStop[]): RouteStop[] {
  const ordered: RouteStop[] = [];
  const pending = [...candidates];
  let current = seed;

  while (pending.length) {
    let bestIndex = 0;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    pending.forEach((candidate, index) => {
      const distance = haversineDistanceKm(current, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const next = pending.splice(bestIndex, 1)[0];
    ordered.push(next);
    current = next;
  }

  return ordered;
}
