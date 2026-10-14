import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const phoneSchema = z.string().regex(/^[1-9][0-9]{7,14}$/);
export const folderSchema = z.string().regex(/^[a-zA-Z0-9_-]{10,200}$/);
const id = z.string().regex(/^[a-zA-Z0-9._:/+=-]{1,250}$/);
export const imageMimes = ["image/jpeg", "image/png", "image/webp"] as const;
export const videoMimes = ["video/mp4", "video/3gpp"] as const;
// Meta peut suffixer le type (« video/mp4; codecs=… ») : seul le type principal est retenu.
const mime = <T extends readonly [string, ...string[]]>(values: T) => z.string().max(100).transform(value => value.split(";")[0].trim().toLowerCase()).pipe(z.enum(values));
const caption = z.string().max(20000).optional();
const image = z.object({ id, mime_type: mime(imageMimes), sha256: z.string().max(100).optional(), caption });
const video = z.object({ id, mime_type: mime(videoMimes), sha256: z.string().max(100).optional(), caption });
const envelope = z.object({ object: z.literal("whatsapp_business_account"), entry: z.array(z.object({ id, changes: z.array(z.object({ field: z.string(), value: z.object({ metadata: z.object({ phone_number_id: id }).optional(), messages: z.array(z.unknown()).max(1000).optional() }).passthrough() })).max(100) })).max(100) });
const base = { id, from: phoneSchema, timestamp: z.string().regex(/^\d{1,12}$/) };
const message = z.discriminatedUnion("type", [z.object({ ...base, type: z.literal("image"), image }), z.object({ ...base, type: z.literal("video"), video })]);
export type IncomingMedia = { waba_id: string; phone_number_id: string; message_id: string; sender: string; media_id: string; mime_type: string; received_at: string; caption: string | null };

/** Message associé au média : texte libre du client, borné, sans caractères de contrôle. Jamais journalisé. */
export function cleanCaption(value: string | undefined): string | null {
  const text = value?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 3000);
  return text ? text : null;
}

export function validSignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

// Ignore les autres types de message (texte, audio, documents…) ; refuse un lot photo/vidéo invalide plutôt que de
// l'acquitter silencieusement. Seule la légende du média est conservée, jamais les autres messages de la conversation.
export function incomingMedia(value: unknown, wabaId: string, phoneId: string): IncomingMedia[] {
  const payload = envelope.parse(value);
  const result: IncomingMedia[] = [];
  for (const entry of payload.entry) {
    if (entry.id !== wabaId) continue;
    for (const change of entry.changes) {
      if (change.field !== "messages" || change.value.metadata?.phone_number_id !== phoneId) continue;
      for (const raw of change.value.messages ?? []) {
        if (!raw || typeof raw !== "object" || !("type" in raw) || (raw.type !== "image" && raw.type !== "video")) continue;
        const item = message.parse(raw);
        const date = new Date(Number(item.timestamp) * 1000);
        if (!Number.isFinite(date.getTime())) throw Error("invalid_timestamp");
        const media = item.type === "image" ? item.image : item.video;
        result.push({ waba_id: wabaId, phone_number_id: phoneId, message_id: item.id, sender: item.from, media_id: media.id, mime_type: media.mime_type, received_at: date.toISOString(), caption: cleanCaption(media.caption) });
        if (result.length > 1000) throw Error("too_many_media");
      }
    }
  }
  return result;
}

export async function boundedBytes(response: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<Uint8Array> {
  if (!response.body) throw Error("empty_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) throw Error("body_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
