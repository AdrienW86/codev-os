# Supervision mobile des publications et diagnostic de production (#45)

Suite du lot 7 (`docs/publications-supervision.md`). Rien n'est reconstruit : la page de supervision existante devient un **hub mobile**, et le diagnostic technique classe chaque mécanisme avec sa preuve. **Aucune migration**, aucune nouvelle variable d'environnement, aucune nouvelle action serveur qui publie.

## 1. Supervision pilotable depuis un téléphone (lot 7)

Page unique : **`/publications/supervision`**, réservée à l'administrateur.

### Navigation

- Onglets compacts **collants** en haut de l'écran : Synthèse, À valider, Erreurs, Programmées, Comptes, Photos, Agent. Chaque onglet porte une pastille (à valider, erreurs, programmées, comptes à reconnecter, clients à court de photos, tâches de l'agent).
- La rangée d'onglets défile horizontalement si besoin ; la page, elle, ne défile jamais horizontalement à 375 px (vérifié dans Chromium).
- **Filtre client** : formulaire GET, sans JavaScript. Le lien obtenu se partage. Les onglets conservent le client choisi.

### Paramètres d'URL (lien profond, utilisable par l'assistant)

| Paramètre | Valeurs | Défaut |
| --- | --- | --- |
| `view` | `overview`, `review`, `errors`, `scheduled`, `accounts`, `photos`, `agent` | `overview` |
| `client` | identifiant (uuid) d'un client présent dans la supervision ou dans la file de validation | tous les clients |

Une valeur inconnue ou invalide est ignorée : retour à la synthèse et à tous les clients. Exemple :

```
/publications/supervision?view=review&client=<id>
```

Ce lien ouvre les publications à valider de ce client. Le code de référence est `lib/publications/supervision-view.ts` (`parseSupervisionQuery`, `supervisionHref`).

### Contenu des onglets

