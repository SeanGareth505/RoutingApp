import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AutoCompleteCompleteEvent, AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { LeafletModule } from '@bluehalo/ngx-leaflet';
import {
  DivIcon,
  LatLngExpression,
  Map,
  Marker,
  divIcon,
  icon,
  latLng,
  marker,
  polyline,
  tileLayer
} from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import { MessageService } from 'primeng/api';
import { RoutePlannerFacade } from '../../../core/application/route-planner.facade';
import { SettingsStore } from '../../../core/application/settings.store';
import { AddressSuggestion } from '../../../core/ports/geocoding.port';
import { RouteStop, RouteViaPoint } from '../../../core/domain/route.models';
import { haversineDistanceKm } from '../../../shared/utils/geo';

@Component({
  selector: 'app-route-builder-page',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    AutoCompleteModule,
    TagModule,
    DragDropModule,
    LeafletModule
  ],
  template: `
    <section class="route-builder-layout">
      <p-card class="toolbar-card">
        <div class="toolbar-grid">
          <form [formGroup]="routeForm" class="route-name-form">
            <label for="routeName">Route name</label>
            <input id="routeName" pInputText formControlName="name" />
          </form>

          <div class="toolbar-status">
            <p-tag
              [value]="activeRoute()?.manualOverride ? 'Manual mode' : 'Auto optimize mode'"
              [severity]="activeRoute()?.manualOverride ? 'warn' : 'success'"
            ></p-tag>
            <p class="summary">
              {{ activeStops().length }} stop(s) | {{ activeRoute()?.metrics?.totalDistanceKm ?? 0 }} km |
              {{ activeRoute()?.metrics?.estimatedMinutes ?? 0 }} min
            </p>
          </div>

          <div class="toolbar-actions">
            <button pButton type="button" class="p-button-outlined" (click)="optimizeRoute()">
              Auto optimize
            </button>
            <button pButton type="button" class="p-button-secondary" (click)="toggleManualMode()">
              Toggle Manual
            </button>
            <button
              pButton
              type="button"
              class="p-button-outlined"
              [disabled]="!canUndo()"
              aria-label="Undo last edit"
              (click)="undoEdit()"
            >
              Undo
            </button>
            <button
              pButton
              type="button"
              class="p-button-outlined"
              [disabled]="!canRedo()"
              aria-label="Redo last edit"
              (click)="redoEdit()"
            >
              Redo
            </button>
            <button
              pButton
              type="button"
              class="p-button-secondary"
              [class.p-button-outlined]="!isPathEditMode()"
              (click)="togglePathEditMode()"
            >
              {{ isPathEditMode() ? 'Exit Path Edit' : 'Edit Path' }}
            </button>
            <button pButton type="button" (click)="saveRoute()">Save Route</button>
          </div>
        </div>
      </p-card>

      <p-card class="checkpoint-card">
        <div class="checkpoint-header">
          <div>
            <h3>Checkpoint Navigator</h3>
            <small>Jump, focus, and manage checkpoints quickly.</small>
          </div>
          <button pButton type="button" class="p-button-text" (click)="checkpointPanelCollapsed.set(!checkpointPanelCollapsed())">
            {{ checkpointPanelCollapsed() ? 'Expand' : 'Collapse' }}
          </button>
        </div>
        @if (!checkpointPanelCollapsed()) {
          <div class="checkpoint-tools">
            <input
              pInputText
              [ngModel]="checkpointSearch()"
              (ngModelChange)="checkpointSearch.set($event)"
              placeholder="Search checkpoint label/address"
              aria-label="Search checkpoints"
            />
            <button pButton type="button" class="p-button-text" (click)="checkpointSearch.set('')">Clear</button>
          </div>
          <div class="checkpoint-list">
            @for (item of filteredCheckpoints(); track item.stop.id) {
              <button
                type="button"
                class="checkpoint-item"
                (click)="focusCheckpoint(item.index)"
                (contextmenu)="openCheckpointContext($event, item.index)"
              >
                <div>
                  <strong>{{ item.index + 1 }}. {{ item.stop.label }}</strong>
                  <small>{{ item.stop.address }}</small>
                </div>
                <span>{{ item.distanceKm.toFixed(2) }} km</span>
              </button>
            }
          </div>
        }
      </p-card>

      <section class="content-grid">
        <p-card class="add-stop-card">
          <h3>Add stop</h3>
          <form [formGroup]="stopForm" class="stop-form" (ngSubmit)="addStop()">
            <label for="stopLabel">Stop label</label>
            <input id="stopLabel" pInputText formControlName="label" />

            <label for="stopAddress">Address</label>
            <p-autocomplete
              inputId="stopAddress"
              formControlName="address"
              [suggestions]="addressSuggestions()"
              optionLabel="displayName"
              [forceSelection]="false"
              [dropdown]="true"
              [emptyMessage]="
                isSearchingAddress() ? 'Searching addresses...' : 'No results. Try suburb/city in query.'
              "
              (completeMethod)="searchAddress($event)"
              (onSelect)="selectAddress($event.value)"
            ></p-autocomplete>
            @if (isSearchingAddress()) {
              <small class="search-hint">Searching...</small>
            }

            <label for="stopNotes">Notes</label>
            <textarea
              id="stopNotes"
              pTextarea
              rows="2"
              formControlName="notes"
              placeholder="Optional notes for this stop"
            ></textarea>

            <button pButton type="submit">Add stop</button>
          </form>
        </p-card>

        <p-card class="map-card">
          <div class="map-header">
            <div class="map-header-top">
              <div class="map-title-block">
                <h3>Live Route Map</h3>
              </div>
            </div>
            @if (isPathEditMode()) {
              <div class="path-editor">
                <div class="edit-context">
                  <span class="context-chip">Mode: Path edit</span>
                  <span class="context-chip">Leg: {{ selectedLegLabel() }}</span>
                  <span class="context-chip">Pan: {{ isMapPanMode() ? 'On' : 'Off' }}</span>
                  <span class="context-chip">
                    Path: {{ activeRoute()?.manualRouteLocked ? 'Locked' : 'Unlocked' }}
                  </span>
                </div>
                <div class="leg-selector">
                  @for (leg of legOptions(); track leg.key) {
                    <button
                      pButton
                      type="button"
                      class="p-button-sm leg-chip"
                      [class.leg-chip-active]="selectedLegKey() === leg.key"
                      [class.p-button-outlined]="selectedLegKey() !== leg.key"
                      [class.p-button-secondary]="selectedLegKey() !== leg.key"
                      [attr.aria-pressed]="selectedLegKey() === leg.key"
                      (click)="selectLeg(leg.key)"
                    >
                      {{ leg.label }}
                    </button>
                  }
                </div>
                <div class="path-actions">
                  <button
                    pButton
                    type="button"
                    class="p-button-sm p-button-outlined action-chip"
                    [class.p-button-secondary]="isMapPanMode()"
                    (click)="toggleMapPanMode()"
                  >
                    {{ isMapPanMode() ? 'Pan on (hold line to edit)' : 'Pan off' }}
                  </button>
                  <button pButton type="button" class="p-button-sm p-button-outlined action-chip" (click)="startViaPointPlacement()">
                    Add via point
                  </button>
                  <button pButton type="button" class="p-button-sm p-button-outlined action-chip" (click)="focusSelectedLeg()">
                    Focus leg
                  </button>
                  <button pButton type="button" class="p-button-sm p-button-outlined action-chip" (click)="toggleManualRouteLock()">
                    {{ activeRoute()?.manualRouteLocked ? 'Unlock path' : 'Lock path' }}
                  </button>
                  <button
                    pButton
                    type="button"
                    class="p-button-sm p-button-outlined action-chip"
                    [disabled]="!selectedLegKey()"
                    (click)="resetSelectedLeg()"
                  >
                    Reset leg
                  </button>
                  <button pButton type="button" class="p-button-sm p-button-outlined action-chip" (click)="resetAllLegs()">
                    Reset all
                  </button>
                </div>
              </div>
            }
            @if (activeWarnings().length) {
              <div class="warning-strip">
                @for (warning of activeWarnings(); track $index) {
                  <span>{{ warning }}</span>
                }
              </div>
            }
            @if ((activeRoute()?.routeAlternatives?.length ?? 0) > 0) {
              <div class="route-variants">
                <button
                  pButton
                  type="button"
                  class="p-button-sm variant-chip"
                  [class.p-button-outlined]="selectedRouteVariant() !== 0"
                  [class.p-button-secondary]="selectedRouteVariant() !== 0"
                  (click)="selectRouteVariant(0)"
                >
                  Primary
                </button>
                @for (alt of activeRoute()?.routeAlternatives ?? []; track $index; let idx = $index) {
                  <button
                    pButton
                    type="button"
                    class="p-button-sm variant-chip"
                    [class.p-button-outlined]="selectedRouteVariant() !== idx + 1"
                    [class.p-button-secondary]="selectedRouteVariant() !== idx + 1"
                    (click)="selectRouteVariant(idx + 1)"
                  >
                    Alt {{ idx + 1 }}
                  </button>
                }
              </div>
            }
          </div>
          @if (activeStops().length === 0) {
            <p class="map-empty">Add a stop to see your route on the map.</p>
          }
          <div
            leaflet
            class="map-host"
            [class.path-edit-select-lock]="isPathEditMode() && (!isMapPanMode() || isLongPressDragActive())"
            [leafletOptions]="mapOptions"
            [leafletLayers]="mapLayers()"
            (leafletMapReady)="onMapReady($event)"
          ></div>
        </p-card>
      </section>

      <p-card class="stops-card">
        <div class="stops-header">
          <h3>Stops Order</h3>
          <small>Drag to reorder or use arrows</small>
        </div>
        <div cdkDropList class="stop-list" (cdkDropListDropped)="reorderStops($event)">
          @for (stop of activeStops(); track stop.id; let index = $index) {
            <article class="stop-row" cdkDrag>
              <div class="stop-main">
                <span class="drag-icon pi pi-bars"></span>
                <strong>{{ index + 1 }}. {{ stop.label }}</strong>
                <small>{{ stop.address }}</small>
              </div>
              <div class="stop-controls">
                <button pButton type="button" class="p-button-text" (click)="moveStop(index, -1)">
                  <i class="pi pi-arrow-up"></i>
                </button>
                <button pButton type="button" class="p-button-text" (click)="moveStop(index, 1)">
                  <i class="pi pi-arrow-down"></i>
                </button>
                <button pButton type="button" class="p-button-text" (click)="removeStop(index)">
                  <i class="pi pi-trash"></i>
                </button>
              </div>
            </article>
          }
        </div>
      </p-card>

      @if (checkpointContextMenu()) {
        <div
          class="checkpoint-context"
          [style.left.px]="checkpointContextMenu()!.x"
          [style.top.px]="checkpointContextMenu()!.y"
        >
          <button type="button" (click)="duplicateCheckpoint(checkpointContextMenu()!.index)">Duplicate</button>
          <button type="button" (click)="toggleCheckpointLock(checkpointContextMenu()!.index)">Lock/Unlock</button>
          <button type="button" (click)="removeStop(checkpointContextMenu()!.index)">Delete</button>
          <button type="button" (click)="closeCheckpointContext()">Close</button>
        </div>
      }
    </section>
  `,
  styles: [
    `
      .route-builder-layout {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .toolbar-card {
        position: sticky;
        top: 0.5rem;
        z-index: 3;
      }
      .toolbar-grid {
        display: grid;
        grid-template-columns: minmax(220px, 320px) minmax(220px, 1fr) auto;
        gap: 0.75rem;
        align-items: end;
      }
      .route-name-form {
        display: grid;
        gap: 0.4rem;
      }
      .toolbar-status {
        display: grid;
        gap: 0.4rem;
      }
      .toolbar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        justify-content: flex-end;
      }
      .summary {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.9rem;
      }
      .search-hint {
        color: var(--text-muted);
      }
      .content-grid {
        display: grid;
        grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
        gap: 1rem;
      }
      .checkpoint-card {
        border: 1px solid var(--border-color);
      }
      .checkpoint-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }
      .checkpoint-header h3 {
        margin: 0;
      }
      .checkpoint-header small {
        color: var(--text-muted);
      }
      .checkpoint-tools {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.65rem;
      }
      .checkpoint-tools input {
        flex: 1;
      }
      .checkpoint-list {
        margin-top: 0.65rem;
        display: grid;
        gap: 0.4rem;
        max-height: 220px;
        overflow: auto;
      }
      .checkpoint-item {
        border: 1px solid var(--border-color);
        border-radius: 0.55rem;
        padding: 0.45rem 0.6rem;
        background: var(--surface-elevated);
        color: var(--text-primary);
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.65rem;
        text-align: left;
      }
      .checkpoint-item strong,
      .checkpoint-item small {
        display: block;
      }
      .checkpoint-item small {
        color: var(--text-muted);
      }
      .stop-form {
        display: grid;
        gap: 0.45rem;
      }
      .add-stop-card h3,
      .map-header h3,
      .stops-header h3 {
        margin: 0 0 0.6rem;
      }
      .stop-list {
        display: grid;
        gap: 0.45rem;
        max-height: 300px;
        overflow: auto;
      }
      .stop-row {
        border: 1px solid var(--border-color);
        border-radius: 0.6rem;
        padding: 0.45rem 0.6rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.6rem;
        background: var(--surface-elevated);
      }
      .stop-main {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
        min-width: 0;
      }
      .stop-main small {
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }
      .drag-icon {
        cursor: grab;
      }
      .stop-controls {
        display: flex;
        align-items: center;
        gap: 0.2rem;
      }
      .map-empty {
        color: var(--text-muted);
        margin: 0.5rem 0 1rem;
      }
      .map-header-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.8rem;
      }
      .map-title-block h3 {
        margin: 0;
      }
      .route-variants {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .warning-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 0.45rem;
      }
      .warning-strip span {
        font-size: 0.78rem;
        padding: 0.2rem 0.45rem;
        border-radius: 999px;
        background: rgba(234, 88, 12, 0.14);
        color: #c2410c;
      }
      .path-editor {
        display: grid;
        gap: 0.45rem;
        margin-bottom: 0.25rem;
        padding: 0.6rem;
        border: 1px solid var(--border-color);
        border-radius: 0.75rem;
      }
      .leg-selector,
      .path-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .edit-context {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .context-chip {
        font-size: 0.78rem;
        color: var(--text-muted);
        border: 1px solid var(--border-color);
        border-radius: 999px;
        padding: 0.22rem 0.5rem;
      }
      :host ::ng-deep .map-card .p-button {
        border-radius: 999px;
      }
      :host ::ng-deep .map-card .leg-chip-active.p-button {
        box-shadow: var(--focus-ring);
      }
      :host ::ng-deep .via-pin {
        width: 28px !important;
        height: 28px !important;
        margin-left: -14px !important;
        margin-top: -14px !important;
        border: none !important;
        background: transparent !important;
        display: grid;
        place-items: center;
        cursor: grab;
        touch-action: none;
      }
      :host ::ng-deep .via-pin .via-pin-dot {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid #ffffff;
        background: #16a34a;
        box-shadow: 0 2px 6px rgba(15, 23, 42, 0.28);
      }
      .map-host {
        height: min(62dvh, 560px);
        border-radius: 0.8rem;
        overflow: hidden;
      }
      .map-host.path-edit-select-lock,
      .map-host.path-edit-select-lock * {
        user-select: none;
        -webkit-user-select: none;
        -ms-user-select: none;
        -webkit-user-drag: none;
      }
      .stops-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .stops-header small {
        color: var(--text-muted);
      }
      .checkpoint-context {
        position: fixed;
        z-index: 2000;
        background: var(--surface-elevated);
        border: 1px solid var(--border-color);
        border-radius: 0.65rem;
        box-shadow: var(--shadow-soft);
        display: grid;
        padding: 0.25rem;
        min-width: 10rem;
      }
      .checkpoint-context button {
        border: none;
        background: transparent;
        text-align: left;
        padding: 0.45rem 0.5rem;
        border-radius: 0.45rem;
        color: var(--text-primary);
      }
      .checkpoint-context button:hover {
        background: color-mix(in srgb, var(--brand-500) 12%, transparent);
      }
      @media (max-width: 960px) {
        .toolbar-grid,
        .content-grid {
          grid-template-columns: 1fr;
        }
        .toolbar-actions {
          justify-content: flex-start;
        }
        .map-host {
          height: 52dvh;
        }
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RouteBuilderPage implements OnInit, OnDestroy {
  private static readonly MIN_ROUTE_DEVIATION_METERS = 20;
  private readonly facade = inject(RoutePlannerFacade);
  private readonly settingsStore = inject(SettingsStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly messageService = inject(MessageService);
  private searchDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private geomanCreateHandler: ((event: unknown) => void) | null = null;
  private mapMoveHandler: ((event: unknown) => void) | null = null;
  private mapUpHandler: ((event: unknown) => void) | null = null;
  private readonly keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);
  private longPressHandle: ReturnType<typeof setTimeout> | null = null;
  private pendingLongPress:
    | {
        legKey: string;
        lat: number;
        lng: number;
      }
    | null = null;

  protected readonly activeRoute = this.facade.activeRoute;
  protected readonly canUndo = this.facade.canUndo;
  protected readonly canRedo = this.facade.canRedo;
  protected readonly activeStops = computed(() => this.activeRoute()?.stops ?? []);
  protected readonly addressSuggestions = signal<AddressSuggestion[]>([]);
  protected readonly selectedAddress = signal<AddressSuggestion | null>(null);
  protected readonly isSearchingAddress = signal(false);
  protected readonly selectedRouteVariant = signal(0);
  protected readonly isPathEditMode = signal(false);
  protected readonly isMapPanMode = signal(true);
  protected readonly isLongPressDragActive = signal(false);
  protected readonly selectedLegKey = signal<string | null>(null);
  protected readonly draftViaPoint = signal<{ legKey: string; lat: number; lng: number } | null>(null);
  protected readonly checkpointPanelCollapsed = signal(false);
  protected readonly checkpointSearch = signal('');
  protected readonly checkpointContextMenu = signal<{ x: number; y: number; index: number } | null>(null);
  protected readonly activeWarnings = computed(() => {
    const warnings: string[] = [];
    const route = this.activeRoute();
    if (!route) {
      return warnings;
    }
    if (route.manualRouteLocked && this.activeStops().length < 2) {
      warnings.push('Manual route lock is enabled with insufficient checkpoints.');
    }
    if ((route.legOverrides ?? []).length > 8) {
      warnings.push('High via-point count may reduce route performance.');
    }
    return warnings;
  });
  protected readonly filteredCheckpoints = computed(() => {
    const query = this.checkpointSearch().trim().toLowerCase();
    const checkpoints = this.activeStops().map((stop, index) => ({
      stop,
      index,
      distanceKm:
        index > 0
          ? haversineDistanceKm(this.activeStops()[index - 1], this.activeStops()[index])
          : 0
    }));
    if (!query) {
      return checkpoints;
    }
    return checkpoints.filter(
      (item) =>
        item.stop.label.toLowerCase().includes(query) || item.stop.address.toLowerCase().includes(query)
    );
  });
  protected readonly legOptions = computed(() => {
    const stops = this.activeStops();
    const options: Array<{ key: string; label: string }> = [];
    for (let index = 0; index < stops.length - 1; index += 1) {
      const fromStop = stops[index];
      const toStop = stops[index + 1];
      options.push({
        key: this.buildLegKey(fromStop.id, toStop.id),
        label: `${index + 1}->${index + 2}`
      });
    }
    return options;
  });
  protected readonly selectedLegLabel = computed(() => {
    const currentLeg = this.selectedLegKey();
    if (!currentLeg) {
      return 'None selected';
    }
    return this.legOptions().find((option) => option.key === currentLeg)?.label ?? 'None selected';
  });

  protected readonly routeForm = this.formBuilder.nonNullable.group({
    name: ['Premium Route Plan', [Validators.required, Validators.minLength(2)]]
  });

  protected readonly stopForm = this.formBuilder.nonNullable.group({
    label: ['Stop', [Validators.required]],
    address: ['', [Validators.required]],
    notes: ['']
  });

  protected readonly mapOptions = {
    layers: [
      tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      })
    ],
    zoom: 5,
    center: latLng(52.52, 13.405)
  };

  private mapInstance: Map | null = null;
  private readonly markerIcon = icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41]
  });
  private readonly viaPointIcon: DivIcon = divIcon({
    className: 'via-pin',
    html: '<span class="via-pin-dot"></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  protected readonly mapLayers = computed(() => {
    const stops = this.activeStops();
    const stopMarkers = stops.map((stop, index) => this.createDraggableMarker(stop, index));
    const viaMarkers = this.buildViaPointMarkers();
    const draftVia = this.draftViaPoint();
    const draftMarkers = draftVia
      ? [
          marker([draftVia.lat, draftVia.lng], {
            icon: this.viaPointIcon,
            interactive: false
          })
        ]
      : [];
    const route = this.activeRoute();
    const selectedVariant = this.selectedRouteVariant();
    const selectedPath =
      selectedVariant > 0
        ? route?.routeAlternatives?.[selectedVariant - 1]
        : route?.routePath;
    const coordinates = selectedPath?.coordinates ?? [];
    if (coordinates.length < 2) {
      if (stops.length < 2) {
        return [...stopMarkers, ...viaMarkers];
      }
      const fallbackLine = polyline(
        stops.map((stop) => [stop.lat, stop.lng] as LatLngExpression),
        { color: '#3455db', weight: 4, dashArray: '8 8' }
      );
      return [...stopMarkers, ...viaMarkers, ...draftMarkers, fallbackLine];
    }

    const line = polyline(
      coordinates.map((point) => [point.lat, point.lng] as LatLngExpression),
      { color: '#3455db', weight: 4 }
    );
    line.on('mousedown', (event) => {
      this.handleLinePointerDown(
        event as unknown as { latlng: { lat: number; lng: number }; originalEvent?: Event }
      );
    });
    line.on('touchstart', (event) => {
      this.handleLinePointerDown(
        event as unknown as { latlng: { lat: number; lng: number }; originalEvent?: Event }
      );
    });
    line.on('click', (event) => {
      if (!this.isPathEditMode() || this.draftViaPoint() || this.pendingLongPress) {
        return;
      }
      void this.addViaPointAtLocation(event.latlng.lat, event.latlng.lng);
    });
    return [...stopMarkers, ...viaMarkers, ...draftMarkers, line];
  });

  async ngOnInit(): Promise<void> {
    window.addEventListener('keydown', this.keydownHandler);
    await this.facade.initialize();
    const routeId = this.activatedRoute.snapshot.queryParamMap.get('routeId');
    if (routeId) {
      await this.facade.loadRoute(routeId);
      const route = this.activeRoute();
      if (route) {
        this.routeForm.controls.name.setValue(route.name);
        this.selectedRouteVariant.set(0);
        this.fitMapBounds();
        return;
      }
    }
    this.facade.newDraftRoute();
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    if (this.searchDebounceHandle) {
      clearTimeout(this.searchDebounceHandle);
      this.searchDebounceHandle = null;
    }
    this.clearLongPress();
    this.pendingLongPress = null;
    if (this.mapInstance) {
      this.isPathEditMode.set(false);
      this.isMapPanMode.set(true);
      this.isLongPressDragActive.set(false);
      this.applyMapInteractionMode();
    }
    this.detachGeomanHandler();
  }

  protected async searchAddress(event: AutoCompleteCompleteEvent): Promise<void> {
    const query = event.query.trim();
    this.selectedAddress.set(null);

    if (this.searchDebounceHandle) {
      clearTimeout(this.searchDebounceHandle);
      this.searchDebounceHandle = null;
    }

    if (query.length < 3) {
      this.isSearchingAddress.set(false);
      this.addressSuggestions.set([]);
      return;
    }

    this.isSearchingAddress.set(true);
    this.searchDebounceHandle = setTimeout(async () => {
      const currentInput = this.stopForm.controls.address.value.trim();
      if (currentInput.length < 3) {
        this.isSearchingAddress.set(false);
        this.addressSuggestions.set([]);
        return;
      }

      let suggestions: AddressSuggestion[] = [];
      try {
        suggestions = await this.facade.searchAddress(currentInput);
      } finally {
        this.isSearchingAddress.set(false);
      }
      // Ignore stale responses that no longer match the input.
      if (this.stopForm.controls.address.value.trim() !== currentInput) {
        return;
      }
      this.addressSuggestions.set(suggestions);
    }, 280);
  }

  protected selectAddress(item: AddressSuggestion): void {
    this.selectedAddress.set(item);
    this.stopForm.controls.address.setValue(item.displayName);
  }

  protected async addStop(): Promise<void> {
    const selected = await this.resolveSelectedAddress();
    if (!selected || selected.lat === undefined || selected.lng === undefined) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Address needed',
        detail: 'Type a fuller address or select one from suggestions.'
      });
      return;
    }

    const existingStopCount = this.activeStops().length;
    const stopLabel = this.stopForm.controls.label.value.trim();
    await this.facade.addStop({
      id: crypto.randomUUID(),
      label: stopLabel || `Stop ${existingStopCount + 1}`,
      address: selected.displayName,
      lat: selected.lat,
      lng: selected.lng,
      notes: this.stopForm.controls.notes.value
    });

    this.selectedRouteVariant.set(0);
    this.selectedAddress.set(null);
    this.stopForm.reset({
      label: `Stop ${existingStopCount + 2}`,
      address: '',
      notes: ''
    });
    this.fitMapBounds();
  }

  protected async optimizeRoute(): Promise<void> {
    await this.facade.optimizeRoute();
    this.selectedRouteVariant.set(0);
    this.fitMapBounds();
  }

  protected async toggleManualMode(): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    await this.facade.updateStops(route.stops);
    this.selectedRouteVariant.set(0);
    this.facade.activeRoute.set({
      ...route,
      manualOverride: !route.manualOverride
    });
  }

  protected async reorderStops(event: CdkDragDrop<RouteStop[]>): Promise<void> {
    const reordered = [...this.activeStops()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    await this.facade.updateStops(reordered);
    this.selectedRouteVariant.set(0);
    this.fitMapBounds();
  }

  protected async moveStop(index: number, direction: -1 | 1): Promise<void> {
    const stops = [...this.activeStops()];
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= stops.length) {
      return;
    }
    [stops[index], stops[nextIndex]] = [stops[nextIndex], stops[index]];
    await this.facade.updateStops(stops);
    this.selectedRouteVariant.set(0);
    this.fitMapBounds();
  }

  protected async removeStop(index: number): Promise<void> {
    const stops = [...this.activeStops()];
    stops.splice(index, 1);
    await this.facade.updateStops(stops);
    this.selectedRouteVariant.set(0);
    this.fitMapBounds();
  }

  protected async saveRoute(): Promise<void> {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    this.facade.activeRoute.set({
      ...route,
      name: this.routeForm.controls.name.value
    });
    await this.facade.saveActiveRoute();
  }

  protected undoEdit(): void {
    this.facade.undoLastEdit();
    this.selectedRouteVariant.set(0);
  }

  protected redoEdit(): void {
    this.facade.redoLastEdit();
    this.selectedRouteVariant.set(0);
  }

  protected focusCheckpoint(index: number): void {
    const stop = this.activeStops()[index];
    if (!stop || !this.mapInstance) {
      return;
    }
    this.mapInstance.setView([stop.lat, stop.lng], Math.max(this.mapInstance.getZoom(), 14), {
      animate: true
    });
    this.closeCheckpointContext();
  }

  protected openCheckpointContext(event: MouseEvent, index: number): void {
    event.preventDefault();
    this.checkpointContextMenu.set({
      x: event.clientX,
      y: event.clientY,
      index
    });
  }

  protected closeCheckpointContext(): void {
    this.checkpointContextMenu.set(null);
  }

  protected async duplicateCheckpoint(index: number): Promise<void> {
    const source = this.activeStops()[index];
    if (!source) {
      return;
    }
    const stops = [...this.activeStops()];
    stops.splice(index + 1, 0, {
      ...source,
      id: crypto.randomUUID(),
      label: `${source.label} Copy`
    });
    await this.facade.updateStops(stops);
    this.closeCheckpointContext();
  }

  protected async toggleCheckpointLock(index: number): Promise<void> {
    const stops = [...this.activeStops()];
    const target = stops[index];
    if (!target) {
      return;
    }
    stops[index] = {
      ...target,
      locked: !target.locked
    };
    await this.facade.updateStops(stops);
    this.closeCheckpointContext();
  }

  protected onMapReady(map: Map): void {
    this.mapInstance = map;
    this.initializeGeoman(map);
    this.applyMapInteractionMode();
    map.on('click', () => this.closeCheckpointContext());
    this.fitMapBounds();
  }

  protected selectRouteVariant(index: number): void {
    this.selectedRouteVariant.set(index);
    this.fitMapBounds();
  }

  protected togglePathEditMode(): void {
    const nextMode = !this.isPathEditMode();
    this.isPathEditMode.set(nextMode);
    if (!nextMode) {
      this.isMapPanMode.set(true);
      this.isLongPressDragActive.set(false);
      this.clearLongPress();
      this.pendingLongPress = null;
      this.draftViaPoint.set(null);
    } else {
      this.isMapPanMode.set(true);
    }
    if (nextMode && !this.selectedLegKey()) {
      const firstLeg = this.legOptions()[0];
      if (firstLeg) {
        this.selectedLegKey.set(firstLeg.key);
      }
    }
    this.applyMapInteractionMode();
  }

  protected toggleMapPanMode(): void {
    this.isMapPanMode.set(!this.isMapPanMode());
    if (!this.isMapPanMode()) {
      this.clearLongPress();
      this.pendingLongPress = null;
      this.isLongPressDragActive.set(false);
      this.draftViaPoint.set(null);
    }
    this.applyMapInteractionMode();
  }

  protected selectLeg(legKey: string): void {
    this.selectedLegKey.set(legKey);
  }

  protected startViaPointPlacement(): void {
    const map = this.mapInstance;
    const legKey = this.resolveSelectedLegKey();
    if (!map || !legKey) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Select route leg',
        detail: 'Choose a leg first, then add a via point.'
      });
      return;
    }
    const mapWithGeoman = map as Map & {
      pm?: {
        enableDraw: (shape: string, options?: object) => void;
      };
    };
    mapWithGeoman.pm?.enableDraw('Marker', {
      continueDrawing: false
    });
  }

  private handleLinePointerDown(event: {
    latlng: { lat: number; lng: number };
    originalEvent?: Event;
  }): void {
    if (!this.isPathEditMode()) {
      return;
    }
    const legKey = this.resolveSelectedLegKey();
    if (!legKey) {
      return;
    }
    this.selectedLegKey.set(legKey);
    const originalEvent = event.originalEvent;

    if (!this.isMapPanMode()) {
      this.draftViaPoint.set({
        legKey,
        lat: event.latlng.lat,
        lng: event.latlng.lng
      });
      originalEvent?.preventDefault();
      return;
    }

    this.clearLongPress();
    this.pendingLongPress = {
      legKey,
      lat: event.latlng.lat,
      lng: event.latlng.lng
    };
    this.longPressHandle = setTimeout(() => {
      this.longPressHandle = null;
      if (!this.pendingLongPress) {
        return;
      }
      this.draftViaPoint.set({
        legKey: this.pendingLongPress.legKey,
        lat: this.pendingLongPress.lat,
        lng: this.pendingLongPress.lng
      });
      this.isLongPressDragActive.set(true);
      this.applyMapInteractionMode();
      originalEvent?.preventDefault();
    }, this.settingsStore.settings().editorLongPressMs);
  }

  private async addViaPointAtLocation(lat: number, lng: number, legKey?: string): Promise<void> {
    const selectedLegKey = legKey ?? this.resolveSelectedLegKey();
    if (!selectedLegKey) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Select route leg',
        detail: 'Choose a leg first before editing route path.'
      });
      return;
    }
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    if (!this.isSignificantRouteDeviation(lat, lng)) {
      this.messageService.add({
        severity: 'info',
        summary: 'No route change',
        detail: 'Move farther away from the existing line to create a meaningful via point.'
      });
      return;
    }
    const override = (route.legOverrides ?? []).find((item) => item.legKey === selectedLegKey);
    const nextViaPoints: RouteViaPoint[] = [
      ...(override?.viaPoints ?? []),
      {
        id: crypto.randomUUID(),
        lat,
        lng
      }
    ];
    await this.facade.setLegViaPoints(selectedLegKey, nextViaPoints);
    this.selectedRouteVariant.set(0);
  }

  protected toggleManualRouteLock(): void {
    this.facade.toggleManualRouteLock();
  }

  protected async resetSelectedLeg(): Promise<void> {
    const selectedLegKey = this.resolveSelectedLegKey();
    if (!selectedLegKey) {
      return;
    }
    await this.facade.clearLegOverride(selectedLegKey);
    this.selectedRouteVariant.set(0);
  }

  protected async resetAllLegs(): Promise<void> {
    await this.facade.clearAllLegOverrides();
    this.selectedRouteVariant.set(0);
  }

  protected focusSelectedLeg(): void {
    const selectedLeg = this.resolveSelectedLegKey();
    const map = this.mapInstance;
    if (!selectedLeg || !map) {
      return;
    }
    const [fromStopId, toStopId] = selectedLeg.split('->');
    const stops = this.activeStops();
    const fromStop = stops.find((item) => item.id === fromStopId);
    const toStop = stops.find((item) => item.id === toStopId);
    if (!fromStop || !toStop) {
      return;
    }
    const points: Array<[number, number]> = [
      [fromStop.lat, fromStop.lng],
      [toStop.lat, toStop.lng]
    ];
    const override = (this.activeRoute()?.legOverrides ?? []).find((item) => item.legKey === selectedLeg);
    (override?.viaPoints ?? []).forEach((point) => points.push([point.lat, point.lng]));
    map.fitBounds(points, { padding: [40, 40] });
  }

  private initializeGeoman(map: Map): void {
    this.detachGeomanHandler();
    const mapWithGeoman = map as Map & {
      pm?: {
        addControls: (options: object) => void;
      };
      on: (eventName: string, handler: (event: unknown) => void) => void;
    };

    mapWithGeoman.pm?.addControls({
      position: 'topleft',
      drawCircle: false,
      drawCircleMarker: false,
      drawPolygon: false,
      drawPolyline: false,
      drawRectangle: false,
      drawText: false,
      drawMarker: false,
      editMode: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: false
    });

    this.geomanCreateHandler = (rawEvent: unknown) => {
      const selectedLegKey = this.selectedLegKey();
      const mapRef = this.mapInstance;
      const event = rawEvent as {
        layer?: Marker;
      };
      if (!this.isPathEditMode() || !selectedLegKey || !event.layer || !mapRef) {
        return;
      }

      const location = event.layer.getLatLng();
      const route = this.activeRoute();
      if (!route) {
        return;
      }
      const override = (route.legOverrides ?? []).find((item) => item.legKey === selectedLegKey);
      const nextViaPoints: RouteViaPoint[] = [
        ...(override?.viaPoints ?? []),
        {
          id: crypto.randomUUID(),
          lat: location.lat,
          lng: location.lng
        }
      ];
      void this.facade.setLegViaPoints(selectedLegKey, nextViaPoints);
      mapRef.removeLayer(event.layer);
      this.selectedRouteVariant.set(0);
    };

    mapWithGeoman.on('pm:create', this.geomanCreateHandler);

    this.mapMoveHandler = (rawEvent: unknown) => {
      const currentDraft = this.draftViaPoint();
      if (this.pendingLongPress && !currentDraft) {
        this.clearLongPress();
        this.pendingLongPress = null;
        return;
      }
      if (!currentDraft) {
        return;
      }
      const event = rawEvent as { latlng?: { lat: number; lng: number } };
      if (!event.latlng) {
        return;
      }
      this.draftViaPoint.set({
        ...currentDraft,
        lat: event.latlng.lat,
        lng: event.latlng.lng
      });
    };

    this.mapUpHandler = () => {
      this.clearLongPress();
      this.pendingLongPress = null;
      const currentDraft = this.draftViaPoint();
      if (!currentDraft) {
        return;
      }
      this.draftViaPoint.set(null);
      this.isLongPressDragActive.set(false);
      this.applyMapInteractionMode();
      void this.addViaPointAtLocation(currentDraft.lat, currentDraft.lng, currentDraft.legKey);
    };

    mapWithGeoman.on('mousemove', this.mapMoveHandler);
    mapWithGeoman.on('mouseup', this.mapUpHandler);
    mapWithGeoman.on('touchmove', this.mapMoveHandler);
    mapWithGeoman.on('touchend', this.mapUpHandler);
    mapWithGeoman.on('touchcancel', this.mapUpHandler);
  }

  private detachGeomanHandler(): void {
    if (!this.mapInstance) {
      return;
    }
    if (this.geomanCreateHandler) {
      this.mapInstance.off('pm:create', this.geomanCreateHandler);
      this.geomanCreateHandler = null;
    }
    if (this.mapMoveHandler) {
      this.mapInstance.off('mousemove', this.mapMoveHandler);
      this.mapInstance.off('touchmove', this.mapMoveHandler);
      this.mapMoveHandler = null;
    }
    if (this.mapUpHandler) {
      this.mapInstance.off('mouseup', this.mapUpHandler);
      this.mapInstance.off('touchend', this.mapUpHandler);
      this.mapInstance.off('touchcancel', this.mapUpHandler);
      this.mapUpHandler = null;
    }
  }

  private applyMapInteractionMode(): void {
    const map = this.mapInstance;
    if (!map) {
      return;
    }
    const disableForPathEditing =
      this.isPathEditMode() && (!this.isMapPanMode() || this.isLongPressDragActive());
    if (disableForPathEditing) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      return;
    }
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }

  private clearLongPress(): void {
    if (!this.longPressHandle) {
      return;
    }
    clearTimeout(this.longPressHandle);
    this.longPressHandle = null;
  }

  private isSignificantRouteDeviation(lat: number, lng: number): boolean {
    const path = this.activeRoute()?.routePath?.coordinates ?? [];
    if (path.length < 2) {
      return true;
    }
    const point = { lat, lng };
    let minDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];
      const distance = pointToSegmentDistanceMeters(point, start, end);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance > RouteBuilderPage.MIN_ROUTE_DEVIATION_METERS;
  }

  private buildViaPointMarkers(): Marker[] {
    const route = this.activeRoute();
    if (!route?.legOverrides?.length) {
      return [];
    }
    const canEdit = this.isPathEditMode();
    const markers: Marker[] = [];

    route.legOverrides.forEach((override) => {
      override.viaPoints.forEach((point) => {
        const markerRef = marker([point.lat, point.lng], {
          draggable: canEdit,
          icon: this.viaPointIcon,
          title: 'Via point'
        });
        markerRef.bindTooltip('Via', {
          direction: 'top',
          permanent: false
        });
        markerRef.on('dragstart', () => {
          this.selectedLegKey.set(override.legKey);
        });
        markerRef.on('dragend', (event) => {
          if (!canEdit) {
            return;
          }
          const dragMarker = event.target as Marker;
          const location = dragMarker.getLatLng();
          this.updateViaPointPosition(override.legKey, point.id, location.lat, location.lng);
        });
        markerRef.on('contextmenu', () => {
          if (!canEdit) {
            return;
          }
          this.selectedLegKey.set(override.legKey);
          this.removeViaPoint(override.legKey, point.id);
        });
        markers.push(markerRef);
      });
    });

    return markers;
  }

  private updateViaPointPosition(
    legKey: string,
    viaPointId: string,
    lat: number,
    lng: number
  ): void {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    const override = (route.legOverrides ?? []).find((item) => item.legKey === legKey);
    if (!override) {
      return;
    }
    const snappedPoint = this.settingsStore.settings().snapViaPoints
      ? this.snapPointToRoutePath(lat, lng)
      : { lat, lng };
    const nextViaPoints = override.viaPoints.map((point) =>
      point.id === viaPointId
        ? { ...point, lat: snappedPoint.lat, lng: snappedPoint.lng }
        : point
    );
    void this.facade.setLegViaPoints(legKey, nextViaPoints);
    this.selectedRouteVariant.set(0);
  }

  private removeViaPoint(legKey: string, viaPointId: string): void {
    const route = this.activeRoute();
    if (!route) {
      return;
    }
    const override = (route.legOverrides ?? []).find((item) => item.legKey === legKey);
    if (!override) {
      return;
    }
    const nextViaPoints = override.viaPoints.filter((point) => point.id !== viaPointId);
    void this.facade.setLegViaPoints(legKey, nextViaPoints);
    this.selectedRouteVariant.set(0);
  }

  private buildLegKey(fromStopId: string, toStopId: string): string {
    return `${fromStopId}->${toStopId}`;
  }

  private resolveSelectedLegKey(): string | null {
    const current = this.selectedLegKey();
    const options = this.legOptions();
    if (current && options.some((item) => item.key === current)) {
      return current;
    }
    const first = options[0]?.key ?? null;
    this.selectedLegKey.set(first);
    return first;
  }

  private snapPointToRoutePath(lat: number, lng: number): { lat: number; lng: number } {
    const path = this.activeRoute()?.routePath?.coordinates ?? [];
    if (path.length < 2) {
      return { lat, lng };
    }
    const point = { lat, lng };
    let closestPoint = { lat, lng };
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < path.length - 1; index += 1) {
      const segmentStart = path[index];
      const segmentEnd = path[index + 1];
      const projected = projectPointToSegment(point, segmentStart, segmentEnd);
      const distance = pointToSegmentDistanceMeters(point, segmentStart, segmentEnd);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestPoint = projected;
      }
    }

    if (closestDistance > 90) {
      return { lat, lng };
    }
    return closestPoint;
  }

  private handleKeydown(event: KeyboardEvent): void {
    const isMetaUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z';
    const isMetaRedo =
      (event.ctrlKey || event.metaKey) &&
      (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'));

    if (isMetaUndo) {
      event.preventDefault();
      this.undoEdit();
      return;
    }
    if (isMetaRedo) {
      event.preventDefault();
      this.redoEdit();
      return;
    }
    if (event.key === 'Escape') {
      this.closeCheckpointContext();
    }
  }

  private createDraggableMarker(stop: RouteStop, index: number): Marker {
    const route = this.activeRoute();
    const markerRef = marker([stop.lat, stop.lng], {
      draggable: route?.manualOverride ?? false,
      icon: this.markerIcon,
      title: stop.label
    });
    const tooltipLabel = `${index + 1}. ${stop.label}`;
    markerRef.bindTooltip(tooltipLabel, {
      direction: 'top',
      permanent: true,
      offset: [0, -28]
    });
    markerRef.bindPopup(
      `
      <div style="min-width: 180px;">
        <strong>${this.escapeHtml(stop.label)}</strong><br />
        <small>${this.escapeHtml(stop.address)}</small>
        ${stop.notes ? `<p style="margin:8px 0 0;">${this.escapeHtml(stop.notes)}</p>` : ''}
      </div>
      `
    );
    markerRef.on('dragend', (event) => {
      const currentStops = [...this.activeStops()];
      const dragMarker = event.target as Marker;
      const point = dragMarker.getLatLng();
      const target = currentStops[index];
      if (!target) {
        return;
      }
      currentStops[index] = {
        ...target,
        lat: point.lat,
        lng: point.lng
      };
      void this.facade.updateStops(currentStops);
      this.selectedRouteVariant.set(0);
    });
    return markerRef;
  }

  private fitMapBounds(): void {
    const map = this.mapInstance;
    const route = this.activeRoute();
    const selectedVariant = this.selectedRouteVariant();
    const selectedPath =
      selectedVariant > 0
        ? route?.routeAlternatives?.[selectedVariant - 1]
        : route?.routePath;
    const points =
      selectedPath?.coordinates?.length
        ? selectedPath.coordinates.map((point) => [point.lat, point.lng] as [number, number])
        : this.activeStops().map((stop) => [stop.lat, stop.lng] as [number, number]);
    if (!map || points.length === 0) {
      return;
    }
    map.fitBounds(points, { padding: [30, 30] });
  }

  private async resolveSelectedAddress(): Promise<AddressSuggestion | null> {
    const selected = this.selectedAddress();
    if (selected) {
      if (selected.lat !== undefined && selected.lng !== undefined) {
        return selected;
      }
      const resolved = await this.facade.resolveAddress(selected.displayName, selected.magicKey);
      if (!resolved) {
        return null;
      }
      this.selectedAddress.set(resolved);
      this.stopForm.controls.address.setValue(resolved.displayName);
      return resolved;
    }

    const rawAddress = this.stopForm.controls.address.value.trim();
    if (rawAddress.length < 3) {
      return null;
    }

    const suggestions = await this.facade.searchAddress(rawAddress);
    if (!suggestions.length) {
      return null;
    }

    const bestMatch = suggestions[0];
    const resolvedBestMatch = await this.facade.resolveAddress(
      bestMatch.displayName,
      bestMatch.magicKey
    );
    if (!resolvedBestMatch) {
      return null;
    }
    this.selectedAddress.set(resolvedBestMatch);
    this.stopForm.controls.address.setValue(resolvedBestMatch.displayName);
    return resolvedBestMatch;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}

function pointToSegmentDistanceMeters(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): number {
  const anchorLatRad = ((start.lat + end.lat) / 2) * (Math.PI / 180);
  const metersPerDegLat = 111_132;
  const metersPerDegLng = 111_320 * Math.cos(anchorLatRad);

  const ax = start.lng * metersPerDegLng;
  const ay = start.lat * metersPerDegLat;
  const bx = end.lng * metersPerDegLng;
  const by = end.lat * metersPerDegLat;
  const px = point.lng * metersPerDegLng;
  const py = point.lat * metersPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLengthSq = abx * abx + aby * aby;
  if (abLengthSq === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSq));
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  const dx = px - closestX;
  const dy = py - closestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPointToSegment(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): { lat: number; lng: number } {
  const anchorLatRad = ((start.lat + end.lat) / 2) * (Math.PI / 180);
  const metersPerDegLat = 111_132;
  const metersPerDegLng = 111_320 * Math.cos(anchorLatRad);

  const ax = start.lng * metersPerDegLng;
  const ay = start.lat * metersPerDegLat;
  const bx = end.lng * metersPerDegLng;
  const by = end.lat * metersPerDegLat;
  const px = point.lng * metersPerDegLng;
  const py = point.lat * metersPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const abLengthSq = abx * abx + aby * aby;
  if (abLengthSq === 0) {
    return { lat: start.lat, lng: start.lng };
  }

  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSq));
  const projectedX = ax + abx * t;
  const projectedY = ay + aby * t;

  return {
    lat: projectedY / metersPerDegLat,
    lng: projectedX / metersPerDegLng
  };
}
