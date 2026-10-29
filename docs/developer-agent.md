# Agent Développeur — Lot D0 : revue de PR cloud

## Objet
Étendre CODE-V OS sans agent Windows. Le Directeur IA pourra transmettre une mission du type
« Crée un article SEO sur la dératisation pour Protection Nuisibles » à un exécutant cloud
(Codex / Claude Code), qui proposera une PR sur une branche et fournira une prévisualisation.

**Lot D0 livré :** uniquement le suivi en lecture seule des PR sur branches `codev-dev/`,
par client relié à GitHub, et la revue de leurs contrôles et de leurs déploiements GitHub/Vercel.
Le bouton d'approbation, les captures automatiques, l'exécutant IA et la création de PR
par CODE-V OS **ne sont pas encore implémentés**. Aucun nouveau token d'écriture requis pour D0.

## Parcours et garde-fous
1. L'administrateur accède à `/developer`; la liste se construit depuis les connexions GitHub
   des clients dans `client_connections.metadata.repository`, jamais depuis un dépôt envoyé par le navigateur.
2. Seules les PR du dépôt lui-même, avec branche `codev-dev/`, sont éligibles.
3. La revue `/developer/[clientId]/[number]` lit la PR, son SHA HEAD, ses statuts, ses checks
   et les déploiements GitHub associés. Une prévisualisation n'est affichée que pour un
   statut de déploiement `success`, environnement Preview, même SHA, URL HTTPS `*.vercel.app`.
4. Les erreurs d'API ou l'absence de checks ne deviennent jamais un état réussi.
5. Aucun merge, déploiement en production, publication de contenu client ni écriture de code
   ne sont effectués par D0. Les approbations futures devront figer le SHA, puis revérifier
   ce SHA au moment de la fusion.

## Lots suivants
- **D1 :** intégrer au moteur de missions P1 (M1–M5), lorsque celui-ci existe réellement :
  schéma de mission, rattachement au client/projet, étape bornée, événements transactionnels,
  budget, autorisation et pause.
- **D2 :** lancer un exécutant isolé (Codex Cloud ou Claude Code dans une CI dédiée),
  sur branche non protégée, avec jeton GitHub limité aux dépôts autorisés. Défendre contre
  les instructions malveillantes présentes dans le dépôt ou les contenus externes.
  Produire la PR, les tests et des preuves horodatées.
- **D3 :** capture de prévisualisation Playwright et boucle de correction sur la même PR.
  L'approbation humaine porte sur le commit SHA courant ; toute mise à jour l'invalide.
- **D4 :** approbation/merge depuis CODE-V OS, exclusivement via action auditée,
  CI obligatoire, règles de protection appliquées, et nouvelle confirmation avant la mise
  en production. Ne jamais fusionner automatiquement un article non relu.

## Préconditions
- `GITHUB_TOKEN` en **lecture seule** ; les droits Checks et Deployments en lecture
  peuvent être nécessaires pour afficher les contrôles ou la preview.
- Une connexion GitHub propre au client avec `metadata.repository` au format `owner/repo`.
- Le dépôt cible doit déjà produire une PR `codev-dev/...` avec un déploiement de preview
  enregistré via GitHub. Aucune PR fictive n'est créée.
- Les projets Vercel qui utilisent une protection de déploiement peuvent nécessiter une
  connexion pour consulter la prévisualisation.

## Développement et tests
`node --test tests/developer-agent.test.mjs` ; puis `npm run typecheck`,
`npm run lint`, `npm test`. Aucun changement de schéma ni migration en D0.
