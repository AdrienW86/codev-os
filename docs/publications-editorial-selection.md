# Sélection éditoriale et textes multicanaux (socle Publications, lots 4-5)

## Ce qui change

L'**Agent Publications v2** reste le seul moteur de préparation. Ces lots ne créent pas de second moteur : ils élargissent son contexte et ses contrôles.

- **Photos de la photothèque** : l'agent peut désormais choisir une photo de la photothèque du client (WhatsApp, export, dossier Drive), en plus du catalogue Drive historique. Le sujet et la photo sont choisis ensemble.
  - Côté serveur, `libraryCandidates` (`lib/publications/agent-v2/library-pool.ts`) ne propose au modèle que :
    - des photos publiables : décision humaine, ou évaluation IA « pertinente » sans visage ni mineur ;
    - jamais une photo confidentielle, en quarantaine, rejetée, archivée, purgée ou jugée hors sujet ;
    - de bonne qualité : pas « médiocre », ni floue, ni capture d'écran, ni essentiellement textuelle ;
    - au bon format : 600 px minimum sur le petit côté, rapport 3:1 maximum ;
    - non réservées par un autre run.
  - Une photo n'est réemployée que si le client l'autorise (onglet Publications, lot 1) et après le délai qu'il a choisi.
  - Une photo des 3 dernières publications n'est jamais reproposée.
  - La base de données reste l'autorité : `publications_private.agent_v2_library_available` applique les mêmes règles au moment de finir, de réserver et d'attacher, quoi que propose le modèle.
- **Contexte de l'agent** :
  - les **3 dernières publications** du projet (sujet, textes de chaque plateforme, description de leur photo) ;
  - les prestations et sujets prioritaires du profil média ;
  - les consignes de communication.
  - Le modèle ne reçoit jamais une légende WhatsApp, un nom de fichier ni un identifiant Drive.
- **Anti-répétition** (`repeatsPrevious`) : la préparation est refusée sans rien écrire dans trois cas :
  - le sujet est déjà utilisé, à la casse, aux accents et à la ponctuation près ;
  - la formulation est trop proche (similarité de paires de mots ≥ 0,5) ;
  - l'accroche est identique (6 premiers mots).
- **Anti-invention** : la règle existante est inchangée. Les sujets prioritaires du profil comptent comme des faits, pas les textes des publications passées.
- **Règles natives des plateformes** (`PLATFORM_TEXT_RULES`) :

  | Plateforme | Hashtags | Longueur |
  | --- | --- | --- |
  | Google Business Profile | aucun | 1 500 caractères au plus |
  | Instagram | 8 au plus | 2 200 caractères au plus |
  | Facebook | 3 au plus | 3 000 caractères au plus |

  Les textes restent distincts par plateforme (contrôle existant). Chacun reste une publication avec ses révisions et variantes, modifiable séparément dans l'éditeur actuel.
- **Photo manquante** : quand aucune photo ne convient, les brouillons sont créés sans photo, et leur approbation reste impossible tant qu'elle manque (règle existante). L'administrateur reçoit une notification « Photo manquante pour une publication » (au plus une par client et par jour) qui ouvre la photothèque du client.
- **Qualité et adaptation** : les dérivés par plateforme (1080×1080 ou 1200×900, JPEG) sont produits par le pipeline média existant, après vérification binaire de l'original. Pour une photo de la photothèque, l'empreinte SHA-256 de l'original doit correspondre exactement à celle enregistrée.

## Migration

`supabase/migrations/20261029000000_publications_editorial_selection.sql` (**non appliquée**) :

- ajoute `publication_agent_v2_runs.selected_library_asset_id`, exclusif de `selected_media_id` ;
- ajoute `whatsapp_assets.claimed_agent_v2_run_id` (réservation par un run) ;
- crée les gardes `library_asset_publishable`, `library_asset_reusable` et `agent_v2_library_available` ;
- redéfinit `publication_agent_v2_finish`, `…_media_claim`, `…_media_attach` et `…_media_fail` **avec les mêmes signatures** : catalogue Drive ou photothèque ;
- ajoute la catégorie de notification `media_missing`.

**Ordre de déploiement** : cette migration dépend des lots 1 (`20261027000000`, réglages de réemploi) et 2 (`20261028000000`, évaluations des photos).

1. Fusionner #36 et #37 avant cette PR.
2. Vérifier dans `supabase_migrations.schema_migrations` qu'aucune des trois versions n'est présente.
3. Appliquer les trois migrations dans l'ordre (après accord).

