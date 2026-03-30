import { Routes } from '@angular/router';

export const SAVED_ROUTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./presentation/saved-routes.page').then((m) => m.SavedRoutesPage)
  }
];
