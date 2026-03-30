import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { RoutePlan, RouteSummary, RouteVersionSnapshot } from '../domain/route.models';
import {
  ExternalRouteSubmission,
  PublicIntakeLink,
  SubmissionReceipt
} from '../domain/submission.models';
import { ExternalSubmissionPort } from '../ports/external-submission.port';
import { RouteRepository } from '../ports/route-repository.port';

interface PlannerDb extends DBSchema {
  routes: {
    key: string;
    value: RoutePlan;
  };
  links: {
    key: string;
    value: PublicIntakeLink;
    indexes: { 'by-route': string };
  };
  submissions: {
    key: string;
    value: ExternalRouteSubmission;
    indexes: { 'by-route': string; 'by-link': string };
  };
}

@Injectable({ providedIn: 'root' })
export class LocalDataStoreService implements RouteRepository, ExternalSubmissionPort {
  private databasePromise: Promise<IDBPDatabase<PlannerDb>> = openDB<PlannerDb>(
    'route-planner-db',
    1,
    {
      upgrade(database) {
        const routes = database.createObjectStore('routes', { keyPath: 'id' });

        const links = database.createObjectStore('links', { keyPath: 'id' });
        links.createIndex('by-route', 'routeId');

        const submissions = database.createObjectStore('submissions', {
          keyPath: 'id'
        });
        submissions.createIndex('by-route', 'routeId');
        submissions.createIndex('by-link', 'publicLinkId');
      }
    }
  );

  async create(route: RoutePlan): Promise<RoutePlan> {
    const db = await this.databasePromise;
    await db.put('routes', route);
    return route;
  }

  async update(route: RoutePlan): Promise<RoutePlan> {
    const db = await this.databasePromise;
    await db.put('routes', route);
    return route;
  }

  async delete(routeId: string): Promise<void> {
    const db = await this.databasePromise;
    await db.delete('routes', routeId);
  }

  async getById(routeId: string): Promise<RoutePlan | null> {
    const db = await this.databasePromise;
    return (await db.get('routes', routeId)) ?? null;
  }

  async list(): Promise<RouteSummary[]> {
    const db = await this.databasePromise;
    const routes = await db.getAll('routes');
    return routes
      .sort((left, right) => right.updatedAtIso.localeCompare(left.updatedAtIso))
      .map((route) => ({
        id: route.id,
        name: route.name,
        stopCount: route.stops.length,
        updatedAtIso: route.updatedAtIso,
        totalDistanceKm: route.metrics.totalDistanceKm
      }));
  }

  async appendVersion(routeId: string, snapshot: RouteVersionSnapshot): Promise<void> {
    const route = await this.getById(routeId);
    if (!route) {
      return;
    }
    const updatedRoute: RoutePlan = {
      ...route,
      versions: [snapshot, ...route.versions].slice(0, 25),
      updatedAtIso: new Date().toISOString()
    };
    await this.update(updatedRoute);
  }

  async listVersions(routeId: string): Promise<RouteVersionSnapshot[]> {
    const route = await this.getById(routeId);
    return route?.versions ?? [];
  }

  async createLink(routeId: string): Promise<PublicIntakeLink> {
    const db = await this.databasePromise;
    const link: PublicIntakeLink = {
      id: crypto.randomUUID(),
      routeId,
      active: true,
      createdAtIso: new Date().toISOString()
    };
    await db.put('links', link);
    return link;
  }

  async listLinks(routeId: string): Promise<PublicIntakeLink[]> {
    const db = await this.databasePromise;
    const links = await db.getAllFromIndex('links', 'by-route', routeId);
    return links.sort((left, right) => right.createdAtIso.localeCompare(left.createdAtIso));
  }

  async revokeLink(linkId: string): Promise<void> {
    const db = await this.databasePromise;
    const link = await db.get('links', linkId);
    if (!link) {
      return;
    }
    await db.put('links', { ...link, active: false });
  }

  async createSubmission(
    payload: Omit<ExternalRouteSubmission, 'id' | 'submittedAtIso' | 'convertedToRoute'>
  ): Promise<SubmissionReceipt> {
    const db = await this.databasePromise;
    const submissionId = crypto.randomUUID();
    const confirmationCode = submissionId.slice(0, 8).toUpperCase();
    const record: ExternalRouteSubmission = {
      ...payload,
      id: submissionId,
      submittedAtIso: new Date().toISOString(),
      convertedToRoute: false
    };
    await db.put('submissions', record);
    return { submissionId, confirmationCode };
  }

  async listSubmissionsForRoute(routeId: string): Promise<ExternalRouteSubmission[]> {
    const db = await this.databasePromise;
    const rows = await db.getAllFromIndex('submissions', 'by-route', routeId);
    return rows.sort((left, right) => right.submittedAtIso.localeCompare(left.submittedAtIso));
  }

  async listSubmissionsByLink(publicLinkId: string): Promise<ExternalRouteSubmission[]> {
    const db = await this.databasePromise;
    const rows = await db.getAllFromIndex('submissions', 'by-link', publicLinkId);
    return rows.sort((left, right) => right.submittedAtIso.localeCompare(left.submittedAtIso));
  }

  async attachSubmissionToRoute(routeId: string, submissionId: string): Promise<void> {
    const db = await this.databasePromise;
    const submission = await db.get('submissions', submissionId);
    if (!submission) {
      return;
    }
    await db.put('submissions', {
      ...submission,
      routeId,
      convertedToRoute: true
    });
  }

  async resolveRouteIdFromLink(publicLinkId: string): Promise<string | null> {
    const db = await this.databasePromise;
    const link = await db.get('links', publicLinkId);
    if (!link || !link.active) {
      return null;
    }
    return link.routeId;
  }
}
