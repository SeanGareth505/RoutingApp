import {
  ExternalRouteSubmission,
  PublicIntakeLink,
  SubmissionReceipt
} from '../domain/submission.models';

export interface ExternalSubmissionPort {
  createLink(routeId: string): Promise<PublicIntakeLink>;
  listLinks(routeId: string): Promise<PublicIntakeLink[]>;
  revokeLink(linkId: string): Promise<void>;
  createSubmission(
    payload: Omit<ExternalRouteSubmission, 'id' | 'submittedAtIso' | 'convertedToRoute'>
  ): Promise<SubmissionReceipt>;
  listSubmissionsForRoute(routeId: string): Promise<ExternalRouteSubmission[]>;
  listSubmissionsByLink(publicLinkId: string): Promise<ExternalRouteSubmission[]>;
  attachSubmissionToRoute(routeId: string, submissionId: string): Promise<void>;
  resolveRouteIdFromLink(publicLinkId: string): Promise<string | null>;
}
