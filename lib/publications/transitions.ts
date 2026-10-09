import { publicationStatuses, type PublicationStatus, type PublicationSettings, type PublicationClientSettings, type PublicationAccount } from "./types";

export const PUBLICATION_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";
export const SAFE_PUBLICATION_FLAGS = Object.freeze({
  generation_enabled: false, automation_enabled: false, publishing_enabled: false, emergency_stop: true,
});

const transitions: Record<PublicationStatus, readonly PublicationStatus[]> = {
  draft: ["pending_review"], pending_review: ["approved", "rejected"], approved: [], rejected: [],
};
export function canTransitionPublication(from: string, to: string): boolean {
  return publicationStatuses.includes(from as PublicationStatus) && transitions[from as PublicationStatus].includes(to as PublicationStatus);
}

// Editing text, media or targets always creates a new immutable revision.
export function statusAfterRevision(): PublicationStatus { return "pending_review"; }
export function approvalMatchesRevision(reviewRevisionId: string, currentRevisionId: string | null): boolean {
  return currentRevisionId !== null && reviewRevisionId === currentRevisionId;
}

export function publicationSafetyState(settings: PublicationSettings | null) {
  const stopped = !settings || settings.emergency_stop;
  return {
    stopped,
    generationAllowed: Boolean(settings && !stopped && settings.generation_enabled),
    automationAllowed: Boolean(settings && !stopped && settings.automation_enabled),
    publishingAllowed: Boolean(settings && !stopped && settings.publishing_enabled),
  };
}

// Preparation only. No function in Lot 1 executes publication or generation.
export function canPublishForAccount(settings: PublicationSettings | null, client: PublicationClientSettings | null, account: PublicationAccount | null): boolean {
  return Boolean(publicationSafetyState(settings).publishingAllowed && client?.publishing_enabled && account?.enabled
    && account.status === "connected" && account.external_account_id && account.credential_reference
    && account.client_id === client.client_id);
}
