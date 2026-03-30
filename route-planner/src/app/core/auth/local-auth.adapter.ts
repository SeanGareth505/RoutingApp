import { Injectable, computed, signal } from '@angular/core';
import { UserRole } from '../domain/route.models';

const STORAGE_KEY = 'route_planner_role';

@Injectable({ providedIn: 'root' })
export class LocalAuthAdapter {
  private readonly roleState = signal<UserRole>(this.readRole());
  readonly role = computed(() => this.roleState());

  setRole(role: UserRole): void {
    this.roleState.set(role);
    localStorage.setItem(STORAGE_KEY, role);
  }

  hasRole(allowedRoles: readonly UserRole[]): boolean {
    return allowedRoles.includes(this.roleState());
  }

  private readRole(): UserRole {
    const storedRole = localStorage.getItem(STORAGE_KEY);
    switch (storedRole) {
      case 'admin':
      case 'dispatcher':
      case 'viewer':
        return storedRole;
      default:
        return 'admin';
    }
  }
}
