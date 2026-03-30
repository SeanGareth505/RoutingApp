import { Routes } from '@angular/router';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./core/layout/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES)
      },
      {
        path: 'route-builder',
        loadChildren: () =>
          import('./features/route-builder/route-builder.routes').then(
            (m) => m.ROUTE_BUILDER_ROUTES
          )
      },
      {
        path: 'saved-routes',
        loadChildren: () =>
          import('./features/saved-routes/saved-routes.routes').then(
            (m) => m.SAVED_ROUTES_ROUTES
          )
      },
      {
        path: 'settings',
        canActivate: [roleGuard],
        data: { roles: ['admin'] },
        loadChildren: () =>
          import('./features/settings/settings.routes').then((m) => m.SETTINGS_ROUTES)
      }
    ]
  },
  {
    path: 'intake/:publicLinkId',
    loadChildren: () =>
      import('./features/intake/intake.routes').then((m) => m.INTAKE_ROUTES)
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
