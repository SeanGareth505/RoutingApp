import { Injectable, signal } from '@angular/core';

const SETTINGS_STORAGE_KEY = 'route_planner_settings';

export interface PlannerSettings {
  routingProvider: 'local' | 'openrouteservice';
  geocodingProvider: 'nominatim';
  retentionDays: number;
  antiSpamMinSeconds: number;
  enableSilentChallenge: boolean;
  providerApiKey: string;
  apiBaseUrl: string;
  editorLongPressMs: number;
  snapViaPoints: boolean;
}

const DEFAULT_SETTINGS: PlannerSettings = {
  routingProvider: 'local',
  geocodingProvider: 'nominatim',
  retentionDays: 90,
  antiSpamMinSeconds: 5,
  enableSilentChallenge: false,
  providerApiKey: '',
  apiBaseUrl: '',
  editorLongPressMs: 180,
  snapViaPoints: true
};

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly settings = signal<PlannerSettings>(this.readSettings());

  update(next: PlannerSettings): void {
    this.settings.set(next);
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  }

  private readSettings(): PlannerSettings {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_SETTINGS;
    }

    try {
      const parsed = JSON.parse(stored) as Partial<PlannerSettings>;
      return {
        ...DEFAULT_SETTINGS,
        ...parsed
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}
