// Socle lot 3 : messages de l'import d'export WhatsApp (codes fermés → texte, aucun détail technique ni secret).
const MESSAGES: Record<string, string> = {
  invalid_client: "Client invalide.", rights_required: "Confirmez que le client vous autorise à utiliser ces photos.",
  archive_invalid: "Archive illisible : exportez la discussion « avec médias » depuis WhatsApp (fichier .zip).", archive_too_large: "Archive trop volumineuse (500 Mo au maximum) : exportez une période plus courte.",
  no_folder: "Associez d’abord un dossier Drive WhatsApp à ce client (Réglages › WhatsApp), avec les droits confirmés.", already_running: "Un import est déjà en cours pour ce client : terminez-le ou annulez-le.",
  import_missing: "Import introuvable ou expiré (24 h) : recommencez.", already_analyzed: "Archive déjà analysée.", wrong_state: "Action impossible à cette étape : rechargez la page.",
  zip_invalid: "Archive ZIP invalide.", zip64_unsupported: "Archive trop grande pour être lue (ZIP64) : exportez une période plus courte.", zip_multivolume: "Archive en plusieurs parties non prise en charge.",
  zip_too_many_entries: "Archive contenant trop de fichiers.", zip_encrypted: "Archive chiffrée non prise en charge.", chat_too_large: "Discussion trop volumineuse : exportez une période plus courte.",
  too_many_photos: "Plus de 5 000 photos : exportez une période plus courte.", items_unavailable: "Analyse non enregistrée : recommencez.",
  archive_missing: "Archive non reçue : renvoyez le fichier.", storage_unavailable: "Stockage temporaire indisponible : réessayez.", storage_host: "Stockage temporaire indisponible.",
  range_unsupported: "Stockage temporaire incompatible avec la lecture par lots.", archive_truncated: "Archive incomplète : renvoyez le fichier.",
  invalid_period: "Période invalide.", nothing_selected: "Aucune photo sélectionnée.",
  config_missing: "Accès Drive d’import non configuré (GOOGLE_DRIVE_IMPORT_*).", config_invalid: "Accès Drive d’import mal configuré.",
  drive_folder: "Dossier Drive du client inaccessible : vérifiez l’association WhatsApp.", provider_permission: "Accès Drive refusé.", provider_unavailable: "Drive indisponible : relancez l’import.",
};
export function exportMessage(code: string): string { return MESSAGES[code] ?? "Import indisponible pour le moment : réessayez."; }
export const ITEM_STATUS_LABELS: Record<string, string> = { pending: "En analyse", ready: "Prête", duplicate: "Déjà dans la photothèque", invalid: "Fichier illisible", too_large: "Trop volumineuse", imported: "Importée", failed: "Échec" };
