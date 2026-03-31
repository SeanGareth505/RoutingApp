import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { StepsModule } from 'primeng/steps';
import { TextareaModule } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { SettingsStore } from '../../../core/application/settings.store';
import { RoutePlannerFacade } from '../../../core/application/route-planner.facade';

@Component({
  selector: 'app-intake-page',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    TextareaModule,
    StepsModule,
    ButtonModule,
    MessageModule
  ],
  template: `
    <section class="intake-layout">
      <p-card>
        <h2 class="page-title">Route Intake Form</h2>
        <p class="page-subtitle">Submit trip details for dispatch review and conversion into route checkpoints.</p>
        <p-steps [model]="stepItems" [readonly]="true" [activeIndex]="step()"></p-steps>

        @if (errorMessage()) {
          <p-message severity="error">{{ errorMessage() }}</p-message>
        }

        <form [formGroup]="form" class="wizard-form">
          @if (step() === 0) {
            <label for="name">Your name</label>
            <input id="name" pInputText formControlName="submitterName" />
            <label for="contact">Phone or email</label>
            <input id="contact" pInputText formControlName="submitterContact" />
          }

          @if (step() === 1) {
            <label for="pickup">Pickup address</label>
            <input id="pickup" pInputText formControlName="pickupAddress" />
            <label for="destination">Destination address</label>
            <input id="destination" pInputText formControlName="destinationAddress" />
            <div formArrayName="additionalStops" class="stops-array">
              @for (stopCtrl of additionalStops.controls; track $index) {
                <div class="stop-line">
                  <input pInputText [formControlName]="$index" placeholder="Additional stop (optional)" />
                  <button pButton type="button" class="p-button-text" (click)="removeAdditionalStop($index)">
                    <i class="pi pi-trash"></i>
                  </button>
                </div>
              }
            </div>
            <button pButton type="button" class="p-button-outlined" (click)="addAdditionalStop()">
              Add optional stop
            </button>
          }

          @if (step() === 2) {
            <label for="vehicle">Vehicle constraints</label>
            <textarea
              id="vehicle"
              pTextarea
              rows="3"
              formControlName="vehicleConstraints"
              placeholder="Vehicle size, accessibility, loading constraints"
            ></textarea>
            <label for="notes">Notes</label>
            <textarea id="notes" pTextarea rows="3" formControlName="notes"></textarea>
          }

          @if (step() === 3) {
            <div class="review-grid">
              <p><strong>Name:</strong> {{ form.controls.submitterName.value }}</p>
              <p><strong>Contact:</strong> {{ form.controls.submitterContact.value }}</p>
              <p><strong>Pickup:</strong> {{ form.controls.pickupAddress.value }}</p>
              <p><strong>Destination:</strong> {{ form.controls.destinationAddress.value }}</p>
              <p><strong>Vehicle constraints:</strong> {{ form.controls.vehicleConstraints.value }}</p>
              <p><strong>Notes:</strong> {{ form.controls.notes.value || 'None' }}</p>
            </div>
          }

          <div class="wizard-actions">
            <button pButton type="button" class="p-button-text" [disabled]="step() === 0" (click)="back()">
              Back
            </button>
            @if (step() < 3) {
              <button pButton type="button" (click)="next()">Next</button>
            } @else {
              <button pButton type="button" (click)="submit()">Submit route details</button>
            }
          </div>
        </form>

        @if (receipt()) {
          <p-message severity="success">
            Submitted successfully. Confirmation code: {{ receipt() }}
          </p-message>
        }
      </p-card>
    </section>
  `,
  styles: [
    `
      .intake-layout {
        max-width: 48rem;
        margin: 1.5rem auto;
        padding: 0 1rem;
      }
      .wizard-form {
        display: grid;
        gap: 0.7rem;
        margin-top: 1rem;
      }
      .stops-array {
        display: grid;
        gap: 0.4rem;
      }
      .stop-line {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.5rem;
      }
      .wizard-actions {
        margin-top: 0.75rem;
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .review-grid p {
        margin: 0.3rem 0;
      }
      @media (max-width: 960px) {
        .intake-layout {
          margin: 1rem auto;
          padding: 0 0.55rem;
        }
        .stop-line {
          grid-template-columns: 1fr;
        }
        .stop-line button {
          justify-self: flex-start;
          min-width: 2.4rem;
          min-height: 2.4rem;
        }
        .wizard-actions {
          flex-direction: column-reverse;
        }
        .wizard-actions button {
          width: 100%;
          justify-content: center;
        }
        :host ::ng-deep .p-steps .p-steps-list {
          overflow-x: auto;
          padding-bottom: 0.3rem;
        }
        :host ::ng-deep .p-steps .p-steps-item-label {
          white-space: nowrap;
          font-size: 0.72rem;
        }
      }
    `
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IntakePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly facade = inject(RoutePlannerFacade);
  private readonly formBuilder = inject(FormBuilder);
  private readonly settingsStore = inject(SettingsStore);

  protected readonly step = signal(0);
  protected readonly receipt = signal('');
  protected readonly errorMessage = signal('');
  protected publicLinkId = '';
  private formStartMs = Date.now();

  protected readonly stepItems = [
    { label: 'Contact' },
    { label: 'Trip Details' },
    { label: 'Constraints' },
    { label: 'Review' }
  ];

  protected readonly form = this.formBuilder.nonNullable.group({
    submitterName: ['', [Validators.required, Validators.minLength(2)]],
    submitterContact: ['', [Validators.required, Validators.minLength(4)]],
    pickupAddress: ['', [Validators.required, Validators.minLength(4)]],
    destinationAddress: ['', [Validators.required, Validators.minLength(4)]],
    additionalStops: this.formBuilder.array<string>([]),
    vehicleConstraints: ['', [Validators.required, Validators.minLength(2)]],
    notes: [''],
    honeyPot: ['']
  });

  protected get additionalStops(): FormArray {
    return this.form.controls.additionalStops;
  }

  ngOnInit(): void {
    this.publicLinkId = this.route.snapshot.paramMap.get('publicLinkId') ?? '';
  }

  protected addAdditionalStop(): void {
    this.additionalStops.push(this.formBuilder.nonNullable.control(''));
  }

  protected removeAdditionalStop(index: number): void {
    this.additionalStops.removeAt(index);
  }

  protected next(): void {
    const current = this.step();
    this.step.set(Math.min(current + 1, 3));
  }

  protected back(): void {
    const current = this.step();
    this.step.set(Math.max(current - 1, 0));
  }

  protected async submit(): Promise<void> {
    this.errorMessage.set('');
    this.receipt.set('');
    const values = this.form.getRawValue();
    const elapsedSeconds = (Date.now() - this.formStartMs) / 1000;

    if (values.honeyPot.trim().length > 0) {
      this.errorMessage.set('Submission rejected.');
      return;
    }

    if (elapsedSeconds < this.settingsStore.settings().antiSpamMinSeconds) {
      this.errorMessage.set('Please review your details and try again in a few seconds.');
      return;
    }

    if (this.form.invalid) {
      this.errorMessage.set('Please complete all required fields.');
      return;
    }

    try {
      const receipt = await this.facade.submitPublicIntake(this.publicLinkId, {
        submitterName: values.submitterName,
        submitterContact: values.submitterContact,
        vehicleConstraints: values.vehicleConstraints,
        notes: values.notes,
        pickupAddress: values.pickupAddress,
        destinationAddress: values.destinationAddress,
        additionalStops: values.additionalStops.filter(
          (stop): stop is string => typeof stop === 'string' && stop.trim().length > 0
        )
      });
      this.receipt.set(receipt.confirmationCode);
      this.form.disable();
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    }
  }
}
