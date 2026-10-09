# Durcissement local des permissions historiques

Validation du 5 octobre 2026. Migration nouvelle : `20261005000004_harden_historical_permissions.sql`, après 00003. Les cinq migrations passent deux fois depuis zéro sur la reproduction fidèle, avec **1 576 contrôles SQL par reconstruction**. Aucun changement distant effectué.

**Limite explicite : les defaults du créateur postgres sont durcis ; ceux du rôle géré supabase_admin restent inchangés lorsque la migration est exécutée par postgres, qui n'est pas autorisé à les modifier.** L'avertissement SQL est visible et testé ; aucun droit supérieur n'a été simulé pour masquer cette limite.

## Migration et décisions

Les 27 tables métier visées comprennent les 13 historiques, les 13 Publications et agent_project_assignments. Leurs privilèges sont retirés à PUBLIC, anon et authenticated, y compris TRUNCATE, REFERENCES, TRIGGER et MAINTAIN. Aucun changement de RLS ni création de policy.

TRUNCATE est explicitement révoqué à service_role sur les 27 tables. Aucun usage applicatif n'a été trouvé dans les services/scripts du dépôt. La migration ne vise aucune table auth/storage/extension, et ne retire pas les capacités d'administration du propriétaire. Les opérations de maintenance ou de restauration exécutées par un propriétaire/migration actor ne dépendent pas du TRUNCATE de service_role sur ces tables.

| Tables | Permissions backend après 00004 |
| --- | --- |
| clients, projects, tasks, agents, agent_client_assignments, client_services, client_connections, client_events | SELECT/INSERT/UPDATE/DELETE conservés ; TRUNCATE retiré |
| agent_runs, recommendations, actions, agent_messages | SELECT/INSERT/UPDATE conservés ; DELETE et TRUNCATE retirés |
| audit_logs | SELECT/INSERT ; UPDATE/DELETE/TRUNCATE retirés |
| Tables Publications et agent_project_assignments | Restrictions déjà définies conservées, sans élargissement |

Les autres privilèges serveur historiques ne sont pas élargis par ce lot. Les tables app ne donnent plus aucun droit direct à anon/authenticated.

## Conservation de l'historique

Les FK historiques restent strictement inchangées, y compris CASCADE et SET NULL. Leur définition et leur statut de validation sont comparés avant/après 00004. Le refus de supprimer une recommandation liée à une action reste cohérent avec la décision métier.

Une révocation DELETE sur une table enfant ne protège pas contre une cascade déclenchée par la suppression d'un parent. Pour appliquer réellement la décision de conservation, quatre triggers BEFORE DELETE utilisant un unique helper privé `agent_scope_private.prevent_history_delete()` bloquent la suppression de runs/recommandations/actions/messages, y compris en cascade. Le helper est invoker avec search_path pg_catalog. Ces guards n'empêchent pas les transitions de statut.

Tests réalisés sans assignation projet ni publication bloquante sur les parents : la suppression backend de l'agent historique ou de son client échoue avec 55000, et tous les objets historiques restent présents. DELETE direct service_role est refusé par ACL ; DELETE propriétaire rencontre le guard. Les clients/agents/projets sans historique bloquant restent supprimables et les CRUD nécessaires sont exercés réellement.

Le trigger historique audit_logs_no_update_delete est conservé, avec définition intacte et activation vérifiée. Aucun mécanisme supplémentaire de TRUNCATE n'est ajouté à audit_logs : la révocation ACL suffit pour les rôles applicatifs. Le propriétaire administratif conserve ses droits ; cette protection ne prétend pas empêcher un administrateur de réaccorder des droits ou de modifier les objets.

Les protections existantes publication_events/publication_attempts sont conservées. Publication events : UPDATE/DELETE refusés pour le backend, et UPDATE/DELETE/TRUNCATE toujours bloqués pour le propriétaire par les triggers existants. INSERT et lecture des journaux fonctionnent.

## Fonctions et RPC

EXECUTE est retiré à PUBLIC/anon/authenticated sur les sept RPC Publications/Agent Scope et les deux fonctions historiques de trigger connues. EXECUTE serveur est conservé. Les helpers privés restent inaccessibles aux rôles navigateur.

Les sept RPC sont vérifiées pour invoker, search_path explicite et permissions ; elles sont exécutées par les suites SQL après 00004. Les définitions de toutes les fonctions existantes sont comparées à leur snapshot avant durcissement : aucun corps ou search_path modifié. Les audits UUID vers resource_id TEXT et les rollback si audit/job échoue passent toujours.

## Privilèges par défaut : portée et limite

Les catalogues de defaults et les rôles ont été relus en transaction READ ONLY, sans données métier ni secret. Il n'existe pas d'ACL globale personnalisée préalable ; public possède les defaults larges de postgres et supabase_admin.

Le distant confirme : postgres est non-superuser et n'est pas membre, même indirectement, de supabase_admin ; il ne peut ni SET ROLE vers ce rôle ni modifier ses defaults. Le test local reproduit cette absence de membership et applique 00004 sous postgres non-superuser.

