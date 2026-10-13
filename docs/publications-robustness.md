# Robustesse et charge du pipeline Publications (phase 8, #47)

Essais de charge **déterministes** du pipeline planifié (préparation IA, validation humaine, diffusion, imports WhatsApp) et
correctifs des défauts trouvés. Aucun appel réel : base simulée ou PostgreSQL local jetable, horloge simulée, Agent v2,
fournisseurs sociaux, Drive et OAuth simulés. Rien n'est activé : `PUBLICATIONS_SCHEDULED_DELIVERY` reste vide par défaut,
l'arrêt d'urgence et l'approbation humaine restent obligatoires. Aucun garde-fou n'a été assoupli.

S'appuie sur [publications-scheduled-flow.md](publications-scheduled-flow.md) (lot 6), [publications-chaos-tests.md](publications-chaos-tests.md)
(moteur P10) et [whatsapp-export-import.md](whatsapp-export-import.md).

## Défauts trouvés et corrigés

| # | Défaut | Conséquence | Correctif |
| --- | --- | --- | --- |
| 1 | Une préparation qui lève une exception (délai, base ou Drive indisponible après la génération) ne comptait pas dans le plafond de 2 préparations par passage | Panne en série : jusqu'à un appel IA par projet de chacun des 10 clients visités, à chaque passage | L'exception compte comme une tentative (`lib/publications/automation/scheduled.ts`, `prepareClient`) |
| 2 | Aucune échéance dans la préparation : la seconde préparation IA démarrait même s'il restait 30 s avant la fin du passage | Processus coupé par la plateforme au milieu d'une génération ou de l'étape média | Option `deadline` : aucune préparation sans 100 s devant elle (`PREPARATION_BUDGET_MS`), aucune reprise média sans 45 s (`MEDIA_FOLLOW_UP_BUDGET_MS`) ; le client non traité garde sa place |
| 3 | Rotation horodatée **après** la préparation, sans condition | Un client dont la préparation plante (processus coupé) restait en tête à chaque passage ; deux passages simultanés préparaient le même client | Rotation réservée **avant** de préparer, en compare-and-set sur l'horodatage lu (`client_busy` pour le perdant) |
| 4 | Les candidates bloquées (approbateur qui n'est plus l'administrateur, refus serveur) consommaient le plafond de 10 diffusions préparées par passage | 10 approbations obsolètes sur les créneaux les plus proches empêchaient la préparation des suivantes, qui ratait leur heure | Plafond sur les diffusions **préparées** seulement (les candidates restent bornées à 50 par passage) ; approbation inutilisable signalée **une fois** (`publication-approval-stale:<publication>:<révision>`, « Échec ou incertitude d'envoi », vers la fiche) |
| 5 | La garde « jamais plus de 2 h de retard » se mesurait sur `run_at`, repoussé à chaque réessai automatique (1 min à 6 h, ou délai imposé par le fournisseur) | Un envoi dû à 9 h en échec temporaire pouvait partir à 11 h 30 ou plus tard sans aucun humain | Migration `20261106000000` : référence = heure due de la diffusion, ou dernière relance par un humain si elle est plus récente |
| 6 | Un seul envoi par passage | Cadence de 15 min et tolérance de 2 h : au plus **8** diffusions dues au même créneau partaient à l'heure, les autres étaient bloquées « en retard » (20 clients à 9 h : 12 bloquées) | Avec l'échéance du passage : premier envoi libre (comme avant), puis jusqu'à 10 envois si leur pire cas tient dans le temps restant (Facebook et GBP 60 s, Instagram 300 s : Instagram n'est jamais qu'un premier envoi). Réservation `publication_job_claim_scheduled` : la tête de file n'est jamais doublée |
| 7 | Purge des exports WhatsApp ordonnée par expiration, limitée à 20 | 20 imports dont la suppression échoue durablement bloquaient indéfiniment la purge (conservation 24 h) des suivants | Ordre par dernière tentative (`updated_at`, réécrit à chaque échec) : les échecs passent en fin de file |

Sans l'échéance (appel sans option), les fonctions gardent exactement leur comportement antérieur (1 envoi par passage,
préparation sans échéance). La route `/api/internal/scheduler/tick` transmet l'échéance partagée (`maxDuration` moins 15 s).

## Contrat pour les autres lots

- `runScheduledPreparation(now, deps, { deadline?, clock? })` ; résumé : `deadline: true` quand un arrêt faute de temps a eu lieu,
  nouveaux motifs `skipped.deadline`, `skipped.client_busy`, `skipped.rotation_unavailable` (compteurs du battement).
