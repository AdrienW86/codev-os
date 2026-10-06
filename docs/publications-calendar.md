# Lot 3 — calendrier éditorial déterministe

Le Lot 3 est implémenté dans le dépôt. Après validation locale, sa migration
a été appliquée au Supabase distant sur autorisation explicite le 5 octobre 2026.
Voir [le rapport d’application](publications-calendar-applied.md).
Les sections ci-dessous décrivent la livraison locale avant cette autorisation.

## Rapport de livraison

1. **Modèle** : une cadence par projet, des réservations datées immuables et des
   jobs de planification séparés des jobs de génération/publication existants.
2. **Migration** : `20261005205057_publications_editorial_calendar.sql`, créée
   avec `supabase migration new`. Trois tables : `publication_cadences`,
   `publication_calendar_slots`, `publication_planning_jobs`. Ajout de
   `publications.creation_origin`. Aucune baseline appliquée au distant.
3. **Cadences** : Réseaux sociaux, deux créneaux lundi/vendredi à 12 h, Facebook
   et Instagram ; GBP, un créneau lundi à 12 h par défaut. Un ou deux créneaux,
   jours/heures modifiables, fuseau IANA, horizon de 1 à 12 semaines (défaut 4).
   `enabled=false`, `auto_create_slots=false`, validation obligatoire.
4. **Moteur** : `buildEditorialCalendar()` est une fonction pure ; sa réalisation
   transactionnelle est `publication_ensure_calendar`. Dates civiles, semaines
   ISO du lundi et conversions du fuseau sont explicites. Les heures inexistantes
   au printemps deviennent des conflits ; une heure ambiguë en automne prend
   l’instant le plus tardif, comme PostgreSQL. Aucun déplacement de contenu.
5. **Idempotence** : unicités projet/semaine/slot, projet/instant et publication
   liée ; keys uniques des jobs ; verrou de projet compatible avec les FK et
   verrou transactionnel client/semaine partagé avec le formulaire manuel.
   La règle historique de deux slots **par client** devient deux **par projet**,
   afin de permettre Social et GBP simultanément. Les publications historiques
   sans projet conservent leur unicité client/semaine/slot.
6. **Calendrier** : `/publications/calendar`, périodes semaine/mois, filtres client,
   projet, plateforme, date de référence et statut. Affichage date/heure/fuseau,
   client, projet, sujet, plateformes, statut, révision, validation et origine.
   Les projections libres ne sont pas des réservations persistées. Les statuts
   planifié/publié/erreur reposent sur les deliveries réelles, jamais sur une
   approbation seule. Une date manuelle conflictuelle reste affichée à sa date
   réelle ; le créneau proposé est signalé séparément en conflit.
7. **Placeholders** : option du bouton « Générer les créneaux ». Racine `draft`,
   origine `system`, sujet « Contenu à préparer », aucune révision, variante,
   image ou texte créé. La première rédaction manuelle peut créer la révision 1
   en utilisant la même protection contre les écritures périmées que le Lot 2.
   Origines permises : manual, system, agent ; origine de création immuable.
8. **Jobs** : `ensure_calendar_slots` trace l’exécution manuelle réussie ;
   `prepare_publication` et `submit_for_review` restent bloqués. Identités,
   tentatives, maximum de tentatives, date de reprise et dernier diagnostic
   préparent un futur exécuteur. Créations et transitions sont journalisées.
   Aucun worker, scheduler ou mécanisme de retry autonome n’est activé.
9. **Périmètre** : le client est dérivé du projet par la RPC. FK composites
   cadence/projet/client, slot/publication/projet/client et job/révision protègent
   les rattachements. Un job ne peut pas viser la publication d’un autre slot.
   Un projet doté d’une cadence conserve son type et son client.
10. **Agent futur** : `buildPublicationsAgentContext` ne fait que lire le contexte.
    Il exige un agent activé, scope project confirmé, assignations client ET projet
    actives. Client/projet, règles, cadence, réservations, racines/révisions/variantes
    historiques du périmètre, refus, photos avec droits confirmés, slots à remplir
    et jobs sont fournis. Aucun secret ni URL publique de média n’est transmis.
    Aucun agent, run ou recommandation n’est créé.
11. **Validation** : le placeholder doit être rédigé avant soumission. La boucle
    draft → pending_review → approved/rejected reste celle du Lot 2. Un refus
    conserve son motif et son ancienne review ; une nouvelle révision ne reprend
    aucune approbation. La génération de texte reste hors périmètre.
12. **Sécurité** : Clerk → requireAdmin → serveur → client privilégié. Toutes les
    nouvelles entrées serveur sont protégées. RLS sur les trois nouvelles tables,
    aucune policy publique, aucun accès anon/authenticated, RPC serveur seulement.
    Historique non supprimable ; journal append-only existant conservé.
