import "server-only";
import { createHash } from "node:crypto";
import { driveReadProvider } from "@/lib/integrations/publications-drive";
import { downloadDrive, importDriveToken, maxImageBytes, maxVideoBytes } from "./providers";
import type { Asset } from "./types";

/**
 * Original Drive d'un média, relu par le bon accès : import (drive.file) pour les fichiers créés par l'application,
 * lecture seule Publications pour les photos déposées à la main dans le dossier Drive du client (origine « drive »).
 */
export async function assetOriginal(asset: Pick<Asset, "origin" | "drive_file_id" | "drive_folder_id" | "md5" | "media_kind">, token?: string) {
  if (asset.origin === "drive") {
    const bytes = await driveReadProvider().download(asset.drive_file_id, asset.drive_folder_id);
    if (createHash("md5").update(bytes).digest("hex") !== asset.md5) throw Error("Drive file changed");
    return bytes;
  }
  return downloadDrive(token ?? await importDriveToken(), asset.drive_file_id, asset.drive_folder_id, asset.md5, asset.media_kind === "video" ? maxVideoBytes : maxImageBytes);
}
