# Audit technique CODE-V OS et clôture locale du Lot 4

Date : 6 octobre 2026. Branche : `feature/publications`. Audit du code du dépôt et des reconstructions PostgreSQL locales ; aucune nouvelle inspection ni modification du Supabase distant. Les fichiers antérieurs non commités ont été conservés. Ce rapport ne certifie pas un déploiement distant ni un parcours navigateur avec une session Clerk réelle.

## Lot 4 : résultat et périmètre

L'implémentation existante a été reprise, sans recommencer les lots précédents. Les points restants étaient la revue des transports et frontières serveur, les validations complètes et l'audit global. Les corrections concernent notamment les validations des agents actifs, les gardes, la pagination, les limites de lecture Drive, les erreurs et les libellés des auteurs.

Migration locale : `supabase/migrations/20261005220029_publications_opportunity_agent.sql`. **Non appliquée au distant.** Elle ajoute le spécialiste Publications, cinq tables (`publication_agent_projects`, `publication_ai_runs`, `publication_drive_media`, `publication_media_uses`, `publication_generation_details`), six RPC, les contraintes et index associés, et un bucket d'originaux privé. Pas de nouvelle migration produite par l'audit.

- **Agent** : scope projet confirmé, projet Social/GBP du même client, agent actif et activé, assignations client et projet actives. Configuration Drive et prestations vérifiées par projet. Agent initialement désactivé ; aucune autonomie de publication ajoutée.
- **Préparation** : formulaire « Préparer les publications » avec autorisation IA explicite, non cochée par défaut. Une demande traite un placeholder existant ; elle ne crée pas de nouvelle date/créneau. Aucun appel IA au chargement ou au rendu.
- **OpenAI** : transport serveur Responses, modèle fixé `gpt-4.1-mini-2025-04-14`, sortie structurée stricte, `store:false`, timeout et limites de tokens. Identifiants sélectionnés, plateformes et phrases autorisées sont revalidés côté application. Les erreurs ne reproduisent ni réponses brutes ni credentials. **Tests avec réponses simulées uniquement.**
- **Drive** : token serveur, requêtes GET uniquement, dossier fixe client/projet, vérification du parent avant téléchargement, types/tailles bornés. Cinq pages maximum, refus des tokens de pagination répétés. Aucun appel Drive réel effectué pendant ces validations. Le renouvellement du token reste une préparation d'intégration ultérieure.
- **Photo-first** : classement des paires opportunité/photo compatible, choix d'une autre opportunité si nécessaire ; sans photo compatible, arrêt en `needs_review`. Analyse limitée à trois candidates ; catégories métier conservatrices. Non-réutilisation contrôlée par identifiant Drive, empreinte SHA et historique immuable d'utilisation. Les usages Facebook/Instagram de la même révision peuvent partager un asset.
- **Images** : Sharp traite réellement des fixtures locales ; carré 1080×1080 Social, 1200×900 GBP, conservation des proportions et de toute l'image, normalisation de l'orientation. Originaux privés, dérivés JPEG bornés. Aucun imagegen.
- **Opportunités** : prestations confirmées, historique, saisonnalité et règles éditoriales ; huit dimensions de score et pénalité de répétition. Adaptateurs GSC/GBP/Ads testés sur snapshots simulés, sans prétendre à une connexion live. Ads pondère le potentiel business sans créer de fausse donnée SEO.
- **Anti-invention** : textes composés de phrases factuelles autorisées et vérifiées ; pas de ville, chantier, résultat ou prestation inventé. Ce choix limite volontairement la liberté rédactionnelle ; une génération libre ne serait pas couverte par la validation actuelle.
- **Validation** : `/publications/review` affiche client/projet/date, contenus, images et justification du score ; état vide testé. Nouvelle révision toujours `pending_review`, aucune approbation héritée. Les anciennes décisions restent dans l'historique et ne sont pas réaffichées dans le bloc courant.
- **Régénération** : refus et motif requis, nouvelle révision immuable, anciennes révisions/reviews conservées. Requête répétée idempotente ; une double demande ne relance pas les providers pour une opération déjà en cours ou achevée.
- **Runs et budget** : `agent_run` et ledger IA, réservation maximale de 0,10 € par tentative, trois tentatives maximum, budget mensuel de l'agent sérialisé par verrou. Tarifs modèle utilisés pour l'estimation ; conversion USD/EUR volontairement conservatrice, pas un taux de change réel. Les appels dont l'issue est inconnue sont provisionnés au maximum pour éviter un dépassement.
- **Transactions** : révision, variantes, assets enregistrés, usages, détail de génération, root, run et événement final atomiques dans PostgreSQL. Échec de l'audit : rollback complet. Les uploads Storage ne sont pas une transaction distribuée : compensation sur échec confirmé, conservation prudente en cas de résultat SQL indéterminé.
- **Concurrence** : deux sessions PostgreSQL réelles vérifient un même placeholder et deux publications partageant un budget. Un seul run logique/événement et aucun dépassement de la réservation disponible.
- **Sécurité de publication** : `generation_enabled=false`, `automation_enabled=false`, `publishing_enabled=false`, `emergency_stop=true`, inchangés dans les fixtures. Préparation manuelle distincte de l'automatisation ; aucun worker, cron ou transport de publication ajouté.