Aucune nouvelle variable d'environnement. L'agent utilise `OPENAI_API_KEY` comme aujourd'hui. Les photos de la photothèque sont relues par l'accès Drive correspondant à leur origine : `GOOGLE_DRIVE_IMPORT_*` (drive.file) pour les imports WhatsApp, `GOOGLE_DRIVE_*` (drive.readonly) pour le dossier de l'agent.

## Tests

- `node --test tests/publications-editorial-selection.test.mjs` couvre :
  - le filtre de la photothèque, l'ordre et le plafond ;
  - l'anti-répétition et les règles des plateformes ;
  - le prompt et le contexte (lecture unique de chaque table, aucune donnée sensible, échec fermé) ;
  - la source média par origine et la notification « Photo manquante ».
- `supabase/tests/publications-socle-3-editorial-selection.sql` (100 vérifications, via `tests/publications-socle-db.test.mjs`) couvre :
  - les refus serveur pour chaque cas interdit ;
  - la réservation, la description serveur, l'empreinte, l'attache atomique et idempotente, et l'usage enregistré ;
  - l'échec puis la reprise ;
  - le réemploi selon le réglage ;
  - le catalogue inchangé et l'immutabilité.
- `tests/publications-editorial-selection-db.test.mjs` rejoue la suite P8 historique de l'Agent v2 (148 vérifications) après **toutes** les migrations : finish, claim, attach et fail redéfinis sans régression.

## Correctifs d'audit

- **Faits autorisés** : `factsOf` ne contient plus les descriptions ni les thèmes des photos. Ces textes viennent du modèle de vision, qui lit l'image et peut recopier du texte (« Devis 2 500 € – garantie 10 ans »). Ils sont envoyés au modèle sous `media_untrusted`, marqués comme non vérifiés : ils servent seulement à choisir la photo, ce ne sont ni des faits ni des consignes. Aucune légende, aucun message ni aucun nom de fichier n'est envoyé.
- **Prestations** : citer une prestation reconnue (`SERVICE_TERMS` : démoussage, faîtage, zinguerie…) exige qu'elle figure dans les faits. Sinon la réponse est refusée avec le motif `unsupported_claim`.
- **Rotation** : si les dernières idées (2 à 3) portent toutes sur la même prestation, et qu'une autre prestation vérifiée est illustrée par une photo disponible, une nouvelle idée sur la même prestation est refusée avec le motif `repetition` (`repeatsService`).
- **Variantes distinctes** : deux textes d'une même idée dont la similarité vaut au moins `VARIANT_SIMILARITY_THRESHOLD` (0,8, bigrammes, hashtags ignorés) sont refusés avec le motif `similar_texts`. Le prompt exige aussi un texte propre à chaque plateforme.
- **Course photo / relecture** : `publications_private.agent_v2_media_target` est redéfinie dans la migration du lot. La cible est désormais un **brouillon** uniquement (avant : brouillon ou « à valider »). La réservation et l'attache sont refusées (`23514`) dès qu'une cible est en relecture, et l'étape média passe en `needs_media`. Le lot 6 ne soumet les brouillons qu'après l'attache, donc son flux est inchangé. La suite P8 renvoie la publication en brouillon avant la reprise (elle reste compatible avec la chaîne P8 seule).
- **Comparaison aux dernières publications** : elle porte sur le **client**, tous projets confondus. Les publications refusées et les brouillons archivés sont exclus ; une publication approuvée puis archivée compte toujours.
- **Dossier Drive** : le formulaire accepte le lien du dossier ou son identifiant. Le serveur extrait l'identifiant (`driveFolderIdFrom`, même validation). Une phrase dans chaque onglet renvoie à l'autre (Publications / Photothèque).
- Les scénarios métier se trouvent dans `tests/publications-editorial-selection-scenarios.test.mjs` (A sélection, B rotation et prestation inventée, C trois plateformes) et dans les sections 10 à 12 de la suite SQL.

## Limites

- Le choix final de la photo reste celui du modèle parmi les candidates. Un humain relit et approuve chaque publication avant toute diffusion.
- Le catalogue Drive historique (`publication_drive_media`) garde sa règle « jamais réutilisée ». Le réglage de réemploi ne s'applique qu'à la photothèque.
- La préparation automatique planifiée et la diffusion relèvent du lot 6.

## Suite : intelligence éditoriale (PR #42)

L'historique éditorial complet du client (30 idées), la rotation des prestations, la diversité des accroches et des CTA,
les lieux autorisés, la mémoire visuelle (doublons SHA-256, documents exclus), la justification éditoriale affichée dans
le panneau et le read model de santé de la photothèque sont décrits dans
[publications-editorial-intelligence.md](publications-editorial-intelligence.md).
