# Médias WhatsApp → Drive et photothèque

## Parcours

Paramètres → Connexions → Photos WhatsApp → Configurer les photos (`/settings/whatsapp`).

1. Créer un dossier Drive dédié depuis cette page, ou utiliser un dossier déjà autorisé à l’application d’import.
2. Associer explicitement le numéro international de l’expéditeur au client et à ce dossier. Confirmer les droits d’utilisation des images et activer l’association. Pour modifier / mettre en pause, réenregistrer le même numéro avec les paramètres voulus.
3. Envoyer une photo ou une vidéo au **numéro de test API** configuré. Le webhook conserve les identifiants techniques, le numéro de l’expéditeur, la date et la **légende du média** (le « message associé », 3 000 caractères au plus). Les autres messages de la conversation, les noms de contacts, l’audio et les documents ne sont pas conservés.
4. Les images sont traitées après l’acquittement du webhook, par petits lots. La page affiche les 100 dernières réceptions, le nombre de tentatives, le code d’erreur et un lien vers le fichier importé. « Traiter la prochaine photo » traite une image manuellement.
5. Renseigner le même dossier dans la configuration Publications du projet concerné. L’agent Publications existant lit alors ces images via son connecteur de lecture, avec ses propres contrôles de droits / validation. Aucune publication automatique n’est ajoutée ici.

Un expéditeur inconnu / en pause / sans droits reste en attente. Les médias d’un numéro inconnu apparaissent dans « En attente d’affectation » : un administrateur choisit explicitement le client (parmi les couples client/dossier déjà associés avec droits confirmés) ou écarte le média. Rien n’est jamais attribué automatiquement à un client. Un changement d’association ne déplace pas les images déjà attribuées : les imports non terminés sur l’ancien périmètre restent bloqués jusqu’au rétablissement de l’association. Les originaux WhatsApp / Drive ne sont jamais supprimés.

## Photothèque (fiche client → onglet « Photothèque »)

Après import vérifié dans Drive, chaque fichier apparaît dans la photothèque du client : miniature privée (WebP 480 px dans le bucket privé `whatsapp-thumbnails`, URL signée 5 minutes), prévisualisation de l’original relu depuis Drive par le serveur (`/api/media-library/<client>/<média>`, administrateur uniquement, sans cache), date de réception, message WhatsApp, numéro masqué, liens vers le fichier et le dossier Drive, statut et historique d’utilisation.

Statuts : reçu → à examiner → validé → utilisé → archivé. « Utilisé » est posé automatiquement lorsqu’un média est transmis à une publication ; un média déjà utilisé n’est réemployé qu’après confirmation explicite.

« Préparer une publication » (photos validées, 4 au maximum, même client) crée un **brouillon** dans le circuit Publications existant : `saveDraft`, dérivés par plateforme (`adaptImage`) dans le stockage privé `publication-images` via `publication_register_image`, puis une révision qui attache ces médias. Le texte est celui saisi, sinon une suggestion IA si demandée (fournisseur existant `selectAIProvider`, uniquement la fiche client et les messages du client, consigne de ne rien inventer), sinon un texte « [À rédiger] ». La publication doit ensuite être relue, soumise et approuvée : aucune diffusion automatique. Les vidéos restent consultables mais ne sont pas encore transmises aux publications (le circuit Publications n’accepte que des images).

Notifications : catégorie « Nouveaux médias WhatsApp » (au plus une par client et par heure, lien vers la photothèque) et une pour les médias en attente d’affectation. Le push reste désactivé tant que l’utilisateur ne l’active pas pour cette catégorie.

Données personnelles : « Effacer les données de ce numéro » supprime l’association, écarte les médias non importés et efface numéro et messages (file et photothèque). La purge automatique des messages et numéros des imports terminés (et des médias archivés) s’active avec `WHATSAPP_RETENTION_DAYS` (30 à 3650). Les fichiers Drive ne sont jamais supprimés automatiquement.

## Configuration serveur

