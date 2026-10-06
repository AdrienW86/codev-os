# CODE-V OS

Cockpit interne CODE-V : Next.js App Router, TypeScript strict et Tailwind CSS 4. Clerk contrôle l’accès ; Supabase est utilisé uniquement côté serveur pour les données métier. Aucune dépendance UI ajoutée.

## Démarrage

```sh
npm install
npm run dev
```

L’accueil `/` redirige vers `/dashboard`. Routes disponibles : `/dashboard`, `/clients`, `/projects`, `/tasks`, `/agents`, `/recommendations`, `/actions` et `/settings`, avec routes de création/édition dédiées.

## Structure

- `app/(cockpit)/` : pages serveur et layout partagé du cockpit.
- `components/layout/` : sidebar persistante, navigation mobile et header avec profil et déconnexion Clerk.
- `components/ui/` : icônes SVG, badges, panneaux et titres réutilisables.
- `components/agents/` : carte d’agent.
- `components/work/` : cartes de projets et tâches partagées entre listes globales et dossiers clients.
- `lib/client-demo-data.ts` : exemples de statuts de connexion, explicitement signalés comme démo.
- `lib/format-date.ts` : affichage français des jours ISO, indépendant du fuseau de la machine.
- `lib/supabase/server.ts` : client Supabase sans session navigateur, marqué `server-only`.
- `lib/clients/`, `lib/projects/`, `lib/tasks/`, `lib/agents/` : validations et opérations serveur protégées.
- `lib/client-services/` : CRUD des services rattachés aux clients.
- `lib/recommendations/`, `lib/agent-runs/`, `lib/agent-messages/`, `lib/actions/` : noyau agentique interne, sans appel modèle ni service externe.
- `lib/audit-logs.ts` : insertion append-only des événements métier dans `public.audit_logs`.
- `components/clients/` : informations réelles, formulaire et aperçu fictif indépendant.
- `app/globals.css` : Tailwind, couleurs du thème sombre et focus clavier.

Les polices système évitent tout téléchargement à la compilation. Le menu mobile utilise un élément natif `details`, se ferme à la navigation et avec Échap. Les tableaux défilent horizontalement sur petits écrans.

## Vérifications

```sh
npm run lint
npm run typecheck
npm run build
npm run test:security
npm run test:clients
node --test tests/*.test.mjs
```

Le typecheck génère les types de routes Next.js avant de lancer TypeScript.

## Périmètre et prochaines étapes

Clients, projets, tâches, agents, assignations, recommandations, runs, messages et actions sont stockés dans Supabase. Les actions restent internes et aucun modèle IA n’est appelé. Le connecteur Google Ads utilise OAuth serveur et REST en lecture seule, après configuration manuelle : [guide et checkpoint Google Cloud](docs/google-ads-read-only.md).

Les listes Projects et Tasks sont lues depuis Supabase et utilisent les UUID clients réels. Les fiches Clients sont chargées à la requête ; un UUID absent ou invalide renvoie une 404.

Chaque fiche client affiche services, projets, tâches, agents assignés, recommandations, runs, actions et un journal synthétique des audits. Google Ads possède une section réelle avec configuration, test de connexion et résumé de performances. Les autres connexions restent signalées comme démo.

## Clients persistants dans Supabase

Définir `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SECRET_KEY` dans `.env.local` à la racine, à côté de `package.json`, ou dans les variables serveur de l’hébergeur. Ne pas transmettre ni committer leurs valeurs. Garder `AUTHORIZED_ADMIN_USER_ID` et les variables Clerk déjà configurées. Redémarrer le serveur après configuration.

Les accès Clients, Projects, Tasks, Agents et agentiques utilisent le client admin server-only et `requireAdmin()`. Les migrations Publications et portées projet sont versionnées dans `supabase/migrations` ; aucun client Supabase navigateur ni policy permissive n’est ajouté. Les formulaires create/update valident côté serveur ; les suppressions respectent les FK existantes et demandent confirmation. Les updates/deletes ajoutent un audit avec l’acteur Clerk.

Validation explicite : trim, nom obligatoire, longueurs maximales, email si renseigné, URL HTTP(S) complète sans identifiants intégrés. Les champs absents ou vides deviennent `null`. Les valeurs invalides sont signalées par champ, les erreurs de stockage restent génériques et les valeurs de formulaire sont conservées après échec. Les logs ne contiennent que le domaine et le type d’opération.

