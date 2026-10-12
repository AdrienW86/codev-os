# Publications depuis la fiche client (socle lot 1)

Onglet **Publications** de chaque fiche client (`/clients/{id}?tab=publications`). Il réutilise tout ce qui existait
au niveau des projets Publications : connexions OAuth Meta et Google Business Profile, comptes par canal,
créneaux hebdomadaires, agent et dossier Drive. Aucun second moteur, aucune saisie de token.

## Ce que l'onglet permet

- **Configurer les publications** quand le client n'a pas encore de projet Publications : la RPC
  `publication_client_project_ensure` retrouve le plus ancien projet éligible du client ou crée un projet
  « Publications — {client} » (type Réseaux sociaux) avec ses trois canaux explicites et **désactivés**.
  Verrou par client : un double clic ne crée jamais deux projets.
- **Connexions** : connecter, reconnecter, vérifier ou déconnecter Meta (Pages Facebook + comptes Instagram
  professionnels autorisés) et Google Business Profile (fiches établissement). Les comptes découverts sont listés
  avec leur nom et leur état ; un compte déjà utilisé par un autre client reste visible mais non sélectionnable.
  Une connexion expirée, révoquée ou en erreur affiche « Reconnexion nécessaire ».
  Démarrée depuis la fiche, la connexion revient sur cet onglet : un cookie de 10 minutes, valeur fermée `client`,
  limité aux routes de callback, choisit la vue ; le client et le projet viennent toujours de l'état OAuth consommé.
- **Par plateforme** : case « Publier sur … » (canal activé), compte de publication choisi, état de publication
  réel (« Prêt pour la publication », « Connexion inactive », « Compte déjà utilisé par un autre client »…), règles
  éditoriales propres au canal, créneaux jour/heure et fuseau horaire. Un canal coché sans compte connecté reste
  affiché comme non publiable.
- **Préparation et validation** (`publication_client_settings`, RPC `publication_client_settings_save`, auditée) :
  préparation automatique activée ou suspendue, avance de préparation (1 à 14 jours), autorisation de diffusion du
  client, réemploi explicite d'une photo déjà publiée (délai minimal 30 à 730 jours), fuseau du client et règles
  éditoriales du client. La validation humaine est obligatoire et verrouillée (`check (require_human_approval)`).
  Ces réglages ne lèvent jamais l'arrêt général ni les interrupteurs globaux.
- **Photothèque Google Drive et prestations** : formulaire existant de l'agent (dossier Drive, prestations
  réellement proposées, objectif éditorial, droits d'utilisation).

## Déploiement

1. Appliquer `supabase/migrations/20261027000000_publications_client_setup.sql` (additive : colonnes avec valeurs
   par défaut sur `publication_client_settings`, deux RPC `service_role`). Elle ne modifie aucune ligne existante.
2. Déployer le code. Sans la migration, l'onglet s'affiche mais « Configurer les publications » et l'enregistrement
   des réglages répondent « migration non appliquée ».
3. Aucune nouvelle variable d'environnement. Les URI de redirection OAuth Meta et Google restent
   `/api/publications/oauth/meta/callback` et `/api/publications/oauth/google-business-profile/callback`.

## Vérifications locales

```sh
npm run typecheck && npm run lint && npm test && npm run build
# Base PostgreSQL locale jetable uniquement :
PUBLICATIONS_SOCLE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:PORT/publications_socle_test node --test tests/publications-socle-db.test.mjs
```

Le test SQL reconstruit deux fois le schéma de production et **toutes** les migrations, puis exécute chaque suite
`supabase/tests/publications-socle-*.sql` dans une transaction annulée.
