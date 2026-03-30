import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { AvatarModule } from 'primeng/avatar';
import { LocalAuthAdapter } from '../../auth/local-auth.adapter';
import { SettingsStore } from '../../application/settings.store';
import { ThemeStore } from '../../application/theme.store';

interface NavItem {
  label: string;
  icon: string;
  path: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ButtonModule,
    DrawerModule,
    AvatarModule
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ShellComponent {
  private readonly router = inject(Router);
  protected readonly auth = inject(LocalAuthAdapter);
  protected readonly settingsStore = inject(SettingsStore);
  protected readonly themeStore = inject(ThemeStore);

  protected readonly mobileMenuVisible = signal(false);
  protected readonly navItems = computed<NavItem[]>(() => [
    { label: 'Dashboard', icon: 'pi pi-home', path: '/dashboard' },
    { label: 'Route Builder', icon: 'pi pi-map', path: '/route-builder' },
    { label: 'Saved Routes', icon: 'pi pi-database', path: '/saved-routes' },
    { label: 'Settings', icon: 'pi pi-cog', path: '/settings' }
  ]);
  protected readonly connectionModeLabel = computed(() => {
    const baseUrl = this.settingsStore.settings().apiBaseUrl.trim();
    if (!baseUrl) {
      return 'Direct';
    }
    return 'Proxy';
  });

  protected navigate(path: string): void {
    this.router.navigateByUrl(path);
    this.mobileMenuVisible.set(false);
  }

  protected toggleTheme(): void {
    this.themeStore.toggle();
  }
}
