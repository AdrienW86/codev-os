# Automatisations et planificateur

Chaîne complète : **AUTOMATISATION → JOB → EXÉCUTION (agent_run) → RÉSULTAT → JOURNAL (audit_logs)**.

## Modèle

| Table | Rôle |
| --- | --- |
| `automations` | Planification : type d’exécution (`run_type`), agent, client facultatif, fréquence (`once`, `daily`, `weekly`, `monthly`), horaire local, **fuseau IANA** (défaut `Europe/Paris`, validé en base contre `pg_timezone_names`), `next_run_at` en UTC, statut (`active`, `paused`, `error`, `completed`, `archived`). Jamais supprimée : archivée. |
| `jobs` | Une exécution à faire. `idempotency_key` unique, payload ≤ 16 Ko, tentatives, bail (`lease_expires_at`), `worker_id`. |
| `agent_runs` | Trace de l’exécution par l’agent, liée au job. |
| `audit_logs` | `job.enqueued`, `job.succeeded`, `job.failed`, `job.retry_scheduled`, `automation.*`. |

Types d’exécution (registre `lib/agents/registry.ts`) : `report.generate`, `monitoring.check_sites`, `seo.analyze`, `ads.monitor`, `news.fetch`. Tout autre type est refusé (automatisation passée en erreur, jamais exécutée).

## Garanties

- **Idempotence** : un job d’automatisation a pour clé `auto:<id>:<échéance>` ; un second passage, même concurrent, n’en crée pas d’autre. Les jobs manuels sont dédupliqués à la minute.
- **Pas de double exécution** : réservation de l’échéance par mise à jour conditionnelle (`where next_run_at = <ancienne valeur>`), puis prise des jobs par `codev_claim_jobs` (`FOR UPDATE SKIP LOCKED`) avec bail de 5 minutes.
- **Fencing** : le résultat d’un worker n’est enregistré que s’il détient encore le job (`worker_id`) ; un worker dont le bail a expiré ne peut pas écraser le travail d’un autre.
- **Rattrapage borné** : des échéances manquées (cron arrêté) donnent **une** exécution, pas une rafale.
- **Délai** : 60 s par exécution ; au-delà, échec réessayable.
- **Reprises** : backoff exponentiel (2, 4, 8… minutes, max 60) pour les erreurs réessayables (quota, délai, indisponibilité) ; échec immédiat sinon. Trois échecs consécutifs passent l’automatisation en `error`.
- **Heure d’été** : l’heure murale est respectée ; une heure inexistante (saut de printemps) est décalée après le saut, une heure ambiguë prend la première occurrence.
- **Permissions** : avant chaque exécution, le moteur de permissions vérifie l’agent (activé, capacité déclarée) et les connexions ; sinon le job est **ignoré** avec la raison, sans échec.
- **Simulation** : le planificateur n’utilise jamais la simulation (cookie navigateur) ; les écritures déclenchées depuis l’interface sont refusées tant qu’un scénario est actif.

## Déclencheur : `/api/internal/scheduler/tick`

- Seule route exemptée de session Clerk ; elle exige `Authorization: Bearer <CRON_SECRET>` (comparaison à temps constant, secret ≥ 16 caractères, recommandé 32+).
- `503` si `CRON_SECRET` est absent, `401` si l’en-tête est faux.
- Chaque passage : rattache les agents globaux, met en file les automatisations échues, traite jusqu’à 5 jobs.

### Activer Vercel Cron (manuel, non activé par ce lot)

1. Ajoutez `CRON_SECRET` dans les variables Vercel (Production). Vercel l’envoie automatiquement en `Authorization: Bearer …` aux crons.
2. Ajoutez à la racine un `vercel.json` :

```json
{
  "crons": [
    { "path": "/api/internal/scheduler/tick", "schedule": "*/15 * * * *" }
  ]
}
```

3. Plan Hobby : un cron ne peut s’exécuter qu’une fois par jour ; utilisez `"0 6 * * *"` (06:00 UTC) ou passez au plan Pro pour une cadence de 15 minutes.
4. Vérifiez dans **Paramètres → Observabilité** que « Dernier job planifié » se met à jour.

Test manuel :

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domaine>/api/internal/scheduler/tick
```

## Interface

**Paramètres → Automatisations** : liste (prochaine / dernière exécution, échecs), modèles recommandés en un clic, création (fréquence, heure de Paris, jours, client), pause, reprise, archivage, **Exécuter maintenant** (job manuel traité immédiatement, résultat affiché). L’agenda affiche les exécutions prévues.