Pour postgres, la migration retire les defaults PUBLIC/anon/authenticated sur tables, séquences et fonctions de public, retire TRUNCATE serveur sur les futures tables et conserve les droits nécessaires au backend, y compris séquences d'identité et EXECUTE.

PostgreSQL accorde normalement EXECUTE des fonctions à PUBLIC au niveau global. Une révocation limitée au schéma ne peut pas annuler ce droit global ; la migration révoque donc ce default global pour les fonctions futures du créateur autorisé. Les fonctions existantes des autres schémas restent intactes. Les futures fonctions postgres hors public devront recevoir explicitement leurs GRANT nécessaires. [Documentation PostgreSQL 17](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

Tests de création réelle sous postgres : table avec identité, séquence et fonction futures sans privilèges anon/authenticated ; TRUNCATE backend refusé ; lecture/insertion/mise à jour/suppression et RPC backend réussies. Une fonction future dans un schéma privé prouve également l'absence de PUBLIC EXECUTE.

Pour supabase_admin non administrable par postgres, la migration produit WARNING et préserve exactement ses trois defaults de public. Des objets probes créés sous ce rôle confirment qu'ils hériteraient encore de grants larges ; ils sont immédiatement supprimés localement. La suite ne prétend pas que cette exception est résolue.

**Créer les futurs objets CODE-V OS sous postgres.** Une correction des defaults du rôle géré nécessiterait une administration fournisseur distincte. Aucun contournement, GRANT de rôle administrateur ou modification distante n'a été tenté.

## Validation et reproductibilité

Ordre de chaque reconstruction : snapshot historique fidèle et catalogues comparés → fixtures fictives représentatives → 00000 → 00001 → 00002 → 00003 → snapshots FK/fonctions/defaults réservés → 00004 sous postgres → conservation des treize tables historiques → droits/refus réels/defaults futurs → projets fictifs → suites Publications et Agent Scope → CRUD/journaux → rollback complet → base vide vérifiée.

| Contrôle final | Résultat |
| --- | --- |
| Premier rebuild à cinq migrations | 1 576 contrôles réussis |
| Second rebuild | 1 576 contrôles réussis, même compteur et assertions |
| Reproduction historique précédente à quatre migrations | 968 contrôles par rebuild, deux fois, réussis |
| Ancienne baseline et quatre migrations | 350 contrôles par rebuild, deux fois, réussis |
| Publications isolées | 213 contrôles par rebuild, deux fois, réussis |
| Lint | Réussi |
| Typecheck | Réussi |
| Build | Réussi, Next.js 16.3.8 |
| Tous les tests Node | 118 réussis, 0 échec, 0 ignoré : 114 application et 4 intégrations SQL |
| Intégrations SQL pendant npm test | Toutes réexécutées avec succès |
| PostgreSQL | Arrêté après validation |

Au total avant les contrôles application : 6 214 contrôles SQL sur les quatre suites, dont 3 152 pour 00000–00004. La trace conserve le WARNING réservé et les NOTICE de cascade des suites historiques, sans masquage.

Trace finale : `.local/historical-hardening-final.log`. Cluster : `.local/publications-postgres/464ea2f0373b444680b03dc320306742`, arrêté. PostgreSQL portable 17.11, écoute exclusivement 127.0.0.1 vérifiée par SQL. Aucun service Windows installé. Variables applicatives fictives et télémétrie désactivée pendant les contrôles ; .env inchangé.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-publications-local.ps1 -PostgresBin 'C:\Users\Adrien\Documents\Adrien\codev-os\.local\runtime\pgsql-runtime\pgsql\bin'
```

Commande stricte dédiée : `npm run test:historical-permissions:db`, avec une base locale vide historical_permissions_test. Sans configuration elle échoue explicitement ; le runner interdit un hôte distant, un autre nom de base et les options URL. Le script global crée les rôles une fois dans le cluster local pour éviter les courses entre les quatre intégrations, chacune isolée dans sa base.

## Impact attendu lors d'une application future

Les accès directs navigateur seront refusés même sans compter sur RLS. Le backend conserve ses opérations métier utiles et ses RPC, mais ne pourra plus purger l'historique ni utiliser TRUNCATE. Supprimer un client/agent portant de l'historique agentique sera refusé. Les transitions de statut assurent la conservation demandée. La migration ne change aucune ligne existante, FK ou policy.

Les defaults postgres seront durcis, avec la portée globale aux fonctions futures expliquée ci-dessus. La limite supabase_admin devra rester visible dans le préflight et dans le rapport d'une future application. Le CLI Supabase n'étant pas installé, le fichier local porte le nom versionné proposé par l'utilisateur ; aucun CLI installé ou connecté au distant.

**Aucun ALTER, GRANT/REVOKE, migration, db push ou INSERT/UPDATE/DELETE distant effectué. Seules des lectures des catalogues de rôles/defaults ont été réalisées. Aucune publication réelle, aucun appel Meta/Google/OpenAI. Aucun passage au Lot 2.**
