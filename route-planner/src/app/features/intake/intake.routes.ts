import { Routes } from '@angular/router';

export const INTAKE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./presentation/intake.page').then((m) => m.IntakePage)
  }
];
