# Photothèque : arrivées des photos, recherche et décisions humaines (PR #43)

Suite de la photothèque intelligente (`docs/media-library-intelligence.md`) et de l'import d'export WhatsApp
(`docs/whatsapp-export-import.md`). Migration `20261103000000_media_library_tools.sql` (kit : `docs/migration-pr43/`).

## 1. Les quatre arrivées de photos (audit)

Règle commune : **une photo autorisée entre une seule fois dans la photothèque du bon client**. Le dédoublonnage se fait
par fichier Drive puis par empreinte SHA-256 **à l'échelle du client** (tous dossiers et toutes origines, photos purgées
comprises). Deux clients différents gardent chacun leur copie. Aucune photo n'est jamais supprimée.

| Arrivée | Autorisation | Dédoublonnage | Constat et correction |
| --- | --- | --- | --- |
| Webhook WhatsApp Business | Expéditeur associé actif avec droits confirmés, ou affectation explicite d'un administrateur | `knownAsset` (`lib/whatsapp/service.ts`) | **Corrigé** : seule l'unicité client + dossier + empreinte existait. Une photo déjà connue par un autre dossier (dossier Drive de l'agent) devenait une seconde entrée ; une photo purgée du même dossier bouclait en échec Drive. Elle est désormais marquée « doublon » (file reliée à la photo existante), sans renvoi dans Drive. |
| Numéro inconnu | Jamais attribué automatiquement | — | Conforme (reste « en attente d'affectation », notification) ; testé de bout en bout. |
| Export WhatsApp (#41) | Association WhatsApp active avec droits, confirmation à l'envoi | Empreinte, client entier | Conforme, inchangé ; testé dans un scénario inter-origines. |
| Photos déjà présentes dans le dossier Drive | Dossier de l'agent avec droits confirmés, et désormais dossiers des associations WhatsApp actives avec droits | Fichier Drive, puis empreinte client | **Corrigé** : (a) une copie d'une photo connue créait une seconde entrée si elle venait d'un autre dossier ; (b) un doublon ou un fichier illisible était retéléchargé à chaque passage ; (c) le lecteur ne voit que les 100 photos les plus récentes : les plus anciennes d'un grand dossier n'entraient jamais. Mémoire `client_media_drive_files` (doublon, échec retenté après 24 h, 3 fois au plus) et parcours de reprise par curseur (`lib/media-intelligence/drive-listing.ts`, `client_media_drive_sync`). |
| Photos ajoutées plus tard dans Drive | Idem | Idem | **Corrigé** : la synchro planifiée ne tournait que pour les clients ayant activé l'analyse IA. `runDriveSyncTick` synchronise désormais tous les clients autorisés, à tour de rôle (5 clients, 5 photos par client et par passage), indépendamment de l'analyse. |

Accès Drive : la synchro lit toujours avec l'accès **Publications en lecture seule** (`GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`),
jamais avec l'accès d'import (`GOOGLE_DRIVE_IMPORT_*`). Elle n'écrit ni ne supprime rien dans Drive.

Limites connues (choix prudents, documentés) : deux fichiers d'un même dossier ayant exactement la même date de
modification à la frontière d'une page de reprise peuvent attendre le cycle suivant ; une course entre un import
WhatsApp et un import d'export de la même photo vers deux dossiers différents reste théoriquement possible (une ligne
non encore importée n'est pas un doublon, pour permettre la reprise d'un envoi interrompu).

## 2. Photothèque (fiche client → Photothèque)

- **Recherche côté serveur** (RPC `whatsapp_library_search`), 24 photos par page : vues de statut (en cours, à examiner,
  publiables — règle serveur de l'agent —, validées, déjà utilisées, quarantaine, rejetées, archivées, toutes), origine
  (WhatsApp, export, Drive), service ou sujet (thèmes et description de l'évaluation, légende ; accents et casse
  ignorés ; suggestions = prestations du profil média puis thèmes fréquents), recherche libre (y compris le sujet des
  publications ayant utilisé la photo), période sur la **date d'origine** (prise de vue, sinon réception, sinon import ;
  jours de Paris), « déjà utilisée » oui/non. Les anciens liens `?status=…` restent valides.
- Sur chaque photo : origine et date d'origine, thèmes, auteur et date du dernier statut, **historique d'utilisation**
  (publication, plateforme, date, état de la diffusion), état du réemploi selon le réglage du client, légende et
  **édition de la légende** (administrateur ; texte nettoyé, 3 000 caractères, toujours traité comme une donnée).
- **Réemploi explicite** : la case « Je confirme le réemploi » n'apparaît que si le client autorise le réemploi
  (réglages Publications) ; le délai minimal du client est vérifié côté serveur (`preparePublication`). Choix prudent :
  réglage illisible = réemploi refusé, comme pour l'agent.
- Mise en page mobile : une colonne sous 420 px, filtres empilés, barre d'actions non collante sur mobile, cibles de
  44 px ; jetons de couleur du design system uniquement.
- Avant la migration, la photothèque revient automatiquement à la liste historique (filtre de statut seulement).

## 3. « Pourquoi écartée ? » et reclassement manuel

Le panneau de chaque photo (`lib/media-intelligence/exclusion.ts`) explique pourquoi l'agent ne la propose pas :
quarantaine (posée par l'analyse ou par un administrateur), rejet, archivage, élément confidentiel (avec sa nature),
verdict humain « hors sujet », verdict de l'analyse et scores, visage ou mineur, qualité (flou, capture d'écran, image
surtout textuelle), format ou dimensions, réservation par l'agent, réemploi désactivé ou trop récent ; plus les échecs
d'analyse et les remarques de qualité. L'éligibilité affichée est calculée avec **les mêmes fonctions** que la
sélection de l'agent (`isPublicationCandidate`, `fitsPlatforms`, `reusable`) ; la base reste l'autorité.

Il affiche aussi les **décisions humaines** (table `whatsapp_asset_decisions` : statut, reclassement et motif, légende,
auteur, date) et le verdict humain de l'évaluation.

**Reclassement** (administrateur, motif obligatoire de 3 à 500 caractères) : RPC `whatsapp_asset_reclassify`, qui
réutilise `whatsapp_assets_review` (verdict manuel, annulation des diffusions non envoyées en cas de quarantaine ou de
rejet, audit existant), trace le motif, et écrit l'audit `whatsapp.library.reclassified` (sans le texte du motif).
Confirmer un statut posé par l'analyse (par exemple une quarantaine) est possible et tracé.

**Une correction humaine persiste** : l'analyse automatique ne modifie jamais un statut posé par une personne
(contrôle SQL existant) et, désormais, la sélection automatique ne réévalue plus du tout une photo dont le statut a été
posé par une personne ; seul un administrateur peut relancer l'analyse explicitement. Seule exception conservée (règle
de sûreté existante) : une nouvelle détection **confidentielle** demandée explicitement suspend le verdict humain
« pertinente » ; l'historique des décisions le conserve.

## 4. Garantie : jamais proposée à l'agent

Une photo en quarantaine, rejetée ou confidentielle n'est jamais proposée à l'agent. La suite
`supabase/tests/publications-socle-6-media-library-tools.sql` l'affirme contre la garde serveur de la PR #38
(`publications_private.library_asset_publishable` et `publication_agent_v2_finish`, appelées sans modification), y
compris juste après un reclassement manuel, et vérifie qu'une photo validée passe le même contrôle (témoin).

## 5. Historique d'utilisation : modèle de lecture partagé

- SQL : `public.whatsapp_asset_usage_history(p_client_id uuid, p_asset_ids uuid[])` → `asset_id, publication_id,
  platform, used_at, used_by, subject, publication_status, archived, delivery_status, scheduled_for, published_at`
  (200 photos au plus, toujours limité au client, `service_role` uniquement).
- TypeScript : `listAssetUsageHistory(db, clientId, assetIds)` dans `lib/whatsapp/usage-history.ts` →
  `Map<assetId, AssetUsage[]>` (plus récentes d'abord ; liste vide si jamais utilisée). Le client Supabase est injecté ;
  avant la migration, repli sur les tables existantes (sans l'état de diffusion). `reuseState(uses, settings, now)`
  donne l'état du réemploi avec la même règle que l'agent.

## Contrats pour les autres lots

- Nouvelles colonnes `whatsapp_assets.caption_edited_by/at` ; nouvelles tables `whatsapp_asset_decisions`,
  `client_media_drive_files`, `client_media_drive_sync`.
- RPC : `whatsapp_asset_reclassify`, `whatsapp_asset_caption_save`, `whatsapp_library_search`,
  `whatsapp_asset_usage_history`.
- `syncDriveLibrary` renvoie `{ added, skipped, folders, duplicates, failed }` ; `runDriveSyncTick` est appelé par
  `runMediaIntelligenceTick` (aucun changement de `app/api/internal/scheduler/tick/route.ts`).
- `LibraryItem.uses` est remplacé par `LibraryItem.history` (`AssetUsage[]`) et `LibraryItem.decisions`.

## Tests

- `node --test tests/media-library-tools.test.mjs` : les quatre arrivées, numéro inconnu, doublons inter-origines,
  photo purgée, deux clients, reprise des grands dossiers, mémoire des doublons et échecs, analyse automatique sans
  réévaluation humaine, filtres, « Pourquoi écartée ? » (accord avec la sélection de l'agent), historique, recherche,
  reclassement, légende, actions (administrateur, simulation), câblage (jetons de couleur, migration additive).
- `PUBLICATIONS_SOCLE_TEST_DATABASE_URL=… node --test tests/publications-socle-db.test.mjs` : 110 vérifications SQL.