13. **Tests Node** : 15 tests dédiés au calendrier, aux filtres, à l’interface,
    à l’authentification et au contexte agent. La suite complète comprend
    148 tests, SQL compris : **148 réussis, 0 échec, 0 ignoré**.
14. **Tests SQL** : reconstruction fidèle de la baseline historique et des huit
    migrations locales, deux fois depuis une base vide. Fixtures synthétiques,
    y compris une ancienne publication et ses deux reviews conservées. Tests
    des permissions, FK, doublons, calendrier, DST, placeholders, origines,
    première révision, refus, audit et rollback des jobs. Deux sessions simultanées
    vérifient une réservation unique ; une autre course oppose formulaire manuel
    et réservation sans deadlock ni doublon. **78 contrôles par reconstruction,
    deux reconstructions réussies, puis deux scénarios de concurrence réussis.**
15. **Lint** : `npm run lint`, réussi.
16. **Types** : `npm run typecheck`, réussi (génération des types Next puis TypeScript).
17. **Build** : `npm run build`, réussi, avec credentials factices dans le processus de
    validation et télémétrie désactivée, sans modification du fichier `.env`.
18. **Limites** : migration distante non appliquée ; aucune automatisation
    autonome ni génération de contenu. Au maximum deux créneaux par projet et
    semaine. Le replanification explicite et le futur exécuteur avec reprises
    nécessiteront un lot séparé. Vue calendrier sous forme de tableau chronologique
    filtré par semaine/mois ; lecture paginée des collections Publications.
19. **Kill switch** : aucune écriture sur `publication_settings`. Les tests
    confirment `emergency_stop=true` et les trois flags generation/automation/
    publishing à false. Le distant n’a pas été modifié dans ce lot.
20. **Publication externe** : aucune ; aucun connecteur Meta, Instagram ou GBP
    ajouté ou appelé, aucune delivery et aucun job de diffusion créé par le moteur.
21. **IA** : aucun appel. Arrêt à la fin du Lot 3 ; Agent Publications IA non lancé.

## Validation reproductible

```powershell
./scripts/test-publications-local.ps1 -PostgresBin './.local/runtime/pgsql-runtime/pgsql/bin'
```

Le script crée un cluster PostgreSQL 17.11 jetable, strictement sur 127.0.0.1,
avec six bases de test séparées, puis l’arrête en fin d’exécution. Les données
réelles et les credentials distants ne sont pas utilisés. La fixture locale
vide les contraintes différées avant les DDL pour représenter un historique
déjà validé, comme les données persistées d’une base existante.

Dernière exécution complète : code retour **0**, cluster local arrêté.

| Suite SQL | Contrôles par reconstruction | Reconstructions réussies |
|---|---:|---:|
| Publications Lot 1 | 213 | 2 |
| Agent Project Scope | 350 | 2 |
| Reproduction du schéma distant | 968 | 2 |
| Permissions historiques | 1 576 | 2 |
| Workspace et décisions Lot 2 | 55 | 2 |
| Calendrier Lot 3 | 78 | 2 |

Ces six suites sont également réellement exécutées par `npm test` avec leurs
bases locales configurées : aucun test SQL ignoré. Le calendrier a été compilé
comme route dynamique protégée. Son rendu serveur est testé ; aucune session
Clerk réelle ni E2E navigateur connecté au distant n’a été utilisée pour ce lot.

Corrections réalisées avant la validation finale : permission EXECUTE explicite
sur la fonction utilisée par le CHECK de cadence ; événements attribués à
l’admin qui déclenche le test ; allocation manuelle au niveau projet ; liaison
automatique d’un brouillon manuel à sa réservation ; verrou de projet sans
conflit avec les FK pendant la course manuel/calendrier ; conservation des dates
réservées et traitement explicite des transitions DST. Les échecs injectés dans
l’audit et les jobs annulent racines, slots, jobs et événements de la RPC.

Les jobs dont la révision est encore inconnue restent bloqués. Le futur
exécuteur devra créer des jobs avec une identité propre à la nouvelle révision,
contrôler le pointeur de révision courant et les approvals, puis appliquer ses
reprises bornées ; il ne devra pas modifier l’identité des jobs historiques.

## Avant un futur déploiement autorisé

Inspecter à nouveau les objets concernés, l’historique des migrations, les
flags de sécurité et les jobs distants ; disposer d’une sauvegarde actuelle
restaurable. Appliquer seulement la nouvelle migration après autorisation, sans
baseline et sans rejouer les versions déjà enregistrées. Vérifier les trois
tables, RLS, permissions, RPC et ancienne publication, puis ouvrir le calendrier.
L’activation d’une cadence ne lance rien en arrière-plan. Le bouton admin peut
réserver les slots pendant que le kill switch demeure actif.
