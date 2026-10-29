// Contrat pur du Studio Motion : aucune vidéo fictive, aucune action externe.
import { z } from "zod";

export const MOTION_DRIVE_ID = /^[a-zA-Z0-9_-]{10,200}$/;
export const MOTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const motionDraftSchema = z.object({
  source_key: z.string().min(47).max(250),
  title: z.string().trim().min(5).max(160),
  brief: z.string().trim().min(20).max(6000),
  brand_direction: z.string().trim().max(4000),
  duration_seconds: z.coerce.number().int().min(5).max(90),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1"]),
  engine: z.enum(["remotion", "freeform"]),
  voice_mode: z.enum(["none", "elevenlabs"]),
}).strict();
export type MotionDraft = z.infer<typeof motionDraftSchema>;

export type MotionSource = {
  clientId: string;
  clientName: string;
  folderId: string;
  label: string;
};
export type MotionProject = {
  id: string; client_id: string; source_folder_id: string; title: string;
  brief: string; brand_direction: string; duration_seconds: number;
  aspect_ratio: "9:16" | "16:9" | "1:1";
  engine: "remotion" | "freeform"; voice_mode: "none" | "elevenlabs";
  status: "draft"; created_at: string;
};
export type MotionFile = { id: string; name: string; mimeType: string; size: number; modifiedTime: string };

export function motionSourceKey(source: Pick<MotionSource, "clientId" | "folderId">): string {
  return source.clientId + ":" + source.folderId;
}
export function resolveMotionSource(sources: MotionSource[], key: string): MotionSource | null {
  return sources.find((source) => motionSourceKey(source) === key) ?? null;
}
export function parseMotionForm(form: { getAll(name: string): unknown[] }): MotionDraft | null {
  const values: Record<string, unknown> = {};
  for (const name of ["source_key", "title", "brief", "brand_direction", "duration_seconds", "aspect_ratio", "engine", "voice_mode"]) {
    const entries = form.getAll(name);
    if (entries.length !== 1 || typeof entries[0] !== "string") return null;
    values[name] = entries[0];
  }
  const parsed = motionDraftSchema.safeParse(values);
  return parsed.success ? parsed.data : null;
}
