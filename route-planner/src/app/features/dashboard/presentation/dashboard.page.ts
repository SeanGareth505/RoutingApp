import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { SkeletonModule } from 'primeng/skeleton';
import { RouterLink } from '@angular/router';
import { RoutePlannerFacade } from '../../../core/application/route-planner.facade';

@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, CardModule, SkeletonModule, RouterLink],
  template: `
    <section class="dashboard-layout">
      <header class="hero">
        <h2 class="page-title">Operations Overview</h2>
        <p class="page-subtitle">Live summary of your routes, distance and next actions.</p>
      </header>

      <section class="dashboard-grid">
        <p-card>
          <h3>Total Routes</h3>
          <p class="value">{{ routeCount() }}</p>
        </p-card>
        <p-card>
          <h3>Total Distance (km)</h3>
          <p class="value">{{ totalDistance() }}</p>
        </p-card>
        <p-card>
          <h3>Quick Actions</h3>
          <div class="actions">
            <a routerLink="/route-builder">Open Route Builder</a>
            <a routerLink="/saved-routes">Review Saved Routes</a>
          </div>
        </p-card>
      </section>
    </section>
  `,
  styles: [
    `
      .dashboard-layout {
        display: grid;
        gap: 1rem;
      }
      .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
      }
      h3 {
        margin: 0 0 0.5rem;
      }
      .value {
        margin: 0;
        font-size: 1.8rem;
        font-weight: 700;
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      a {
        color: var(--brand-500);
        text-decoration: none;
        font-weight: 600;
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPage implements OnInit {
  private readonly facade = inject(RoutePlannerFacade);
  protected readonly routes = this.facade.routes;
  protected readonly routeCount = computed(() => this.routes().length);
  protected readonly totalDistance = computed(() =>
    this.routes()
      .reduce((acc, route) => acc + route.totalDistanceKm, 0)
      .toFixed(2)
  );

  async ngOnInit(): Promise<void> {
    await this.facade.refreshRoutes();
  }
}
