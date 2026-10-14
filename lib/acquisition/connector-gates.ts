import { getDispatchBlockReason, type DispatchPolicyInput } from "./dispatch-policy";

/** Centralized validation used by every future sending adapter. Fail closed. */
export function evaluateAcquisitionDispatch(
  policy: DispatchPolicyInput,
  message: { workspaceId: string; senderId: string; recipient: string; idempotencyKey: string },
): { allowed: boolean; reason: string } {
  if (!message.workspaceId || !message.senderId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.recipient)) {
    return { allowed: false, reason: "invalid_identity" };
  }
  if (!/^[a-zA-Z0-9:_-]{16,150}$/.test(message.idempotencyKey)) {
    return { allowed: false, reason: "invalid_idempotency_key" };
  }
  const reason = getDispatchBlockReason(policy);
  return reason ? { allowed: false, reason } : { allowed: true, reason: "eligible" };
}
