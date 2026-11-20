# Agent de classement concurrentiel local — phase 1

## Livré
- Moteur TypeScript `lib/local-seo/ranking-engine.ts`.
- Entrées séparées `maps` et `organic` ; mot-clé, point GPS, langue, appareil, source et date obligatoires.
- Classement de tous les concurrents présents avant la fiche ou le site du client.
- Écarts d'avis, de notes, de catégorie et de présence de site avec recommandations explicables.
- Aucune position inventée : les observations non vérifiées et les cibles absentes sont signalées.
- Signalement des listes incomplètes lorsque le rang du client implique des concurrents manquants.

## À développer avant mise en production
1. Brancher une source contractuellement autorisée de positions Maps et une source de résultats organiques. Ne pas confondre Google Places Nearby Search et rang Maps.
2. Résoudre l'identité des entreprises par place_id pour Maps et URL canonique/domaine pour Search ; gérer plusieurs établissements et doublons.
3. Ajouter les tables Supabase multi-tenant avec RLS : analyses, observations, résultats, recommandations et historique.
4. Ajouter les routes Next.js sécurisées et la page client CODE-V OS avec deux onglets, filtres, preuves de mesure et liste exhaustive paginée.
5. Croiser Google Business Profile (avec autorisation), Search Console, GA4 et audits techniques ; distinguer hypothèses SEO et facteurs prouvés.
6. Ajouter les tests unitaires, d'intégration, de permissions et les contrôles de coût/quota avant activation.
7. Générer les plans d'action Top 3 et les rapports ; toutes les modifications externes requièrent une validation humaine.

## Limites
Un rang dépend du mot-clé, de la position, de l'appareil, de la langue et de l'instant. Il n'existe pas de classement universel. Les données concurrentes privées et l'algorithme Google ne sont pas accessibles. Le Top 3 est un objectif, pas une garantie.
