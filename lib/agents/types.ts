import type { AgentClientAssignmentRow, AgentRow } from "@/lib/supabase/database.types";
export type AgentScope = "client" | "project";
export type AgentProjectAssignmentRecord = {
  agent_id:string;client_id:string;project_id:string;enabled:boolean;created_at:string;updated_at:string;
  project:{id:string;name:string;type:string|null}|null;
  agent:Pick<AgentRow,"id"|"name"|"agent_scope"|"scope_review_required">|null;
};

export type AgentRecord = AgentRow;
export type AgentAssignmentRecord = AgentClientAssignmentRow & { agent: AgentRow | null };
export type ClientAgentAssignmentRecord = AgentClientAssignmentRow & { client: { id: string; name: string } | null };
export type AgentSummary = Pick<AgentRow, "id" | "name" | "status" | "enabled" | "autonomy_level" | "agent_scope" | "scope_review_required">;
export type AgentAssignmentSummary = Pick<AgentClientAssignmentRow, "agent_id" | "client_id" | "enabled" | "client_instructions"> & { agent: AgentSummary | null };
export type AgentField = "name" | "description" | "status" | "enabled" | "instructions" | "model" | "schedule" | "autonomy_level" | "max_monthly_budget_eur" | "agent_scope";
export type AgentFormState = {
  errors?: Partial<Record<AgentField | "id", string>>;
  values?: Partial<Record<AgentField | "id", string>>;
  message?: string;
};
export type AgentAssignmentFormState = {
  errors?: Partial<Record<"agent_id" | "client_instructions" | "enabled", string>>;
  message?: string;
};
export type AgentTestRunState = { message?: string; recommendationId?: string };
export type AgentMutationResult = { ok: true; id: string } | { ok: false; state: AgentFormState };
export type AssignmentMutationResult = { ok: true } | { ok: false; message: string };
