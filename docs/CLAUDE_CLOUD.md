# Claude Code Cloud : configuration de codev-os

## Projet
Next.js 16.3.8, React 19.2.8, TypeScript (strict), Tailwind 4, ESLint 9. Gestionnaire : npm (package-lock.json v3). Node 22 (voir `.nvmrc`).
Pas de tests, pas de Supabase, pas de Vercel, aucune variable d'environnement requise à ce jour.

## Commandes
- Installation : `npm ci` (lancée automatiquement par `scripts/cloud-setup.sh` au démarrage d'une session cloud)
- Dev : `npm run dev`
- Lint : `npm run lint`
- Typecheck : `npm run typecheck`
- Build : `npm run build`

## Domaines réseau à autoriser dans l'environnement Claude Cloud
| Domaine | Raison |
|---|---|
| `registry.npmjs.org` | installation des dépendances (`npm ci`) |
| `github.com` | clone, fetch, push |
| `api.github.com` | Pull Requests, API GitHub |
| `fonts.googleapis.com` et `fonts.gstatic.com` | `next/font/google` (Geist) est téléchargé pendant `next build` |
| `telemetry.nextjs.org` (optionnel) | télémétrie Next.js ; peut être coupée avec `NEXT_TELEMETRY_DISABLED=1` |

## Secrets
Aucun secret n'est nécessaire pour le moment. Quand un service externe sera ajouté, déclarer ses variables dans `.env.example` (noms seulement) et renseigner les valeurs dans les variables d'environnement de l'environnement Claude Cloud, jamais dans le dépôt.

## Garde-fous
Pas de migration Supabase distante, pas de déploiement de production, pas de merge direct sur `master`.
