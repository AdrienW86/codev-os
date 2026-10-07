import type { Json } from "@/lib/supabase/database.types";
import type {PublicationsAgentProject,PublicationsAIRun,DriveMedia,MediaUse,GenerationDetails} from './agent-types';

export const publicationPlatforms = ["google_business_profile", "facebook", "instagram"] as const;
export const publicationStatuses = ["draft", "pending_review", "approved", "rejected"] as const;
export const deliveryStatuses = ["scheduled", "processing", "published", "retryable_error", "uncertain", "blocked", "cancelled"] as const;
export const jobTypes = ["generate", "regenerate", "deliver", "reconcile"] as const;
export const jobStatuses = ["pending", "processing", "succeeded", "failed", "cancelled"] as const;
export type PublicationPlatform = typeof publicationPlatforms[number];
export type PublicationStatus = typeof publicationStatuses[number];
export type DeliveryStatus = typeof deliveryStatuses[number];
export type JobType = typeof jobTypes[number];
export type JobStatus = typeof jobStatuses[number];
export type ReviewDecision = "approved" | "rejected";
export type WeeklySlot = { day: number; time: string };

type Created = { id: string; created_at: string };
type Updated = Created & { updated_at: string };
export type PublicationSettings = Updated & {
  generation_enabled: boolean; automation_enabled: boolean;
  publishing_enabled: boolean; emergency_stop: boolean;
};
export type PublicationClientSettings = Updated & {
  client_id: string; timezone: string; generation_enabled: boolean;
  publishing_enabled: boolean; editorial_brief: string; weekly_slots: Json;
};
export type PublicationAccount = Updated & {
  client_id: string; platform: PublicationPlatform; external_account_id: string | null;
  status: "disconnected" | "connected" | "error" | "revoked"; enabled: boolean;
  credential_reference: string | null; metadata: Json;
};
export type Publication = Updated & {
  creation_origin: "manual" | "system" | "agent";
  target_date: string | null;
  project_id: string | null;
  client_id: string; editorial_week: string; slot: 1 | 2; subject: string;
  status: PublicationStatus; current_revision_id: string | null;
};
export type PublicationListItem = Publication & { client: { name: string } | null; project: {id:string;name:string} | null };
export type PublicationRevision = Created & {
  internal_title: string | null; angle: string | null; source_content: string | null; target_date: string | null; actor_id: string | null;
  project_id: string | null;
  publication_id: string; client_id: string; revision_number: number; parent_revision_id: string | null;
  origin: "manual" | "generated" | "regenerated"; regeneration_reason: string | null;
  model: string | null; estimated_cost: number | null;
};
export type PublicationVariant = Updated & {
  revision_id: string; publication_id: string; client_id: string;
  platform: PublicationPlatform; text_content: string; metadata: Json;
};
export type PublicationAsset = Created & {
  client_id: string; storage_path: string; file_hash: string; mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number | null; height: number | null; provenance: string; rights_confirmed: boolean;
};
export type PublicationVariantAsset = { variant_id: string; asset_id: string; client_id: string; sort_order: number };
export type PublicationReview = Created & {
  publication_id: string; revision_id: string; client_id: string; variant_id: string | null;
  decision: ReviewDecision; reason: string | null; actor_id: string;
};
export type PublicationDelivery = Updated & {
  published_at: string | null;
  publication_id: string; client_id: string; publication_account_id: string; variant_id: string;
  platform: PublicationPlatform; scheduled_for: string; status: DeliveryStatus; idempotency_key: string; remote_id: string | null;
};
export type PublicationJob = Updated & {
  type: JobType; publication_id: string; delivery_id: string | null; revision_id: string | null;
  deduplication_key: string; run_at: string; status: JobStatus; attempts: number; max_attempts: number;
  locked_at: string | null; locked_by: string | null; last_error: string | null;
};
export type PublicationAttempt = Created & {
  job_id: string; delivery_id: string | null; attempt_number: number;
  result: "succeeded" | "retryable_error" | "uncertain" | "blocked" | "failed";
  sanitized_error: string | null; request_id: string | null; duration_ms: number | null;
};
export type PublicationEvent = Created & {
  actor_type: "admin" | "system" | "worker"; actor_id: string | null; action: string;
  client_id: string | null; resource_type: string; resource_id: string; correlation_id: string | null;
  before_data: Json | null; after_data: Json | null; metadata: Json;
};

