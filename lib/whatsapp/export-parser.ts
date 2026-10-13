import { cleanCaption } from "./payload";

// Socle lot 3 : lecture d'un export de discussion WhatsApp (Android et iOS, français et anglais). Pur.
// On ne garde QUE les pièces jointes, leur date et leur légende (le texte du même message). Le reste de la
// conversation, les noms et les numéros sont ignorés et jamais renvoyés. Les légendes sont des données non fiables :
// elles ne déclenchent rien, ne sont jamais interprétées et restent bornées (cleanCaption).
export type ExportMediaRef = { fileName: string; at: string | null; caption: string | null };
export type ParsedChat = { media: ExportMediaRef[]; omitted: number; messages: number };

const MARKS = /[‎‏‪-‮⁦-⁩﻿]/g;
const DATE = String.raw`(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+(\d{1,2})[:h.](\d{2})(?:[:.](\d{2}))?\s*([AaPp]\.?\s?[Mm]\.?)?`;
const ANDROID = new RegExp(String.raw`^${DATE}\s+[-–]\s+(.*)$`);
const IOS = new RegExp(String.raw`^\[${DATE}\]\s+(.*)$`);
const FILE = String.raw`([^<>:"/\\|?*\u0000-\u001f]{1,200}\.[A-Za-z0-9]{2,5})`;
const ANDROID_ATTACHMENT = new RegExp(String.raw`^${FILE}\s+\((?:fichier joint|file attached|pièce jointe|archivo adjunto|arquivo anexado|datei angehängt)\)\s*(.*)$`, "i");
const IOS_ATTACHMENT = new RegExp(String.raw`^<(?:pièce jointe|piece jointe|attached|joint|adjunto|anexo|anhang)\s*:\s*${FILE}\s*>\s*(.*)$`, "i");
const OMITTED = /^<?\s*(?:médias? omis|media omitted|fichier omis|image absente|image omitted|photo omise|vidéo absente|video omitted|multimédia omitido)\s*>?$/i;

// Heure locale (fuseau du client) → instant ISO. Deux passes pour tenir compte de l'heure d'été.
export function localInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone = "Europe/Paris"): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(guess); if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  const offset = (t: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map(p => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - t;
  };
  let t = guess - offset(guess); t = guess - offset(t);
  return new Date(t).toISOString();
}
// Jour en premier (format français), sauf si le premier nombre ne peut pas être un mois… inversement.
function headerInstant(m: RegExpMatchArray, dayFirst: boolean, timeZone: string): string | null {
  let a = Number(m[1]), b = Number(m[2]); const y = Number(m[3]), year = y < 100 ? 2000 + y : y;
  let hour = Number(m[4]); const minute = Number(m[5]), second = Number(m[6] ?? 0), ampm = m[7]?.replace(/[.\s]/g, "").toLowerCase();
  if (ampm) { if (hour === 12) hour = 0; if (ampm === "pm") hour += 12; }
  if (!dayFirst) [a, b] = [b, a];
  if (b > 12 && a <= 12) [a, b] = [b, a];
  return localInstant(year, b, a, hour, minute, second, timeZone);
}
// Le format de date d'un export est homogène : jour en premier sauf si un en-tête l'exclut (second nombre > 12).
function detectDayFirst(lines: string[]): boolean {
  for (const line of lines) { const m = line.match(ANDROID) ?? line.match(IOS); if (!m) continue; if (Number(m[1]) > 12) return true; if (Number(m[2]) > 12) return false; }
  return true;
}
// Date d'après le nom du fichier : Android IMG-20240112-WA0003.jpg (jour seul, midi local), iOS 00000012-PHOTO-2024-01-12-14-32-10.jpg.
export function fileNameInstant(name: string, timeZone = "Europe/Paris"): string | null {
  const ios = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (ios) return localInstant(+ios[1], +ios[2], +ios[3], +ios[4], +ios[5], +ios[6], timeZone);
  const android = name.match(/(?:IMG|VID|PTT|AUD|STK|DOC)-(\d{4})(\d{2})(\d{2})-WA\d+/i);
  if (android) return localInstant(+android[1], +android[2], +android[3], 12, 0, 0, timeZone);
  return null;
}

export function parseChat(text: string, timeZone = "Europe/Paris"): ParsedChat {
  const lines = text.replace(MARKS, "").split(/\r?\n/);
  const dayFirst = detectDayFirst(lines.slice(0, 500));
  const media: ExportMediaRef[] = [];
  let omitted = 0, messages = 0;
  let current: { ref: ExportMediaRef; caption: string[] } | null = null;
  const close = () => { if (current) { current.ref.caption = cleanCaption(current.caption.join("\n")); media.push(current.ref); current = null; } };
  for (const line of lines) {
    const header = line.match(IOS) ?? line.match(ANDROID);
    if (!header) { if (current && line.trim()) current.caption.push(line); continue; }
    close(); messages++;
    const body = header[8]; const sep = body.indexOf(": ");
    if (sep < 0) continue; // message système (création du groupe, chiffrement…)
    const content = body.slice(sep + 2).trim();
    if (OMITTED.test(content)) { omitted++; continue; }
    const attachment = content.match(IOS_ATTACHMENT) ?? content.match(ANDROID_ATTACHMENT);
    if (!attachment) continue; // texte seul : jamais conservé
    const fileName = attachment[1].trim();
    if (media.some(m => m.fileName === fileName)) continue;
    current = { ref: { fileName, at: headerInstant(header, dayFirst, timeZone), caption: null }, caption: attachment[2]?.trim() ? [attachment[2].trim()] : [] };
  }
  close();
  return { media, omitted, messages };
}

// Fichier de discussion de l'archive : « _chat.txt » (iOS) ou « Discussion WhatsApp avec … .txt » / « WhatsApp Chat with … .txt ».
export function isChatFile(name: string): boolean {
  const base = name.split("/").pop() ?? name;
  return /^_chat\.txt$/i.test(base) || /^(?:discussion whatsapp avec|whatsapp chat with|chat de whatsapp con|conversa do whatsapp com).*\.txt$/i.test(base);
}
export const IMAGE_EXTENSIONS: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const extensionOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
export const baseName = (name: string) => name.split("/").pop() ?? name;
