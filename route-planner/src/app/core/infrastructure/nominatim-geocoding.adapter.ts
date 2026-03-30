import { inject, Injectable } from '@angular/core';
import { AddressSuggestion, GeocodingPort } from '../ports/geocoding.port';
import { SettingsStore } from '../application/settings.store';

interface SuggestResponse {
  suggestions: AddressSuggestion[];
}

interface ResolveResponse {
  result: AddressSuggestion | null;
}

interface ArcGisSuggestResponse {
  suggestions: Array<{
    text: string;
    magicKey: string;
    isCollection: boolean;
  }>;
}

interface ArcGisResolveResponse {
  candidates: Array<{
    address: string;
    location: {
      x: number;
      y: number;
    };
  }>;
}

@Injectable({ providedIn: 'root' })
export class NominatimGeocodingAdapter implements GeocodingPort {
  private readonly settingsStore = inject(SettingsStore);
  private readonly cache = new Map<string, { expiresAt: number; items: AddressSuggestion[] }>();
  private readonly suggestInFlight = new Map<string, Promise<AddressSuggestion[]>>();
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly requestTimeoutMs = 4000;

  async searchAddress(query: string): Promise<AddressSuggestion[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < 3) {
      return [];
    }

    const key = trimmedQuery.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.items;
    }

    const pending = this.suggestInFlight.get(key);
    if (pending) {
      return pending;
    }

    const task = this.fetchSuggestions(trimmedQuery)
      .then((items) => {
        this.cache.set(key, {
          expiresAt: Date.now() + this.cacheTtlMs,
          items
        });
        return items;
      })
      .finally(() => {
        this.suggestInFlight.delete(key);
      });

    this.suggestInFlight.set(key, task);
    return task;
  }

  async resolveAddress(query: string, magicKey?: string): Promise<AddressSuggestion | null> {
    const proxyResult = await this.resolveViaProxy(query, magicKey);
    if (proxyResult !== null) {
      return proxyResult;
    }
    return this.resolveDirectArcGis(query, magicKey);
  }

  private async fetchSuggestions(query: string): Promise<AddressSuggestion[]> {
    const proxySuggestions = await this.fetchSuggestionsViaProxy(query);
    if (proxySuggestions !== null) {
      return proxySuggestions;
    }
    return this.fetchSuggestionsDirectArcGis(query);
  }

  private async fetchSuggestionsViaProxy(query: string): Promise<AddressSuggestion[] | null> {
    const endpoint = this.buildApiEndpoint('/geocode/suggest');
    if (!endpoint) {
      return null;
    }
    endpoint.searchParams.set('q', query);

    try {
      const response = await this.fetchWithTimeout(endpoint.toString());
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as SuggestResponse;
      return data.suggestions ?? [];
    } catch {
      return null;
    }
  }

  private async fetchSuggestionsDirectArcGis(query: string): Promise<AddressSuggestion[]> {
    const endpoint = new URL(
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest'
    );
    endpoint.searchParams.set('f', 'json');
    endpoint.searchParams.set('text', query);
    endpoint.searchParams.set('maxSuggestions', '8');

    try {
      const response = await this.fetchWithTimeout(endpoint.toString());
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as ArcGisSuggestResponse;
      return (payload.suggestions ?? [])
        .filter((item) => !item.isCollection)
        .map((item) => ({
          displayName: item.text,
          magicKey: item.magicKey
        }));
    } catch {
      return [];
    }
  }

  private async resolveViaProxy(query: string, magicKey?: string): Promise<AddressSuggestion | null> {
    const endpoint = this.buildApiEndpoint('/geocode/resolve');
    if (!endpoint) {
      return null;
    }

    endpoint.searchParams.set('text', query);
    if (magicKey) {
      endpoint.searchParams.set('magicKey', magicKey);
    }

    try {
      const response = await this.fetchWithTimeout(endpoint.toString());
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as ResolveResponse;
      return data.result;
    } catch {
      return null;
    }
  }

  private async resolveDirectArcGis(
    query: string,
    magicKey?: string
  ): Promise<AddressSuggestion | null> {
    const endpoint = new URL(
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates'
    );
    endpoint.searchParams.set('f', 'json');
    endpoint.searchParams.set('SingleLine', query);
    endpoint.searchParams.set('maxLocations', '1');
    endpoint.searchParams.set('outSR', '4326');
    if (magicKey) {
      endpoint.searchParams.set('magicKey', magicKey);
    }

    try {
      const response = await this.fetchWithTimeout(endpoint.toString());
      if (!response.ok) {
        return null;
      }
      const payload = (await response.json()) as ArcGisResolveResponse;
      const topCandidate = payload.candidates?.[0];
      if (!topCandidate) {
        return null;
      }
      return {
        displayName: topCandidate.address,
        lat: topCandidate.location.y,
        lng: topCandidate.location.x
      };
    } catch {
      return null;
    }
  }

  private buildApiEndpoint(path: string): URL | null {
    const baseUrl = this.settingsStore.settings().apiBaseUrl.trim();
    if (!baseUrl) {
      return null;
    }
    if (/^https?:\/\//i.test(baseUrl)) {
      return new URL(`${trimTrailingSlash(baseUrl)}${path}`);
    }
    return new URL(`${normalizeBasePath(baseUrl)}${path}`, window.location.origin);
  }

  private async fetchWithTimeout(input: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await fetch(input, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeBasePath(value: string): string {
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return trimTrailingSlash(withLeadingSlash);
}