- `processScheduledDuePublications(env, deps, { deadline?, clock? })` ; `DueRunDeps.run(workerId, { platforms? })`.
- `runOnePublicationJob(worker, { …, maxLateSeconds, platforms? })` : avec `platforms`, RPC `publication_job_claim_scheduled`.
- Constantes : `SEND_BUDGET_MS`, `MAX_SCHEDULED_DUE_WITH_DEADLINE` (registry), `PREPARATION_BUDGET_MS`, `MEDIA_FOLLOW_UP_BUDGET_MS` (scheduled).
- Base : `public.publication_job_claim_scheduled(text,integer,integer,text[])` (invoker, `service_role`), `publication_job_claim_on_time` remplacée (même signature).
- Notification : clé `publication-approval-stale:<publication>:<révision>` (catégorie `delivery_failed`).

## Mesures (tests, machine de développement)

| Scénario | Mesure |
| --- | --- |
| 20 clients en préparation automatique, 1 projet chacun | tous servis en **10 passages** (2 préparations IA par passage au plus), écart constant de 10 passages entre deux préparations d'un client, chaque client exactement 3 fois sur 30 passages ; < 10 ms par passage (base simulée) |
| IA indisponible pour les 20 clients pendant 24 h (96 passages) | **60 appels IA** au plus (3 par projet, jamais deux en moins de 6 h), 2 par passage au plus, puis 20 incidents signalés ; coût imputé au pire 6 € (0,10 € par échec, budget mensuel de l'agent re-vérifié en base) |
| Exceptions à chaque préparation | 2 tentatives par passage (avant : 10) |
| Deux passages simultanés | jamais le même client des deux côtés |
| 120 publications approuvées (20 clients) | **12 passages** de 10 diffusions préparées, une diffusion par révision |
| 20 diffusions dues au même créneau, cadence 15 min | avant : 8 parties à l'heure ; après : **2 passages** (10 envois par passage) |
| API sociales en panne (5xx, délais) pour 20 diffusions | 1 marqueur d'envoi par diffusion, ≤ 1 écriture de publication par diffusion (13 écritures, 13 « à vérifier », 7 réessayables : aucune écriture), jamais de renvoi |
| Connexions OAuth expirées (20) | **0 requête** fournisseur, diffusions bloquées (`auth`) |
| Base : 60 approbations, 20 clients | préparées en 6 passages ; reprise après 3 jours d'arrêt : 60 tâches bloquées par lots de 50 (2 appels), 0 tentative ; relancées par un humain : 60 envois, une tentative chacune |
| Deux sessions PostgreSQL | la seconde réservation répond en ~15 ms sans attendre la première (SKIP LOCKED) et prend une autre tâche ; double préparation : la seconde attend le verrou puis reçoit la même diffusion |
| Export WhatsApp de 600 photos (50 doublons) | 40 appels d'analyse de 15 photos, 69 appels d'import de 8, lectures par plages ≤ 64 Kio, ~10-50 ms par appel ; coupure Drive : une photo « en échec », ligne orpheline reprise par un import suivant, jamais deux lignes de photothèque |
| Purge des exports, 20 suppressions en échec permanent | les 5 imports sains purgés au **2e passage** (avant : jamais) |

## Tests

- `tests/publications-load.test.mjs` (10 scénarios, sans base) : équité sur 20 clients, délais IA, échéance, interruption et passages
  simultanés, 120 approbations, créneaux manqués depuis plusieurs jours, capacité d'envoi, vrai moteur P10 et vrais publishers Meta /
  GBP face aux pannes et aux jetons expirés, gros export WhatsApp, purge. Six de ces scénarios échouent sans les correctifs.
- `tests/publications-load-db.test.mjs` (PostgreSQL local, `PUBLICATIONS_SOCLE_TEST_DATABASE_URL`, base `publications_socle_test_load`) :
  chaîne complète des migrations, suites `supabase/tests/publications-load-1-delivery.sql` (222 vérifications) et
  `publications-load-2-whatsapp.sql` (rejeux de webhook, doublons de photos et d'archive, un import actif par client), puis
  **deux sessions psql réelles** : réservation des diffusions et des jobs (SKIP LOCKED), double préparation, rotation en
  compare-and-set, webhook WhatsApp rejoué en parallèle, réservation de la file WhatsApp. Fixtures partagées :
  `supabase/tests/publications-load-fixtures.sql`.
- La suite P10 complète (`tests/publications-scheduled-flow-db.test.mjs`) reste verte après la migration.

## Limites connues

- L'ordre des envois d'un même créneau suit l'identifiant de tâche (aléatoire) : équitable en moyenne, pas en tourniquet par client.
- Un client dont la préparation s'arrête faute de temps au milieu de plusieurs projets attend un tour complet pour les suivants.
- La photothèque intelligente (`lib/media-intelligence`, hors périmètre) plafonne déjà par client (budget mensuel, 3 échecs puis
  pause de 6 h) mais ne reçoit pas l'échéance du passage ; sa propre étape garde un minimum de 60 s.
- Migration : [docs/migration-pr47/README.md](migration-pr47/README.md).
