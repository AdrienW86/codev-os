// Formats audio de la dictée (pur, testable) : type MIME du navigateur → extension acceptée par OpenAI,
// et reconnaissance du conteneur réel par ses premiers octets (« magic bytes »).
export const MAX_AUDIO_BYTES = 4_000_000;

// Extensions acceptées par /v1/audio/transcriptions : flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.
const formats: Record<string, { extension: string; container: string }> = {
  "audio/webm": { extension: "webm", container: "webm" },
  "video/webm": { extension: "webm", container: "webm" },
  "audio/ogg": { extension: "ogg", container: "ogg" },
  "audio/mp4": { extension: "mp4", container: "mp4" },
  "audio/x-m4a": { extension: "m4a", container: "mp4" },
  "audio/m4a": { extension: "m4a", container: "mp4" },
  "audio/mpeg": { extension: "mp3", container: "mp3" },
  "audio/mp3": { extension: "mp3", container: "mp3" },
  "audio/wav": { extension: "wav", container: "wav" },
  "audio/x-wav": { extension: "wav", container: "wav" },
  "audio/wave": { extension: "wav", container: "wav" },
  "audio/flac": { extension: "flac", container: "flac" },
};

export const ACCEPTED_AUDIO = Object.keys(formats);

/** « audio/webm;codecs=opus » → { mime: "audio/webm", extension: "webm" } ; null si non pris en charge. */
export function audioFormatOf(type: string) {
  const mime = type.toLowerCase().split(";")[0].trim();
  const format = formats[mime];
  return format ? { mime, ...format } : null;
}

/** Conteneur réel d'après les premiers octets (indépendant du type annoncé). */
export function sniffContainer(bytes: Uint8Array): string | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "webm";
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return "ogg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return "wav";
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return "mp4";
  if (at(0, 0x66, 0x4c, 0x61, 0x43)) return "flac";
  if (at(0, 0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "mp3";
  return null;
}