| Onglet | Contenu | Actions |
| --- | --- | --- |
| Synthèse | Interrupteurs (arrêt d'urgence, automatisation, génération, diffusion, `PUBLICATIONS_SCHEDULED_DELIVERY`), tuiles cliquables et « À traiter » : premières erreurs, comptes à reconnecter, clients à court de photos | — |
| À valider | Cartes compactes : **aperçu de chaque variante** façon Facebook, Instagram (photo carrée) ou Google Business Profile (titre, bouton), avec **sa** photo ; « Photo manquante » signalée | Valider, Rejeter (motif obligatoire), Modifier : formulaires et actions serveur **existants** de la file de validation |
| Erreurs | Raison lisible de chaque diffusion en erreur (classe et code court, motif de blocage) et créneaux manqués | Relance depuis la fiche |
| Programmées | Créneaux à venir, puis publiées sur 30 jours | Modifier (après approbation : nouvelle approbation obligatoire, comme avant), Reprogrammer (`publication_reschedule`), Suspendre |
| Comptes | Comptes connectés et à reconnecter, avec la raison | **Reconnecter** : `startOAuthAction` existant (état à usage unique, page de consentement officielle, retour sur l'onglet Publications de la fiche client) |
| Photos | Photos réellement utilisables par l'agent, à revoir, rejetées ; « Trop peu de photos » sous 6 | Lien vers la photothèque du client |
| Agent | Mode de préparation, **dernière préparation** (terminée, en échec avec raison sûre, en cours), prochaines préparations automatiques | Suspendre la préparation, Générer maintenant (formulaire Agent v2 existant) |

- Les aperçus signés ne sont chargés que dans l'onglet « À valider », au plus 10 cartes. Un lien mène ensuite à la file complète.
- « À valider » compte toute la file de validation, comme `/publications/review`, et pas seulement les publications programmées.
- Aucune action de cette page ne publie. La diffusion reste soumise à l'approbation humaine, aux interrupteurs et à `PUBLICATIONS_SCHEDULED_DELIVERY`.

### Raccourcis

- **Accueil** : carte « Supervision des publications ». Elle ouvre directement l'onglet « À valider » s'il y a des publications à valider.
- **Navigation** : lien « Supervision » sous « Publications » (barre latérale et menu mobile). Sur téléphone, un bouton « Supervision » apparaît aussi à côté de « Menu », sans ouvrir le menu.

### Photothèque : point de remplacement unique

`lib/publications/supervision-photos.ts` → `loadClientPhotoCoverage(db, clients, now)` est le **seul** endroit où la supervision lit la photothèque :
- tables lues : `whatsapp_assets`, `whatsapp_asset_assessments` et `whatsapp_asset_uses` (historique d'utilisation) ;
- règles appliquées : celles de sélection de l'agent.

Quand les modèles de lecture « clients sans photos utilisables » (#42) et « historique d'utilisation des photos » (#43) seront disponibles, il suffira de remplacer le corps de cette fonction sans changer sa signature.

Si la photothèque est illisible, la page affiche « Photothèque illisible ». Elle n'affiche jamais « Trop peu de photos » par défaut.

## 2. Diagnostic de production (lot 9)

Page **`/settings/diagnostic`** (admin, lecture seule). En tête de page, « **État des mécanismes** » : chaque élément reçoit exactement un état, avec sa preuve (date et/ou compteur).

| État | Sens |
| --- | --- |
| **opérationnel** | Preuve récente d'un passage ou d'un traitement réussi, datée |
| **configuré** | Variables présentes ou interrupteur ouvert, **sans** preuve récente |
| **désactivé** | Variables absentes, interrupteur coupé, ou fonction volontairement à l'arrêt |
| **en erreur** | Problème ouvert (connexion expirée, diffusion bloquée, file en retard…) ou dernier échec plus récent que le dernier succès |
| **inconnu** | Uniquement quand la donnée est illisible (lecture en échec) |

Règle : **jamais « opérationnel » sans preuve.** Des variables présentes sans passage réussi récent restent « configuré ».

### Groupes (chacun échoue seul)

Un groupe dont la lecture échoue affiche ses éléments « inconnu ».

| Groupe | Éléments et preuve |
| --- | --- |
| Planificateur et étapes | Dernier passage **réel** (`scheduler_heartbeats`, ligne `scheduler_tick`). Le planificateur est en erreur dans trois cas : passage en échec, aucun passage depuis 36 h, ou passage commencé il y a plus de 15 min sans fin. Puis chaque étape du tick : ok → opérationnel, failed → en erreur, disabled → désactivé, skipped → configuré, absente → inconnu |
| Interrupteurs de sécurité | Arrêt d'urgence, automatisation, génération, diffusion (réglages globaux), `PUBLICATIONS_SCHEDULED_DELIVERY` et préparation automatique par client (nombre de clients, dernière préparation planifiée journalisée). `PUBLICATIONS_SCHEDULED_DELIVERY` vaut : désactivé si la variable est absente ou n'est pas exactement `enabled` ; opérationnel seulement si l'étape d'envoi a réussi au dernier passage |
| Agents actifs | Agent Publications (projets autorisés, dernière préparation) et chaque agent activé du cockpit (dernier run sur 30 jours) |
| IA : erreurs et coûts | OpenAI : dernier appel réussi contre dernier échec IA (génération, classement photo). Sont aussi affichés les échecs sur 7 jours et les coûts estimés sur 30 jours : Agent Publications, `client_media_ai_usage`, `agent_runs.estimated_cost_eur` |
| Google Drive et WhatsApp | Drive des publications (`GOOGLE_DRIVE_*`, lecture seule) : jamais « opérationnel », faute de journal des lectures réussies. Il passe en erreur en cas d'échec de récupération de média sur 7 jours. Drive d'import (`GOOGLE_DRIVE_IMPORT_*`, drive.file) : dernier média déposé contre échecs Drive/OAuth. Réception WhatsApp : dernier média reçu. Import WhatsApp : interrupteur, imports bloqués, dernier import contre dernier échec. **Les deux jetons Drive restent distincts** |
| Connexions sociales et diffusions | Meta, Google Business Profile : connexions expirées, révoquées ou en erreur = en erreur ; opérationnel seulement avec une diffusion confirmée (`published` et identifiant distant) sur 30 jours. Diffusions : échec, bloquées, à réessayer, à vérifier |
| Délais de traitement | Âge du plus ancien élément en attente : imports WhatsApp attribués, jobs dus, envois de publications dus, diffusions programmées échues. Au-delà de 36 h : en erreur, ou désactivé pour les diffusions quand l'envoi automatique est coupé |

Les sections détaillées existantes (derniers runs, préparations planifiées, imports, connexions, tâches bloquées, variables) restent sous « Détails ». Les variables y sont classées « configuré » ou « désactivé ».

**Jamais** de valeur de variable, de longueur, de jeton, de référence de coffre, de texte fournisseur ni d'identifiant brut.

### Seuils (choix conservateurs)

- **36 h** pour un passage ou une file : le cron peut être quotidien (plan Hobby).
- **7 jours** pour les agents, l'IA et la réception WhatsApp.
- **30 jours** pour les diffusions confirmées.

Code : `lib/system/diagnostic-model.ts` (classement pur) et `lib/system/diagnostic.ts` (une fonction par groupe : `schedulerStatus`, `safetyStatus`, `agentsStatus`, `aiStatus`, `mediaStatus`, `connectionsStatus`, `delaysStatus`). Le battement n'est lu qu'une fois par affichage.

## Tests

- `tests/publications-supervision-mobile.test.mjs` :
  - lien profond, filtre client, pastilles ;
  - état de l'agent et photothèque isolée (illisible ≠ trop peu) ;
  - aperçus par plateforme et règle « Média requis » ;
  - rendu de chaque onglet ;
  - raccourcis et jetons de design ;
  - **mise en page à 375 px dans Chromium** (`/opt/pw-browsers`, CSS Tailwind réel compilé depuis `app/globals.css`, aucune requête réseau) : aucun défilement horizontal, onglets collants, photos contenues.
- `tests/system-diagnostic-status.test.mjs` :
  - classement de chaque état et preuve exigée ;
  - drapeau `enabled` exact ;
  - files en retard ;
  - groupes indépendants, réglages illisibles = inconnu ;
  - lecture seule, aucun secret.
