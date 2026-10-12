# Import d'un export WhatsApp (socle Publications, lot 3)

Depuis la fiche client, onglet **Médias**, un administrateur dépose l'archive `.zip` produite par « Exporter la discussion » (avec médias)
de WhatsApp. Les photos retenues rejoignent la photothèque du client (`whatsapp_assets`, origine `whatsapp_export`) avec leur date
d'origine et la légende du message, puis passent dans le parcours habituel (analyse IA, validation, agent Publications).

Dépend du lot 2 (#37, migration `20261028000000_media_library_intelligence.sql`) et s’empile sur #36 à #40 : **fusionner #36 à #40 avant cette PR**.

## Parcours

1. **Dépôt** : le navigateur envoie l'archive directement dans le bucket privé `whatsapp-exports` via une URL d'envoi signée
   (`<client>/<import>.zip`). Elle ne transite pas par une fonction Vercel. Confirmation des droits obligatoire.
2. **Analyse** : le serveur lit le ZIP par plages HTTP (répertoire central, puis chaque entrée), sans jamais charger l'archive entière.
   Le fichier de discussion est décompressé en mémoire (20 Mo max), seules les lignes de pièces jointes images sont extraites
   (nom de fichier, date, légende). Formats Android et iOS, français et anglais ; à défaut, date tirée du nom du fichier.
3. **Préparation par lots** (15 photos par appel) : contrôle d'intégrité (CRC, taille), type réel, dimensions, empreintes SHA-256/MD5,
   aperçu WebP réduit stocké dans le même bucket privé. Doublons détectés contre la photothèque du client et dans l'archive.
4. **Aperçu** : grille paginée avec statut de chaque photo, filtres (période, avec légende), sélection/désélection avant import.
5. **Import par lots** (8 photos par appel) vers le dossier Drive du client (expéditeur WhatsApp actif avec droits confirmés),
   puis référencement dans la photothèque.
6. **Fin, annulation ou expiration (24 h)** : archive et aperçus supprimés, légendes effacées des lignes d'import, audit.
   La tâche planifiée (`/api/internal/scheduler/tick`, étape `whatsappExports`) purge les imports expirés.

Le traitement est repris là où il s'est arrêté (bouton « Reprendre l'import ») : chaque lot est idempotent.

## Exports incomplets

Un export sans fichier de discussion, avec des pièces jointes « omises » ou des fichiers annoncés mais absents est marqué
**incomplet** : les photos présentes restent importables, avec la date du nom de fichier quand le message manque.

## Sécurité

- La conversation n'est jamais stockée : seules la date et la légende de chaque photo retenue sont conservées.
- Le texte des messages n'est jamais interprété comme une instruction et ne déclenche aucune action (ni publication, ni réglage).
- Archives refusées : chiffrées, zip64, multi-volumes, plus de 20 000 entrées, plus de 5 000 photos, méthode autre que
  stockée/deflate. Décompression bornée (protection « zip bomb »), CRC vérifié.
- Lecture par plages via URL signée courte, limitée à l'hôte Supabase du projet (`NEXT_PUBLIC_SUPABASE_URL`).
- Tables `whatsapp_export_imports` / `whatsapp_export_items` : RLS active sans politique, accès serveur uniquement.
- Aucune publication n'est déclenchée par l'import.

## Configuration

Aucune nouvelle variable d'environnement. L'envoi vers Drive réutilise l'accès d'import existant `GOOGLE_DRIVE_IMPORT_*`
(portée `drive.file`, voir `docs/whatsapp-drive.md`) ; il ne touche pas à l'accès Publications en lecture
(`GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`).

Taille maximale d'archive : 500 Mo (limite du bucket et contrôle serveur). Le plan Supabase doit autoriser des fichiers de
cette taille (Storage → Settings → « Upload file size limit ») ; sinon l'envoi est refusé par le stockage.

## Déploiement

1. Fusionner #36 à #40, puis cette PR.
2. Appliquer la migration `20261101000000_whatsapp_export_import.sql` (crée le bucket privé et les deux tables), après
   vérification qu'elle n'est pas déjà présente en production.
3. Vérifier la limite de taille de fichier du stockage Supabase.

## Tests

- `node --test tests/whatsapp-export-import.test.mjs` : parseur (Android/iOS, FR/EN, heure d'été), lecteur ZIP par plages
  et refus de sécurité, service complet (analyse, doublons, aperçu, import, purge, annulation, expiration, câblage sans injection HTML).
- `supabase/tests/publications-socle-5-whatsapp-export.sql` (via `tests/publications-socle-db.test.mjs`, PostgreSQL local).
