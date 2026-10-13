# Photothèque intelligente (socle Publications, lot 2)

## Ce que fait la fonctionnalité

- **Profil média par client** (onglet Photothèque de la fiche client) : activité, prestations confirmées, sujets prioritaires, types de photos acceptés et exclus, consignes de communication, analyse automatique activée ou non, budget IA mensuel, conservation des rejets et politique de suppression. Chaque enregistrement incrémente une version, et les photos évaluées avec une version antérieure sont réanalysées.
- **Classement IA** de chaque photo selon trois verdicts : `relevant` (pertinente), `to_review` (à examiner) ou `off_topic` (hors sujet).
  - Deux scores séparés : pertinence métier et publiabilité.
  - Détection des éléments sensibles : visage, mineur, document personnel, facture ou devis, adresse, plaque, écran, autre information privée.
  - Évaluation de la qualité.
  - Seule une réduction de 640 px part au modèle, en détail `low`. La légende WhatsApp est transmise comme donnée non fiable (`caption_from_sender_untrusted`), jamais comme consigne.
- **Règles de sûreté appliquées par le code**, quel que soit l'avis du modèle :
  - Un élément confidentiel force `confidential`, plafonne la publiabilité à 0,1 et interdit le verdict `relevant`.
  - Un visage, un mineur, une qualité médiocre ou des scores faibles ramènent le verdict à `to_review`.
  - L'IA ne valide jamais une photo et ne la supprime jamais. Elle ne peut que placer en **quarantaine** (privée) une photo confidentielle ou hors sujet, et seulement si aucun humain n'a déjà fixé son statut.
- **Décision humaine** : statuts Validé, Quarantaine, Rejeté, Archivé, etc.
  - Ils passent par la RPC `whatsapp_assets_review`, qui enregistre le verdict manuel et écrit l'audit.
  - Une photo signalée confidentielle ne peut alimenter un brouillon qu'après une nouvelle validation humaine.
  - Ses légendes ne sont jamais reprises dans un prompt de rédaction ni dans la source du brouillon.
- **Purge** : seules les photos **rejetées par un humain**, après la durée de conservation du client, et seulement si la politique est « Mettre à la corbeille Drive ».
  - Le fichier importé par l'application est mis à la corbeille Drive (récupérable).
  - La miniature est supprimée, la légende et l'expéditeur sont effacés.
  - Une photo déposée à la main dans le dossier Drive du client n'est jamais supprimée : seule sa référence est purgée.
- **Synchronisation du dossier Drive de l'agent** : référence dans la photothèque les photos ajoutées au dossier configuré dans l'agent Publications (droits confirmés). Les fichiers sont lus en lecture seule, avec l'origine `drive`, un dédoublonnage par fichier puis par SHA-256, et 15 photos par appel au maximum.
- **Planificateur** : `/api/internal/scheduler/tick` lance `runMediaIntelligenceTick` (5 clients et 8 photos par client au maximum) dans un `try/catch` indépendant. Il ne déclenche jamais de publication.

## Variables d'environnement et accès

