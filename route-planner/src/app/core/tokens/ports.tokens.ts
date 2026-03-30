import { InjectionToken } from '@angular/core';
import { ExternalSubmissionPort } from '../ports/external-submission.port';
import { GeocodingPort } from '../ports/geocoding.port';
import { RouteOptimizationPort } from '../ports/route-optimization.port';
import { RouteRepository } from '../ports/route-repository.port';

export const ROUTE_REPOSITORY = new InjectionToken<RouteRepository>('ROUTE_REPOSITORY');
export const ROUTE_OPTIMIZATION_PORT = new InjectionToken<RouteOptimizationPort>(
  'ROUTE_OPTIMIZATION_PORT'
);
export const GEOCODING_PORT = new InjectionToken<GeocodingPort>('GEOCODING_PORT');
export const EXTERNAL_SUBMISSION_PORT = new InjectionToken<ExternalSubmissionPort>(
  'EXTERNAL_SUBMISSION_PORT'
);