## Méthode et limites

Lecture des modules métier, routes, Server Actions, accès SQL, types, formulaires, transports, migrations et suites existantes. Guides de la version Next.js installée consultés avant les changements. PostgreSQL portable 17.11 écoute uniquement sur `127.0.0.1` ; bases et données fictives dédiées, deux reconstructions par suite. La baseline historique reste exclusivement locale.

Le scanner `scripts/audit-local-security.mjs` examine les fichiers admissibles à Git, les imports client/serveur et les gardes directes des Server Actions. Il ne lit pas les valeurs des fichiers d'environnement ignorés et n'imprime jamais de valeur détectée. Les heuristiques ne remplacent pas un audit cryptographique de tout l'historique Git ni un scanner de vulnérabilités des dépendances. Aucune absence absolue de vulnérabilité n'est revendiquée.

## Registre des constats

P0 : compromission immédiate. P1 : intégrité/sécurité ou fonctionnement important. P2 : robustesse/performance/maintenabilité. P3 : confort. **Aucun P0 démontré.** Quatre P1 identifiés, dont deux corrigés localement ; les deux autres nécessitent une évolution SQL ciblée, sans modification distante dans ce chantier.

| ID / priorité | Description et risque | Fichier/module | Recommandation / correction | Corrigé |
|---|---|---|---|---|
| P1-01 | Le helper d'audit pouvait être appelé sans garde propre ; ses appelants actuels étaient gardés, mais une réutilisation future aurait été dangereuse. | `lib/audit-logs.ts` | `requireAdmin()` avant accès privilégié, test d'accès refusé avant DB. | Oui |
| P1-02 | Les listes projets/tâches pouvaient être tronquées par la limite REST, faussant vue et contexte. | `lib/projects/data.ts`, `lib/tasks/data.ts`, `lib/supabase/pagination.ts` | Pagination de 100 lignes, ordre stable, refus des paramètres invalides et des erreurs de page ; fixture de 101 lignes. | Oui |
| P1-03 | Plusieurs anciens CRUD écrivent la mutation puis l'audit par deux requêtes ; créations clients/projets/tâches sans audit exhaustif. Échec du second appel : mutation déjà commise et retry ambigu. | `lib/clients/data.ts`, `lib/projects/data.ts`, `lib/tasks/data.ts`, autres CRUD historiques | RPC transactionnelles mutation+audit, acteur serveur et idempotence ; tests de panne du journal. Ne pas ajouter un faux correctif uniquement visuel. | Non |
| P1-04 | Création d'action : lecture des actions existantes avant INSERT sans unicité SQL correspondante. Deux requêtes concurrentes peuvent franchir le contrôle. | `lib/actions/data.ts`, table `actions` | Précontrôle agrégé des doublons existants, puis nouvelle migration avec unicité partielle recommendation/type pour actions non annulées ; création transactionnelle auditée et test à deux sessions. Aucun nettoyage historique automatique. | Non |
| P2-01 | Un agent désactivé/inactif ou partiellement chargé pouvait obtenir un contexte d'exécution via le helper commun. | `lib/agents/scope.ts` | Exiger `enabled=true` et `status='Actif'`, indépendamment des assignations. Fixture calendrier mise en cohérence, regression fail-closed. | Oui |
| P2-02 | Pagination Drive potentiellement infinie si token répété ou longues pages sans candidate utilisable. | `lib/integrations/publications-drive.ts` | Borne cinq pages et ensemble des tokens déjà vus ; tests des deux scénarios. | Oui |
| P2-03 | Certaines erreurs attribuaient toute panne à une migration absente. | `components/publications/planning-section.tsx`, `app/(cockpit)/publications/calendar/page.tsx` | Message d'indisponibilité neutre, conserver un état d'erreur distinct d'une liste vide. | Oui |
| P2-04 | IDs Clerk visibles dans reviews/révisions/journal. | `lib/publications/actor-label.ts`, `app/(cockpit)/publications/[id]/page.tsx` | Libellé humain « Administrateur », « Agent », « Système » ; IDs conservés dans la DB, test de rendu sans ID technique ni doublon. | Oui |
| P2-05 | Protection Git incomplète des variantes `.env` et configuration locale auxiliaire. Aucun secret versionnable détecté pendant l'audit. | `.gitignore` | Ignorer `.env*` sauf template `.env.example`, configuration locale Claude ; backups/runtime déjà ignorés. | Oui |
| P2-06 | File de validation : workspace complet par publication, lecture des liens de tout le client puis filtrage et signatures d'assets historiques. Coût croissant/N+1. | `app/(cockpit)/publications/review/page.tsx`, `lib/publications/workspace.ts` | Pagination UI et chargement groupé de la révision courante ; filtrer les liens par variantes en SQL. Mesurer nombre de requêtes et conservation des historiques avant remplacement. | Non |
| P2-07 | D'autres listes historiques et dashboard chargent trop de données ou restent soumis à la limite REST ; reporting filtre une partie des périodes en mémoire. | `lib/agents`, `lib/actions`, `lib/recommendations`, dashboard/reporting | Pagination/agrégats SQL ciblés, projections réduites, filtres temporels compatibles avec les dates historiques NULL. | Non |
| P2-08 | Orphelins privés possibles si upload réussi mais cleanup échoué ou issue SQL inconnue. | `lib/publications/agent-service.ts` | Outil de réconciliation en lecture puis suppression explicitement autorisée ; conserver les objets tant que le commit n'est pas déterminé. | Non |
| P2-09 | Defaults de permissions du créateur géré `supabase_admin` ne sont pas administrables par le rôle de migration habituel. | Migration `20261005000004_harden_historical_permissions.sql` | Créer les objets métier avec `postgres`, ACL explicites dans chaque migration ; revue fournisseur séparée si nouveau créateur. Aucun besoin de changer des grants distants ici. | Non |
| P2-10 | Transport réel, OAuth Drive, qualité éditoriale live et authentification navigateur non exercés par les mocks. | Intégrations, parcours admin | Campagne séparée et autorisée avec projet de test, budget plafonné et aucune publication externe. Ne pas présenter les tests simulés comme une validation live. | Non |
| P3-01 | Contexte métier dense et fichiers UI comprimés rendent la revue plus difficile. | Composants Publications, helpers historiques | Extraction ciblée lors d'un prochain changement fonctionnel, sans refactor esthétique global. | Non |
| P3-02 | États loading/error globaux et couverture E2E encore limités. | Routes cockpit et tests | Ajouter parcours navigateur admin/non-admin et récupération d'erreurs après définition d'un setup local Clerk. | Non |

