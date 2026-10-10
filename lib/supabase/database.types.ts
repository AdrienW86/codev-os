import type { Client, ClientInput } from "@/lib/clients/types";
import type { PublicationTables, PublicationFunctions } from "@/lib/publications/types";
import type { WhatsAppFunctions, WhatsAppTables } from "@/lib/whatsapp/types";
import type { CoreFunctions, CoreTables } from "@/lib/supabase/core.types";
import type { AdsWorkspaceTables, AdsWorkspaceFunctions } from "@/lib/supabase/ads-workspace.types";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProjectRow = {
  id: string;
  client_id: string;
  name: string;
  type: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  progress: number;
  responsible: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectInsert = {
  id?: string;
  client_id: string;
  name: string;
  type?: string | null;
  status: string;
  priority: string;
  due_date?: string | null;
  progress: number;
  responsible?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TaskRow = {
  due_time?: string | null;
  duration_minutes?: number | null;
  completed_at: string | null;
  id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_type: "admin" | "agent" | "none";
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskInsert = {
  due_time?: string | null;
  duration_minutes?: number | null;
  id?: string;
  client_id: string;
  project_id?: string | null;
  title: string;
  status: string;
  priority: string;
  due_date?: string | null;
  assignee_type: "admin" | "agent" | "none";
  assignee_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type AgentRow = {
  /** Type du registre applicatif (lib/agents/registry.ts). */
  agent_type?: string | null;
  publication_specialist?: boolean;
  agent_scope: "client" | "project";
  scope_review_required: boolean;
  id: string;
  name: string;
  description: string | null;
  status: string;
  instructions: string;
  model: string | null;
  schedule: string | null;
  autonomy_level: number;
  enabled: boolean;
  max_monthly_budget_eur: number | null;
  created_at: string;
  updated_at: string;
};

export type AgentInsert = {
  agent_type?: string | null;
  publication_specialist?: boolean;
  agent_scope?: "client" | "project";
  scope_review_required?: boolean;
  id?: string;
  name: string;
  description?: string | null;
  status: string;
  instructions: string;
  model?: string | null;
  schedule?: string | null;
  autonomy_level: number;
  enabled?: boolean;
  max_monthly_budget_eur?: number | null;
  created_at?: string;
  updated_at?: string;
};

export type AgentClientAssignmentRow = {
  agent_id: string;
  client_id: string;
  enabled: boolean;
  client_instructions: string | null;
  created_at: string;
  /** manual (admin), service (activation d’un service) ou global (Agent Rapport). */
  source?: "manual" | "service" | "global";
  service_key?: string | null;
  updated_at?: string;
};

export type AgentClientAssignmentInsert = {
  agent_id: string;
  client_id: string;
  enabled?: boolean;
  client_instructions?: string | null;
  created_at?: string;
  source?: "manual" | "service" | "global";
  service_key?: string | null;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  resource_type: string;
  resource_id: string | null;
  before_data: Json | null;
  after_data: Json | null;
  metadata: Json;
  created_at: string;
};

export type AuditLogInsert = Omit<AuditLogRow, "id" | "created_at">;

export type RecommendationRow = {
  project_id: string | null;
  id: string;
  agent_id: string;
  client_id: string;
  title: string;
  reason: string | null;
  severity: string;
  status: string;
  payload: Json;
  created_at: string;
  updated_at: string;
};

export type RecommendationInsert = {
  project_id?: string | null;
  id?: string;
  agent_id: string;
  client_id: string;
  title: string;
  reason?: string | null;
  severity: string;
  status: string;
  payload: Json;
  created_at?: string;
  updated_at?: string;
};

export type AgentRunRow = {
  project_id: string | null;
  id: string;
  agent_id: string;
  client_id: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  summary: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_eur: number | null;
  metadata: Json;
};

export type AgentRunInsert = {
  project_id?: string | null;
  id?: string;
  agent_id: string;
  client_id?: string | null;
  status: string;
  started_at?: string;
  completed_at?: string | null;
  summary?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_eur?: number | null;
  metadata?: Json;
};

export type AgentMessageRow = {
  project_id: string | null;
  id: string;
  recommendation_id: string | null;
  agent_id: string;
  client_id: string;
  sender_type: "admin" | "agent" | "system";
  message: string;
  metadata: Json;
  created_at: string;
};

export type AgentMessageInsert = {
  project_id?: string | null;
  id?: string;
  recommendation_id?: string | null;
  agent_id: string;
  client_id: string;
  sender_type: "admin" | "agent" | "system";
  message: string;
  metadata?: Json;
  created_at?: string;
};

export type InternalActionRow = {
  project_id: string | null;
  id: string;
  recommendation_id: string | null;
  agent_id: string;
  client_id: string;
  action_type: string;
  parameters: Json;
  status: string;
  requires_approval: boolean;
  approved_at: string | null;
  executed_at: string | null;
  result: Json | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  payload_hash?: string | null;
  approved_payload_hash?: string | null;
  approved_by?: string | null;
  prepared_by?: string | null;
  execution_mode?: "internal" | "manual" | "external";
  incident_id?: string | null;
};

export type InternalActionInsert = {
  project_id?: string | null;
  id?: string;
  recommendation_id?: string | null;
  agent_id: string;
  client_id: string;
  action_type: string;
  parameters: Json;
  status: string;
  requires_approval: boolean;
  approved_at?: string | null;
  executed_at?: string | null;
  result?: Json | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  approved_by?: string | null;
  prepared_by?: string | null;
  execution_mode?: "internal" | "manual" | "external";
  incident_id?: string | null;
};

export type ClientServiceRow = {
  id: string;
  client_id: string;
  service_type: string;
  status: string;
  monthly_fee_eur: number | null;
  notes: string | null;
  created_at: string;
  service_key?: string | null;
  lifecycle?: "active" | "to_configure" | "paused" | "ended";
  activated_at?: string | null;
  deactivated_at?: string | null;
  updated_at?: string;
};

export type ClientServiceInsert = {
  id?: string;
  client_id: string;
  service_type: string;
  status: string;
  service_key?: string | null;
  lifecycle?: "active" | "to_configure" | "paused" | "ended";
  activated_at?: string | null;
  deactivated_at?: string | null;
  monthly_fee_eur?: number | null;
  notes?: string | null;
  created_at?: string;
};

export type Database = {
  public: {
    Tables: PublicationTables & CoreTables & AdsWorkspaceTables & WhatsAppTables & {
      agent_project_assignments: {
        Row: {agent_id:string;client_id:string;project_id:string;enabled:boolean;created_at:string;updated_at:string};
        Insert: {agent_id:string;client_id:string;project_id:string;enabled?:boolean;created_at?:string;updated_at?:string};
        Update: {enabled?:boolean};
        Relationships: [
          {foreignKeyName:"agent_project_assignments_project_id_client_id_fkey";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]},
          {foreignKeyName:"agent_project_assignments_agent_id_fkey";columns:["agent_id"];isOneToOne:false;referencedRelation:"agents";referencedColumns:["id"]}
        ];
      };
      client_connections: {
        // credential_reference / connected_at / expires_at: Lot 4.3 P9, written only through the publication connection RPCs.
        Row: { id: string; client_id: string; provider: string; status: string; external_account_id: string | null; metadata: Json; last_checked_at: string | null; created_at: string; updated_at: string; credential_reference: string | null; connected_at: string | null; expires_at: string | null; scope?: "client" | "global"; scopes?: string[]; last_sync_at?: string | null; last_error?: string | null };
        Insert: { client_id: string | null; provider: string; status: string; external_account_id?: string | null; metadata: Json; last_checked_at?: string | null; scope?: "client" | "global"; scopes?: string[]; last_sync_at?: string | null; last_error?: string | null };
        Update: { status?: string; external_account_id?: string | null; metadata?: Json; last_checked_at?: string | null; scopes?: string[]; last_sync_at?: string | null; last_error?: string | null };
        Relationships: [];
      };
      clients: {
        Row: Client;
        Insert: ClientInput;
        Update: Partial<ClientInput>;
        Relationships: [];
      };
      projects: {
        Row: ProjectRow;
        Insert: ProjectInsert;
        Update: Partial<ProjectInsert>;
        Relationships: [{
          foreignKeyName: "projects_client_id_fkey";
          columns: ["client_id"];
          isOneToOne: false;
          referencedRelation: "clients";
          referencedColumns: ["id"];
        }];
      };
      tasks: {
        Row: TaskRow;
        Insert: TaskInsert;
        Update: Partial<TaskInsert>;
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          }
        ];
      };
      agents: {
        Row: AgentRow;
        Insert: AgentInsert;
        Update: Partial<AgentInsert>;
        Relationships: [];
      };
      agent_client_assignments: {
        Row: AgentClientAssignmentRow;
        Insert: AgentClientAssignmentInsert;
        Update: Partial<AgentClientAssignmentInsert>;
        Relationships: [
          {
            foreignKeyName: "agent_client_assignments_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_client_assignments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        Update: never;
        Relationships: [];
      };
      recommendations: {
        Row: RecommendationRow;
        Insert: RecommendationInsert;
        Update: Partial<RecommendationInsert>;
        Relationships: [
          {foreignKeyName:"recommendations_project_client_fk";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]},
          {
            foreignKeyName: "recommendations_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recommendations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      agent_runs: {
        Row: AgentRunRow;
        Insert: AgentRunInsert;
        Update: Partial<AgentRunInsert>;
        Relationships: [
          {foreignKeyName:"agent_runs_project_client_fk";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]},
          {
            foreignKeyName: "agent_runs_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      agent_messages: {
        Row: AgentMessageRow;
        Insert: AgentMessageInsert;
        Update: Partial<AgentMessageInsert>;
        Relationships: [
          {foreignKeyName:"agent_messages_project_client_fk";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]},
          {
            foreignKeyName: "agent_messages_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      actions: {
        Row: InternalActionRow;
        Insert: InternalActionInsert;
        Update: Partial<InternalActionInsert>;
        Relationships: [
          {foreignKeyName:"actions_project_client_fk";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]},
          {
            foreignKeyName: "actions_recommendation_id_fkey";
            columns: ["recommendation_id"];
            isOneToOne: false;
            referencedRelation: "recommendations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "actions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
      client_services: {
        Row: ClientServiceRow;
        Insert: ClientServiceInsert;
        Update: Partial<Omit<ClientServiceInsert, "id" | "client_id" | "created_at">>;
        Relationships: [{
          foreignKeyName: "client_services_client_id_fkey";
          columns: ["client_id"];
          isOneToOne: false;
          referencedRelation: "clients";
          referencedColumns: ["id"];
        }];
      };
    };
    Views: { [key: string]: never };
    Functions: PublicationFunctions & CoreFunctions & AdsWorkspaceFunctions & WhatsAppFunctions & {
      agent_set_scope: { Args:{p_agent_id:string;p_scope:"client"|"project";p_actor_id:string};Returns:undefined };
      agent_project_assignment_set: { Args:{p_agent_id:string;p_project_id:string;p_enabled:boolean;p_actor_id:string};Returns:undefined };
    };
  };
};
