/** Transport-independent types: no production send implementation, no credentials. */
export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "configuration" | "unauthorized" | "temporary" | "permanent" | "uncertain"; detail: string };

export type OutboundMessage = {
  workspaceId: string; senderId: string; messageId: string; recipient: string;
  subject: string; plainText: string; idempotencyKey: string;
};
export type TransportReceipt = { providerMessageId: string; acceptedAt: string };
export type IncomingReply = {
  providerMessageId: string; inReplyTo: string | null;
  senderAddress: string; receivedAt: string; plainText: string;
};
export interface AcquisitionEmailTransport {
  readonly provider: string;
  verifyConfiguration(): Promise<ProviderResult<{ address: string }>>;
  submitApproved(message: OutboundMessage): Promise<ProviderResult<TransportReceipt>>;
}
export interface AcquisitionInboxProvider {
  readonly provider: string;
  verifyConfiguration(): Promise<ProviderResult<{ address: string }>>;
  fetchSince(cursor: string | null, limit: number): Promise<ProviderResult<{ replies: IncomingReply[]; nextCursor: string | null }>>;
}
export type DiscoverySignal = {
  companyName: string; domain: string | null; category: string;
  sourceUrl: string; checkedAt: string; observation: string;
};
export interface AcquisitionDiscoveryProvider {
  readonly provider: string;
  findSignals(input: { category: string; location: string; maxResults: number }): Promise<ProviderResult<DiscoverySignal[]>>;
}
export interface AcquisitionCopyGenerator {
  draft(input: { category: string; observations: DiscoverySignal[]; companyName: string }): Promise<
    ProviderResult<{ subject: string; bodyText: string; evidenceUrls: string[] }>>;
}

/** Deliberate non-operational default, safe for preview and production. */
export function unconfiguredEmailTransport(): AcquisitionEmailTransport {
  return {
    provider: "unconfigured",
    async verifyConfiguration() { return { ok: false, kind: "configuration", detail: "No approved provider connected." }; },
    async submitApproved(_message) { return { ok: false, kind: "unauthorized", detail: "Outbound sending is disabled." }; },
  };
}
