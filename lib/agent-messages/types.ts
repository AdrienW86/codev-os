import type { AgentMessageRow } from "@/lib/supabase/database.types";

export type AgentMessageRecord = AgentMessageRow;
export type CreateAdminMessageResult = { ok: true; message: AgentMessageRecord } | { ok: false; message: string };