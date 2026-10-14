# Intelligence éditoriale de l'Agent Publications v2 (PR #42)

## Objectif

Des publications professionnelles, variées et exploitables pour les clients artisans : pas seulement du texte généré,
mais un **choix éditorial** (quel sujet, quelle prestation, quelle photo, quelle accroche) fondé sur l'historique du
client et contrôlé de façon déterministe avant toute écriture.

L'Agent v2 reste **le seul moteur**. Cette PR enrichit son contexte et ses contrôles ; elle ne crée ni second moteur,
ni appel IA supplémentaire (une seule génération par préparation, contexte compact et plafonné). Le planificateur,
l'action manuelle et la reprise média passent toujours par `prepareNextPublicationsAs` / `retryAgentV2MediaAs`.
L'approbation humaine reste obligatoire pour chaque publication ; la diffusion reste derrière
`PUBLICATIONS_SCHEDULED_DELIVERY=enabled` (inchangé, désactivé par défaut).

## Ce qui change

### 1. Historique éditorial du client

`lib/publications/editorial-memory.ts` (pur) construit, à partir des données existantes (publications, variantes de la
révision courante, `whatsapp_asset_uses`, `publication_media_uses`), jusqu'à **30 idées** du client, tous projets
confondus : sujet, date, plateformes, prestations mises en avant (parmi les prestations vérifiées), styles d'accroche
et d'appel à l'action, accroches, CTA, textes (bornés à 600 caractères) et photos utilisées. Mêmes règles que les
lots 4-5 : une publication refusée ou un brouillon archivé ne compte pas.

- Contexte de l'agent : construit à partir des **mêmes lectures** (chaque table lue une fois).
- Lecture serveur (read model) : `lib/publications/editorial-history.ts`
  - `loadClientEditorialHistory(clientId, limit = 30)` (sans session, appelant vérifié) ;
  - `getClientEditorialHistory(clientId, limit = 30)` (session administrateur).
  - Retour : `{clientId, services, entries: [{subject, date, platforms, services, introStyle, ctaStyle, photos: [{source, id, description}], publicationIds}]}`.

### 2. Plan éditorial déterministe

`lib/publications/editorial-plan.ts` calcule avant l'appel au modèle :

- **Rotation des prestations** : prestations écartées avec leur motif (« mise en avant par la dernière publication
  (date) », « mise en avant 2 fois dans les 4 dernières publications ») ; prestations à privilégier = non mises en
  avant récemment **et** illustrées par une photo publiable disponible (la moins récente d'abord) ; prestations sans
  photo utilisable.
- **Saisonnalité** (voir ci-dessous).
- **Accroches et CTA** : style suggéré par rotation dans un pool (`question`, `conseil`, `presentation`,
  `exclamation`, `constat` ; CTA `contact`, `message`, `conseil`, `question`, `appel`), le moins récemment utilisé
  d'abord ; accroches et CTA déjà employés ; formulations récurrentes (suites de 4 mots présentes dans au moins deux
  idées passées, 10 au plus).
- **Lieux autorisés** : la zone de la fiche client découpée en lieux.

Le modèle reçoit une version compacte (`editorial_history` : 10 idées sans texte ni identifiant de photo ;
`editorial_plan` ; `allowed_places`), moins de 6 000 caractères même avec un historique plein (testé).

### 3. Gardes déterministes (`lib/publications/editorial-guards.ts`)

Appliquées dans `validateGeneratorOutput`, après les contrôles existants (inchangés) et avant toute écriture. Chaque
refus porte un motif et un détail affichés à l'admin (« Motif : … ») et enregistrés dans la justification du run.

