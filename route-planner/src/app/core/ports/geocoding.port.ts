export interface AddressSuggestion {
  displayName: string;
  lat?: number;
  lng?: number;
  magicKey?: string;
}

export interface GeocodingPort {
  searchAddress(query: string): Promise<AddressSuggestion[]>;
  resolveAddress(query: string, magicKey?: string): Promise<AddressSuggestion | null>;
}
