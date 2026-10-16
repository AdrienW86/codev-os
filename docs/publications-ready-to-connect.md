# Publications — parcours terminé et branchement des API

État du lot du 16 octobre 2026. Ce guide décrit le code livré ; les anciens documents « Lot 1 », « Lot 2 » et diagnostics datés restent des historiques. L'état actuel de Supabase et des comptes sociaux distants n'a pas été lu depuis cet environnement.

## Utiliser le module avant les API sociales

1. Dans la fiche client, ouvrir **Publications**, créer ou sélectionner son projet éditorial et confirmer les canaux souhaités. Choisir un canal pour rédiger ne nécessite pas de compte social connecté.
2. Utiliser **Nouveau brouillon** depuis la fiche client ou **Nouvelle publication** depuis le tableau. **Brouillon libre** est le mode initial : aucune date ni réservation de créneau, aucune limite héritée des deux anciens slots hebdomadaires. La création sur un slot historique reste disponible séparément.
3. Renseigner le sujet, les faits sources et les textes propres à Facebook, Instagram ou Google Business Profile. Enregistrer crée un brouillon. Les paramètres d'URL client/projet sont vérifiés ; un projet d'un autre client n'est jamais présélectionné.
4. Ajouter une image privée JPEG, PNG ou WebP de 768 Ko maximum, sa provenance et la confirmation des droits. L'upload prépare l'image ; **Enregistrer** l'associe dans une nouvelle révision. Les versions et images historiques restent conservées.
5. Corriger, approuver ou refuser avec un motif. Une photo manque : la validation reste bloquée. Une correction après approbation crée une nouvelle révision en brouillon ; la décision précédente reste dans l'historique.
6. **Récupérer les textes** copie les textes enregistrés par réseau ou télécharge un fichier UTF-8. Les champs de titre et CTA publics sont inclus, les sources internes et URL privées exclues. Une version non approuvée est signalée. Si le presse-papiers est refusé, un texte sélectionnable permet la copie manuelle. Aucune exportation ne change l'état de diffusion.
7. **Planifier ce brouillon** le rattache à un créneau du canal. La planification invalide également l'approbation : relire la nouvelle version. Le calendrier affiche les dates et fuseaux configurés.
8. Après une nouvelle approbation, **Préparer la diffusion** vérifie le compte, les autorisations et les interrupteurs. Sans branchement ou autorisation, la préparation est refusée sans créer d'envoi. Le contenu reste disponible pour correction et lecture.
9. Le tableau, la fiche complète et le panneau latéral utilisent les mêmes verrous et contrôles. Une diffusion en cours, incertaine ou déjà publiée verrouille l'édition. L'archivage exige une confirmation et conserve l'historique en lecture seule.

La création manuelle ne demande pas d'API IA. L'Agent Publications réutilise le moteur existant et nécessite séparément son fournisseur IA, un brief, les faits vérifiés, les droits médias et une autorisation explicite. Ses sorties restent des brouillons à valider, jamais des approbations automatiques.

## Correctifs de fiabilité

- Seules les réponses confirmées du workflow deviennent des succès. Un refus de canal, d'archive ou un message inconnu ne peut plus afficher une fausse validation.
- Le suivi durable des préparations précède la soumission et la notification. Une coupure ou un retour perdu conserve la reprise ; elle ne régénère pas les textes et ne soumet pas une version déjà décidée.
- Une réponse perdue après création Agent v2 est réconciliée avec le run client/projet enregistré. Une issue indéterminée conserve les réservations et son identifiant de reprise. La correspondance des plateformes respecte l'ordre UUID de création SQL.
- Une rotation OAuth enregistre la nouvelle référence avant de purger celle effectivement remplacée. Un résultat SQL ambigu conserve les secrets chiffrés ; aucun secret potentiellement actif n'est supprimé.
- Google Business Profile n'est marqué publié que pour un état **LIVE** confirmé. **PROCESSING**, réponse illisible et état inconnu restent à vérifier. Meta et Google ne concluent pas « absent » à partir d'une liste malformée ou d'une pagination incomplète.
- Les délais `Retry-After` numériques ou HTTP sont conservés et bornés. Les timeouts après dispatch restent incertains et ne déclenchent pas de renvoi aveugle.
- La vérification d'un envoi incertain et sa confirmation sont liées à la tentative courante. Un ancien résultat « absent », un nouveau résultat « indéterminé » ou une vérification d'une autre tentative ne permettent pas une reprise.

## Migration préparée, sans application distante

`supabase/migrations/20261112000000_publications_checked_reconciliation.sql` ajoute les pointeurs de tentative/vérification et les RPC de réconciliation contrôlée. Les accès navigateur restent refusés, les fonctions sont réservées au rôle serveur. Les anciennes RPC non liées à une tentative ne sont plus exécutables par ce rôle après migration.

Le code reste compatible avec une base sans cette migration pour la préparation, les médias, les décisions, le calendrier et l'historique. La seule réconciliation contrôlée refuse alors l'action avec un message de mise à jour nécessaire, sans appel fournisseur ni repli sur les anciennes RPC. Il faut appliquer cette migration avant de mettre en service les diffusions réelles et leurs reprises.