## Contrôles par domaine

**Authentification** : politique admin fail-closed, proxy protégeant les routes métier et réponses sans cache pour les refus API, layout et helpers privilégiés gardés. Quarante Server Actions exportées ont une garde admin directe ; contrôle complémentaire des helpers et tests d'absence d'accès DB avant refus. Pas de clé Supabase privilégiée dans le graphe d'import des composants client. `server-only` protège les accès DB/credentials et transports.

**SQL** : RLS et refus réels anon/authenticated testés ; service_role seul accède au métier. Il contourne RLS par conception : l'autorisation applicative et les contraintes cross-client restent indispensables. RPC métier `SECURITY INVOKER`, search_path explicite, fonctions privées sans accès navigateur. Deux anciennes fonctions de trigger ont un search_path historique `public` ; conserver un schéma public sans création par les rôles navigateur et réexaminer si de nouveaux créateurs sont autorisés. FK composites publication/révision/projet/client et agent/assignations vérifiées. UPDATE/DELETE/TRUNCATE des journaux protégés par ACL et triggers ; le rôle propriétaire n'est pas confondu avec un rôle navigateur. Les suppressions de parents ayant un historique protégé échouent réellement. Index jobs/deliveries/events et nouveaux index de réservation/budget/media présents. Unicité/idempotence des RPC Publications démontrées ; faiblesse historique des actions documentée séparément.

