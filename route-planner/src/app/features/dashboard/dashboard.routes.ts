import { Routes } from '@angular/router';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./presentation/dashboard.page').then((m) => m.DashboardPage)
  }
];
