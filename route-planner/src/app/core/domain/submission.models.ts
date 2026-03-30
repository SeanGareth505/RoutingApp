export interface ExternalRouteSubmission {
  id: string;
  routeId: string;
  publicLinkId: string;
  submitterName: string;
  submitterContact: string;
  vehicleConstraints: string;
  notes: string;
  pickupAddress: string;
  destinationAddress: string;
  additionalStops: string[];
  submittedAtIso: string;
  convertedToRoute: boolean;
}

export interface SubmissionReceipt {
  submissionId: string;
  confirmationCode: string;
}

export interface PublicIntakeLink {
  id: string;
  routeId: string;
  active: boolean;
  createdAtIso: string;
}
