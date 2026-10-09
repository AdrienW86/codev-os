import type { InternalActionStatus, InternalActionType } from "./types";

export const actionTypes: readonly InternalActionType[] = ["internal.test"];
export const actionStatuses: readonly InternalActionStatus[] = ["draft", "pending_approval", "approved", "executing", "executed", "failed", "cancelled"];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isActionUuid(value: string) {
  return uuid.test(value);
}

export function isValidActionParameters(actionType: unknown, parameters: unknown): parameters is Record<string, never> {
  return actionType === "internal.test" && parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) && Object.keys(parameters).length === 0;
}

export function validateCreateActionInput(input: unknown): { recommendation_id: string; action_type: InternalActionType; parameters: Record<string, never> } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (typeof value.recommendation_id !== "string" || !uuid.test(value.recommendation_id)) return null;
  if (typeof value.action_type !== "string" || !actionTypes.includes(value.action_type as InternalActionType)) return null;
  if (!isValidActionParameters(value.action_type, value.parameters)) return null;
  return { recommendation_id: value.recommendation_id, action_type: value.action_type as InternalActionType, parameters: {} };
}

const transitions: Record<InternalActionStatus, readonly InternalActionStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["executing"],
  executing: ["executed", "failed"],
  executed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionAction(from: string, to: InternalActionStatus) {
  return actionStatuses.includes(from as InternalActionStatus) && transitions[from as InternalActionStatus].includes(to);
}