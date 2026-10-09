# Architecture Client / Project / Agent

Évolution locale de `feature/publications`, préparée le 5 octobre 2026. Aucun déploiement, migration distante, publication, email, cron ou appel d’intégration n’est exécuté par ce chantier. Les deux migrations du Lot Publications initial restent inchangées.

## Modèle métier

Un **client** représente l’entreprise. Un **projet** représente un domaine opérationnel distinct : site principal, deuxième site, SEO, Ads Lyon, Réseaux sociaux, Google Business Profile, maintenance, refonte, campagne locale. Le client d’un projet devient immuable ; déplacer un projet existant entre entreprises n’est plus une modification autorisée.

`agents.agent_scope` vaut `client` ou `project`.

- L’agent client, dont le futur Account Manager, travaille avec `project_id = null`. Il accède aux projets et à leur synthèse déterministe depuis sa fiche. Aucun rôle n’est déduit de son nom.
- Le spécialiste travaille avec un projet explicite, une portée projet confirmée, un rattachement client actif et une autorisation projet active. Son activation globale et son statut Actif restent nécessaires. Le moteur actuel conserve uniquement ses actions internes autorisées ; aucune autonomie supplémentaire.
- L’ancien nom « Ads Agent » reste une condition de l’intégration Ads historique, mais ne détermine jamais la portée. Cette intégration utilise une connexion au niveau client. Elle ne peut actuellement pas exécuter de run spécialisé ni attribuer arbitrairement les métriques d’un compte Ads à une campagne/projet.

Exemple Jrenov : `jrenov.com` et SEO sont des projets distincts si leur périmètre métier le justifie ; Ads Lyon, Social, GBP et Maintenance restent distincts. Un spécialiste peut être autorisé sur plusieurs projets mais chaque run en cible exactement un. L’Account Manager cible Jrenov sans projet, puis agrège les activités classées par projet.

## Assignations : option B

`agent_client_assignments` reste le rattachement principal. `agent_project_assignments(agent_id, client_id, project_id, enabled)` ajoute des autorisations distinctes, avec unicité `(agent_id, project_id)` et deux clés étrangères composites vers le rattachement parent et le projet du même client. Le `client_id` est conservé pour compatibilité avec les tables actuelles et contrôlé par la base ; l’interface ne le choisit pas pour une assignation projet.

Le retrait projet est logique (`enabled=false`), audité et conserve la ligne. Les anciennes fonctions de suppression d’un rattachement client peuvent désormais être refusées par la clé étrangère restrictive tant qu’une autorisation projet existe, même désactivée : utiliser la désactivation du rattachement client pour conserver l’historique.

La portée se confirme/change par `agent_set_scope`; les autorisations par `agent_project_assignment_set`. Les deux RPC utilisent l’identité Clerk fournie par le serveur, verrouillent l’agent et écrivent un audit transactionnel. Aucun navigateur ne choisit l’acteur. Un changement de niveau est refusé si un run est en cours, une action s’exécute ou une autorisation projet reste active. Une classification peut être confirmée sans effacer les historiques.

## Contexte opérationnel

`project_id` nullable est ajouté à `agent_runs`, `recommendations`, `actions`, `agent_messages`. Le serveur valide le client, le projet, leur relation, la portée et les deux autorisations avant création ou exécution. La base applique également ces règles sur les nouvelles lignes et sur le passage d’une action vers approved/executing. Elle conserve les contextes historiques immuables ; un changement ultérieur de portée ne reclasse pas les anciens runs/recommandations.

Un test interne spécialisé dérive la recommandation du projet du run. Les actions et messages relisent la recommandation et héritent de son client, agent et projet ; des paramètres de contexte ajoutés dans le navigateur ne les remplacent pas. Les messages sur une recommandation historique peuvent être refusés après reclassement du spécialiste, puisqu’ils conserveraient son ancien contexte non autorisé : aucune attribution de projet automatique n’est faite.

Les tâches gardent client/projet. Une clé étrangère composite bloque les nouvelles tâches entre clients différents. Le trigger `tasks_completion` date les nouveaux passages à Terminé, efface la date à la réouverture et préserve les dates connues. Une ancienne tâche terminée n’est pas datée artificiellement à l’installation de la migration. La création/édition reste administrative.

## Publications

`publications.project_id` devient nullable et `publication_revisions.project_id` conserve le périmètre du contenu versionné. Les jobs le dérivent par leur révision et les deliveries par leur variante → révision ; pas de colonne projet redondante sur ces tables.

- Projet Réseaux sociaux : Facebook et Instagram.
- Projet Google Business Profile : Google Business Profile uniquement.
- Un projet doit appartenir au client de la publication. Un projet sans type compatible est refusé.
- Les anciennes publications sans projet restent lisibles et révisables ; elles ne sont pas attribuées automatiquement. Un ancien contenu multi-plateformes Social + GBP ne peut pas être rattaché à un seul de ces projets. Il devra être séparé manuellement dans le futur éditeur.

