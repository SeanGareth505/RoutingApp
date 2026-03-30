export type UserRole = 'admin' | 'dispatcher' | 'viewer';

export interface RouteStop {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  notes?: string;
  locked?: boolean;
}

export interface RouteMetrics {
  totalDistanceKm: number;
  estimatedMinutes: number;
}

export interface RoutePathPoint {
  lat: number;
  lng: number;
}

export interface RouteViaPoint extends RoutePathPoint {
  id: string;
}

export interface RouteLegOverride {
  legKey: string;
  viaPoints: RouteViaPoint[];
}

export interface RoutePath {
  coordinates: RoutePathPoint[];
  metrics: RouteMetrics;
}

export interface RouteVersionSnapshot {
  id: string;
  createdAtIso: string;
  reason: string;
  stops: RouteStop[];
  manualOverride: boolean;
  manualRouteLocked?: boolean;
  legOverrides?: RouteLegOverride[];
  routePath?: RoutePath;
}

export interface RoutePlan {
  id: string;
  name: string;
  createdAtIso: string;
  updatedAtIso: string;
  manualOverride: boolean;
  manualRouteLocked?: boolean;
  metrics: RouteMetrics;
  stops: RouteStop[];
  legOverrides?: RouteLegOverride[];
  routePath?: RoutePath;
  routeAlternatives?: RoutePath[];
  versions: RouteVersionSnapshot[];
}

export interface RouteSummary {
  id: string;
  name: string;
  stopCount: number;
  updatedAtIso: string;
  totalDistanceKm: number;
}

export interface RouteOptimizationInput {
  stops: RouteStop[];
  lockFixedStops: boolean;
  preserveOrder?: boolean;
  includeAlternatives?: boolean;
  manualRouteLocked?: boolean;
  legOverrides?: RouteLegOverride[];
}

export interface RouteOptimizationResult {
  stops: RouteStop[];
  metrics: RouteMetrics;
  routePath?: RoutePath;
  routeAlternatives?: RoutePath[];
  provider?: string;
}
