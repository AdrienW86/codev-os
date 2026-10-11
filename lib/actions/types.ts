import type { InternalActionRow } from "@/lib/supabase/database.types";

export type InternalActionRecord = InternalActionRow & {
  agent: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  recommendation: { id: string; title: string } | null;
};
export type InternalActionType = "internal.test";
export type InternalActionStatus = "draft" | "pending_approval" | "approved" | "executing" | "executed" | "failed" | "cancelled" | "rejected" | "uncertain";
export type ActionResult = { ok: true; action: InternalActionRecord } | { ok: false; message: string };
