import type { IncomingMedia } from "./payload";
import type { Json } from "@/lib/supabase/database.types";
export type Mapping = { sender: string; client_id: string; drive_folder_id: string; rights_confirmed: boolean; enabled: boolean; updated_by: string; updated_at: string };
export type InboxStatus = "pending" | "processing" | "imported" | "duplicate" | "failed" | "dismissed";
export type Inbox = Omit<IncomingMedia, "sender"> & { id: string; sender: string | null; client_id: string | null; drive_folder_id: string | null; status: InboxStatus; attempts: number; lease: string | null; lease_until: string | null; retry_at: string; error_code: string | null; drive_file_id: string | null; asset_id: string | null; assigned_by: string | null; assigned_at: string | null; created_at: string };
export const libraryStatuses = ["received", "to_review", "validated", "used", "archived", "quarantined", "rejected"] as const;
export type LibraryStatus = (typeof libraryStatuses)[number];
export type MediaKind = "image" | "video";
export type Asset = {
  id: string; client_id: string; drive_folder_id: string; sha256: string; md5: string; drive_file_id: string; mime_type: string; size: number; created_at: string;
  media_kind: MediaKind; imported_at: string | null; library_status: LibraryStatus; status_changed_at: string; status_changed_by: string | null;
  caption: string | null; sender: string | null; received_at: string | null; width: number | null; height: number | null; thumbnail_path: string | null;
  origin: AssetOrigin; captured_at: string | null; purged_at: string | null; claimed_agent_v2_run_id: string | null;
  classification_failures: number; classification_failed_at: string | null;
  // Outils de la photothèque (migration 20261103000000) : légende éditée par un administrateur.
  caption_edited_by?: string | null; caption_edited_at?: string | null;
};
export type AssetOrigin = "whatsapp" | "drive" | "whatsapp_export";
export type AssetInsert = Pick<Asset, "client_id" | "drive_folder_id" | "sha256" | "md5" | "drive_file_id" | "mime_type" | "size"> & Partial<Pick<Asset, "media_kind" | "caption" | "sender" | "received_at" | "width" | "height" | "origin" | "captured_at" | "imported_at">>;
// Socle lot 2 : profil média du client, évaluation IA courante d'un média, journal des coûts IA.
export type MediaProfileRow = { client_id: string; activity_summary: string; services: string[]; accepted_photo_types: string[]; excluded_photo_types: string[]; priority_topics: string[]; communication_guidelines: string; ai_classification_enabled: boolean; ai_monthly_budget_eur: number; quarantine_retention_days: number; rejected_deletion_policy: "keep" | "trash_drive"; version: number; updated_by: string; updated_at: string; last_classified_at: string | null };
export type AssetAssessment = { asset_id: string; client_id: string; verdict: "relevant" | "to_review" | "off_topic"; business_relevance: number; publishability: number; sensitive: string[]; confidential: boolean; description: string; topics: string[]; quality: "good" | "acceptable" | "poor"; quality_issues: string[]; profile_version: number; model: string; estimated_cost_eur: number; analyzed_at: string; manual_verdict: "relevant" | "off_topic" | null; reviewed_by: string | null; reviewed_at: string | null };
export type MediaAiUsage = { id: string; client_id: string; asset_id: string | null; purpose: "classification"; model: string; input_tokens: number; output_tokens: number; estimated_cost_eur: number; created_at: string };
export type AssetUse = { id: string; asset_id: string; client_id: string; publication_id: string; platform: "facebook" | "instagram" | "google_business_profile"; publication_asset_id: string | null; used_by: string; used_at: string };
// Outils de la photothèque : décisions humaines (ajout seul) et mémoire de la synchronisation Drive.
export type AssetDecision = { id: string; asset_id: string; client_id: string; kind: "status" | "reclassify" | "caption"; from_status: LibraryStatus | null; to_status: LibraryStatus | null; reason: string | null; actor_id: string; created_at: string };
export type DriveFileSeen = { client_id: string; drive_file_id: string; drive_folder_id: string; outcome: "duplicate" | "failed"; asset_id: string | null; failures: number; error_code: string | null; first_seen_at: string; updated_at: string };
export type DriveSyncState = { client_id: string; drive_folder_id: string; backfill_after: string | null; backfill_completed_at: string | null; last_synced_at: string | null };
export type UsageHistoryRow = { asset_id: string; publication_id: string; platform: AssetUse["platform"]; used_at: string; used_by: string; subject: string | null; publication_status: string | null; archived: boolean; delivery_status: string | null; scheduled_for: string | null; published_at: string | null };
// Socle lot 3 : import d'export WhatsApp (archive temporaire, une ligne par photo de l'archive).
export type ExportImportRow = { id: string; client_id: string; drive_folder_id: string; status: "uploading" | "analyzing" | "ready" | "importing" | "completed" | "cancelled" | "expired" | "failed"; storage_path: string; archive_size: number | null; counts: Json; incomplete: boolean; error_code: string | null; rights_confirmed: boolean; created_by: string; created_at: string; updated_at: string; expires_at: string; purged_at: string | null };
export type ExportItemRow = { id: string; import_id: string; client_id: string; entry_name: string; entry_offset: number; compressed_size: number; size: number; method: number; crc32: number; captured_at: string | null; caption: string | null; status: "pending" | "ready" | "importing" | "duplicate" | "invalid" | "too_large" | "imported" | "failed"; selected: boolean; sha256: string | null; md5: string | null; mime_type: string | null; width: number | null; height: number | null; preview_path: string | null; asset_id: string | null; error_code: string | null; created_at: string; updated_at: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<R>; Relationships: [] };
export type WhatsAppTables = {
  whatsapp_senders: Table<Mapping, Omit<Mapping, "updated_at">>;
  whatsapp_inbox: Table<Inbox, IncomingMedia>;
  whatsapp_assets: Table<Asset, AssetInsert>;
  whatsapp_asset_uses: Table<AssetUse, Omit<AssetUse, "id" | "used_at">>;
  client_media_profiles: Table<MediaProfileRow, Pick<MediaProfileRow, "client_id" | "updated_by">>;
  whatsapp_asset_assessments: Table<AssetAssessment, Omit<AssetAssessment, "analyzed_at" | "manual_verdict" | "reviewed_by" | "reviewed_at">>;
  client_media_ai_usage: Table<MediaAiUsage, Omit<MediaAiUsage, "id" | "created_at">>;
  whatsapp_export_imports: Table<ExportImportRow, Pick<ExportImportRow, "id" | "client_id" | "drive_folder_id" | "storage_path" | "rights_confirmed" | "created_by"> & Partial<Pick<ExportImportRow, "expires_at" | "status">>>;
  whatsapp_asset_decisions: Table<AssetDecision, Omit<AssetDecision, "id" | "created_at">>;
  client_media_drive_files: Table<DriveFileSeen, Pick<DriveFileSeen, "client_id" | "drive_file_id" | "drive_folder_id" | "outcome"> & Partial<Pick<DriveFileSeen, "asset_id" | "failures" | "error_code" | "updated_at">>>;
  client_media_drive_sync: Table<DriveSyncState, Pick<DriveSyncState, "client_id" | "drive_folder_id"> & Partial<DriveSyncState>>;
  whatsapp_export_items: Table<ExportItemRow, Pick<ExportItemRow, "import_id" | "client_id" | "entry_name" | "entry_offset" | "compressed_size" | "size" | "method" | "crc32"> & Partial<Pick<ExportItemRow, "captured_at" | "caption" | "status" | "selected" | "error_code">>>;
};
export type WhatsAppFunctions = {
  whatsapp_claim: { Args: { p_lease: string }; Returns: Inbox[] };
  whatsapp_assign: { Args: { p_inbox_id: string; p_client_id: string; p_folder: string; p_actor_id: string }; Returns: Inbox };
  whatsapp_forget_sender: { Args: { p_sender: string; p_actor_id: string }; Returns: number };
  whatsapp_purge_personal_data: { Args: { p_before: string }; Returns: number };
  client_media_profile_save: { Args: { p_client_id: string; p_profile: Json; p_actor_id: string }; Returns: number };
  client_media_ai_month_spend: { Args: { p_client_id: string }; Returns: number };
  whatsapp_asset_assessment_record: { Args: { p_asset_id: string; p_client_id: string; p_assessment: Json; p_usage: Json }; Returns: string };
  whatsapp_asset_assessment_failed: { Args: { p_asset_id: string; p_client_id: string; p_usage: Json | null }; Returns: number };
  whatsapp_assets_review: { Args: { p_client_id: string; p_asset_ids: string[]; p_status: string; p_actor_id: string }; Returns: number };
  whatsapp_rejected_purge_candidates: { Args: { p_limit: number }; Returns: { asset_id: string; client_id: string; drive_file_id: string; drive_folder_id: string; origin: string; thumbnail_path: string | null }[] };
  whatsapp_asset_mark_purged: { Args: { p_asset_id: string; p_client_id: string; p_drive_trash_planned: boolean }; Returns: boolean };
  whatsapp_asset_reclassify: { Args: { p_client_id: string; p_asset_id: string; p_status: string; p_reason: string; p_actor_id: string }; Returns: Json };
  whatsapp_asset_caption_save: { Args: { p_client_id: string; p_asset_id: string; p_caption: string; p_actor_id: string }; Returns: boolean };
  whatsapp_asset_usage_history: { Args: { p_client_id: string; p_asset_ids: string[] }; Returns: UsageHistoryRow[] };
  whatsapp_library_search: { Args: { p_client_id: string; p_filters: Json; p_limit: number; p_offset: number }; Returns: { asset_id: string; total: number }[] };
  whatsapp_asset_purge_trash_logged: { Args: { p_asset_id: string; p_client_id: string; p_outcome: "trashed" | "missing" | "failed" }; Returns: undefined };
};