type Relationship = { foreignKeyName: string; columns: string[]; isOneToOne: boolean; referencedRelation: string; referencedColumns: string[] };
type Table<Row, Required extends keyof Row, Writable extends keyof Row = never, Relations extends Relationship[] = []> = {
  Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: [Writable] extends [never] ? never : Partial<Pick<Row, Writable>>;
  Relationships: Relations;
};
// Explicit channel of a project (Lot 4.3 P1). Written only through publication_channel_save.
export type PublicationProjectChannelRow = Updated & {
  client_id: string; project_id: string; platform: PublicationPlatform; enabled: boolean;
  publication_account_id: string | null; editorial_rules: string | null;
};
export type PublicationTables = {
  publication_project_channels: Table<PublicationProjectChannelRow, "client_id" | "project_id" | "platform">;
  publication_agent_projects: Table<PublicationsAgentProject,'project_id'|'client_id'|'agent_id'|'drive_folder_id'|'verified_services'>;
  publication_ai_runs: Table<PublicationsAIRun,'agent_run_id'|'agent_id'|'client_id'|'project_id'|'publication_id'|'idempotency_key'|'attempt'>;
  publication_drive_media: Table<DriveMedia,'client_id'|'drive_file_id'|'drive_folder_id'|'name'|'mime_type'|'modified_at'|'file_size'>;
  publication_media_uses: Table<MediaUse,'media_id'|'asset_id'|'publication_id'|'revision_id'|'client_id'|'platform'>;
  publication_generation_details: Table<GenerationDetails,'revision_id'|'publication_id'|'client_id'|'run_id'|'selected_opportunity'|'media_id'|'factual_basis'|'generation_summary'>;
  publication_cadences: Table<PublicationCadence, "client_id" | "project_id", keyof CadenceConfig>;
  publication_calendar_slots: Table<CalendarSlot, "cadence_id" | "client_id" | "project_id" | "editorial_week" | "slot" | "local_date" | "local_time" | "timezone" | "scheduled_for" | "platforms", "publication_id">;
  publication_planning_jobs: Table<PlanningJob, "type" | "client_id" | "project_id" | "idempotency_key", "status" | "attempts" | "run_after" | "last_error">;
  publication_settings: Table<PublicationSettings, never, "generation_enabled" | "automation_enabled" | "publishing_enabled" | "emergency_stop">;
  publication_client_settings: Table<PublicationClientSettings, "client_id", "timezone" | "generation_enabled" | "publishing_enabled" | "editorial_brief" | "weekly_slots">;
  publication_accounts: Table<PublicationAccount, "client_id" | "platform", "external_account_id" | "status" | "enabled" | "credential_reference" | "metadata">;
  publications: Table<Publication, "client_id" | "editorial_week" | "slot" | "subject", "status" | "current_revision_id", [{
    foreignKeyName: "publications_client_id_fkey"; columns: ["client_id"]; isOneToOne: false;
    referencedRelation: "clients"; referencedColumns: ["id"];
  }, {foreignKeyName:"publications_project_client_fk";columns:["project_id","client_id"];isOneToOne:false;referencedRelation:"projects";referencedColumns:["id","client_id"]}]>;
  publication_revisions: Table<PublicationRevision, "publication_id" | "client_id" | "revision_number" | "origin">;
  publication_variants: Table<PublicationVariant, "revision_id" | "publication_id" | "client_id" | "platform" | "text_content">;
  publication_assets: Table<PublicationAsset, "client_id" | "storage_path" | "file_hash" | "mime_type" | "provenance">;
  publication_variant_assets: Table<PublicationVariantAsset, keyof PublicationVariantAsset>;
  publication_reviews: Table<PublicationReview, "publication_id" | "revision_id" | "client_id" | "variant_id" | "decision" | "actor_id">;
  publication_deliveries: Table<PublicationDelivery, "publication_id" | "client_id" | "publication_account_id" | "variant_id" | "platform" | "scheduled_for" | "idempotency_key", "variant_id" | "scheduled_for" | "status" | "remote_id">;
  publication_jobs: Table<PublicationJob, "type" | "publication_id" | "deduplication_key", "run_at" | "status" | "attempts" | "locked_at" | "locked_by" | "last_error">;
  publication_attempts: Table<PublicationAttempt, "job_id" | "attempt_number" | "result">;
  publication_events: Table<PublicationEvent, "actor_type" | "action" | "resource_type" | "resource_id">;
};
export type PublicationFunctions = {
  publication_channel_save:{Args:{p_project_id:string;p_platform:string;p_enabled:boolean;p_publication_account_id:string|null;p_editorial_rules:string|null;p_actor_id:string};Returns:string};
  publication_agent_configure:{Args:{p_project:string;p_folder:string;p_services:Json;p_rules:string;p_enabled:boolean;p_rights:boolean;p_actor:string};Returns:string};
  publication_ai_begin:{Args:{p_publication:string;p_expected:string|null;p_actor:string};Returns:Json};
  publication_ai_catalog:{Args:{p_run:string;p_photos:Json};Returns:Json};
  publication_ai_claim_media:{Args:{p_run:string;p_media:string;p_hash:string;p_analysis:Json};Returns:undefined};
  publication_ai_fail:{Args:{p_run:string;p_error:string;p_cost:number;p_input:number;p_output:number};Returns:undefined};
  publication_ai_finish:{Args:{p_run:string;p_media:string;p_content:Json;p_opportunity:Json;p_derivatives:Json;p_original:string;p_usage:Json;p_actor:string};Returns:string};
  publication_save_cadence: {Args:{p_project_id:string;p_config:Json;p_actor_id:string};Returns:string};
  publication_ensure_calendar: {Args:{p_project_id:string;p_start_week:string;p_placeholders:boolean;p_actor_id:string};Returns:Json};
  publication_save_draft: {Args:{p_publication_id:string|null;p_expected_revision_id:string|null;p_client_id:string;p_project_id:string;p_title:string;p_angle:string;p_source:string;p_target_date:string|null;p_week:string|null;p_slot:number|null;p_variants:Json;p_actor_id:string};Returns:string};
  publication_submit_manual: {Args:{p_publication_id:string;p_revision_id:string;p_actor_id:string};Returns:undefined};
  publication_review_manual: {Args:{p_publication_id:string;p_revision_id:string;p_decision:string;p_reason:string|null;p_actor_id:string};Returns:undefined};
  publication_register_image: {Args:{p_publication_id:string;p_revision_id:string;p_asset_id:string;p_path:string;p_hash:string;p_mime:string;p_provenance:string;p_actor_id:string};Returns:undefined};
  publication_set_project: {Args:{p_publication_id:string;p_expected_revision_id:string|null;p_project_id:string|null;p_actor_id:string};Returns:string|null};
  publication_create_project_manual: {Args:{p_client_id:string;p_project_id:string;p_editorial_week:string;p_slot:number;p_subject:string;p_variants:Json;p_actor_id:string};Returns:string};
  publication_create_manual: {
    Args: { p_client_id: string; p_editorial_week: string; p_slot: number; p_subject: string; p_variants: Json; p_actor_id: string };
    Returns: string;
  };
  publication_revise_manual: {
    Args: { p_publication_id: string; p_expected_revision_id: string; p_variants: Json; p_actor_id: string };
    Returns: string;
  };
  publication_review: {
    Args: { p_publication_id: string; p_revision_id: string; p_variant_id: string; p_decision: ReviewDecision; p_reason: string | null; p_actor_id: string };
    Returns: PublicationStatus;
  };
};

