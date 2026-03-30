import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'route_planner_theme';
const DARK_CLASS = 'app-dark';

@Injectable({ providedIn: 'root' })
export class ThemeStore {
  readonly mode = signal<ThemeMode>(this.readMode());

  constructor() {
    this.applyTheme(this.mode());
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
    localStorage.setItem(STORAGE_KEY, mode);
    this.applyTheme(mode);
  }

  toggle(): void {
    const nextMode: ThemeMode = this.mode() === 'dark' ? 'light' : 'dark';
    this.setMode(nextMode);
  }

  private applyTheme(mode: ThemeMode): void {
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add(DARK_CLASS);
      return;
    }
    root.classList.remove(DARK_CLASS);
  }

  private readMode(): ThemeMode {
    const stored = localStorage.getItem(STORAGE_KEY);
    switch (stored) {
      case 'light':
      case 'dark':
        return stored;
      default:
        return 'light';
    }
  }
}