Les migrations `20261016000001_whatsapp_drive_ingestion.sql` puis `20261024000000_whatsapp_media_library.sql` doivent être appliquées, dans cet ordre, **avant** le déploiement du code de la photothèque (le webhook écrit la colonne `caption` ; sans la seconde migration il répond 503 et Meta relivre). Créée avec la CLI, son horodatage a été placé après la migration Google Ads existante pour préserver l’ordre de déploiement. Elle ajoute trois tables et des fonctions avec RLS, accessibles uniquement à `service_role`. Aucune migration distante n’est appliquée par ce lot.

Variables Vercel **serveur uniquement** (jamais `NEXT_PUBLIC_`, jamais à coller dans une conversation) :

| Variable | Valeur attendue |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Secret de l’application Meta CODE-V MEDIA, utilisé pour vérifier la signature des POST |
| `WHATSAPP_VERIFY_TOKEN` | Valeur aléatoire choisie pour la vérification GET du webhook |
| `WHATSAPP_ACCESS_TOKEN` | Token Meta autorisé à lire les médias du compte configuré ; temporaire pour le premier essai |
| `WHATSAPP_PHONE_NUMBER_ID` | ID du numéro API, `1350162804850979` pour le test actuel |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | WABA API, `1688571106203195` pour le test actuel |
| `WHATSAPP_INGESTION_ENABLED` | `true` pour activer la réception et les imports ; désactivé par défaut |
| `GOOGLE_DRIVE_IMPORT_CLIENT_ID` | Client OAuth Google de l’application d’import |
| `GOOGLE_DRIVE_IMPORT_CLIENT_SECRET` | Secret OAuth correspondant |
| `GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN` | Refresh token autorisé avec `https://www.googleapis.com/auth/drive.file` |
| `CRON_SECRET` | Secret serveur du planificateur existant (`/api/internal/scheduler/tick`), qui vide aussi la file WhatsApp |
| `WHATSAPP_RETENTION_DAYS` | Facultatif : durée de conservation des messages et numéros (30 à 3650 jours) ; absent = pas de purge automatique |

L’accès Drive d’import est **distinct** des variables `GOOGLE_DRIVE_*` du lecteur Publications. Un refresh token `drive.readonly` ne permet pas l’import. Autoriser `drive.file` avec les credentials OAuth propres à l’import (par exemple via OAuth Playground avec « Use your own OAuth credentials », accès offline). Ne pas demander l’accès à tout Drive. Avec `drive.file`, coller l’ID d’un dossier arbitraire ne lui donne pas accès : créer le dossier depuis l’écran ou autoriser explicitement un dossier existant via Google Picker avec cette même application. Le sélecteur Picker n’est pas implémenté dans ce lot.

L’utilisateur Google du lecteur Publications doit également avoir accès au dossier créé. Photos JPEG/PNG/WebP, 8 Mo et 40 millions de pixels maximum ; vidéos MP4/3GPP jusqu’à 16 Mo (limite Meta), conteneur vérifié (boîte `ftyp`) sans décodage. Documents, audio et stickers ne sont pas importés. Les dossiers sont créés privés : aucun partage public n’est ajouté par l’application.

## Meta : terminer le test

Après déploiement et configuration des secrets :

- URL de rappel : `https://os.code-v.fr/api/webhooks/whatsapp`.
- Token de vérification : **la même valeur que `WHATSAPP_VERIFY_TOKEN`** (ce n’est ni le token d’accès ni l’App Secret).
- Abonner le webhook au champ `messages`, et l’application au compte WhatsApp test. Sélectionner uniquement le compte test actuel.
- Ajouter / vérifier le numéro destinataire de test si Meta le demande. Envoyer depuis ce téléphone une photo au numéro API test. Vérifier sa réception dans la file et son fichier Drive.
- Réenvoyer exactement le même fichier : deux réceptions, un seul fichier Drive ; statut « Doublon exact ignoré » pour la seconde.