Limites : les tests simulent Supabase et Google ; les accès réels restent à valider manuellement. Les insertions métier et audit sont deux requêtes distinctes : un audit peut échouer après mutation, sans rollback ni rejeu automatique. Les runs de test et `internal.test` restent simulés. Les analyses Google Ads lisent les comptes associés via la table existante `client_connections`, sans persistance des métriques. Documentation : [clés Supabase](https://supabase.com/docs/guides/getting-started/api-keys), [Google Ads](docs/google-ads-read-only.md).

## Accès privé : administrateur unique

Ajouter `AUTHORIZED_ADMIN_USER_ID` dans le fichier `.env.local` à la racine du projet, à côté de `package.json`, avec l’identifiant Clerk du compte administrateur existant. Aucun préfixe `NEXT_PUBLIC_`. Ne pas committer ce fichier. Redémarrer le serveur après toute modification. Sur l’hébergeur, définir la même variable dans les variables d’environnement serveur puis redéployer.

Le proxy refuse par défaut toutes les routes applicatives hors `/sign-in` et des endpoints techniques Clerk ; il exclut seulement les ressources internes Next.js et le favicon. Les visiteurs non connectés sont redirigés vers `/sign-in` (401 pour API et mutations). Les comptes connectés non autorisés reçoivent un 403. Une variable absente ou vide refuse également l’accès.

`lib/require-admin.ts` fournit `requireAdmin()`, utilisé dans le layout, les pages serveur, les services métier et les Server Actions. Il revérifie la session et l’identité côté serveur : redirection si non connecté, interruption 404 sinon si non autorisé. Toute nouvelle Server Action ou Route Handler doit garder le même contrôle avant lecture ou mutation et ne pas intercepter les interruptions d’authentification.

La page `/sign-up` est supprimée et le proxy redirige aussi ses sous-chemins vers `/sign-in`. `SignIn` désactive le lien d’inscription. Le mode Clerk `restricted` a été appliqué à l’instance de développement de CODE-V OS via `clerk-private.config.json` : seules les inscriptions sur invitation restent possibles côté Clerk, sans jamais contourner le contrôle d’admin du cockpit. Ne pas émettre d’invitation pour cette application à admin unique.

Les tests de sécurité exécutent le proxy et le helper avec des sessions Clerk simulées : anonyme, autre compte, admin, configuration absente/vide et signup. Ils ne remplacent pas des tests de connexion réelle dans un navigateur. La production Clerk n’est pas configurée : lors de sa création, appliquer également le mode restreint et renseigner l’identifiant de l’admin de cette instance dans l’environnement serveur. La directive robots évite l’indexation mais ne contrôle pas l’accès.

## Portées métier et Publications

Lot 2 Publications manuel : liste filtrable, création, fiche, révisions, validation humaine et images privées. Rapport à jour et résultats de tests : [Lot 2](docs/publications-lot-2.md). Les migrations 00000–00005 sont installées sur `codev-os`, le kill switch reste actif. Les rapports de validation locale ci-dessous décrivent les étapes historiques précédant cette installation.

Les agents distinguent les portées client et projet. Les spécialistes utilisent des autorisations projet, les généralistes disposent du contexte mensuel déterministe. Fiche projet : `/projects/[id]` ; synthèse : `/clients/[id]/summary?period=2026-09`.

Les publications sont rattachables aux projets Social/GBP, avec révision et nouvelle validation lors d’un changement. Arrêt général actif et publication désactivée par défaut. Aucune intégration supplémentaire ni email automatique.

Architecture, reprises manuelles et limites : [portées agents](docs/agent-scope-architecture.md), [Publications](docs/publications-architecture.md). Les quatre migrations ont été validées sur PostgreSQL portable local avec deux reconstructions complètes ; aucun service distant modifié. Méthode, baseline et résultats : [validation locale](docs/publications-local-validation.md). Sans base dédiée, `npm test` ignore les intégrations SQL ; la commande stricte `test:publications:db` échoue.

Validation complémentaire sur une reproduction fidèle du schéma distant, avec permissions historiques conservées : [rapport de reproduction](docs/supabase-remote-replay-validation.md). `npm run test:remote-schema:db` exige une base PostgreSQL locale dédiée ; aucun accès distant n'est effectué par les runners SQL. Les fixtures historiques locales ne doivent jamais être poussées vers Supabase.

Migration 00004 de durcissement validée localement : [permissions historiques](docs/historical-permissions-hardening.md). Deux reconstructions à cinq migrations, aucun accès métier anon/authenticated, TRUNCATE backend révoqué, historique conservé. Les defaults du rôle géré supabase_admin restent une exception documentée ; aucune modification distante appliquée.
