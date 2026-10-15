# Automatisations et planificateur

Chaîne complète : **AUTOMATISATION → JOB → EXÉCUTION (agent_run) → RÉSULTAT → JOURNAL (audit_logs)**.

## Modèle

| Table | Rôle |
| --- | --- |
| `automations` | Planification : type d’exécution (`run_type`), agent, client facultatif, fréquence (`once`, `daily`, `weekly`, `monthly`), horaire local, **fuseau IANA** (défaut `Europe/Paris`, validé en base contre `pg_timezone_names`), `next_run_at` en UTC, statut (`active`, `paused`, `error`, `completed`, `archived`). Jamais supprimée : archivée. |
| `jobs` | Une exécution à faire. `idempotency_key` unique, payload ≤ 16 Ko, tentatives, bail (`lease_expires_at`), `worker_id`. |
| `agent_runs` | Trace de l’exécution par l’agent, liée au job. |
| `audit_logs` | `job.enqueued`, `job.succeeded`, `job.failed`, `job.retry_scheduled`, `automation.*`. |

Types d’exécution (registre `lib/agents/registry.ts`) : `ads.report.prepare`, `ads.report.send`, `report.generate`, `monitoring.check_sites`, `seo.analyze`, `ads.monitor`, `news.fetch`. Tout autre type est refusé (automatisation passée en erreur, jamais exécutée).

## Garanties

- **Idempotence** : un job d’automatisation a pour clé `auto:<id>:<échéance>` ; un second passage, même concurrent, n’en crée pas d’autre. Les jobs manuels sont dédupliqués à la minute.
- **Mise en file atomique** : `codev_enqueue_automation` verrouille l’automatisation, compare son échéance, insère le job puis avance l’échéance dans une seule transaction. Une erreur SQL annule les deux écritures. Les anciennes clés de job équivalentes avec `+00:00` sont reconnues.
- **Pas de double exécution** : prise des jobs par `codev_claim_jobs` (`FOR UPDATE SKIP LOCKED`) avec bail de 5 minutes. Une demande manuelle utilise `codev_claim_job` pour réserver uniquement son propre job ; elle ne traite jamais un autre travail de la file, notamment un envoi.
- **Fencing** : le worker, le statut `running` et la validité du bail sont vérifiés avant le handler et à la clôture. Le succès de l’exécution agent n’est enregistré qu’après la clôture du job ; un bail expiré n’apparaît pas comme une réussite, même avant sa reprise par un autre worker.
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

### Protection contre les passages concurrents

La route du planificateur acquiert maintenant un verrou atomique dans `scheduler_heartbeats` avant d'exécuter les tâches, même si elle est déclenchée manuellement. Un second appel simultané renvoie `200` avec `skipped: running` et ne réexécute pas les jobs. Un passage interrompu est récupérable après 330 secondes ; la fin de l'ancien worker ne peut plus écraser le nouveau battement (fencing sur `started_at`). Si la base ne permet pas d'obtenir le verrou, la route renvoie `503 scheduler_lock_unavailable` et ne lance aucun job (seule la purge idempotente des archives temporaires WhatsApp reste autorisée).

**Ce changement ne crée pas de cron Vercel et n'active aucun envoi** : le déclenchement reste à configurer explicitement, avec le secret serveur et les garde-fous Publications existants. Tests isolés : `tests/scheduler-single-flight.test.mjs`.

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

**Paramètres → Automatisations** : supervision des états réels « jamais exécutée », « planifiée », « en cours », « réussie », « échouée », « ignorée », « annulée », « en retard » et « validation nécessaire ». La prochaine échéance et le statut de configuration restent distincts de la preuve du dernier job. `automations.last_run_at` date une mise en file et ne prouve pas une réussite.

Chaque automatisation ouvre `/settings/automations/[id]` : les 50 jobs les plus récents, leurs dates et tentatives, un lien stable vers chaque preuve et les rapports explicitement reliés par les identifiants du handler. Les statuts d’approbation sont relus sur la **version actuelle** du rapport, jamais déduits du texte d’un résumé. Les anciennes demandes manuelles non rattachées ne peuvent pas être attribuées rétroactivement et ne figurent pas dans cet historique. Un résultat absent ou illisible est signalé. Ni paramètres bruts ni erreurs fournisseur ne sont exposés. Cette page est en lecture seule, protégée par l’accès admin, et ne lit pas de données réelles pendant une simulation.

Une échéance ou un job en attente est signalé en retard après cinq minutes ; un bail expiré est signalé immédiatement. Cela n’installe ni ne valide une cadence de cron. Le lien vers le diagnostic permet de vérifier les battements enregistrés. Un job « réussi » ne signifie ni rapport approuvé ni e-mail livré.

Modèles recommandés, création, pause, reprise, archivage et **Exécuter maintenant** restent disponibles. La demande manuelle est dédupliquée et rattachée à son automatisation ; seul son job est traité immédiatement. L’agenda affiche les exécutions prévues.

### Migration locale et validation

`20261111000000_atomic_automation_enqueue.sql` ajoute les deux RPC de mise en file atomique et réservation ciblée, réservées à `service_role` (`security invoker`, `search_path` fixe). Elle n’active aucun cron ni envoi, ne supprime aucune donnée et n’a pas été appliquée à distance dans ce lot. Le nouveau moteur exige cette migration : il échoue explicitement si elle manque, sans repli vers l’ancienne mise en file non atomique ou la file globale.

Tests simulés : `tests/scheduler-engine.test.mjs`, `tests/automation-supervision.test.mjs` et les tests existants de passages concurrents/charge. Test PostgreSQL natif isolé : `tests/automation-operations-db.test.mjs`, qui reconstruit une base jetable de bouclage dédiée, injecte une vraie erreur SQL (absence de perte d’échéance), lance quatre transactions de mise en file puis quatre réservations concurrentes (un seul gagnant), vérifie qu’un envoi étranger reste intact et contrôle les grants. Ce test est ignoré si PostgreSQL natif n’est pas fourni ; il ne valide aucun fournisseur ni cron distant.

## Rapports Ads récurrents

La configuration par client met en file les préparations et échéances dans ce même moteur. Voir [ads-recurring-delivery.md](ads-recurring-delivery.md) pour les périodes closes, l’approbation, les réservations et la cadence minute nécessaire aux horaires choisis. Le cron quotidien Hobby ne garantit pas 18 h. Aucun déclencheur réel n’est activé par le code.
