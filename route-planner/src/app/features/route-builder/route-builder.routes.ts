import { Routes } from '@angular/router';

export const ROUTE_BUILDER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./presentation/route-builder.page').then((m) => m.RouteBuilderPage)
  }
];
