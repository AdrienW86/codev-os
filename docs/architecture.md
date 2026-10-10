# Architecture — CODE-V OS V1

## Couches

```
app/ (pages, Server Actions, routes)      ← point d'entrée : requireAdmin(), validation, simulation refusée
  └─ lib/<domaine>/service.ts             ← règles métier, acteur explicite, audit
       ├─ lib/permissions/engine.ts       ← pur : sait / a le droit / autonomie
       ├─ lib/agents/registry.ts          ← pur : agents, capacités, types d'exécution, fournisseurs
       ├─ lib/actions/registry.ts         ← pur : types d'actions, schémas zod, mode d'exécution
       ├─ lib/scheduler/*                 ← récurrence (pure), moteur de jobs
       ├─ lib/runs/handlers.ts            ← un handler par type d'exécution (imports paresseux)
       └─ lib/providers/*                 ← adaptateurs fournisseurs (HTTP borné, erreurs normalisées)
supabase/migrations/                      ← schéma append-only, RLS partout, triggers de garde
```

Principes :

- **Acteur explicite** (`lib/core/actor.ts`) : `admin` (session Clerk vérifiée), `assistant` (au nom de l’admin), `system` (planificateur authentifié par `CRON_SECRET`). L’autorisation se fait au point d’entrée ; les services reçoivent l’acteur et l’inscrivent au journal.
- **Pilotage par registres** : agents, capacités, types d’exécution, types d’actions, outils de l’assistant, fournisseurs. Les branchements par nom d’agent sont proscrits.
- **Pur d’abord** : tout ce qui décide (permissions, récurrence, rapports, anomalies Ads, analyse SEO, évaluation des contrôles, classement de la veille, intentions de l’assistant, état du système) est une fonction pure, testée sans base ni réseau.
- **Dégradation explicite** : un module non migré ou un fournisseur absent affiche un état clair (« données indisponibles », ✓ / ○ / !) au lieu d’une erreur.

## Sécurité

| Menace | Contre-mesure |
| --- | --- |
| Accès non autorisé | `proxy.ts` (Clerk) + `await requireAdmin()` dans chaque page, Server Action et route. Une seule exemption : `/api/internal/scheduler/tick`, protégée par `CRON_SECRET` (temps constant). |
| Confiance côté client | Validation serveur systématique (zod strict, `.strict()` : clés inconnues refusées). Aucune donnée du navigateur n’est réutilisée sans revalidation (ex. confirmation de l’assistant). |
| CSRF | Server Actions (protégées par Next) ; routes JSON : `Origin` identique exigé + `Sec-Fetch-Site: same-origin`, `Content-Type` imposé. |
| SSRF | `lib/providers/net-policy.ts` + `safe-http.ts` : https (http seulement pour les contrôles de sites), ports 80/443, pas d’identifiants dans l’URL, adresses privées / locales / lien local / métadonnées / IPv4 encapsulée (y compris `::ffff:7f00:1`) / 6to4 / NAT64 refusées, **vérification au moment de la connexion** (anti-rebinding DNS), redirections suivies manuellement et revérifiées, taille et durée bornées. API fournisseurs : liste blanche d’hôtes, `redirect: "error"`. |
| Open redirect | Aucune redirection construite à partir d’une entrée ; liens de l’assistant filtrés (`/…` interne ou `https://`). |
| Injections | Requêtes paramétrées (PostgREST) ; motifs `ilike` échappés ; identifiants de sources au format strict ; prompt système de l’assistant : les résultats d’outils sont des données. |
| Traversée de chemin | Aucun accès fichier ; identifiants (dépôt GitHub, projet Vercel) refusés s’ils contiennent `..` ou des segments en trop. |
| Rejeu / double exécution | Clés d’idempotence, mises à jour conditionnelles, `SKIP LOCKED`, bail + fencing, empreinte figée des actions. |
| Charge excessive | Corps JSON ≤ 16 Ko, audio ≤ 4 Mo, payload de job ≤ 16 Ko, limitation de débit par administrateur. |
| Secrets | Variables serveur uniquement ; état du système = présence seulement (noms de variables, jamais de valeur) ; journal d’audit expurgé (`redact`) ; aucune clé dans les métadonnées de connexion. |
| Agents | Pas de shell, pas de système de fichiers, pas d’URL arbitraire, pas d’identifiants bruts ; effets externes toujours validés par un humain. |

## Simulation

Le cookie `codev-simulation` active un scénario ; le monde simulé vit dans le `sessionStorage`. Les pages basculent vers les vues simulées après `requireAdmin`. Toute mutation réelle passe par `requireAdminWriter()` qui **refuse** l’écriture tant qu’un scénario est actif ; l’assistant ne lit pas de données réelles en simulation.

<a id="assistant"></a>
## Assistant

```
navigateur ──POST /api/assistant──▶ requireAdmin · même origine · taille · débit · zod
                                     │
                                     ├─ fournisseur IA configuré ? ─ oui ─▶ AIProvider (OpenAI | Anthropic)
                                     │                                      ↕ outils (≤ 3 tours)
                                     └─ non / panne ─▶ analyseur d'intentions déterministe
outil de LECTURE  → exécuté → réponse
outil d'ÉCRITURE  → PROPOSITION → l'administrateur clique « Confirmer » → nouvelle requête {confirm}
                  → revalidation complète → permissions → exécution → audit
```

- `lib/ai/providers.ts` : adaptateurs sans SDK, `AI_PROVIDER` pour choisir, repli automatique sur l’autre clé.
- `lib/assistant/tools.ts` : registre (zod → JSON Schema) ; `executor.ts` : exécution, résolution de client sans ambiguïté, moteur de permissions.
- Le modèle ne peut jamais confirmer une écriture : la confirmation est une requête distincte déclenchée par un clic.
- Voix : `components/assistant/use-voice.ts` (MediaRecorder → `/api/assistant/transcribe`, repli Web Speech, `speechSynthesis`). L’audio n’est ni stocké ni journalisé.

## Données principales (migration `20261015000000_codev_os_core.sql`)

`automations`, `jobs` (+ `codev_claim_jobs`), `reports` + `report_versions` (append-only), `agenda_items`, `incidents`, `site_checks`, `metric_snapshots`, `news_items`, colonnes ajoutées à `agents`, `agent_client_assignments`, `client_services`, `actions`, `tasks`, `client_connections`. Triggers de garde : empreinte des actions, transitions des rapports (contenu figé après envoi), fuseaux IANA valides, interdiction de supprimer l’historique.