| Variable | Usage |
| --- | --- |
| `OPENAI_API_KEY` | Classement IA (modèle `PUBLICATIONS_MODEL` de `lib/integrations/publications-openai.ts`). Sans clé, l'analyse répond « clé non configurée » et rien n'est classé. |
| `GOOGLE_DRIVE_IMPORT_*` (existant, scope `drive.file`) | Lecture des originaux importés depuis WhatsApp et mise à la corbeille lors de la purge. |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` (existant Publications, scope `drive.readonly`) | Lecture et synchronisation du dossier Drive de l'agent (photos d'origine `drive`). |

Les deux accès Drive ne sont jamais mélangés : chaque photo est relue par l'accès correspondant à son origine (`assetOriginal` dans `lib/whatsapp/library.ts`).

Coût : environ 0,001 à 0,002 € par photo. Le budget mensuel par client (2 € par défaut, 50 € au maximum) est vérifié avant chaque appel à partir du journal `client_media_ai_usage`, qui est en ajout seul.

## Migration

`supabase/migrations/20261028000000_media_library_intelligence.sql` (**non appliquée**) :

- crée les tables `client_media_profiles`, `whatsapp_asset_assessments` et `client_media_ai_usage` ;
- ajoute à `whatsapp_assets` les colonnes `origin`, `captured_at` et `purged_at`, et les statuts `quarantined` et `rejected` ;
- crée les RPC `client_media_profile_save`, `client_media_ai_month_spend`, `whatsapp_asset_assessment_record`, `whatsapp_assets_review`, `whatsapp_rejected_purge_candidates` et `whatsapp_asset_mark_purged`.

Toutes les tables ont la RLS activée sans politique. Seul `service_role` y accède, avec des droits explicites, et le journal des coûts est en ajout seul.

Avant la migration, la photothèque existante continue de fonctionner : la liste, les anciens statuts et la préparation de brouillon restent disponibles. Le profil et l'analyse affichent « appliquez la migration ».

## Corrections d'audit

- **Coût et échecs** : un échec après facturation (réponse illisible, évaluation refusée, enregistrement en erreur) journalise quand même le coût dans `client_media_ai_usage` via `whatsapp_asset_assessment_failed(asset, client, usage)` ; le fournisseur joint le coût à son erreur (`AI invalid output`, `AI usage limit`). Colonnes `whatsapp_assets.classification_failures` (0 par défaut) et `classification_failed_at` : la sélection automatique écarte une photo après 3 échecs ou pendant 6 h après un échec ; un succès remet le compteur à zéro ; le bouton « Analyser » sur une sélection peut toujours relancer.
- **Rotation** : `client_media_profiles.last_classified_at` (vide = prioritaire), mis à jour après le passage de chaque client, même en erreur ; le planificateur prend les clients les moins récemment traités.
- **Synchro Drive automatique** : le planificateur référence au plus 5 nouvelles photos par client (dossiers Drive confirmés de l'agent Publications, accès lecture seule Publications `GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`, le même que pour relire ces photos). Sans accès configuré, seule la synchro est sautée. La recherche des fichiers déjà connus est limitée au client.
- **Purge** : le média est d'abord marqué purgé par `whatsapp_asset_mark_purged(asset, client, p_drive_trash_planned)` (toujours rejeté par un humain, contrôlé en base) ; la corbeille Drive n'est tentée qu'ensuite, et son résultat est journalisé par `whatsapp_asset_purge_trash_logged(asset, client, 'trashed'|'missing'|'failed')`. Un média repêché entre-temps n'est ni marqué ni mis à la corbeille (compté « skipped »).
- **Décision humaine périmée** : une nouvelle évaluation confidentielle efface `manual_verdict`, `reviewed_by` et `reviewed_at`.
- **Captures d'écran** : `screenshot` ou `text_heavy` empêche tout verdict automatique « pertinent ».
- **Quarantaine ou rejet humain** : `whatsapp_assets_review` annule, par `publication_delivery_cancel`, les diffusions programmées, en reprise ou bloquées des publications qui utilisent ces médias (`whatsapp_asset_uses`), avec un événement `publication.delivery_cancelled_media_withdrawn` par diffusion et le total dans l'audit (`cancelled_deliveries`). Les diffusions publiées ou en cours ne sont pas touchées. La fonction retourne toujours le nombre de médias mis à jour.
- **Mobile** : la barre d'actions de la photothèque n'est collante qu'à partir de la largeur `sm`.

## Déploiement

1. Vérifier dans `supabase_migrations.schema_migrations` que `20261028000000` est absent.
2. Appliquer la migration (après accord).
3. Déployer.
4. Compléter le profil d'un client, puis lancer « Analyser les nouvelles photos » sur quelques photos.
5. Vérifier les verdicts, puis activer l'analyse automatique si besoin.

## Tests

- `node --test tests/media-intelligence.test.mjs` couvre les règles de sûreté, la donnée non fiable, la validation du profil, le budget, la purge, les actions et l'exclusion des médias confidentiels.
- `PUBLICATIONS_SOCLE_TEST_DATABASE_URL=… node --test tests/publications-socle-db.test.mjs` exécute `supabase/tests/publications-socle-2-media-intelligence.sql` : 95 vérifications sur une base locale reconstruite.

## Suite : outils de la photothèque (PR #43)

Recherche filtrée et paginée côté serveur, historique d'utilisation partagé, « Pourquoi écartée ? », reclassement
manuel tracé, édition de la légende, dédoublonnage inter-origines et synchronisation Drive indépendante de l'analyse IA :
voir `docs/media-library-tools.md`. La sélection automatique de l'analyse ne réévalue plus une photo dont le statut a
été posé par une personne.

## Limites

- Les vidéos ne sont pas classées.
- La détection repose sur le modèle. Les règles de code garantissent qu'aucune photo n'est validée, publiée ni supprimée sur la seule décision de l'IA, mais un élément sensible non détecté reste possible : la validation humaine reste obligatoire.
- La synchronisation Drive se limite aux images JPEG, PNG et WebP de 8 Mo au plus (les limites du lecteur Publications). Depuis la PR #43, les dossiers de plus de 100 photos sont parcourus par un curseur de reprise.