**Agents** : propagation et validation de `project_id` pour runs/recommendations/actions/messages, double assignation requise en scope projet, scopes inconnus refusés. Les actions internes ont un type et des paramètres validés ; aucun exécuteur de texte libre/`eval` ou branchement Meta/GBP ajouté. Le budget Lot 4 est verrouillé globalement par agent, pas seulement par publication.

**Next.js/TypeScript** : paramètres asynchrones conformes à Next installé, routes privées dynamiques au build, accès DB sans cache partagé, Server Actions authentifiées indépendamment du formulaire. Pas de chargement du provider réel au build. Types des cinq tables/six RPC ajoutés ; valeurs nullable historiques prises en compte. Casts du SDK et réseau entourés de validations métier ; les mocks ne prouvent pas toutes les variantes d'erreur d'un fournisseur réel. Aucun changement de Clerk.

**UX** : états vides, indisponibilité, droits Drive requis, consentement IA, pending des boutons, refus avec motif et nouvelle révision testés. Un journal d'événement distinct de la décision demeure visible sans dupliquer la décision. Les anciennes reviews ne sont ni supprimées ni modifiées par un dédoublonnage visuel arbitraire.

## Validation locale finale

Commande principale :

```powershell
./scripts/test-publications-local.ps1 -PostgresBin './.local/runtime/pgsql-runtime/pgsql/bin'
```

