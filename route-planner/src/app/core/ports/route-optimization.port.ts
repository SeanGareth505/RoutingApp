import { RouteOptimizationInput, RouteOptimizationResult } from '../domain/route.models';

export interface RouteOptimizationPort {
  optimize(input: RouteOptimizationInput): Promise<RouteOptimizationResult>;
}
