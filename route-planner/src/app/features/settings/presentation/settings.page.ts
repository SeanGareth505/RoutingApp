import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { MessageService } from 'primeng/api';
import { SettingsStore } from '../../../core/application/settings.store';
import { ThemeMode, ThemeStore } from '../../../core/application/theme.store';
import { LocalAuthAdapter } from '../../../core/auth/local-auth.adapter';
import { UserRole } from '../../../core/domain/route.models';

@Component({
  selector: 'app-settings-page',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectButtonModule,
    ToggleSwitchModule
  ],
  template: `
    <p-card>
      <h2 class="page-title">System Settings</h2>
      <p class="page-subtitle">Configure routing behavior, security and editor interaction preferences.</p>
      <form [formGroup]="form" class="settings-form" (ngSubmit)="save()">
        <label for="role">User role</label>
        <p-selectbutton
          id="role"
          [options]="roleOptions"
          formControlName="role"
          optionLabel="label"
          optionValue="value"
        ></p-selectbutton>

        <label for="theme">Theme mode</label>
        <p-selectbutton
          id="theme"
          [options]="themeOptions"
          formControlName="themeMode"
          optionLabel="label"
          optionValue="value"
        ></p-selectbutton>

        <label for="retention">Submission retention days</label>
        <p-inputnumber id="retention" formControlName="retentionDays" [min]="7" [max]="365"></p-inputnumber>

        <label for="minTime">Minimum submit time (seconds)</label>
        <p-inputnumber id="minTime" formControlName="antiSpamMinSeconds" [min]="1" [max]="30"></p-inputnumber>

        <label for="apiKey">Provider API key (optional)</label>
        <input id="apiKey" pInputText formControlName="providerApiKey" />

        <label for="apiBaseUrl">API base URL</label>
        <input id="apiBaseUrl" pInputText formControlName="apiBaseUrl" placeholder="Leave blank for direct mode" />
        <small class="help-text">
          Use <code>/api</code> for local proxy, full backend URL for hosted API, or leave blank to use
          direct public providers (GitHub Pages mode).
        </small>

        <label for="silentChallenge">Enable silent challenge</label>
        <p-toggleswitch id="silentChallenge" formControlName="enableSilentChallenge"></p-toggleswitch>

        <label for="editorLongPressMs">Map long-press delay (ms)</label>
        <p-inputnumber
          id="editorLongPressMs"
          formControlName="editorLongPressMs"
          [min]="80"
          [max]="800"
          [step]="10"
        ></p-inputnumber>

        <label for="snapViaPoints">Snap via points to nearby route line</label>
        <p-toggleswitch id="snapViaPoints" formControlName="snapViaPoints"></p-toggleswitch>

        <button pButton type="submit" [disabled]="form.invalid">Save settings</button>
      </form>
    </p-card>
  `,
  styles: [
    `
      .settings-form {
        display: grid;
        gap: 0.65rem;
        max-width: 32rem;
      }
      label {
        font-size: 0.9rem;
        color: var(--text-muted);
      }
      .help-text {
        color: var(--text-muted);
        margin-top: -0.25rem;
      }
      @media (max-width: 960px) {
        .settings-form {
          max-width: 100%;
        }
        .help-text {
          margin-top: -0.1rem;
          font-size: 0.8rem;
          line-height: 1.35;
        }
        :host ::ng-deep .settings-form .p-selectbutton {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.35rem;
        }
        :host ::ng-deep .settings-form .p-selectbutton .p-button {
          justify-content: center;
        }
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsPage {
  private readonly settingsStore = inject(SettingsStore);
  private readonly themeStore = inject(ThemeStore);
  private readonly auth = inject(LocalAuthAdapter);
  private readonly formBuilder = inject(FormBuilder);
  private readonly messageService = inject(MessageService);

  protected readonly roleOptions = [
    { label: 'Admin', value: 'admin' },
    { label: 'Dispatcher', value: 'dispatcher' },
    { label: 'Viewer', value: 'viewer' }
  ];
  protected readonly themeOptions = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' }
  ];

  protected readonly form = this.formBuilder.nonNullable.group({
    role: this.formBuilder.nonNullable.control<UserRole>(this.auth.role()),
    themeMode: this.formBuilder.nonNullable.control<ThemeMode>(this.themeStore.mode()),
    retentionDays: this.formBuilder.nonNullable.control(
      this.settingsStore.settings().retentionDays,
      [Validators.required]
    ),
    antiSpamMinSeconds: this.formBuilder.nonNullable.control(
      this.settingsStore.settings().antiSpamMinSeconds,
      [Validators.required]
    ),
    providerApiKey: this.formBuilder.nonNullable.control(this.settingsStore.settings().providerApiKey),
    apiBaseUrl: this.formBuilder.nonNullable.control(this.settingsStore.settings().apiBaseUrl),
    enableSilentChallenge: this.formBuilder.nonNullable.control(
      this.settingsStore.settings().enableSilentChallenge
    ),
    editorLongPressMs: this.formBuilder.nonNullable.control(this.settingsStore.settings().editorLongPressMs),
    snapViaPoints: this.formBuilder.nonNullable.control(this.settingsStore.settings().snapViaPoints)
  });

  protected save(): void {
    const values = this.form.getRawValue();
    this.auth.setRole(values.role);
    this.themeStore.setMode(values.themeMode);
    this.settingsStore.update({
      ...this.settingsStore.settings(),
      retentionDays: values.retentionDays,
      antiSpamMinSeconds: values.antiSpamMinSeconds,
      providerApiKey: values.providerApiKey,
      apiBaseUrl: values.apiBaseUrl.trim(),
      enableSilentChallenge: values.enableSilentChallenge,
      editorLongPressMs: values.editorLongPressMs,
      snapViaPoints: values.snapViaPoints
    });
    this.messageService.add({
      severity: 'success',
      summary: 'Settings saved',
      detail: 'Configuration and theme are stored locally and Firebase remains disabled.'
    });
  }
}