Le runner crée un cluster neuf en loopback, sept bases de test isolées, exécute les deux reconstructions de chaque suite SQL, puis `npm run test:publications`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`. Les credentials des validations applicatives sont des placeholders locaux, sans modification de `.env`. Le cluster est arrêté en fin de runner.

| Suite SQL | Assertions par reconstruction | Reconstructions |
|---|---:|---:|
| Permissions historiques | 1 576 | 2 |
| Workspace/reviews Lot 2 | 55 | 2 |
| Calendrier Lot 3 | 82 | 2 |
| Agent Publications Lot 4 | 100 | 2 |
| Reproduction historique du schéma distant | 968 | 2 |
| Publications Lot 1 | 213 | 2 |
| Agent Project Scope | 350 | 2 |

Soit **6 688 assertions SQL** dans la passe dédiée, plus les scénarios de concurrence Lot 4. Les suites recouvrent certains contrôles : il s'agit d'exécutions réussies, pas de 6 688 cas distincts. `npm test` rejoue aussi ces intégrations lorsque les variables locales sont présentes.

Dernière passe complète réussie après tous les correctifs :

| Contrôle | Résultat |
|---|---|
| `npm run test:publications` | 18/18, aucun échec ni skip |
| `npm test` | 203/203, aucun échec ni skip, intégrations SQL locales incluses |
| Passe SQL dédiée | 6 688 assertions, sept suites reconstruites deux fois, concurrence supplémentaire réussie |
| `npm run lint` | Réussi |
| `npm run typecheck` | Réussi |
| `npm run build` | Réussi ; routes privées dynamiques, file de review compilée |
| `git diff --check` | Réussi ; avertissements de conversion LF/CRLF uniquement |
| Scan de sécurité local | 346 fichiers admissibles à Git, 165 modules applicatifs, 21 composants client, 40 Server Actions ; aucun secret détecté, aucune frontière serveur/client fautive détectée, aucune action sans garde directe, aucun fichier sensible suivi détecté |
| PostgreSQL | Cluster neuf `c62f7d3e9bcd4d11afa7f6c27539b16c`, exclusivement loopback, arrêté à la fin |

Les nouvelles protections de test couvrent notamment : autorisation manuelle IA, agent désactivé, scopes croisés, output structuré/anti-invention, modèle/tokens/coûts, metadata Drive et pagination répétée, SHA/non-réutilisation, dérivés réels Sharp, refus/régénération, idempotence, indisponibilité provider, erreur du journal et concurrence du budget. Les tests ajoutés pendant l'audit vérifient aussi le helper d'audit sans accès admin, les listes dépassant une page REST et le rendu sans ID Clerk.

### Fichiers et état Git

Branche `feature/publications`, aucun commit effectué. Huit fichiers déjà suivis modifiés ; nombreux répertoires/fichiers non suivis correspondant aussi aux lots précédents (`app/(cockpit)`, `components`, `lib`, `supabase`, `tests`, `docs`, `scripts` notamment). Le diff des seuls fichiers suivis ne représente donc pas le périmètre complet du Lot 4. Aucun état antérieur réinitialisé, aucun dump ajouté au suivi Git. `.env`, backups et runtime local demeurent ignorés.

Principaux fichiers créés pour le Lot 4 et cette clôture :

- Migration `20261005220029_publications_opportunity_agent.sql`, types `agent-types.ts` et modules `agent-context.ts`, `agent-service.ts`, `agent-data.ts` dans `lib/publications`.
- `lib/publications/opportunities/*`, `lib/publications/ai/*`, traitement des images et modules `lib/integrations/publications-openai.ts`, `lib/integrations/publications-drive.ts`.
- `components/publications/agent-section.tsx`, `agent-forms.tsx`, `app/(cockpit)/publications/agent-actions.ts`, `app/(cockpit)/publications/review/page.tsx`.
- `tests/publications-opportunities.test.mjs`, `tests/publications-agent-ui.test.mjs`, `tests/publications-agent-db.test.mjs`, `supabase/tests/publications-agent.sql`.
- Audit : ce document, `scripts/audit-local-security.mjs`, `lib/supabase/pagination.ts`, `lib/publications/actor-label.ts`. Helpers CRUD/scope/audit, messages UI, tests de régression et runner local adaptés.
- Dépendance Sharp directe `0.35.5` déclarée avec lockfile ; pas de téléchargement supplémentaire pendant cette reprise.

La migration Lot 4 doit encore être précontrôlée et appliquée sur le distant dans une opération explicitement autorisée ; les pages dépendant de ses objets ne sont pas certifiées fonctionnelles sur le distant avant cela.

## Feuille de route après cet audit

1. Traiter P1-03/P1-04 par migrations/RPC locales spécifiques, préserver les données et contrôler les doublons sans nettoyage automatique ; faire valider le replay et la concurrence avant toute demande d'application distante.
2. Préparer un déploiement Lot 4 explicitement autorisé, avec sauvegarde et prechecks, puis smoke tests admin/Drive/IA séparément autorisés. Ce chantier ne l'applique pas.
3. Réduire les lectures de la file de review et du dashboard avec mesures de requêtes et tests de non-régression historique ; prévoir réconciliation Storage privée et observabilité sans secrets.
4. Ajouter E2E d'authentification et une campagne de qualité métier, conserver toutes les limites d'autonomie et le kill switch.

Aucune modification distante, aucun appel OpenAI réel, aucune publication externe, aucun worker/cron, aucun changement de secret ni suppression de donnée métier pendant cette reprise. Aucun Lot 5 commencé.
