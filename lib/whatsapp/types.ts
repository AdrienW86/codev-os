import type { IncomingImage } from "./payload";
export type Mapping = { sender: string; client_id: string; drive_folder_id: string; rights_confirmed: boolean; enabled: boolean; updated_by: string; updated_at: string };
export type Inbox = IncomingImage & { id: string; client_id: string | null; drive_folder_id: string | null; status: "pending" | "processing" | "imported" | "duplicate" | "failed"; attempts: number; lease: string | null; lease_until: string | null; retry_at: string; error_code: string | null; drive_file_id: string | null; created_at: string };
export type Asset = { id: string; client_id: string; drive_folder_id: string; sha256: string; md5: string; drive_file_id: string; mime_type: string; size: number; created_at: string };
type Table<R, I> = { Row: R; Insert: I; Update: Partial<R>; Relationships: [] };
export type WhatsAppTables = {
  whatsapp_senders: Table<Mapping, Omit<Mapping, "updated_at">>;
  whatsapp_inbox: Table<Inbox, IncomingImage>;
  whatsapp_assets: Table<Asset, Omit<Asset, "id" | "created_at">>;
};
export type WhatsAppFunctions = {
  whatsapp_claim: { Args: { p_lease: string }; Returns: Inbox[] };
};
