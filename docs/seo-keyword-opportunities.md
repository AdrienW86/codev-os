# Agent SEO V2 — opportunités de mots-clés

L’Agent SEO existant (`seo`, exécution `seo.analyze`) devient un moteur qui détecte, priorise et suit des opportunités de mots-clés par client, à partir de données Search Console réelles. Il n’y a **pas de second moteur** : même registre d’agents, même moteur d’exécution, mêmes automatisations, mêmes recommandations, mêmes actions et approbations.

## Principes

- **Données réelles uniquement.** Clics, impressions, CTR et positions viennent de Search Console. Aucun volume de recherche n’est inventé. Une piste issue du contexte client (prestation ou zone sans requête) est une **hypothèse** : `verified = false`, aucune métrique, confiance faible. La base l’impose (contraintes `check`).
- **Pas de score présenté comme une certitude.** Priorité (haute / moyenne / faible) et confiance sont des niveaux, accompagnés des facteurs qui les expliquent. Le potentiel de clics est une estimation fondée sur une courbe de CTR de référence, affichée comme telle.
- **Qualité plutôt que quantité.** 30 opportunités au plus par analyse, variantes regroupées (même page, mêmes mots principaux), demandes exclues par le client déclassées, au plus 3 pistes locales et jamais de création en série de pages locales.
- **Aucune modification externe sans approbation.** L’analyse automatique ne fait que lire. Une modification du site passe par une action approuvée, puis une branche et une PR en brouillon, jamais un push en production.

## Détection (`lib/seo/opportunities.ts`, pur et testé)

Période analysée : 28 jours se terminant 3 jours avant aujourd’hui (données consolidées), comparés aux 28 jours précédents.

| Catégorie | Règle | Action type |
| --- | --- | --- |
| `striking_distance` | position 4 à 10, ≥ 30 impressions, intention pertinente | renforcer la page |
| `page_two` | position 11 à 20, ≥ 60 impressions, intérêt commercial ou dynamique favorable | enrichir le contenu |
| `declining_page` | clics −30 % (≥ 20 auparavant) ou position −3 places, uniquement sur une page observée dans la période (une page absente d’une réponse Search Console limitée n’est pas comptée comme une chute) | diagnostiquer avant de modifier |
| `low_ctr` | position ≤ 10, ≥ 150 impressions, CTR < 50 % du CTR de référence pour la position et l’intention | title et meta description |
| `emerging_query` | requête nouvelle (≥ 20 impressions) ou impressions ×2, hors marque | vérifier la couverture, suivre |
| `cannibalization` | ≥ 2 pages avec ≥ 15 % des impressions chacune ; **vérifier l’intention avant toute consolidation** | consolider ou différencier |
| `content_gap` | prestation renseignée sans requête (analyse hebdomadaire) — hypothèse | ajouter du contenu |
| `local_gap` | prestation recherchée mais jamais avec une zone d’intervention renseignée — hypothèse, 3 zones max | mentionner la zone |

Intention estimée par règles lisibles (marque, zone renseignée, termes transactionnels ou commerciaux, questions), toujours libellée « estimée ». Le contexte métier vient de la fiche client (activité, zone, site) et du contexte métier déjà saisi pour Google Ads (services prioritaires, zones, exclusions) : rien n’est déduit.

Analyse quotidienne : Search Console seulement. Analyse hebdomadaire (et lancement manuel) : en plus, lecture des pages du site dans GitHub (title, H1, description), sujets manquants, PageSpeed, pages vues Vercel Analytics en contexte.

## Données (migration `20261109000000_seo_keyword_opportunities.sql`, additive)

- `seo_opportunity_analyses` : historique des analyses ; une seule analyse planifiée par client, profondeur et jour.
- `seo_keyword_opportunities` : une ligne par client et empreinte (dédupliquée d’une analyse à l’autre), statuts `detected → to_review → approved → in_progress → done`, ou `dismissed` (raison obligatoire). Un déclencheur impose les transitions. Elle **référence** la recommandation existante (`recommendation_id`).
- `seo_opportunity_interventions` : situation de référence figée, PR, date de déploiement (enregistrée une fois), mesures 7/28/60 jours.
- RLS active, aucun droit pour `anon` / `authenticated`, pas de suppression par le rôle service.

Tests : `supabase/tests/seo-opportunities.sql` (rejoué sur le schéma de production par `tests/seo-opportunities-db.test.mjs`).