Les historiques incertains sont rattachés automatiquement seulement si une unique tentative courante peut être établie à partir du job. Un historique ancien ambigu reste bloqué et nécessite une investigation ; un ancien événement « absent » ne constitue jamais une nouvelle preuve.

Avant toute application autorisée : identifier la cible, lire l'historique réellement appliqué, comparer les dépendances, vérifier la sauvegarde et exécuter le fichier dans une transaction unitaire ; contrôler ensuite fonctions, colonnes, triggers, contraintes, RLS, grants et données historiques. Ne pas utiliser de `supabase db push` global. Ce lot n'applique aucune migration distante ; l'autorisation SEO V2 reste distincte.

## Branchement serveur à effectuer ensuite

| Besoin | Configuration et vérification |
| --- | --- |
| Authentification et stockage | Clerk administrateur, Supabase serveur, migrations Publications existantes et bucket privé `publication-images`. Ne jamais exposer la clé serveur au navigateur. |
| URL du cockpit | `PUBLICATIONS_OAUTH_BASE_URL`, origine HTTPS sans chemin ; HTTP limité au développement loopback. |
| Coffre chiffré | `PUBLICATION_CREDENTIALS_KEY` et `PUBLICATION_CREDENTIALS_KEY_ID`. Clé AES-256 de 32 octets en base64, saisie dans les variables serveur sécurisées. Les clés précédentes de rotation sont facultatives. |
| Facebook et Instagram | `META_APP_ID`, `META_APP_SECRET` ; `META_LOGIN_CONFIG_ID` si Facebook Login for Business. Le compte Instagram doit être professionnel et lié à la Page. Choisir explicitement les comptes du bon client après OAuth. |
| Google Business Profile | `GOOGLE_BUSINESS_PROFILE_CLIENT_ID`, `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET`, autorisations GBP et établissement accessible au compte connecté. |
| Agent de rédaction | Fournisseur IA existant, budget de l'agent, brief et droits médias. Facultatif pour le parcours manuel. |
| Diffusion automatique | `PUBLICATIONS_SCHEDULED_DELIVERY=enabled` seulement lors d'une mise en service volontaire, après validation des interrupteurs globaux/client, des comptes et des reprises. Le scheduler existant est réutilisé. |

Déclarer les callbacks exacts chez les fournisseurs :

```text
https://VOTRE-COCKPIT/api/publications/oauth/meta/callback
https://VOTRE-COCKPIT/api/publications/oauth/google-business-profile/callback
```

Le diagnostic des connexions indique les noms des variables manquantes, jamais leurs valeurs. Les guides fournisseur détaillés restent disponibles : [Meta](publications-meta-setup.md), [OAuth](publications-oauth.md), [Google Business Profile](publications-gbp-publisher.md).

Brancher une API ne lève pas l'arrêt d'urgence et n'autorise pas une publication. Tester d'abord connexion, découverte et association des comptes sans diffusion. Vérifier ensuite un vrai compte de test, une vraie photo et les permissions du fournisseur avant toute décision d'activation. La cadence du cron détermine la précision de diffusion ; aucune heure exacte n'est garantie sans une cadence adaptée.

## Validation reproductible

```sh
npm test
npm run lint
npm run typecheck
npm run build

# Exclusivement sur un cluster PostgreSQL local jetable.
PUBLICATIONS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/publications_lot1_test \
  PUBLICATIONS_TEST_PSQL=psql node scripts/test-publications-native.mjs

E2E_DATABASE_URL=postgres://postgres@127.0.0.1:5432/codev_publications_ui \
  CODEV_CORE_TEST_PSQL=psql node scripts/test-publications-ui.mjs --download-postgrest
```

Le premier runner refuse les cibles distantes et les options d'URL, utilise une liste fixe de bases jetables et exécute les suites SQL séquentiellement. Le second reconstruit uniquement `codev_publications_ui`, utilise le binaire officiel PostgREST 13.0.7 avec vérification SHA-256 et Chromium sur desktop 1 440 px/mobile 375 px.

Dans le test navigateur, les transactions, révisions, décisions, doublons, planification et archivage sont réels dans PostgreSQL. Clerk et le stockage privé des photos sont simulés localement. Les appels sociaux, IA, e-mail et Drive sont interdits ; le contrôle de version npm de Next dev reçoit une réponse locale indisponible. Aucun essai de fournisseur réel, session Clerk réelle, Supabase distant ou téléphone physique n'est revendiqué.

Les résultats finaux et les limites de mise en service sont consignés dans la PR. Les captures et le rapport machine se trouvent dans `e2e/output/publications/`, fichiers locaux ignorés par Git.

Validation locale du lot : **1 140 tests, 1 097 réussis, zéro échec, 43 ignorés** dans `npm test` ; **26 suites PostgreSQL 17.11 réussies, aucune ignorée** dans le runner natif ; **2 parcours navigateur complets réussis**, desktop et mobile, avec PostgreSQL et PostgREST réels. Les assertions de concurrence utilisent plusieurs vraies connexions, dont la confirmation d'un envoi incertain sous verrou. Le lint termine sans erreur avec deux avertissements préexistants hors Publications. Typecheck réussi ; le statut du build et des checks distants est joint à la PR.
