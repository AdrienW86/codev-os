# Planificateur : cron Vercel chaque minute

Le planificateur unique de CODE-V OS est la route `/api/internal/scheduler/tick` (moteur `lib/scheduler/engine.ts` et
étapes Publications, WhatsApp, Search Console, photothèque, push). Ce document décrit son déclenchement par Vercel Cron,
ses garanties et la procédure d'activation. Aucun autre déclencheur n'existe ni ne doit être ajouté.

## Ce que fait le dépôt

- `vercel.json` déclare **un seul** cron : `* * * * *` (chaque minute) sur `/api/internal/scheduler/tick`.
  Vercel Pro accepte une cadence minimale d'une minute, précise à la minute ; Hobby refuse au déploiement toute
  expression plus fréquente qu'une fois par jour. Les crons ne tournent que sur le déploiement de **production**.
- Vercel appelle la route en `GET` avec `Authorization: Bearer <CRON_SECRET>` quand la variable existe dans le projet.
  La route compare le secret à temps constant (`lib/scheduler/cron-auth.ts`) :
  - `CRON_SECRET` absent ou de moins de 16 caractères → `503 scheduler_not_configured`, rien n'est exécuté ni lu ;
  - en-tête absent ou faux → `401 unauthorized`, rien n'est exécuté ni lu.
  Le secret n'est jamais renvoyé, journalisé ni écrit dans le battement ; il n'existe que côté serveur (aucune variable
  `NEXT_PUBLIC_`). `proxy.ts` exempte de session Clerk uniquement cette route, qui s'authentifie elle-même.
- **Un seul passage à la fois.** Vercel ne réessaie pas un cron en échec, peut livrer un même déclenchement deux fois
  et lance le suivant même si le précédent tourne encore (un passage peut durer jusqu'à `maxDuration` = 300 s). Le
  verrou est porté par la ligne `scheduler_tick` de `public.scheduler_heartbeats` (aucune migration) :
  compare-and-set atomique, la ligne n'est prise que si le passage précédent est terminé ou a dépassé son bail
  (`SCHEDULER_LEASE_MS` = 330 s, au-delà de la coupure plateforme). Un déclenchement qui arrive pendant un passage
  répond `200 { ok: true, skipped: "running" }` sans rien exécuter ni écrire.
- **Reprise après interruption** : un passage coupé (timeout, crash, redéploiement) laisse `finished_at` vide ; le premier
  déclenchement après le bail reprend la main (journal « Passage précédent interrompu : reprise. »). Les jobs du moteur
  ont leur propre bail et fencing ; un passage interrompu qui se réveille ne peut écrire ni sa fin ni ses résultats
  (fin conditionnée à son `started_at`).
- **Verrou illisible** (base indisponible) : `503 scheduler_lock_unavailable`, aucune étape ne tourne sans verrou, sauf
  la purge des exports WhatsApp (conservation de 24 h, idempotente). Le déclenchement suivant réessaie une minute après.
- **Battement à chaque passage** : début (`finished_at` vide, « passage en cours ») puis fin avec l'état de chaque étape
  (`ok`, `failed`, `skipped` faute de temps, `disabled` par son interrupteur) et des compteurs entiers seulement.
  Étapes « désactivées » reconnues : préparation et envoi des diffusions (`PUBLICATIONS_SCHEDULED_DELIVERY` ≠ `enabled`
  ou arrêt d'urgence), préparation automatique (arrêt d'urgence, automatisation ou génération coupées), push (VAPID
  absent), import WhatsApp (`WHATSAPP_INGESTION_ENABLED` ≠ `true`), Search Console (aucune connexion Google).
- **Diagnostic** (`/settings/diagnostic`) : le planificateur est « opérationnel » seulement avec un passage terminé
  depuis moins de 2 h (`SCHEDULER_FRESH_MS`) ; au-delà, « en erreur : Aucun passage depuis … ».

## Ce que le cron ne contourne jamais

Le cron n'appelle que les points d'entrée déjà gardés, avec l'environnement réel :

| Étape | Garde vérifiée à chaque passage |
| --- | --- |
| `publication_delivery_prepare` | `PUBLICATIONS_SCHEDULED_DELIVERY` = `enabled` exactement, `emergency_stop = false`, `publishing_enabled = true`, publication approuvée par l'administrateur autorisé |
| `publication_delivery_send` | même drapeau ; le moteur de diffusion revérifie chaque interrupteur et la préparation |
| `publication_preparation` | `emergency_stop = false`, `automation_enabled`, `generation_enabled` ; brouillons soumis « À valider », jamais approuvés |

Tant que l'arrêt d'urgence est actif et `PUBLICATIONS_SCHEDULED_DELIVERY` absent, activer le cron ne publie rien :
ces trois étapes apparaissent « désactivé ». Tests : `tests/scheduler-cron.test.mjs`,
`tests/publications-scheduled-flow.test.mjs`, `tests/publications-scheduled-flow-recovery.test.mjs`.

## Procédure d'activation (manuelle)

Prérequis : projet Vercel sur le plan **Pro** (sur Hobby, le déploiement de `vercel.json` échouerait).

1. **Créer le secret** hors de toute conversation : 32 caractères aléatoires ou plus, par exemple
   `openssl rand -hex 32` ou le générateur d'un gestionnaire de mots de passe.
2. **Vercel → projet codev-os → Settings → Environment Variables → Add** :
   nom `CRON_SECRET`, valeur = le secret, environnement **Production** uniquement, option **Sensitive** cochée.
3. **Fusionner la PR** qui ajoute `vercel.json` (déploiement de production automatique). Si la variable a été ajoutée
   après ce déploiement : **Deployments → dernier déploiement Production → Redeploy** (une variable ne s'applique
   qu'aux nouveaux déploiements).
4. **Vercel → Settings → Cron Jobs** : vérifier la ligne `/api/internal/scheduler/tick` · `* * * * *` et que les crons
   sont activés. Le bouton **Run** déclenche un passage immédiat.
5. **Preuve dans le diagnostic** (`/settings/diagnostic`, une à deux minutes plus tard) :
   - « Planificateur (cron) » : **opérationnel**, « Dernier passage réussi » daté de moins de 2 minutes ;
   - « Purge des exports WhatsApp », « Automatisations (jobs) », « Classement de la photothèque » : **opérationnel** ;
   - « Préparation des diffusions », « Envoi des publications dues », « Préparation automatique des publications » :
     **désactivé** (attendu tant que l'arrêt d'urgence est actif) ;
   - « Notifications push », « Synchro Search Console », « Import WhatsApp → Drive » : **désactivé** si non configurés.
   Rafraîchir après une minute : la date du dernier passage avance.
6. **Journaux** : Vercel → **Logs**, filtre sur `/api/internal/scheduler/tick` : un `200` par minute. Un
   `200 skipped: running` ponctuel est normal (passage long). `503 scheduler_not_configured` = variable absente ou
   déploiement antérieur à la variable ; `401` = secret différent ; `503 scheduler_lock_unavailable` = base injoignable.

Retour arrière immédiat, sans déploiement : **Settings → Cron Jobs → Disable Cron Jobs**. Supprimer `CRON_SECRET`
(puis redéployer) rend aussi chaque appel inopérant (`503`).

Coût : environ 43 200 invocations par mois, de quelques secondes chacune quand il n'y a rien à faire.
