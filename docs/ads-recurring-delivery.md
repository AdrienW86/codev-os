# Livraison : recommandations Ads et rapports récurrents par client

Branche `feature/ads-recurring-recommendations`, depuis master `c98e3fb` (PR #14 et #15 fusionnées). Code et PR uniquement : aucune migration distante, modification de secrets, activation d’envoi/cron, campagne modifiée ou communication réelle à un client.

## Parcours livré

Depuis l’accueil : « Que me recommandes-tu pour les campagnes de Protection Nuisibles ? ». L’outil `ads_recommendations` résout le client et le périmètre suivi, puis ouvre le panneau existant. L’analyse interne est directe ; elle conserve l’autorisation administrateur, la réservation d’analyse par client et les limites de l’appel IA. Aucune modification Ads ni approbation/envoi implicite. « oui » reste sans pouvoir d’approbation.

Le dashboard utilise le même service. Résumé vocal court ; constats, preuves, priorités, Search/Local Services, périodes partielles et données manquantes restent à l’écran. L’IA réutilise le contexte commercial et les instructions globales/client ; son repli est explicitement déterministe. Les règles fixes n’utilisent pas ces instructions.

Cache persistant de cinq minutes : run terminé, même client, compte/état de connexion, périmètre exact, instructions/contexte, mode, fournisseur et modèle. Les replis IA ne sont pas mis en cache. Une actualisation explicite contourne le cache ; une connexion devenue invalide ne réutilise pas un ancien succès. Le cache concerne l’analyse ; l’assistant lit encore l’inventaire Ads pour revalider les campagnes. Un instantané serveur de moins de trente secondes évite la seconde lecture Ads pendant la même requête ; aucun instantané fourni par le navigateur n’est accepté.

Durées mesurées : résolution du client, lecture du dashboard Ads, analyse/appel IA et réponse/affichage navigateur. Transcription et lecture vocale sont mesurées dans leurs hooks ; la lecture utilise la synthèse du navigateur, sans requête TTS serveur. Les durées restent locales ou dans la trace du run, sans transcription/audio/log de contenu. L’état de chargement est visible ; aucun SLA de réponse immédiate n’est annoncé.

Dans `/advertising?client=<UUID>` et la fiche client, onglet Campagnes :

- Configuration distincte pour chaque client : activé/pause, hebdomadaire/mensuel, jour, heure et fuseau, destinataire unique confirmé par l’administrateur, campagnes/types, mode IA/déterministe, préparation seule/envoi d’une version approuvée, délai de préparation et retard maximal autorisé.
- Prochaines préparation/échéance et coupure réelle affichées. Jour mensuel absent = dernier jour du mois. L’adresse est vérifiée syntaxiquement et confirmée explicitement ; aucune preuve de délivrabilité ou de possession de la boîte n’est prétendue.
- « Préparer maintenant / voir l’aperçu » : avant la coupure, lecture des seules journées déjà closes, recommandations comprises, aperçu non enregistré/non approuvable/non envoyable. À partir de la préparation, mise en file du rapport finalisé ; traitement au prochain tick.
- « Voir le rapport en cours », version/état, destinataire figé, historique, pause et lien « Envoyer maintenant » vers la prévisualisation du rapport approuvé. Un envoi manuel vérifie à nouveau adresse, période, contenu et version avant confirmation.

## Périodes et versions

Les rapports récurrents sont de type `google_ads`, avec fréquence et configuration figées dans l’échéance ; les rapports génériques hebdomadaires/mensuels existants gardent leur moteur.

La période va d’une préparation à la suivante et utilise les jours calendaires **du compte Ads**, indépendamment du fuseau d’envoi. La journée de préparation est exclue. Exemple vendredi 18 h Paris, préparation six heures avant : dernier jour inclus jeudi ; vendredi reste incomplet et exclu. Avec une préparation avancée à jeudi, mercredi devient le dernier jour inclus. La coupure, les dates et le fuseau sont enregistrés.

Sans changement, les périodes se suivent sans trou ni recouvrement. Après modification de fréquence ou pause/reprise, le début reprend après le dernier jour finalisé du même compte et fuseau, sous verrou SQL. Une période déjà couverte est sautée. Un changement de compte/fuseau ouvre une nouvelle série explicitement bornée ; il ne retouche aucun rapport. Une pause très longue peut dépasser la limite existante de 366 jours par requête : la préparation refuse cette période plutôt que tronquer l’historique silencieusement ; traiter cet historique par rapports manuels bornés avant reprise.

Le rapport finalisé est prêt à relire, jamais approuvé automatiquement. L’approbation fige la version envoyable ; une actualisation ou modification crée une nouvelle version et invalide cette approbation. Une version envoyée ou archivée reste figée. Les changements de configuration ne changent ni destinataire ni périmètre d’une échéance existante ; ses jobs restants sont suspendus, et une nouvelle révision prépare les prochaines échéances.

## Planification et transport

Deux types dans le registre existant : `ads.report.prepare` et `ads.report.send`, traités par les mêmes jobs, baux, workers, permissions et audits. L’enqueue et l’avancement des prochaines dates partagent une transaction. Publication du rapport et réservation d’envoi vérifient encore révision/configuration, client, destinataire figé et bail du worker sous verrou.

L’évaluation des échéances peut enregistrer un blocage d’approbation sans Resend configuré. Le transport effectif reste protégé par la configuration/activation Resend et la réservation transactionnelle. La configuration autorise le transport de la version approuvée ; elle n’approuve jamais le contenu. À l’échéance :

- non approuvé : « Envoi bloqué : validation nécessaire », notification discrète et aucun envoi ; approbation tardive suivie d’un envoi **manuel** ;
- délai dépassé : pas de transport automatique ; retard admis seulement dans la fenêtre configurée (0–120 minutes, cinq par défaut) ;
- préparation seule, pause ou configuration remplacée : aucun envoi automatique ;
- même version : une seule réservation, même avec plusieurs appels ; résultat réseau incertain conservé, sans répétition aveugle ;
- « Accepté par Resend » signifie accepté par l’API, pas livré au destinataire.

Les erreurs/reprises de préparation apparaissent dans l’historique et les jobs de Paramètres → Observabilité. Les notifications réutilisent les préférences existantes ; les notifications verrouillées ne contiennent ni nom de client, chiffres ni texte du rapport.

## État distant vérifié et ordre des migrations

Audit en lecture seule le 10 octobre 2026, projet `lehlbcnpufkllcykvtlg` : 26 migrations appliquées ; dernière `20261010055802`, nom `20261015000000_codev_os_core`. Les sept fichiers suivants ne sont **pas** appliqués :

1. `20261016000000_google_ads_reports.sql`
2. `20261016000001_whatsapp_drive_ingestion.sql`
3. `20261017000000_google_ads_campaign_tracking.sql`
4. `20261018000000_google_ads_client_context.sql`
5. `20261019000000_report_delivery_claims.sql`
6. `20261020000000_notifications_web_push.sql`
7. `20261020000001_ads_recurring_reports.sql` — seul nouveau fichier de ce lot.

Après une autorisation distincte d’application : sauvegarder le projet et vérifier une restauration sur copie, relire à nouveau l’historique distant, appliquer uniquement les fichiers encore manquants dans cet ordre via le mécanisme de migration Supabase qui enregistre lui-même son historique, puis vérifier tables/RLS/RPC/versionnement. Rejouer chaque fichier séparément pour identifier le premier échec. Aucune écriture SQL manuelle dans `schema_migrations`.

**Attention à la CLI :** les versions historiques distantes sont des dates d’application, différentes des préfixes locaux bien que les noms correspondent. Ne pas lancer un `db push` global supposant les historiques alignés : il pourrait proposer de rejouer des migrations historiques. Utiliser d’abord le diagnostic/dry-run ; toute réparation d’historique par la CLI exige une revue séparée des migrations effectivement appliquées. Le connecteur `apply_migration` peut appliquer les seuls fichiers manquants et enregistrer leur historique sans reconstruire les anciennes versions. Aucune réparation/application n’a été faite ici.

Tant que ces tables manquent, le panneau signale les migrations nécessaires ; le tick existant ignore la configuration récurrente absente. Aucun envoi récurrent ne démarre par le simple déploiement du code.

## Configuration du déploiement après autorisation

Resend : domaine vérifié dans son dashboard, DNS SPF/DKIM exactement fournis par Resend et politique DMARC adaptée. Vérifier `RESEND_API_KEY`, `EMAIL_FROM`, puis activer `EMAIL_SENDING_ENABLED=true` uniquement après validation de l’opération. Le formulaire indique la configuration manquante sans afficher les secrets. Vérifier un destinataire choisi pour chaque client, sans copier automatiquement son adresse de fiche.

Déclencheur : `/api/internal/scheduler/tick`, `Authorization: Bearer <CRON_SECRET>`. Les envois exigent un déclenchement fréquent **et** une capacité suffisante pour vider les jobs avant la fin de leur fenêtre. Une minute est la cadence proposée : Vercel Pro/Enterprise avec expression `* * * * *`, ou ordonnanceur externe authentifié. Conserver les jobs idempotents ; surveiller retards, erreurs, backlog et durée de fonction (la route existante déclare 300 secondes, à vérifier contre les limites du plan réel). Aucun `vercel.json`, secret ni fréquence réelle n’est modifié par ce lot.

Vercel Hobby limite le cron à une fois par jour, dans une fenêtre horaire : il ne permet pas de promettre vendredi à 18 h, ni de gérer séparément préparation et envoi ce jour-là. Même avec une cadence minute, 18 h est l’échéance cible, pas une garantie réseau absolue. Choisir une marge de retard explicite compatible avec la cadence et la file ; au-delà, l’envoi devient manuel. L’appel existant traite jusqu’à cinq jobs séquentiellement : adapter la durée autorisée de fonction/la capacité des workers à la charge avant d’activer le transport.

VAPID/Web Push : configuration et autorisation par appareil identiques au guide [notifications-pwa.md](notifications-pwa.md). Les notifications internes fonctionnent indépendamment d’un appareil push configuré. WhatsApp garde sa configuration séparée ; cette livraison n’active aucune ingestion ni connexion.

Références vérifiées : [limites Cron Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing), [domaines Resend](https://resend.com/docs/add-a-domain).

## Validation de ce lot

- `NODE_USE_ENV_PROXY=0 npm test` : **650 réussis, zéro échec, 28 ignorés** (intégrations facultatives sans base/configuration locale). La variable désactive le proxy global injecté par cet environnement Node 24 pour permettre le test de rebinding DNS avec son propre `lookup` ; aucun contrôle SSRF applicatif n’est désactivé.
- `npm run lint`, `npm run typecheck` et `npm run build -- --webpack` : réussis. Webpack est utilisé parce que le lien vers les dépendances de ce workspace sort de la racine que Turbopack accepte ; le build de production compile toutes les routes.
- Rejeu de **toutes** les migrations, y compris WhatsApp, sur PostgreSQL WASM/PGlite et 31 assertions SQL de ce lot, plus refus attendus de révision périmée/snapshot modifiable. Isolation des rôles/RLS, publication transactionnelle/version unique, bail perdu, destinataire figé, approbation, réservation unique, résultat incertain, notifications dédupliquées, pause et continuité vérifiés. Une seule connexion, aucune course native prétendue.
- Chromium 153 réel, **1440×900 et 375×812** : configuration/rechargement, aperçu non approuvable, rapport en cours bloqué, approbation, destinataire figé et faux Resend ; demandes écrites et voix continue simulée ouvrant les recommandations sans Confirmer. Micro fermé pendant la synthèse, aucun débordement horizontal ni erreur JavaScript. Commande reproductible : `E2E_CHROMIUM=/chemin/chromium node scripts/test-recurring-ui.mjs` (ou Chromium Playwright installé). Le harnais remplace Clerk/storage dans une copie temporaire seulement et refuse les destinations fournisseur non simulées.
- Test natif facultatif : `CODEV_CORE_TEST_DATABASE_URL=postgres://…@127.0.0.1:…/codev_core_test node --test tests/ads-recurring-db.test.mjs`. Base dédiée jetable, aucun hôte distant accepté ; quatre sessions doivent réserver exactement un envoi. **Non exécuté** ici, serveur PostgreSQL natif indisponible. Les validations utilisent des données et fournisseurs simulés ; aucune API Google Ads/IA/Resend réelle, aucun vrai micro ou Safari/iOS, aucun envoi distant. Le rejeu PostgreSQL WASM/PGlite a une seule connexion ; il ne valide pas une course entre workers natifs. Une suite native facultative exerce quatre réservations indépendantes quand une base locale jetable est disponible.

## Tester Protection Nuisibles après revue

1. Après application autorisée des migrations sur une copie/preview, ouvrir `/advertising?client=94d94845-3c55-4f28-8e28-1252ec444aeb`. Vérifier l’association au compte `9206382986`, les campagnes suivies et leur propriétaire ; comparer les totaux et la période avec Google Ads.
2. Renseigner le contexte commercial et les instructions spécifiques ; demander la phrase de recommandation à l’accueil, à l’écrit puis à la voix. Vérifier client/campagnes/période, preuves, séparation Local Services, moteur/repli affiché et absence de confirmation d’analyse. L’appel IA réel est une validation distincte et peut coûter des jetons.
3. Configurer d’abord **préparation seule** : hebdomadaire, vendredi 18 h, Europe/Paris, six heures avant, campagnes explicites et adresse choisie/confirmée. Vérifier prochaines dates, coupure du jeudi et aperçu non approuvable avant préparation. Ne pas activer un destinataire réel pour ce test sans autorisation.
4. À l’échéance de préparation, déclencher le tick dans l’environnement de test, relire le rapport et ses recommandations. Approuver puis modifier : nouvelle version, approbation annulée. Vérifier qu’un rapport non approuvé bloque l’envoi et produit une notification.
5. Prévisualiser « Envoyer maintenant », vérifier version, période et adresse figée. Tester le transport avec un fournisseur simulé ou une boîte de test explicitement autorisée, jamais implicitement vers le client. Après approbation et configuration/autorisation séparées de Resend/cron, tester l’envoi récurrent dans sa fenêtre, son unicité et la pause.
