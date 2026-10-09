# Meta (Facebook / Instagram) — mise en service (Lot 4.3 P13)

Tout le code est en place : connexion OAuth, coffre chiffré, synchronisation des Pages et comptes Instagram,
association explicite aux clients, publication Facebook / Instagram, erreurs, réconciliation. Ce guide liste ce
qui reste à configurer et à vérifier.

## Parcours dans CODE-V OS

1. *Projet → Configuration → Connexions* : « Connecter Meta ». Le client est celui du projet (déterminé côté
   serveur). Le `state` OAuth est aléatoire, stocké haché, à usage unique, valable 10 minutes, lié au client, au
   projet et à l’administrateur.
2. Callback (route protégée par Clerk) : échange du code côté serveur, jeton longue durée (~60 jours) chiffré
   (AES-256-GCM) dans le coffre ; la base métier ne garde qu’une référence opaque. Jamais de jeton dans le
   navigateur, les journaux, l’audit ou Git.
3. Les Pages et comptes Instagram professionnels visibles par ton compte Meta sont listés pour ce client.
4. **Association explicite** : pour chaque canal du projet (Facebook, Instagram), choisir le compte. Une Page /
   un compte Instagram ne peut servir qu’**un seul client** : s’il est déjà utilisé ailleurs, il est affiché
   « Déjà utilisé par un autre client » et refusé côté serveur (et en base).
5. Publication : brouillon → validation manuelle → « Préparer la diffusion » (snapshot du texte et des médias
   approuvés) → « Envoyer les publications dues » quand l’heure est arrivée. Identifiant Meta, statut, tentatives et
   erreur (classe + code court) enregistrés par destination. Une relance réutilise la même diffusion ; une
   réponse ambiguë devient « Résultat incertain » et se vérifie chez Meta avant toute relance (pas de doublon).
6. Les interrupteurs (`emergency_stop`, `publishing_enabled`, et l’autorisation par client) se changent en base
   uniquement, délibérément. Ils sont fermés aujourd’hui : rien ne part.

## Développement vs validation Meta

| | Développement (aujourd’hui) | Comptes clients / mode Live |
|---|---|---|
| Qui peut se connecter | Personnes avec un rôle sur l’app | Idem en accès Standard ; tout utilisateur en accès Avancé |
| Accès aux permissions | Standard, automatique, sans App Review | Standard suffit si **toi seul** te connectes (admin de l’app) et gères les Pages clientes |
| App Review | Non | Seulement pour l’accès Avancé (clients qui se connecteraient eux-mêmes) + vérification d’entreprise |
| Pages publiables | Celles que tu gères (tâche CREATE_CONTENT) | Idem |

Les clients doivent te donner un rôle sur leur Page (et le compte Instagram doit être **professionnel** et lié à
la Page). Si ce rôle passe par un Business Manager : `META_PAGE_ROLES_VIA_BUSINESS_MANAGER=true`
(ajoute `ads_management`, `ads_read`, exigés pour Instagram dans ce cas), puis reconnecter.

## À configurer dans Meta Developers

1. App : type *Business* avec **Facebook Login for Business** (créer une *configuration* : jeton utilisateur,
   permissions ci-dessous ; reporter son identifiant dans `META_LOGIN_CONFIG_ID`), ou produit **Facebook Login**
   classique (laisser `META_LOGIN_CONFIG_ID` vide).
2. Permissions : `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`,
   `instagram_content_publish` (+ `ads_management`, `ads_read` si Business Manager).
3. *Valid OAuth Redirect URIs* : `http://localhost:3000/api/publications/oauth/meta/callback` (local) et l’URL de
   production équivalente ; *Strict Mode* activé.
4. Rôles de l’app : ton compte Facebook comme administrateur.
5. Secrets : `META_APP_ID`, `META_APP_SECRET` (Paramètres → Général) dans `.env` local et dans les variables
   serveur de l’hébergement — jamais `NEXT_PUBLIC_`.

## Blocages possibles en local

- **Redirection `http://localhost`** : la documentation officielle impose une correspondance exacte de l’URI ;
  elle ne précise pas le traitement de `http://localhost` quand *Enforce HTTPS* est actif. Si Meta refuse l’URI,
  utiliser une URL HTTPS (tunnel ou déploiement) dans `PUBLICATIONS_OAUTH_BASE_URL` et dans Meta.
- **Médias Instagram** : Meta télécharge l’image depuis une URL publique ; les URL signées Supabase (HTTPS,
  5 minutes) conviennent même depuis le poste local. JPEG uniquement.
- **Base distante** : l’app locale utilise la base Supabase distante. P11 → P12 y sont appliquées ; **P13**
  (une Page = un client) ne l’est pas encore : sans elle, l’exclusivité n’est pas imposée par la base (le code
  reste compatible). À appliquer sur autorisation explicite, avec la même procédure que P11 → P12.
- **Aucun envoi réel** tant que les interrupteurs sont fermés : la connexion et l’association se testent sans
  rien publier.