export type ManualVariantInput = { platform: PublicationPlatform; text_content: string; asset_ids: string[] };
export type ManualPublicationInput = { project_id?: string | null; client_id: string; editorial_week: string; slot: 1 | 2; subject: string; variants: ManualVariantInput[] };
export type RevisePublicationInput = { publication_id: string; expected_revision_id: string; variants: ManualVariantInput[] };
export type ReviewPublicationInput = { publication_id: string; revision_id: string; variant_id: string; decision: ReviewDecision; reason: string | null };
export type PublicationResult<T> = { ok: true; data: T } | { ok: false; message: string };
export type CadenceConfig = {enabled:boolean;posts_per_week:1|2;preferred_weekdays:number[];preferred_times:string[];timezone:string;planning_horizon_weeks:number;auto_create_slots:boolean;require_manual_approval:true};
export type PublicationCadence = Updated & CadenceConfig & {client_id:string;project_id:string};
export type CalendarSlot = Created & {cadence_id:string;client_id:string;project_id:string;editorial_week:string;slot:1|2;local_date:string;local_time:string;timezone:string;scheduled_for:string;platforms:PublicationPlatform[];publication_id:string|null};
export type PlanningJob = Updated & {type:"ensure_calendar_slots"|"prepare_publication"|"submit_for_review";client_id:string;project_id:string;publication_id:string|null;slot_id:string|null;revision_id:string|null;idempotency_key:string;status:"blocked"|"prepared"|"succeeded"|"failed";attempts:number;max_attempts:number;run_after:string;last_error:string|null};
