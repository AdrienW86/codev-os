# Installation et mise en service — CODE-V OS V1

Ce guide part d’un poste vierge et va jusqu’à une instance de production. Rien ici ne demande de coller un secret dans le navigateur : **toutes les clés sont des variables d’environnement serveur** (Vercel → Project → Settings → Environment Variables, ou `.env.local` en développement, jamais commité).

## 1. Prérequis

- Node.js 22+ et npm.
- Un projet Supabase (Postgres 15+), un compte Clerk, un projet Vercel.
- Facultatif : PostgreSQL 16 local pour les tests SQL (`CODEV_CORE_TEST_DATABASE_URL`).

## 2. Variables d’environnement

La liste complète des **noms** est dans [`.env.example`](../.env.example) (aucune valeur). Variables publiques à ajouter en plus, qui ne sont **pas** des secrets :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL publique du projet Supabase (`https://<ref>.supabase.co`). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clé publiable Clerk (`pk_…`). |

<a id="clerk"></a>
### Clerk

1. Créez une application Clerk (connexion e-mail ou Google).
2. `CLERK_SECRET_KEY` = clé secrète `sk_…` (serveur uniquement).
3. Connectez-vous une fois, récupérez votre identifiant `user_…` dans le tableau de bord Clerk, puis renseignez `AUTHORIZED_ADMIN_USER_ID`. Tout autre compte reçoit un 403/404 : le cockpit n’a qu’un administrateur.

<a id="supabase"></a>
### Supabase

1. `SUPABASE_SECRET_KEY` = clé secrète `sb_secret_…` (jamais exposée au navigateur ; toutes les lectures passent par le serveur).
2. RLS est activé sur toutes les tables, sans aucun droit pour `anon` / `authenticated`.

## 3. Migrations (ordre exact)

Les migrations sont **append-only** : aucune réinitialisation, aucun `drop` destructif. Appliquez-les dans l’ordre des noms de fichiers de `supabase/migrations/`.

État constaté du projet distant au moment de ce lot : 24 migrations appliquées, **deux restent à appliquer, dans cet ordre** :

1. `20261014000000_publications_account_client_exclusivity.sql`
2. `20261015000000_codev_os_core.sql` — noyau V1 : registre d’agents, services ↔ agents, actions à empreinte figée, automatisations, jobs, rapports, agenda, incidents, contrôles de sites, métriques, veille, connexions globales.

Procédure recommandée :

```bash
# 1. Sauvegarde (voir docs/supabase-manual-backup.md)
# 2. Vérification préalable sur une copie locale
CODEV_CORE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/codev_core_test node --test tests/codev-core-db.test.mjs
# 3. Application
supabase db push            # ou : psql "$DATABASE_URL" -f supabase/migrations/<fichier>.sql, dans l’ordre
```

Après application, vérifiez :

```sql
select agent_type, name, status, enabled from public.agents where agent_type is not null order by agent_type;
select count(*) from public.automations;      -- table présente
select proname from pg_proc where proname = 'codev_claim_jobs';
```

Tant que la migration du noyau n’est pas appliquée, les pages concernées (Rapports, Automatisations, Agenda, Observabilité, sources client) affichent un état « données indisponibles » explicite au lieu d’échouer.

## 4. Premier démarrage

```bash
npm ci
npm run dev          # http://localhost:3000
npm test             # tests unitaires, intégration, sécurité et chaos
npm run lint && npm run typecheck
```

Puis dans l’application :

1. **Paramètres → Connexions** : l’état du système indique ✓ / ○ / ! pour chaque fournisseur, avec les noms de variables manquantes (jamais de valeur).
2. **Paramètres → Automatisations** : créez les automatisations recommandées (rapports hebdomadaires, contrôle des sites, veille).
3. **Fiche client → Agents** : renseignez les sources (propriété Search Console, projet Vercel, dépôt GitHub, identifiant Google Ads).

## 5. Planificateur

Voir [automation.md](automation.md). En bref : `CRON_SECRET` (32+ caractères aléatoires), puis un cron Vercel vers `/api/internal/scheduler/tick`. **Le cron n’est pas activé par ce lot** : l’exemple `vercel.json` est documenté, à ajouter volontairement.

## 6. Vérifications de sécurité avant mise en production

- `AUTHORIZED_ADMIN_USER_ID` renseigné ; aucun autre compte n’accède au cockpit.
- `EMAIL_SENDING_ENABLED` absent ou différent de `true` tant que le domaine d’envoi n’est pas vérifié.
- Les agents SEO, Ads, Monitoring et Automatisation sont **en pause** par défaut ; activez-les un par un depuis /agents.
- Aucune variable `NEXT_PUBLIC_*` ne contient de secret (test automatisé).
