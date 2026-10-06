# Google Ads — lecture seule

## Architecture

Authentification retenue : OAuth 2.0 single-user. Un utilisateur Google dédié avec accès **Lecture seule** aux comptes concernés est recommandé. REST v25, aucun SDK ni dépendance ajoutée. L’interface `GoogleAdsReadClient` permet de remplacer plus tard la stratégie d’authentification sans modifier les services métier. Aucun second système d’authentification n’est implémenté.

La documentation Google consultée le 3 octobre 2026 confirme le remplacement des developer tokens le 9 septembre 2026 par les niveaux d’accès du projet Google Cloud. Aucun developer token n’est envoyé ou attendu. Certaines pages et résumés officiels contiennent encore les anciennes instructions : suivre la page dédiée à cette transition.

- [Transition vers les projets Google Cloud](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [Authentification utilisateur](https://developers.google.com/google-ads/api/docs/oauth/user-authentication)
- [Modèle d’accès et rôles](https://developers.google.com/google-ads/api/docs/oauth/access-model)
- [REST Search et pagination](https://developers.google.com/google-ads/api/rest/common/search)
- [Versions actuelles](https://developers.google.com/google-ads/api/docs/release-notes)
- [Périodes GAQL](https://developers.google.com/google-ads/api/docs/query/date-ranges)

`lib/integrations/google-ads/` : types internes, validation des IDs/périodes, GAQL centralisé, transport privé avec pagination, service des connexions et analyses. Les données sont lues à la demande, sans cache durable ni nouvelle table. Les seuls appels Google sont l’échange OAuth d’un refresh token et `googleAds:search`. Le POST Search est une lecture, pas une mutation Google Ads.

## Checkpoint manuel avant tout appel réel

Le code est prêt ; aucun credential n’a été consulté et aucun compte réel n’a été testé. Effectuer ces étapes hors des formulaires métier de CODE-V OS :

1. Sélectionner ou créer le projet Google Cloud qui détiendra les credentials OAuth.
2. Activer Google Ads API. Dans sa page Overview Google Cloud, demander/vérifier le niveau d’accès aux comptes de production (Explorer ou niveau approprié aux volumes). L’accès Test ne suffit pas à lire un compte de production. Ne pas demander un developer token dans l’ancien API Center.
3. Préparer Google Auth Platform : application interne si l’organisation Workspace le permet, sinon externe avec utilisateurs autorisés. Configurer le scope `https://www.googleapis.com/auth/adwords`. Ce scope couvre aussi les écritures : la limitation lecture seule repose sur le transport du projet et, en défense supplémentaire, le rôle Google Ads du compte utilisé.
4. Créer un client OAuth adapté à l’outil utilisé pour obtenir l’autorisation (application Web avec URI de redirection exacte ou application Desktop pour un outil local fiable). Ne pas ajouter de callback improvisé dans CODE-V OS.
5. Accorder au seul utilisateur Google choisi l’accès Lecture seule aux comptes Google Ads, directement ou via le manager. Vérifier la hiérarchie si un `manager_customer_id` est fourni.
6. Effectuer une autorisation OAuth ponctuelle via un outil local fiable utilisant ce client OAuth, avec `access_type=offline` et `prompt=consent`. Obtenir le refresh token sans le publier ni le mettre dans des logs. Ne pas utiliser le flow OOB obsolète ; utiliser la redirection enregistrée ou le loopback prévu pour une application Desktop. En mode OAuth externe Testing, le refresh token peut expirer après sept jours : régler le statut de publication/vérification selon les exigences Google avant un usage durable.
7. Placer les variables ci-dessous dans `.env` à la racine du projet en local, et dans les variables serveur de l’hébergeur en production. Aucune valeur d’exemple n’est fournie. Redémarrer le serveur après configuration.
8. Sur la fiche du client, ouvrir « Configurer Google Ads », saisir le customer ID et éventuellement le manager ID, enregistrer puis « Tester la connexion ». Un échec ne crée pas de données Google fictives.
9. Vérifier le résumé réel puis lancer une analyse depuis la fiche de l’agent nommé **Ads Agent**, actif et assigné activement à ce client.

Pour obtenir le refresh token avec l’outil officiel [OAuth Playground](https://developers.google.com/oauthplayground), utiliser **ses propres** credentials du projet Cloud approuvé : créer un client OAuth Web avec l’URI de redirection exacte `https://developers.google.com/oauthplayground`. Dans les réglages Playground, conserver les endpoints Google, choisir Server-side, Offline, Consent Screen et « Use your own OAuth credentials ». Renseigner les credentials uniquement dans cet outil officiel, jamais dans CODE-V OS ni dans cette conversation. Autoriser le scope `https://www.googleapis.com/auth/adwords` avec l’utilisateur Google prévu, puis utiliser « Exchange authorization code for tokens ». Transférer le refresh token directement dans la variable serveur. Ne pas partager un lien Playground contenant les credentials/tokens. Utiliser les credentials propres au projet est indispensable : les credentials par défaut de Playground ne représentent pas votre projet Cloud et leurs refresh tokens sont temporaires. Cette étape implique l’envoi des credentials au service officiel Playground ; si la politique de l’entreprise l’interdit, utiliser un outil OAuth local fiable avec le même flow offline.

Variables serveur nécessaires :

- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`

La configuration existante Clerk/admin et `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY` est conservée. Aucune variable Google n’a de préfixe `NEXT_PUBLIC_`. Aucun secret ne doit être saisi dans l’interface, un audit ou `client_connections.metadata`.

## Connexions et données

La table **existante** `client_connections` stocke uniquement `provider=google_ads`, le customer ID, un statut `disconnected/connected/error`, la dernière vérification réussie et des métadonnées reconstruites depuis une liste autorisée : `account_name`, `currency_code`, `timezone`, `manager_customer_id`, `auth_strategy=single_user`, `connection_version`. Changer l’association remet le statut à disconnected jusqu’à un test réussi. Une mise à jour de statut est conditionnée par l’ID, le client, le provider, le compte et `updated_at` pour éviter de valider une association remplacée pendant l’appel Google.

Cette implémentation attend une seule connexion Google Ads par client. Des doublons existants provoquent une erreur sûre ; aucune migration ou contrainte n’est ajoutée. Les statuts doivent être acceptés par le schéma existant. Aucun schéma distant n’a été modifié ou supposé corrigé automatiquement.

Lecture : compte (nom, ID, devise, fuseau), campagnes non supprimées (ID, nom, statut, canal, budget lisible, dates), métriques campagne et totaux compte (impressions, clics, coût, conversions, valeur, CTR, CPC). Les micros sont convertis en unités monétaires avec la devise du compte. Le coût/conversion est calculé seulement si les conversions sont connues et supérieures à zéro. Une métrique absente reste indisponible ; elle n’est pas remplacée par un zéro inventé. Le budget de campagne est le montant configuré, pas nécessairement un plafond mensuel ni un budget propre à chaque campagne (budgets partagés possibles).

Période par défaut : les 30 derniers jours complets, aujourd’hui exclu, dans le fuseau du compte. UI : 7/30/90 jours ; fonction serveur : de 1 à 90 jours. Les inventaires et métriques sont paginés ; limites de sécurité : 50 000 lignes et 100 pages, erreur explicite au dépassement au lieu d’une analyse tronquée. Pas de keywords/search terms dans ce premier lot.

## Analyse et sécurité

`buildGoogleAdsAnalysisContext(clientId)` retourne compte, période, campagnes, totaux et observations. Une seule règle : campagne ENABLED avec coût strictement positif et exactement zéro conversion **connue**. Il s’agit d’une observation invitant à vérifier suivi et performances, pas d’un jugement universel sur la rentabilité. Les conversions peuvent être différées.

Le run manuel vérifie l’agent actif, l’assignation active et la connexion connected. Il utilise les tables existantes `agent_runs` et `recommendations`. Une recommandation informative agrège les signaux (50 maximum dans le payload, nombre total indiqué), sinon le run se termine avec « aucune recommandation ». Aucun LLM, aucune action Google Ads exécutable, aucun lien vers un exécuteur externe.

Tous les accès métier et Google appellent `requireAdmin()`. Le compte à lire est rechargé depuis la relation du client, jamais fourni librement par un formulaire d’analyse. Les credentials, le token et le transport sont privés côté serveur. Cache HTTP désactivé, redirects réseau refusés, timeouts bornés. Les erreurs Google brutes ne sont ni affichées ni journalisées. Logs : catégorie, opération, customer ID et request ID validé quand disponible. Audits : événements de connexion/analyse, identifiants minimaux, aucun token ni payload OAuth.

## Vérification et limites

Tests unitaires sans appels Google : transport OAuth/Search simulé, pagination, métriques, périodes/fuseaux, connexion, erreurs, allowlist metadata, admin, runs avec/sans signal, audits, absence de méthodes d’écriture et absence de credentials dans les Client Components. Tests métier avec doubles Supabase ; les credentials et l’accès Cloud doivent ensuite être validés manuellement.

Limitations : l’agent est identifié par son nom `Ads Agent`, faute de champ de type dans le schéma existant ; le renommer masque cette fonctionnalité. Le connecteur réutilise un utilisateur OAuth global. Aucun stockage de métriques ni retry automatique. Les mutations Supabase et les audits restent des opérations séparées ; un échec d’audit peut suivre une écriture réussie. Une recommandation déjà créée peut rester disponible si la finalisation du run échoue. Les appels multi-requêtes ne constituent pas un snapshot transactionnel de Google Ads. Les doublons de connexion concurrents dépendent des contraintes déjà provisionnées.

## Éventuelles écritures futures

Créer un transport d’écriture **distinct**, avec permissions explicites, actions typées et paramétrées, validation serveur du compte, approval gate humain obligatoire, préconditions rechargées, idempotence et audit avant/après. Faire valider ce lot séparément. Le transport actuel doit rester lecture seule ; aucune mutation n’est préparée dans ce lot.
