// Types de la table du Studio vidéo (migration 20261120000000_publications_motion_video.sql).
import type { Json } from "@/lib/supabase/database.types";

type Table<Row, Insert, Update = Partial<Insert>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };
export type StudioVideoRow = {
  id: string; client_id: string; title: string; script: Json; sources: Json; storage_path: string; duration_seconds: number; size_bytes: number;
  width: number; height: number; created_by: string; created_at: string; last_publication_id: string | null;
};
export type StudioTables = {
  studio_videos: Table<StudioVideoRow, Omit<StudioVideoRow, "created_at" | "last_publication_id" | "sources"> & Partial<Pick<StudioVideoRow, "created_at" | "last_publication_id" | "sources">>>;
};