Avant tout déploiement SQL : suivre [supabase-migration-reconciliation.md](supabase-migration-reconciliation.md). Les versions distantes ne correspondent pas toujours aux préfixes des fichiers ; vérifier l'historique et rejouer la migration sur une copie isolée avant toute application.

## Recommandations et cycle de vie

- Une opportunité de priorité haute et de confiance au moins moyenne passe « À examiner » et crée une recommandation (`payload.kind = "keyword_opportunity"`). Les autres restent « Détectée » ; « Ouvrir la recommandation » la crée à la demande.
- Décider depuis la page Recommandations (accepter / refuser) met l’opportunité à jour, et inversement.
- Une opportunité réalisée ou écartée n’est **jamais relancée automatiquement**. Si ses chiffres changent nettement (impressions ou clics doublés ou divisés par deux, position décalée de 3 places), elle est signalée « Changement significatif » ; la réouverture reste une décision manuelle.

## Conversation avec l’agent

Depuis la recommandation : « Pourquoi ? », « Compare sur trois mois » (trois tranches de 30 jours et les 90 jours précédents, lus dans Search Console), « Prépare la modification », « Examine les concurrents » (réponse honnête : aucune source SERP connectée, aucune position concurrente inventée), « Écarte-la, … » (proposition à confirmer par un bouton, rien n’est fait sans ce clic). Les autres questions passent par le fournisseur IA configuré, avec uniquement les données de l’opportunité ; sans IA, réponse par règles.

## Exécution contrôlée

1. L’opportunité est approuvée.
2. « Préparer la modification » (title, meta description, H1) relit le fichier source dans GitHub et fige : dépôt, branche de base, chemin, empreinte du fichier, remplacements exacts. Une action `seo.github_pull_request` est créée, **en attente d’approbation** ; l’empreinte du contenu approuvé est figée en base.
3. Après approbation, « Créer la branche et la PR » : vérifie que le fichier n’a pas changé, crée une branche `codev-seo/…`, commite le fichier, ouvre une **PR en brouillon**. Jamais de fusion ni de push sur la branche par défaut. Fichiers interdits : `.github/`, `.env*`, chemins relatifs.
4. Une intervention est enregistrée avec la situation de référence. Quand la PR est fusionnée et déployée par l’équipe, « Enregistrer la date de déploiement » ; l’opportunité passe « Réalisée ».

Une modification réalisée hors CODE-V OS peut aussi être enregistrée (« Enregistrer une intervention réalisée ») pour bénéficier de la mesure.

Variable : `GITHUB_SEO_WRITE_TOKEN`, distincte du jeton de lecture `GITHUB_TOKEN`. Jeton GitHub à granularité fine limité aux dépôts des sites clients, permissions **Contents : Read and write** et **Pull requests : Read and write**. À définir dans Vercel → Project → Settings → Environment Variables. Sans elle, la préparation reste possible mais l’exécution est refusée.

## Mesure des résultats

À chaque analyse, les interventions déployées sont mesurées sur la requête et la page concernées, sur 7, 28 et 60 jours avant / après le déploiement, uniquement lorsque toutes les journées sont consolidées. Verdict prudent : amélioration, dégradation, stable ou données insuffisantes (< 50 impressions). L’interface rappelle qu’une évolution n’est pas automatiquement attribuable à la modification (saisonnalité, mises à jour Google, concurrence).

## Automatisations

Bouton « Planifier les analyses » par client : analyse quotidienne (07:30) et recherche hebdomadaire (lundi 08:00), créées dans le moteur d’automatisations existant (`seo.analyze`, `config.depth`).

Conditions pour qu’elles s’exécutent réellement :

1. Agent SEO **activé** (statut Actif) et **assigné** au client ; il est en pause par défaut.
2. Search Console connectée et propriété choisie sur la fiche client.
3. `CRON_SECRET` défini dans Vercel **et** un cron Vercel qui appelle `/api/internal/scheduler/tick` (voir [automation.md](automation.md)). Ce lot n’ajoute pas de `vercel.json` : sur le plan Hobby, un seul déclenchement par jour, les analyses passent alors au premier tick suivant leur échéance.

Sans ces trois conditions, les analyses ne tournent que par le bouton « Lancer une analyse complète ».

## Hors périmètre (dépend d’API externes)

- **Google Keyword Planner** : non branché. L’accès exige un compte Google Ads avec jeton développeur en accès de base et l’autorisation d’utiliser `KeywordPlanIdeaService` ; l’accès actuel est en lecture seule et n’a pas été vérifié pour ce service. Aucun volume n’est donc affiché.
- **Positions concurrentes / SERP** : aucune source connectée.
