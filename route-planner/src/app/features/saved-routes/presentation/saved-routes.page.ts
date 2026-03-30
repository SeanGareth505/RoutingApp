import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { RoutePlannerFacade } from '../../../core/application/route-planner.facade';
import { CsvRouteService, GtfsExportOptions } from '../../../core/infrastructure/csv-route.service';
import { MessageService } from 'primeng/api';
import { RouteStop, RouteVersionSnapshot } from '../../../core/domain/route.models';
import { ExternalRouteSubmission } from '../../../core/domain/submission.models';
import { SelectButtonModule } from 'primeng/selectbutton';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';

@Component({
  selector: 'app-saved-routes-page',
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    CardModule,
    DialogModule,
    TagModule,
    DatePipe,
    SelectButtonModule,
    FormsModule,
    InputTextModule,
    InputNumberModule
  ],
  template: `
    <p-card>
      <div class="header">
        <h3>Saved Routes</h3>
        <div class="tools">
          <label class="file-input">
            Import CSV
            <input type="file" accept=".csv" (change)="importCsv($event)" />
          </label>
        </div>
      </div>

      <p-table [value]="routes()" dataKey="id" responsiveLayout="scroll">
        <ng-template pTemplate="header">
          <tr>
            <th>Name</th>
            <th>Stops</th>
            <th>Distance</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-route>
          <tr>
            <td>{{ route.name }}</td>
            <td>{{ route.stopCount }}</td>
            <td>{{ route.totalDistanceKm }} km</td>
            <td>{{ route.updatedAtIso | date: 'medium' }}</td>
            <td class="actions">
              <button pButton type="button" class="p-button-text" (click)="openBuilder(route.id)">
                Open
              </button>
              <button pButton type="button" class="p-button-text" (click)="openVersions(route.id)">
                Versions
              </button>
              <button pButton type="button" class="p-button-text" (click)="openSubmissions(route.id)">
                Submissions
              </button>
              <button pButton type="button" class="p-button-text" (click)="exportCsv(route.id)">
                Export CSV
              </button>
              <button pButton type="button" class="p-button-text" (click)="exportGtfs(route.id)">
                Export GTFS
              </button>
              <button pButton type="button" class="p-button-text" (click)="createLink(route.id)">
                Create link
              </button>
              <button pButton type="button" class="p-button-text p-button-danger" (click)="remove(route.id)">
                Delete
              </button>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>

    <p-dialog
      header="CSV Import Workflow"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [visible]="csvDialog()"
      (visibleChange)="csvDialog.set($event)"
    >
      <div class="csv-config">
        <label>Import mode</label>
        <p-selectbutton
          [options]="csvModeOptions"
          [(ngModel)]="csvMode"
          optionLabel="label"
          optionValue="value"
        ></p-selectbutton>

        @if (csvMode !== 'new') {
          <label for="targetRoute">Target route</label>
          <select id="targetRoute" [(ngModel)]="csvTargetRouteId" class="route-select">
            <option value="">Select target route</option>
            @for (route of routes(); track route.id) {
              <option [value]="route.id">{{ route.name }}</option>
            }
          </select>
        }

        <div class="report-block">
          <strong>Rows parsed: {{ csvParsedRowsCount() }}</strong>
          @if (csvErrors().length) {
            <p class="report-title">Errors</p>
            <ul>
              @for (item of csvErrors(); track $index) {
                <li>{{ item }}</li>
              }
            </ul>
          }
          @if (csvWarnings().length) {
            <p class="report-title">Warnings</p>
            <ul>
              @for (item of csvWarnings(); track $index) {
                <li>{{ item }}</li>
              }
            </ul>
          }
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" class="p-button-text" (click)="csvDialog.set(false)">Cancel</button>
        <button pButton type="button" [disabled]="csvErrors().length > 0" (click)="applyCsvImport()">
          Apply import
        </button>
      </ng-template>
    </p-dialog>

    <p-dialog
      header="GTFS Export Options"
      [modal]="true"
      [style]="{ width: '42rem' }"
      [visible]="gtfsDialog()"
      (visibleChange)="gtfsDialog.set($event)"
    >
      <div class="csv-config">
        <div class="gtfs-grid">
          <label for="agencyName">Agency name</label>
          <input id="agencyName" pInputText [(ngModel)]="gtfsOptions.agencyName" />

          <label for="agencyUrl">Agency URL</label>
          <input id="agencyUrl" pInputText [(ngModel)]="gtfsOptions.agencyUrl" />

          <label for="agencyTimezone">Timezone</label>
          <input id="agencyTimezone" pInputText [(ngModel)]="gtfsOptions.agencyTimezone" />

          <label for="routeShortName">Route short name</label>
          <input id="routeShortName" pInputText [(ngModel)]="gtfsOptions.routeShortName" />

          <label for="routeLongName">Route long name</label>
          <input id="routeLongName" pInputText [(ngModel)]="gtfsOptions.routeLongName" />

          <label for="routeType">Route type</label>
          <select id="routeType" [(ngModel)]="gtfsOptions.routeType" class="route-select">
            @for (type of gtfsRouteTypeOptions; track type.value) {
              <option [value]="type.value">{{ type.label }}</option>
            }
          </select>

          <label for="tripHeadsign">Trip headsign</label>
          <input id="tripHeadsign" pInputText [(ngModel)]="gtfsOptions.tripHeadsign" />

          <label for="startTime">Start time</label>
          <input id="startTime" pInputText [(ngModel)]="gtfsOptions.startTime" placeholder="06:00:00" />

          <label for="spacingMinutes">Stop spacing (minutes)</label>
          <p-inputnumber
            id="spacingMinutes"
            [(ngModel)]="gtfsOptions.stopSpacingMinutes"
            [min]="1"
            [max]="120"
          ></p-inputnumber>

          <label for="serviceStart">Service start date</label>
          <input id="serviceStart" type="date" [(ngModel)]="gtfsOptions.serviceStartDate" class="route-select" />

          <label for="serviceEnd">Service end date</label>
          <input id="serviceEnd" type="date" [(ngModel)]="gtfsOptions.serviceEndDate" class="route-select" />
        </div>

        <div class="service-days">
          <strong>Service days</strong>
          @for (day of gtfsServiceDayLabels; track day.key) {
            <label>
              <input type="checkbox" [(ngModel)]="gtfsOptions.serviceDays[day.key]" />
              {{ day.label }}
            </label>
          }
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton type="button" class="p-button-text" (click)="gtfsDialog.set(false)">Cancel</button>
        <button pButton type="button" (click)="confirmGtfsExport()">Export GTFS ZIP</button>
      </ng-template>
    </p-dialog>

    <p-card class="links-card">
      <h4>Public intake links</h4>
      @for (link of links(); track link.id) {
        <div class="link-row">
          <p-tag [severity]="link.active ? 'success' : 'danger'" [value]="link.active ? 'Active' : 'Revoked'"></p-tag>
          <code>{{ buildPublicUrl(link.id) }}</code>
        </div>
      }
    </p-card>

    <p-dialog
      header="Version History"
      [modal]="true"
      [style]="{ width: '34rem' }"
      [visible]="versionsDialog()"
      (visibleChange)="versionsDialog.set($event)"
    >
      @for (version of versions(); track version.id) {
        <article class="version-row">
          <div>
            <strong>{{ version.createdAtIso | date: 'medium' }}</strong>
            <p>{{ version.reason }}</p>
          </div>
          <button pButton type="button" class="p-button-text" (click)="restoreSelected(version)">
            Restore
          </button>
        </article>
      }
    </p-dialog>

    <p-dialog
      header="Pending Submissions"
      [modal]="true"
      [style]="{ width: '38rem' }"
      [visible]="submissionsDialog()"
      (visibleChange)="submissionsDialog.set($event)"
    >
      @for (submission of submissions(); track submission.id) {
        <article class="version-row">
          <div>
            <strong>{{ submission.submitterName }}</strong>
            <p>{{ submission.pickupAddress }} -> {{ submission.destinationAddress }}</p>
            <p>Contact: {{ submission.submitterContact }}</p>
          </div>
          <button
            pButton
            type="button"
            class="p-button-text"
            [disabled]="submission.convertedToRoute"
            (click)="convertSubmission(submission)"
          >
            {{ submission.convertedToRoute ? 'Converted' : 'Convert' }}
          </button>
        </article>
      }
    </p-dialog>
  `,
  styles: [
    `
      .header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: center;
        margin-bottom: 1rem;
      }
      .file-input {
        display: inline-flex;
        padding: 0.4rem 0.65rem;
        border: 1px solid #d0d5dd;
        border-radius: 0.5rem;
        cursor: pointer;
      }
      .file-input input {
        display: none;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
      }
      .links-card {
        margin-top: 1rem;
      }
      .link-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.4rem 0;
      }
      .version-row {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        border-bottom: 1px solid #eaecf0;
        padding: 0.5rem 0;
      }
      .version-row p {
        margin: 0;
        color: #667085;
      }
      .csv-config {
        display: grid;
        gap: 0.7rem;
      }
      .route-select {
        border: 1px solid var(--border-color);
        border-radius: 0.5rem;
        padding: 0.4rem 0.5rem;
        background: var(--surface-elevated);
        color: var(--text-primary);
      }
      .report-block {
        max-height: 220px;
        overflow: auto;
        border: 1px solid var(--border-color);
        border-radius: 0.65rem;
        padding: 0.6rem;
        background: var(--surface-elevated);
      }
      .report-title {
        margin: 0.45rem 0 0.25rem;
        font-weight: 600;
      }
      .report-block ul {
        margin: 0;
        padding-left: 1rem;
        color: var(--text-muted);
      }
      .gtfs-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.6rem 0.8rem;
        align-items: center;
      }
      .service-days {
        border: 1px solid var(--border-color);
        border-radius: 0.65rem;
        padding: 0.6rem;
        display: grid;
        gap: 0.35rem;
        background: var(--surface-elevated);
      }
      .service-days label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--text-primary);
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SavedRoutesPage implements OnInit {
  private readonly facade = inject(RoutePlannerFacade);
  private readonly router = inject(Router);
  private readonly csvService = inject(CsvRouteService);
  private readonly messageService = inject(MessageService);

  protected readonly routes = this.facade.routes;
  protected readonly links = this.facade.links;
  protected readonly versionsDialog = signal(false);
  protected readonly submissionsDialog = signal(false);
  protected readonly versions = signal<RouteVersionSnapshot[]>([]);
  protected readonly submissions = signal<ExternalRouteSubmission[]>([]);
  protected readonly csvDialog = signal(false);
  protected readonly gtfsDialog = signal(false);
  protected readonly csvErrors = signal<string[]>([]);
  protected readonly csvWarnings = signal<string[]>([]);
  protected readonly csvParsedRowsCount = signal(0);
  private csvRows: RouteStop[] = [];
  protected csvTargetRouteId = '';
  protected csvMode: 'new' | 'replace' | 'merge' = 'new';
  protected readonly csvModeOptions = [
    { label: 'New route', value: 'new' },
    { label: 'Replace route', value: 'replace' },
    { label: 'Merge route', value: 'merge' }
  ];
  protected gtfsExportRouteId = '';
  protected gtfsOptions: GtfsExportOptions = createDefaultGtfsOptions();
  protected readonly gtfsRouteTypeOptions = [
    { value: 0, label: '0 Tram' },
    { value: 1, label: '1 Subway' },
    { value: 2, label: '2 Rail' },
    { value: 3, label: '3 Bus' },
    { value: 4, label: '4 Ferry' },
    { value: 5, label: '5 Cable tram' },
    { value: 6, label: '6 Aerial lift' },
    { value: 7, label: '7 Funicular' },
    { value: 11, label: '11 Trolleybus' },
    { value: 12, label: '12 Monorail' }
  ];
  protected readonly gtfsServiceDayLabels: Array<{
    key: keyof GtfsExportOptions['serviceDays'];
    label: string;
  }> = [
    { key: 'monday', label: 'Monday' },
    { key: 'tuesday', label: 'Tuesday' },
    { key: 'wednesday', label: 'Wednesday' },
    { key: 'thursday', label: 'Thursday' },
    { key: 'friday', label: 'Friday' },
    { key: 'saturday', label: 'Saturday' },
    { key: 'sunday', label: 'Sunday' }
  ];
  private selectedRouteId = '';

  async ngOnInit(): Promise<void> {
    await this.facade.refreshRoutes();
  }

  protected openBuilder(routeId: string): void {
    this.router.navigate(['/route-builder'], {
      queryParams: { routeId }
    });
  }

  protected async remove(routeId: string): Promise<void> {
    await this.facade.removeRoute(routeId);
  }

  protected async createLink(routeId: string): Promise<void> {
    const link = await this.facade.createPublicLink(routeId);
    this.messageService.add({
      severity: 'success',
      summary: 'Public link created',
      detail: this.buildPublicUrl(link.id)
    });
  }

  protected async openVersions(routeId: string): Promise<void> {
    this.selectedRouteId = routeId;
    this.versions.set(await this.facade.listVersions(routeId));
    await this.facade.loadRouteLinks(routeId);
    this.versionsDialog.set(true);
  }

  protected async restoreSelected(version: RouteVersionSnapshot): Promise<void> {
    if (!this.selectedRouteId) {
      return;
    }
    await this.facade.restoreVersion(this.selectedRouteId, version);
    this.versionsDialog.set(false);
  }

  protected async openSubmissions(routeId: string): Promise<void> {
    this.selectedRouteId = routeId;
    await this.facade.loadRouteSubmissions(routeId);
    this.submissions.set(this.facade.submissions());
    this.submissionsDialog.set(true);
  }

  protected buildPublicUrl(linkId: string): string {
    return `${location.origin}/intake/${linkId}`;
  }

  protected async convertSubmission(submission: ExternalRouteSubmission): Promise<void> {
    if (!this.selectedRouteId) {
      return;
    }
    await this.facade.convertSubmissionToStops(this.selectedRouteId, submission);
    await this.openSubmissions(this.selectedRouteId);
  }

  protected async exportCsv(routeId: string): Promise<void> {
    await this.facade.loadRoute(routeId);
    const route = this.facade.activeRoute();
    if (!route) {
      return;
    }
    const csvContent = this.csvService.exportStops(route.stops);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${route.name.replace(/\s+/g, '-').toLowerCase()}.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  protected async exportGtfs(routeId: string): Promise<void> {
    await this.facade.loadRoute(routeId);
    const route = this.facade.activeRoute();
    if (!route || route.stops.length < 2) {
      this.messageService.add({
        severity: 'warn',
        summary: 'GTFS export requires stops',
        detail: 'Add at least two stops before exporting GTFS.'
      });
      return;
    }
    this.gtfsExportRouteId = routeId;
    this.gtfsOptions = {
      ...createDefaultGtfsOptions(),
      routeShortName: route.name.slice(0, 12) || 'Route',
      routeLongName: route.name || 'Exported Route',
      tripHeadsign: route.stops.at(-1)?.label || route.name || 'Destination'
    };
    this.gtfsDialog.set(true);
  }

  protected async confirmGtfsExport(): Promise<void> {
    const routeId = this.gtfsExportRouteId;
    if (!routeId) {
      return;
    }
    await this.facade.loadRoute(routeId);
    const route = this.facade.activeRoute();
    if (!route || route.stops.length < 2) {
      this.messageService.add({
        severity: 'warn',
        summary: 'GTFS export requires stops',
        detail: 'Add at least two stops before exporting GTFS.'
      });
      return;
    }

    const blob = await this.csvService.exportGtfsZip(route.name, route.stops, this.gtfsOptions);
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${route.name.replace(/\s+/g, '-').toLowerCase()}-gtfs.zip`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    this.gtfsDialog.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'GTFS exported',
      detail: 'GTFS zip generated with required core files.'
    });
  }

  protected async importCsv(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    const result = this.csvService.importStops(text);
    this.csvRows = result.rows;
    this.csvErrors.set(result.errors);
    this.csvWarnings.set(result.warnings);
    this.csvParsedRowsCount.set(result.rows.length);
    this.csvDialog.set(true);
  }

  protected async applyCsvImport(): Promise<void> {
    const parsedRows = this.csvRows;
    if (!parsedRows.length) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No CSV rows found',
        detail: 'Choose a CSV with valid route rows.'
      });
      return;
    }

    if (this.csvMode === 'new') {
      this.facade.newDraftRoute();
      await this.facade.updateStops(parsedRows);
      this.csvDialog.set(false);
      this.messageService.add({
        severity: 'success',
        summary: 'CSV imported',
        detail: `${parsedRows.length} stops loaded into a new draft route.`
      });
      this.router.navigate(['/route-builder']);
      return;
    }

    if (!this.csvTargetRouteId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Target route required',
        detail: 'Select which existing route should be updated.'
      });
      return;
    }

    await this.facade.loadRoute(this.csvTargetRouteId);
    const route = this.facade.activeRoute();
    if (!route) {
      return;
    }
    const nextStops = this.csvMode === 'replace' ? parsedRows : [...route.stops, ...parsedRows];
    await this.facade.updateStops(nextStops);
    await this.facade.saveActiveRoute(`CSV ${this.csvMode} import`);
    this.csvDialog.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Route updated from CSV',
      detail: `${parsedRows.length} rows applied with ${this.csvMode} mode.`
    });
    this.router.navigate(['/route-builder'], { queryParams: { routeId: this.csvTargetRouteId } });
  }
}

function createDefaultGtfsOptions(): GtfsExportOptions {
  return {
    agencyName: 'Route Planner Agency',
    agencyUrl: 'https://example.com',
    agencyTimezone: 'Africa/Johannesburg',
    routeShortName: 'Route',
    routeLongName: 'Exported Route',
    routeType: 3,
    tripHeadsign: 'Destination',
    startTime: '06:00:00',
    stopSpacingMinutes: 8,
    serviceStartDate: todayIsoDate(),
    serviceEndDate: futureIsoDate(365),
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
}

function todayIsoDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function futureIsoDate(days: number): string {
  const next = new Date();
  next.setDate(next.getDate() + days);
  const month = `${next.getMonth() + 1}`.padStart(2, '0');
  const day = `${next.getDate()}`.padStart(2, '0');
  return `${next.getFullYear()}-${month}-${day}`;
}
