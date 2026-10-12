import { inflateRawSync } from "node:zlib";

// Socle lot 3 : lecture minimale d'une archive ZIP d'export WhatsApp par plages d'octets. Seuls le répertoire central
// puis les entrées choisies sont lus : l'archive n'est jamais chargée entière en mémoire et chaque lot relit
// uniquement ses fichiers. Refus explicites : ZIP64, multi-volumes, entrées chiffrées, méthodes autres que
// « stockée » et « deflate », tailles incohérentes, CRC invalide, expansion au-delà de la taille annoncée.
export type RangeReader = { size: number; read(start: number, end: number): Promise<Uint8Array> };
export type ZipEntry = { name: string; method: number; compressedSize: number; size: number; crc32: number; offset: number; encrypted: boolean };
export class ZipFailure extends Error { constructor(public readonly code: string) { super(code); } }

export const MAX_ZIP_ENTRIES = 20000;
const MAX_CENTRAL_DIRECTORY = 16 * 1024 * 1024;
const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

export async function readCentralDirectory(reader: RangeReader, maxEntries = MAX_ZIP_ENTRIES): Promise<ZipEntry[]> {
  if (!Number.isSafeInteger(reader.size) || reader.size < 22) throw new ZipFailure("zip_invalid");
  const tailStart = Math.max(0, reader.size - 65557);
  const tail = await reader.read(tailStart, reader.size);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (view(tail).getUint32(i, true) === EOCD) { at = i; break; }
  if (at < 0) throw new ZipFailure("zip_invalid");
  const e = view(tail.subarray(at));
  const disk = e.getUint16(4, true), cdDisk = e.getUint16(6, true), count = e.getUint16(10, true), cdSize = e.getUint32(12, true), cdOffset = e.getUint32(16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipFailure("zip64_unsupported");
  if (disk !== 0 || cdDisk !== 0) throw new ZipFailure("zip_multivolume");
  if (count > maxEntries) throw new ZipFailure("zip_too_many_entries");
  if (cdSize > MAX_CENTRAL_DIRECTORY || cdOffset + cdSize > tailStart + at) throw new ZipFailure("zip_invalid");
  const cd = await reader.read(cdOffset, cdOffset + cdSize), v = view(cd);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== CENTRAL) throw new ZipFailure("zip_invalid");
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true);
    const compressedSize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nameLength = v.getUint16(p + 28, true), extraLength = v.getUint16(p + 30, true), commentLength = v.getUint16(p + 32, true), offset = v.getUint32(p + 42, true);
    if (p + 46 + nameLength > cd.length) throw new ZipFailure("zip_invalid");
    if (compressedSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipFailure("zip64_unsupported");
    const raw = cd.subarray(p + 46, p + 46 + nameLength);
    const name = Buffer.from(raw).toString(flags & 0x800 ? "utf8" : "latin1");
    if (!name.endsWith("/")) entries.push({ name, method, compressedSize, size, crc32: crc, offset, encrypted: (flags & 1) === 1 });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// Contenu d'une entrée, vérifié (taille annoncée, CRC). maxSize borne la décompression (pas de bombe ZIP).
export async function extractEntry(reader: RangeReader, entry: ZipEntry, maxSize: number): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipFailure("zip_encrypted");
  if (entry.method !== 0 && entry.method !== 8) throw new ZipFailure("zip_method");
  if (entry.size > maxSize || entry.compressedSize > maxSize + 1024 * 1024) throw new ZipFailure("entry_too_large");
  const header = await reader.read(entry.offset, entry.offset + 30), h = view(header);
  if (header.length < 30 || h.getUint32(0, true) !== LOCAL) throw new ZipFailure("zip_invalid");
  const start = entry.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (start + entry.compressedSize > reader.size) throw new ZipFailure("zip_truncated");
  const data = entry.compressedSize ? await reader.read(start, start + entry.compressedSize) : new Uint8Array();
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = data;
  else {
    try { bytes = new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(1, maxSize) })); }
    catch { throw new ZipFailure("entry_corrupt"); }
  }
  if (bytes.length !== entry.size) throw new ZipFailure("entry_corrupt");
  if (crc32(bytes) !== entry.crc32) throw new ZipFailure("entry_corrupt");
  return bytes;
}
// Lecteur en mémoire (tests, petits fichiers).
export function bufferReader(bytes: Uint8Array): RangeReader {
  return { size: bytes.length, async read(start, end) { return bytes.subarray(Math.max(0, start), Math.min(bytes.length, end)); } };
}
