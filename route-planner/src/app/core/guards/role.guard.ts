import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LocalAuthAdapter } from '../auth/local-auth.adapter';
import { UserRole } from '../domain/route.models';

export const roleGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const auth = inject(LocalAuthAdapter);
  const roles = (route.data['roles'] as UserRole[] | undefined) ?? ['admin'];

  if (auth.hasRole(roles)) {
    return true;
  }

  return router.createUrlTree(['/dashboard']);
};
