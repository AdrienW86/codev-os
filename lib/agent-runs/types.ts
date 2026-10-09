import type { AgentRunRow } from "@/lib/supabase/database.types";

export type AgentRunRecord = AgentRunRow & {
  agent: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
};
export type AgentRunResult = { ok: true; run: AgentRunRecord } | { ok: false; message: string };
export type InternalTestRunResult = { ok: true; runId: string; recommendationId: string } | { ok: false; message: string };