Ce test ne nécessite aucune migration / réinscription du numéro professionnel existant. La coexistence de l’application WhatsApp Business avec l’API n’est pas configurée ni vérifiée ici. Les échanges de l’application actuelle et l’historique ne sont pas aspirés par cette intégration. Une importation historique manuelle reste une phase distincte.

## Reprises et volume

Le webhook répond 200 seulement après l’écriture durable du lot. Une signature incorrecte est refusée. Une indisponibilité du stockage donne 503 pour permettre une nouvelle livraison Meta. Les replays du même identifiant de message sont ignorés.

Le planificateur existant (`/api/internal/scheduler/tick`) traite aussi la file : au plus 20 médias et 60 secondes par passage, puis la purge de conservation si elle est activée. Meta ne conserve les médias reçus par webhook que **7 jours** : un média non affecté ou en échec au-delà ne peut plus être téléchargé.

Un traitement différé opportuniste est lancé après réception : au plus 10 médias par invocation, avec une fenêtre de démarrage de 10 secondes. Il ne garantit pas de vider un lot de centaines d’images. Installer un déclencheur régulier pour vider la file et effectuer les reprises, ou utiliser le bouton manuel :

`GET` ou `POST /api/internal/whatsapp/process` avec `Authorization: Bearer <CRON_SECRET>`.

Ce déclencheur applique les mêmes bornes. Aucun nouveau cron / fichier `vercel.json` n’est ajouté. Adapter la fréquence à l’hébergement ; un passage quotidien est peu adapté à des centaines de photos. Ne pas considérer le traitement différé comme un worker permanent. Les médias doivent être traités rapidement tant qu’ils restent disponibles chez Meta ; aucune sauvegarde des images non associées n’est réalisée.

Une tâche possède un bail de 5 minutes, récupérable après expiration. Les erreurs attendent une reprise exponentielle ; après 5 tentatives, l’import passe en échec et peut être relancé explicitement. Un ID Drive est réservé avant upload ; une reprise contrôle le parent et le checksum MD5 du fichier avant de le réutiliser. Le SHA-256 local assure le dédoublonnage exact dans le périmètre **client + dossier**, uniquement pour les imports réalisés par ce connecteur. Les fichiers déjà présents avant l’installation ne sont pas indexés et ne sont donc pas dédoublonnés par ce lot. Deux clients peuvent conserver la même photo sans collision de périmètre.

Les ressemblances visuelles, les variantes recompressées et la suppression de doublons historiques ne sont pas traitées. Une phase de revue des photos similaires sera nécessaire. Aucun effacement automatique n’est effectué.

## Validation

Tests transport avec réponses simulées : signature, limites de lecture, isolation WABA/numéro, réponse retryable, host allowlist des médias / sessions Drive, validation du format et checksum, réconciliation d’un upload interrompu. SQL : replay, portée figée, droits, isolation des dossiers, récupération du bail, plafond de reprises, dédoublonnage par client et RLS.

Photothèque : vidéo et légende, types ignorés, intégrité vidéo, limite photo, miniature, relecture Drive (parent + MD5), sélection (même client, validé, réemploi), consigne IA, brouillon « À rédiger », préparation de publication (dérivés, révision, historique, nettoyage en cas d’échec), notifications, authentification des actions et de la prévisualisation, conservation (`tests/whatsapp-library.test.mjs`). SQL : affectation explicite, refus inter-clients, notification horaire, effacement d’un numéro, purge trop courte refusée, historique d’utilisation inter-client refusé, RLS (`supabase/tests/whatsapp-media-library.sql`).

Le SQL peut être exécuté sur une base PostgreSQL **locale jetable uniquement** via `CODEV_CORE_TEST_DATABASE_URL` et `node --test tests/whatsapp-db.test.mjs`. Le contrôle réalisé dans cette session utilise PostgreSQL WASM (PGlite), sur une seule connexion ; il ne prouve pas la concurrence multiworkers. Aucun appel réel à Meta ou Google Drive ni essai de production n’a été fait.

Références :
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
- https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
