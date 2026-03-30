import { RoutePlan, RouteSummary, RouteVersionSnapshot } from '../domain/route.models';

export interface RouteRepository {
  create(route: RoutePlan): Promise<RoutePlan>;
  update(route: RoutePlan): Promise<RoutePlan>;
  delete(routeId: string): Promise<void>;
  getById(routeId: string): Promise<RoutePlan | null>;
  list(): Promise<RouteSummary[]>;
  appendVersion(routeId: string, snapshot: RouteVersionSnapshot): Promise<void>;
  listVersions(routeId: string): Promise<RouteVersionSnapshot[]>;
}
