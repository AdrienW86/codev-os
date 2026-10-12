import type { IncomingMedia } from "./payload";
export type Mapping = { sender: string; client_id: string; drive_folder_id: string; rights_confirmed: boolean; enabled: boolean; updated_by: string; updated_at: string };
export type InboxStatus = "pending" | "processing" | "imported" | "duplicate" | "failed" | "dismissed";
export type Inbox = Omit<IncomingMedia, "sender"> & { id: string; sender: string | null; client_id: string | null; drive_folder_id: string | null; status: InboxStatus; attempts: number; lease: string | null; lease_until: string | null; retry_at: string; error_code: string | null; drive_file_id: string | null; asset_id: string | null; assigned_by: string | null; assigned_at: string | null; created_at: string };
export const libraryStatuses = ["received", "to_review", "validated", "used", "archived"] as const;
export type LibraryStatus = (typeof libraryStatuses)[number];
export type MediaKind = "image" | "video";
export type Asset = {
  id: string; client_id: string; drive_folder_id: string; sha256: string; md5: string; drive_file_id: string; mime_type: string; size: number; created_at: string;
  media_kind: MediaKind; imported_at: string | null; library_status: LibraryStatus; status_changed_at: string; status_changed_by: string | null;
  caption: string | null; sender: string | null; received_at: string | null; width: number | null; height: number | null; thumbnail_path: string | null;
};
export type AssetInsert = Pick<Asset, "client_id" | "drive_folder_id" | "sha256" | "md5" | "drive_file_id" | "mime_type" | "size"> & Partial<Pick<Asset, "media_kind" | "caption" | "sender" | "received_at" | "width" | "height">>;
export type AssetUse = { id: string; asset_id: string; client_id: string; publication_id: string; platform: "facebook" | "instagram" | "google_business_profile"; publication_asset_id: string | null; used_by: string; used_at: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<R>; Relationships: [] };
export type WhatsAppTables = {
  whatsapp_senders: Table<Mapping, Omit<Mapping, "updated_at">>;
  whatsapp_inbox: Table<Inbox, IncomingMedia>;
  whatsapp_assets: Table<Asset, AssetInsert>;
  whatsapp_asset_uses: Table<AssetUse, Omit<AssetUse, "id" | "used_at">>;
};
export type WhatsAppFunctions = {
  whatsapp_claim: { Args: { p_lease: string }; Returns: Inbox[] };
  whatsapp_assign: { Args: { p_inbox_id: string; p_client_id: string; p_folder: string; p_actor_id: string }; Returns: Inbox };
  whatsapp_forget_sender: { Args: { p_sender: string; p_actor_id: string }; Returns: number };
  whatsapp_purge_personal_data: { Args: { p_before: string }; Returns: number };
};