| Motif | Règle |
| --- | --- |
| `place_not_allowed` | un lieu nommé (préposition de lieu + nom propre, ou région / grande ville connue) absent des faits du client |
| `repetition` | sujet identique ou très proche (similarité ≥ 0,6) d'une idée de l'historique, ou formulation proche (≥ 0,5) d'un texte passé ; rotation des prestations |
| `intro_repetition` | accroche (6 premiers mots) déjà employée dans l'historique, ou même style d'accroche que les 3 dernières idées sur toutes les plateformes |
| `cta_repetition` | CTA déjà employé (10 dernières idées), ou même style de CTA que les 2 dernières idées |
| `phrase_repetition` | formulation récurrente signalée au modèle |
| `photo_mismatch` | la photo illustre une autre prestation que celle du sujet |
| `document_photo` | la photo est un document (facture, devis, attestation, certificat, capture d'écran…) |

- **Rotation** (`repeatsService`) : désormais, quand les **deux** dernières idées portent sur la même prestation et
  qu'une autre prestation vérifiée est illustrée par une photo disponible, une 3e idée sur la même prestation est
  refusée (avant : les 2 à 3 dernières devaient toutes porter sur elle). Exemple couvreur : jamais 3 démoussages de
  suite si une photo permet la zinguerie, le faîtage ou la rénovation.
- **Affirmations** : nouveau motif `worksite` dans les affirmations interdites sauf fait confirmé : « nous sommes
  intervenus », « nous avons réalisé / réparé / posé… », « chantier terminé », « hier », « récemment », « chez un
  client »… Les gardes existantes (prix, garantie, délai, prestation non vérifiée, `factsOf` sans descriptions de
  photos) sont inchangées.
- **Vocabulaire associé** (`SERVICE_SYNONYMS`, liste fermée) : rapproche une photo et un sujet (gouttière → zinguerie,
  guêpe → désinsectisation, rat → dératisation…). Il sert au choix, jamais à affirmer une prestation.

### 4. Mémoire visuelle (`lib/publications/editorial-photos.ts`)

- Une photo utilisée n'est jamais reproposée, sauf réemploi autorisé par le client (règle existante).
- **Doublons exacts** (même SHA-256, par exemple une photo reçue par WhatsApp puis réimportée par l'export) : les
  usages de l'une valent pour l'autre, et une seule copie est proposée. Une photo de la photothèque dont l'empreinte
  est celle d'une photo publiée via le catalogue Drive n'est jamais reproposée (règle « jamais réutilisée » du
  catalogue), et inversement. Il n'existe pas d'empreinte perceptuelle en base : seuls les doublons exacts sont
  détectés (choix documenté, pas de calcul d'image supplémentaire).
- **Documents** : une photo de document ou administrative n'est jamais candidate, **même validée par un humain**
  (éléments sensibles facture / document / écran / adresse, défaut capture d'écran ou image textuelle, ou description /
  thèmes de type facture, devis, attestation, certificat, contrat, rapport, flyer…). Exemple Protection Nuisibles :
  l'attestation de traitement n'est jamais présentée comme une intervention.
- Chaque candidate porte les prestations qu'elle illustre (`services`, d'après sa description non fiable) : le modèle
  choisit la photo d'après le sujet, le serveur le vérifie (`photo_mismatch`).

### 5. Saisonnalité : choix prudent

Aucune donnée saisonnière explicite n'existe dans la fiche client, le profil média ni les réglages Publications
(vérifié). Une table statique mois → prestations (`SEASONAL_SERVICE_HINTS`) sert donc **uniquement de préférence
douce** : elle départage des prestations déjà permises et illustrées, ne s'applique qu'aux prestations vérifiées du
client (rien pour une agence web), et le prompt interdit d'affirmer une saison, une météo ou une urgence absente des
consignes. Si un champ saisonnier explicite est ajouté plus tard au profil, il devra primer sur cette table.

### 6. Justification éditoriale

`lib/publications/editorial-justification.ts` construit, sans IA, la justification de chaque préparation : sujet et
raisons (prestation privilégiée, préférence saisonnière douce, sujet prioritaire), photo et raison, historique
considéré (10 idées), prestations écartées et pourquoi, prestations sans photo, styles employés, contrôles passés — ou
le motif du refus. Elle est enregistrée avec le run **avant** `finish` (ou avant `fail`) par
`publication_editorial_justification_record` ; une erreur d'enregistrement ne bloque jamais la préparation.

Le panneau de la publication affiche un bloc repliable « Justification éditoriale de l'agent », en lecture seule
(`components/publications/agent-v2-justification.tsx`), relu et borné côté serveur (`justificationView`), rendu en
texte. Jamais de légende WhatsApp, de nom de fichier, d'identifiant Drive ni de description de photo (non fiable).

### 7. Santé de la photothèque (read model pour la supervision, l'assistant et le diagnostic)

`lib/publications/editorial-health.ts` :

```ts
type ServicePhotoHealth = {service: string; usable: number};
type ClientPhotoHealth = {clientId: string; clientName: string; totalImages: number; usable: number; libraryUsable: number;
  catalogUsable: number; documents: number; services: ServicePhotoHealth[]; servicesLacking: string[]; lackingOverall: boolean; lacking: boolean};
type PhotoHealthOptions = {clientIds?: readonly string[]; now?: Date; thresholds?: {minUsable: number; minPerService: number}}; // défaut 3 / 1

loadEditorialPhotoHealth(options?): Promise<ClientPhotoHealth[]>   // sans session (appelant vérifié), échec fermé
listClientsLackingPhotos(options?): Promise<ClientPhotoHealth[]>   // seulement les clients en manque, les plus démunis d'abord
getEditorialPhotoHealth(options?): Promise<ClientPhotoHealth[]>    // session administrateur exigée
computeClientPhotoHealth(input): ClientPhotoHealth                 // calcul pur
```

Clients concernés : ceux dont un projet a l'Agent Publications activé (ou `clientIds`), 100 au plus. Mêmes règles que
le pool de l'agent (publiable, qualité, format, jamais un document, réemploi selon le réglage, doublons comptés une
fois), sans plafond ; photos du catalogue Drive utilisables comptées aussi.

## Migration

`supabase/migrations/20261102000000_publications_editorial_intelligence.sql` (**non appliquée**), kit et procédure dans
[`docs/migration-pr42/README.md`](migration-pr42/README.md) : colonne `publication_agent_v2_runs.editorial_justification`
(nullable), déclencheur d'immuabilité, RPC `publication_editorial_justification_record`, index GIN sur `publication_ids`.
Dépend de `whatsapp_export_import` (#41). Aucune nouvelle variable d'environnement.

## Tests

- `tests/publications-editorial-intelligence.test.mjs` : historique, styles, plan (rotation, saisonnalité, lieux),
  anti-répétition au-delà des 3 dernières idées, rotation, lieux, photos et documents (Protection Nuisibles), mémoire
  visuelle (SHA-256, catalogue), affirmations de chantier, prompt compact, justification et panneau, contexte réel,
  read models historique et santé.
- `tests/publications-editorial-intelligence-e2e.test.mjs` (phase 2) : CODE-V, JRenov, Couverture Catalane et
  Protection Nuisibles (fictifs) × Facebook / Instagram / GBP par le planificateur et l'Agent v2 réels (IA, Drive et
  réseaux simulés) : photos importées d'un export et classées → sélection → 3 textes distincts → règles du client →
  créneau → « À valider » → approbation humaine obligatoire → modification = nouvelle approbation → diffusion préparée
  seulement avec le drapeau (testé absent) → créneau manqué notifié ; refus d'un lieu inventé enregistré et projet en
  pause ; client sans photo utilisable → « Photo manquante » et read model de santé.
- `supabase/tests/publications-socle-6-editorial-intelligence.sql` (38 vérifications, chaîne complète des migrations).

## Limites

- Détection des lieux prudente (préposition de lieu + nom propre, liste courte de régions et grandes villes) : un lieu
  écrit sans préposition et hors liste n'est pas détecté ; un faux positif provoque un refus (jamais une invention).
- Les styles d'accroche et de CTA sont classés par règles simples ; « constat » regroupe tout le reste.
- Un refus consomme un appel IA ; le planificateur reste borné (2 préparations par passage, pause de 6 h après un échec).