`publication_create_project_manual` crée une publication ciblée dans une seule transaction. `publication_set_project` vérifie la révision attendue et verrouille le parent. Un changement de projet clone le contenu, les métadonnées et les images ordonnées dans une nouvelle révision, invalide les validations, bloque les anciennes deliveries et annule les jobs en attente. Processing/published/uncertain bloque ce changement. L’audit `publication.project_changed` conserve les anciens/nouveaux IDs projet et révision ; aucun contenu ni secret n’est recopié dans l’audit. La cohérence projet/révision courante est contrôlée à la fin de la transaction.

Les flags du Lot 1 restent arrêt général actif, génération/automatisation/publication désactivées. La cadence reste **deux publications éditoriales par client et par semaine au total**, partagées entre projets, pas deux par projet. L’allocation Social/GBP nécessitera une décision éditoriale avant automatisation. `published_at` est ajouté aux deliveries pour dater les futures confirmations ; les anciennes diffusions restent sans date fiable.

## Synthèse mensuelle

`buildClientMonthlySummaryContext(clientId, period)` est une fonction serveur protégée ; `period` vaut YYYY-MM, années 2000–2199. Elle ne charge aucun fournisseur externe et ne produit aucun texte IA. Les lectures sont paginées, limitées au client, puis les jobs/tentatives aux publications de ce client.

La structure TypeScript contient période, client, projets et activité par projet, activité client/historique sans projet, totaux, notes, métriques et qualité des données. Les réalisations sont filtrées sur le mois Europe/Paris, bornes début inclus et fin exclue, changement d’heure compris :

| Donnée | Date / traitement |
| --- | --- |
| Runs | `started_at` ; incidents failed sur `completed_at` |
| Recommandations du mois | `created_at` |
| Recommandations ouvertes | Créées avant fin de mois, statut **actuel** pending/accepted |
| Actions exécutées | `executed_at`, statut executed |
| Tâches terminées | `completed_at`, statut actuel Terminé |
| Programmations | `scheduled_for` dans le mois, hors blocked/cancelled ; contient aussi les dates déjà diffusées |
| Publications diffusées | `published_at`, projet de la révision utilisée |
| Deliveries en erreur | Statut actuel retryable_error/uncertain, `updated_at` dans le mois |
| Incidents action/job | Statut failed actuel, `updated_at` ; date d’erreur précise à ajouter ultérieurement |
| Tentatives en erreur | `created_at`, chaque tentative distincte, sans texte d’erreur sensible |
| À venir | Tâches ouvertes avec échéance après le mois, selon état actuel |

Les IDs sont dédupliqués à chaque source et chaque ligne n’appartient qu’à un projet ou au niveau client. Programmations et diffusions sont deux indicateurs différents et ne doivent pas être additionnés pour calculer un nombre de contenus uniques. Incidents job et tentative sont également deux événements différents.

Les métriques Google Ads sont extraites uniquement des payloads déjà persistés, avec une liste de valeurs numériques finies autorisées. Un même compte/périmètre/période n’est retenu qu’une fois, avec l’observation la plus récente disponible avant la fin de mois. Une période partielle reste partielle : aucune extrapolation, somme entre fenêtres chevauchantes ni ventilation d’un compte client entre projets. L’intégration historique ne persiste des métriques dans les recommandations que lorsqu’elle produit une observation ; leur absence signifie indisponibilité, jamais zéro.

Aucune table de rapports n’est créée. Le résultat reflète les lectures courantes, sans snapshot transactionnel global entre tables : pour un futur rapport approuvé/envoyé, prévoir une persistance versionnée et un gel des sources, afin de conserver la preuve de ce qui a été validé. Aucun email n’est préparé pour envoi dans ce chantier.

## Migrations et reprise des données

1. `20261005000002_agent_project_scope.sql` : portées/indicateurs, autorisations projet, contextes, dates tâches, contraintes/guards/RPCs, RLS/ACL.
2. `20261005000003_publications_project_scope.sql` : projet publications/révisions, horodatage diffusion, plateforme compatible, changements audités/versionnés, identité projet protégée.

Les fichiers sont seulement préparés. Aucun enregistrement distant n’a été modifié. À leur application, les agents existants reçoivent `client` + `scope_review_required=true` ; c’est une valeur de compatibilité signalée à vérifier, jamais une classification métier inventée. Les historiques conservent `project_id=null`. Aucune ligne n’est supprimée et aucune cascade destructive n’est ajoutée.

Les clés étrangères composites vers les projets sont NOT VALID pour préserver les anciennes incohérences de tâches ; les nouvelles écritures sont contrôlées. Les contraintes devront être validées après examen des données réelles. La base historique n’est pas versionnée dans ce dépôt : les types TypeScript et requêtes existantes décrivent le contrat local, pas une preuve du schéma distant. Vérifier UUIDs, noms de FK, contraintes existantes, privilèges service_role et colonnes d’audit dans une copie locale de la base avant toute application distante.

