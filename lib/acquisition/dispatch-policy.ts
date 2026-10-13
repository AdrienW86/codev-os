/** Pure fail-closed checks. No transport implementation or sending side effects here. */
export type DispatchPolicyInput = {
  emergencyStop: boolean; workspaceSendingEnabled: boolean; senderReady: boolean;
  providerApproved: boolean; recipientApproved: boolean; humanApproved: boolean;
  suppressed: boolean; dailyLimit: number; sentToday: number;
};
export function getDispatchBlockReason(input: DispatchPolicyInput): string | null {
  if (input.emergencyStop) return "emergency_stop";
  if (!input.workspaceSendingEnabled) return "sending_disabled";
  if (!input.providerApproved) return "provider_not_authorized";
  if (!input.senderReady) return "sender_not_ready";
  if (!input.recipientApproved) return "recipient_not_verified";
  if (!input.humanApproved) return "human_approval_required";
  if (input.suppressed) return "recipient_suppressed";
  if (!Number.isSafeInteger(input.dailyLimit) || input.dailyLimit<=0) return "no_quota";
  if (!Number.isSafeInteger(input.sentToday)||input.sentToday<0||input.sentToday>=input.dailyLimit) return "daily_quota_reached";
  return null;
}
