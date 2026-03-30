import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withHashLocation } from '@angular/router';
import { providePrimeNG } from 'primeng/config';
import Aura from '@primeuix/themes/aura';
import { MessageService } from 'primeng/api';
import { LocalDataStoreService } from './core/infrastructure/local-data-store.service';
import { NominatimGeocodingAdapter } from './core/infrastructure/nominatim-geocoding.adapter';
import { RouteOptimizationAdapter } from './core/infrastructure/route-optimization.adapter';
import {
  EXTERNAL_SUBMISSION_PORT,
  GEOCODING_PORT,
  ROUTE_OPTIMIZATION_PORT,
  ROUTE_REPOSITORY
} from './core/tokens/ports.tokens';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          prefix: 'p',
          darkModeSelector: '.app-dark',
          cssLayer: false
        }
      }
    }),
    MessageService,
    LocalDataStoreService,
    NominatimGeocodingAdapter,
    RouteOptimizationAdapter,
    {
      provide: ROUTE_REPOSITORY,
      useExisting: LocalDataStoreService
    },
    {
      provide: EXTERNAL_SUBMISSION_PORT,
      useExisting: LocalDataStoreService
    },
    {
      provide: GEOCODING_PORT,
      useExisting: NominatimGeocodingAdapter
    },
    {
      provide: ROUTE_OPTIMIZATION_PORT,
      useExisting: RouteOptimizationAdapter
    },
    provideRouter(routes, withHashLocation())
  ]
};
