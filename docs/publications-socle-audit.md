# Socle Publications multiclient — audit (12 octobre 2026)

Audit réel du code de `master` (f53edfd) + PR #35, avant les lots du socle Publications intelligent.
Légende : **Existant** fonctionnel · **Partiel** présent avec manques · **Absent**.

État Supabase de production vérifié en lecture seule : 38 migrations enregistrées, dont `whatsapp_media_library`,
`publications_unscheduled_drafts` et `publications_schedule_drafts` (contenu identique aux fichiers du dépôt).
SEO V2 (#28) n'est pas appliquée. Arrêt général actif, `publishing_enabled=false`, 0 compte de publication.

## Lot 1 — Configuration sociale dans la fiche client

| Besoin | État | Où |
| --- | --- | --- |
| OAuth Meta (Pages + Instagram) et GBP, coffre chiffré, états à usage unique | Existant | `lib/publications/oauth/service.ts`, `connections/*`, callbacks `/api/publications/oauth/*` |
| Connexions par client, exclusivité d'un compte entre clients | Existant | `client_connections`, migration `20261014000000` |
| Vérifier / reconnecter / déconnecter | Existant | `ConnectionsPanel` (onglet Configuration du projet) |
| Choix du compte par canal, activation par canal, créneaux jour/heure | Existant | `ChannelConfiguration` (projet) |
| Fuseau horaire modifiable | Partiel | colonne et RPC prêtes, pas d'éditeur |
| Règles éditoriales par canal | Partiel | colonne et RPC prêtes, pas d'éditeur |
| Onglet dans la fiche client | Absent | tout est sous `/projects/[id]/configuration` et `/agent` |
| Création idempotente du projet Publications | Absent | `createProject` est un insert simple |
| Réglages client (publication autorisée, préparation auto, brief) | Partiel | `publication_client_settings` lue mais jamais écrite |
| Validation humaine obligatoire | Existant (non configurable) | transitions + `delivery_readiness` |

## Lot 2 — Photothèque intelligente

| Besoin | État | Où |
| --- | --- | --- |
| Ingestion WhatsApp → Drive, dédoublonnage SHA-256, isolation client | Existant | `lib/whatsapp/*`, migrations `20261016000001`, `20261023000000` |
| Profil média par client (activité, prestations, photos acceptées / exclues, sujets) | Partiel | `clients.activity`, `verified_services`, `editorial_rules` ; rien de structuré |
| Classement IA pertinent / à examiner / hors sujet | Partiel | v1 : scène fixe + `usable` (Drive uniquement) ; WhatsApp jamais analysé |
| Pertinence métier et aptitude à publier séparées | Absent | |
| Détection d'éléments sensibles | Absent | une consigne « usable=false si document ou visage » |
| Quarantaine privée, rétention, reclassement, politique de suppression | Partiel | statuts manuels, purge des données personnelles ; aucune quarantaine |
| Exclusion des documents confidentiels des prompts | Partiel | |

## Lot 3 — Import d'historique WhatsApp

| Besoin | État |
| --- | --- |
| Import d'export `.zip` / `.txt`, analyse, association légende ↔ photo, date d'origine | Absent |
| Prévisualisation, doublons, import Drive, lots, purge des archives | Absent (briques réutilisables : `uploadDrive`, SHA-256, miniatures, garde-fous de dossier) |

## Lots 4 et 5 — Sélection sujet + photo, rédaction multicanale

| Besoin | État | Où |
| --- | --- | --- |
| Sujet et photo choisis ensemble | Partiel | Agent v2 : un appel choisit idée + média, mais sans les 3 dernières publications (textes, médias) |
| Réservoir de photos | Partiel | v2 ne voit que `publication_drive_media` analysées par v1 ; photos WhatsApp absentes |
| Variantes FB / IG / GBP distinctes | Existant | `agent-v2/prompt.ts`, `selection.ts` |
| Aucune invention, anti-injection | Existant | `FORBIDDEN_INVENTIONS`, `unsupportedClaims`, schémas fermés |
| Réemploi de média configurable | Absent | média utilisé toujours exclu |
| Notification « Photo manquante » | Absent | état `needs_media` affiché seulement |
| Budget IA | Existant | réserve 0,10 € par exécution, plafond mensuel par agent |

## Lot 6 — Préparation, calendrier, approbation

| Besoin | État | Où |
| --- | --- | --- |
| Créneaux par canal → occurrences | Existant (manuel) | `ensureProjectOccurrences` |
| Préparation automatique à l'avance | Absent | agent v2 sur clic uniquement, `requireAdmin` |
| Passage « À valider » + notification | Partiel | brouillons agent non soumis ; aucune notification Publications |
| Modification après approbation ⇒ nouvelle validation | Existant | `publication_save_draft`, `delivery_readiness` |
| Diffusion idempotente à l'heure prévue | Partiel | moteur complet, mais lancé par le bouton « Envoyer les publications dues » ; absent du tick |
| Historique d'erreurs, reprise manuelle, confirmation plateforme | Existant | `publication_attempts`, retry / reconcile |

## Lot 7 — Supervision

| Besoin | État |
| --- | --- |
| Tableau des publications, file de validation, tiroir d'édition | Existant |
| Comptes à reconnecter, erreurs, photothèques pauvres, prochaines tâches agent, suspension par client | Absent |

## Simulation du pipeline (PR #44)

Une simulation administrateur rejoue tout le pipeline sur des clients fictifs (Paramètres → Simulation UX), sans base ni API de publication : voir [publications-simulation.md](publications-simulation.md).