Revue administrative, après application **autorisée** dans une copie locale :

```sql
select id,name,agent_scope,scope_review_required from public.agents where scope_review_required;
select t.id,t.client_id,t.project_id from public.tasks t join public.projects p on p.id=t.project_id where p.client_id<>t.client_id;
select id,client_id,project_id from public.tasks where status='Terminé' and completed_at is null;
select id,client_id from public.publications where project_id is null;
select id,client_id from public.publication_deliveries where status='published' and published_at is null;
```

Ne pas remplir project_id historique à partir du nom d’agent. Les guards conservent ces contextes immuables ; une reprise détaillée devra faire l’objet d’une migration de correction contrôlée avec provenance, pas d’UPDATE improvisés.

## Sécurité et audit

Clerk → `requireAdmin()` → serveur Next.js → client Supabase privilégié. Modules de données marqués `server-only`, aucun accès Supabase dans les nouveaux composants navigateur, aucune nouvelle variable publique ni modification `.env`.

RLS activée sur les tables touchées/exposées. ACL navigateur retirées sur les domaines concernés, aucune policy permissive ajoutée ; les anciennes policies ne sont pas élargies. La nouvelle table d’assignations n’accorde que SELECT/INSERT/UPDATE à service_role. Helpers dans des schémas privés, fonctions invoker à search_path explicite, exécution RPC réservée au serveur. L’acteur des audits provient de la session Clerk ; la base exige un identifiant `user_…` sur les nouvelles RPCs.

Audits de scope et assignations ainsi que changements de projet publication sont atomiques avec la mutation. Les audits existants de runs/recommandations/actions/messages incluent project_id et des snapshots minimaux. Les instructions globales et client restent exclues. Dette existante : ces anciennes mutations applicatives et `writeAuditLog` sont deux requêtes distinctes ; une indisponibilité de l’audit peut laisser une mutation effectuée mais non confirmée. Les messages d’erreur demandent de recharger ; une future transaction/outbox dédiée devra résoudre ce point.

## Interface

- Fiche client : projets avec statut, spécialistes et activité par projet, agents client séparés, lien synthèse ; les sections existantes restent disponibles pendant la transition.
- `/projects/[id]` : client/type/statut, tâches, autorisations spécialistes, runs/recommandations/actions récentes, publications, métriques persistées du dernier mois complet et accès à la synthèse.
- Fiche agent : portée à confirmer, autorisations projet, test interne ciblé, projet affiché dans l’activité ; généraliste avec projets du client et lien synthèse.
- Recommandations liste/détail et activité client : contexte projet visible.
- Publications : projet affiché, rattachement administratif avec révision attendue et revalidation.
- `/clients/[id]/summary?period=2026-09` : synthèse structurée par projet et bloc client, limites et dates inconnues visibles.

Les sections projet effectuent plusieurs lectures par projet ; un chargement progressif côté serveur sera pertinent pour les gros portefeuilles. Les erreurs de stockage restent explicites ; aucun dataset démonstratif ne remplace les résultats de ces nouvelles pages.

## Vérification locale

Tests unitaires/exécution des fonctions serveur couvrent les portées, autorisations, mauvais client, héritage projet, révocation avant exécution, agrégation multi-projets, déduplication, DST, dates manquantes, métriques partielles, pagination et refus non-admin.

Suites SQL réelles : `tests/publications-db.test.mjs` applique les deux migrations du Lot 1 ; `tests/agent-scope-db.test.mjs` applique la baseline locale et les quatre migrations, vérifie la conservation historique puis exécute `publications.sql` et `agent-scope.sql`. Deux reconstructions transactionnelles avec rollback et interdiction d'une base non vide. Aucun `.env` chargé par ces tests et connexion exclusivement loopback, bases dédiées `publications_lot1_test` / `agent_scope_test` (suffixes autorisés).

```powershell
# Seulement avec un PostgreSQL local et une base dédiée vide.
$env:AGENT_SCOPE_TEST_DATABASE_URL = 'postgresql://postgres:LOCAL_PASSWORD@127.0.0.1:5432/agent_scope_test'
npm run test:scope:db
```

Validation réelle réalisée sur PostgreSQL portable 17.11 : baseline locale des douze tables historiques, quatre migrations, comparaison intégrale des données fictives historiques et deux suites SQL, deux fois depuis zéro. 350 contrôles par reconstruction complète, aucun échec. La baseline reflète le contrat du dépôt ; les defaults/politiques distants inconnus ne sont pas certifiés. Voir le [rapport local](publications-local-validation.md).

La RPC de changement de projet Publications a été corrigée pour fonctionner avec les contraintes immédiates ; révision et projet courants changent ensemble, avec rollback de l'audit. Le Lot 2 n'est pas commencé. Les intégrations externes et l'envoi d'emails nécessiteront un chantier ultérieur explicitement autorisé.
