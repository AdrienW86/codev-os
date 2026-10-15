# Directeur IA — diagnostic transversal

Le bouton **Analyser tous mes clients** du Directeur IA ouvre un diagnostic dans le panneau de résultats existant. Les commandes « Analyse tous mes clients et identifie les urgences », « Quelles actions dois-je prioriser aujourd’hui ? » et « Prépare un plan d’optimisation pour Couverture Catalane » utilisent le même outil en lecture seule.

## Résultat métier

Les propositions sont classées par gravité/priorité enregistrée, puis par fraîcheur vérifiable et client. Chaque carte distingue :

- le fait effectivement enregistré et sa date ;
- la justification d’un agent ou la causalité restant à confirmer ;
- l’impact qualitatif, sans pourcentage de confiance ni gain financier inventé ;
- le degré de confiance : état étayé ou preuve/interprétation limitée ;
- les liens vers les preuves et l’examen ou la validation humaine nécessaire.

Un incident associé à une recommandation chargée du même client évite de répéter cette recommandation. Une ancienne référence vers la recommandation d’un autre client ne devient jamais un lien attribué au mauvais client et ne supprime pas sa proposition.

**Proposer une tâche** réutilise l’outil enregistré de création de tâche : résolution serveur du nom du client, proposition, puis bouton de confirmation séparé. Préparer ou annuler cette proposition n’insère aucune tâche. Les actions déjà en attente renvoient vers **Travail → À valider** ; le diagnostic ne les approuve pas.

## Sources et limites

L’outil consulte les sorties déjà présentes dans les tables existantes : incidents non résolus, tâches dues ou en retard, actions en attente, recommandations et instantanés Search Console. Il ne déclenche aucun agent, appel Google Ads, publication, livraison ou planificateur. Il fonctionne sans fournisseur IA et ses commandes explicites conservent la synthèse déterministe même lorsqu’un modèle est configuré.

Les instantanés SEO permettent de comparer les clics agrégés des pages enregistrées aux clics de leur période précédente. Leurs dates sont affichées : ils ne sont pas présentés comme une mesure de la semaine en cours. Les données manquantes, invalides, sans comparaison ou avec une base nulle ne produisent pas de fausse baisse. Une nouvelle collecte d’un ancien mois ne remplace pas une période plus récente dans le classement. La propriété Search Console et l’association actuelle au client ne sont pas certifiées par ces anciennes données ; cette limite reste visible. Une baisse de clics ne démontre ni perte d’impressions ni cause SEO.

La lecture est bornée à 100 clients et 200 éléments par source, avec comptages exacts et délais de 12 secondes par requête. La couverture partielle, l’absence de comptage et les sources en échec sont affichées. Une panne ne devient jamais « zéro urgence ». Les 20 premières propositions sont affichées ; le nombre de propositions supplémentaires est indiqué. Un diagnostic ciblé sur un client complète une lecture globale tronquée.

Ces lectures historiques ne contournent pas l’activation ni les permissions des agents : aucune exécution d’agent n’est demandée. Les propositions de travail restent soumises aux validations existantes. La session administrateur est vérifiée à la route et dans le service ; la simulation bloque toute lecture réelle. Les requêtes sont limitées aux identifiants des clients consultés, puis les appartenances sont revérifiées par le modèle pur. Les erreurs brutes et paramètres d’actions ne sont pas transmis au navigateur.

## Implémentation

- Outil du registre : **director_briefing**, paramètres stricts, client facultatif et focus all/seo/ads.
- Lecture protégée : **lib/assistant/director.ts** ; décision pure : **lib/assistant/director-model.ts**.
- Vue serveur typée **director_briefing**, rendue par des composants React connus, dans le même panneau responsive que les autres outils.
- La voix lit seulement la courte synthèse ; les cartes et tableaux restent visuels.
- Aucune migration, table, moteur d’approbation, ordonnanceur ni service fournisseur ajouté.

## Vérifications locales exécutées

Les tests **tests/director.test.mjs** exercent le vrai modèle, service, registre, orchestrateur et rendu React avec Clerk/stockage simulés : classement, sources en panne/tronquées, données anciennes, bases nulles, comparaisons incorrectes, références interclients, simulation, absence d’écriture et confirmation séparée. Les suites assistant et navigation existantes sont également exécutées.

**E2E_CHROMIUM=/usr/bin/chromium NODE_USE_ENV_PROXY=0 node scripts/test-director-ui.mjs** lance une copie isolée de Next et un vrai Chromium, en 1440×1000 et 375×812 : bouton de diagnostic, double clic sans double requête, cartes et preuves, proposition/annulation de tâche sans écriture, source en panne sans résultat ancien conservé et absence de débordement horizontal. Clerk et données sont simulés ; aucun micro, compte réel, API Ads, Search Console ou Supabase distant n’est validé par cet essai.

Captures et logs restent dans le dossier ignoré **e2e/output/director/**. La page et l’API de test ne sont écrites que dans cette copie jetable.
