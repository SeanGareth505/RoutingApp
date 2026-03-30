import { Injectable } from '@angular/core';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { RouteStop } from '../domain/route.models';

interface CsvStopRow {
  label: string;
  address: string;
  lat: string;
  lng: string;
  notes?: string;
}

export interface CsvImportReport {
  rows: RouteStop[];
  errors: string[];
  warnings: string[];
}

export interface GtfsExportOptions {
  agencyName: string;
  agencyUrl: string;
  agencyTimezone: string;
  routeShortName: string;
  routeLongName: string;
  routeType: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 11 | 12;
  tripHeadsign: string;
  startTime: string;
  stopSpacingMinutes: number;
  serviceStartDate: string;
  serviceEndDate: string;
  serviceDays: {
    monday: boolean;
    tuesday: boolean;
    wednesday: boolean;
    thursday: boolean;
    friday: boolean;
    saturday: boolean;
    sunday: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class CsvRouteService {
  exportStops(stops: RouteStop[]): string {
    const rows = stops.map((stop) => ({
      label: stop.label,
      address: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      notes: stop.notes ?? ''
    }));
    return Papa.unparse(rows);
  }

  importStops(fileContent: string): CsvImportReport {
    const result = Papa.parse<CsvStopRow>(fileContent, {
      header: true,
      skipEmptyLines: true
    });

    const errors: string[] = [];
    const warnings: string[] = [];
    const rows: RouteStop[] = [];
    const duplicateGuard = new Set<string>();

    result.data.forEach((row: CsvStopRow, index: number) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!row.label || !row.address || Number.isNaN(lat) || Number.isNaN(lng)) {
        errors.push(`Row ${index + 1} is invalid. Required: label, address, lat, lng.`);
        return;
      }
      rows.push({
        id: crypto.randomUUID(),
        label: row.label,
        address: row.address,
        lat,
        lng,
        notes: row.notes ?? ''
      });

      const duplicateKey = `${row.label.trim().toLowerCase()}|${lat.toFixed(6)}|${lng.toFixed(6)}`;
      if (duplicateGuard.has(duplicateKey)) {
        warnings.push(`Row ${index + 1} appears to be a duplicate checkpoint.`);
      } else {
        duplicateGuard.add(duplicateKey);
      }
    });

    if (!rows.length && !errors.length) {
      warnings.push('No rows were parsed from CSV input.');
    }

    return { rows, errors, warnings };
  }

  async exportGtfsZip(
    routeName: string,
    stops: RouteStop[],
    options?: Partial<GtfsExportOptions>
  ): Promise<Blob> {
    const defaults: GtfsExportOptions = {
      agencyName: 'Route Planner Agency',
      agencyUrl: 'https://example.com',
      agencyTimezone: 'Africa/Johannesburg',
      routeShortName: routeName.slice(0, 12) || 'Route',
      routeLongName: routeName || 'Exported Route',
      routeType: 3,
      tripHeadsign: stops.at(-1)?.label || routeName || 'Destination',
      startTime: '06:00:00',
      stopSpacingMinutes: 8,
      serviceStartDate: toHtmlDate(new Date()),
      serviceEndDate: toHtmlDate(addDays(new Date(), 365)),
      serviceDays: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true
      }
    };
    const config: GtfsExportOptions = {
      ...defaults,
      ...options,
      serviceDays: {
        ...defaults.serviceDays,
        ...(options?.serviceDays ?? {})
      }
    };

    const safeRouteId = toGtfsId(routeName || 'route_1');
    const tripId = `${safeRouteId}_trip_1`;
    const serviceId = `${safeRouteId}_service`;

    const agency = Papa.unparse([
      {
        agency_id: 'agency_1',
        agency_name: config.agencyName,
        agency_url: config.agencyUrl,
        agency_timezone: config.agencyTimezone
      }
    ]);

    const routes = Papa.unparse([
      {
        route_id: safeRouteId,
        agency_id: 'agency_1',
        route_short_name: config.routeShortName || routeName.slice(0, 12) || 'Route',
        route_long_name: config.routeLongName || routeName || 'Exported Route',
        route_type: config.routeType
      }
    ]);

    const trips = Papa.unparse([
      {
        route_id: safeRouteId,
        service_id: serviceId,
        trip_id: tripId,
        trip_headsign: config.tripHeadsign || stops.at(-1)?.label || routeName || 'Destination'
      }
    ]);

    const stopsRows = stops.map((stop, index) => ({
      stop_id: `stop_${index + 1}`,
      stop_name: stop.label || `Stop ${index + 1}`,
      stop_lat: stop.lat,
      stop_lon: stop.lng,
      stop_desc: stop.address
    }));
    const gtfsStops = Papa.unparse(stopsRows);

    const firstDepartureSeconds = parseGtfsTimeToSeconds(config.startTime);
    const stopSpacingMinutes = Math.max(1, Number(config.stopSpacingMinutes) || 8);
    const stopTimes = Papa.unparse(
      stopsRows.map((stop, index) => {
        const totalSeconds = firstDepartureSeconds + index * stopSpacingMinutes * 60;
        return {
          trip_id: tripId,
          arrival_time: toGtfsTime(totalSeconds),
          departure_time: toGtfsTime(totalSeconds + 60),
          stop_id: stop.stop_id,
          stop_sequence: index + 1
        };
      })
    );

    const calendar = Papa.unparse([
      {
        service_id: serviceId,
        monday: config.serviceDays.monday ? 1 : 0,
        tuesday: config.serviceDays.tuesday ? 1 : 0,
        wednesday: config.serviceDays.wednesday ? 1 : 0,
        thursday: config.serviceDays.thursday ? 1 : 0,
        friday: config.serviceDays.friday ? 1 : 0,
        saturday: config.serviceDays.saturday ? 1 : 0,
        sunday: config.serviceDays.sunday ? 1 : 0,
        start_date: normalizeGtfsDate(config.serviceStartDate),
        end_date: normalizeGtfsDate(config.serviceEndDate)
      }
    ]);

    const zip = new JSZip();
    zip.file('agency.txt', agency);
    zip.file('routes.txt', routes);
    zip.file('trips.txt', trips);
    zip.file('stops.txt', gtfsStops);
    zip.file('stop_times.txt', stopTimes);
    zip.file('calendar.txt', calendar);

    return zip.generateAsync({ type: 'blob' });
  }
}

function toGtfsId(value: string): string {
  const cleaned = value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '_');
  return cleaned.length ? cleaned : 'route_1';
}

function toGtfsTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

function toGtfsDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date.getTime());
  clone.setDate(clone.getDate() + days);
  return clone;
}

function toHtmlDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeGtfsDate(value: string): string {
  const cleaned = value.replaceAll('-', '').trim();
  if (/^\d{8}$/.test(cleaned)) {
    return cleaned;
  }
  return toGtfsDate(new Date());
}

function parseGtfsTimeToSeconds(value: string): number {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return 6 * 3600;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    minutes > 59 ||
    seconds > 59
  ) {
    return 6 * 3600;
  }
  return hours * 3600 + minutes * 60 + seconds;
}
