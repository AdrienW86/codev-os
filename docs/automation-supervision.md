# Supervision et exécution manuelle des automatisations

**Paramètres → Automatisations** sépare la prochaine échéance, le statut de configuration et la preuve du dernier job. `last_run_at` date une mise en file, pas une réussite. Les états affichés distinguent jamais exécutée, planifiée, en cours, réussie, échouée, ignorée, annulée, en retard et validation nécessaire.

Chaque automatisation ouvre un historique en lecture seule des 50 derniers jobs associés. Les liens de résultat viennent des identifiants réellement enregistrés par le handler. La version actuelle du rapport est relue : une réussite de préparation ne signifie ni approbation, ni envoi, ni livraison. Un résultat manquant reste explicitement indisponible. Les anciennes demandes manuelles sans lien d’automatisation ne sont pas inventées dans cet historique.

Le bouton **Exécuter maintenant** réserve uniquement le job demandé par une mise à jour conditionnelle de sa clé, de son état, de son compteur de tentatives, de son budget et de son échéance. Un clic ne traite plus d’autres travaux de la file globale. Les demandes manuelles sont rattachées à l’automatisation. Les jobs futurs, épuisés ou déjà pris ne sont pas exécutés. Les baux expirés restent du ressort du planificateur existant.

Le moteur vérifie le bail avant le traitement, après les lectures de préparation et avant le handler, puis lors de la clôture du job. Un worker remplacé ou expiré ne peut pas annoncer une réussite ni démarrer le handler après une perte de bail observée. Les handlers avec des effets externes conservent leurs propres réservations et garde-fous existants.

Cette livraison utilise uniquement les tables et RPC déjà présents sur master. **Elle n’applique aucune migration et n’active aucun cron.** La mise en file transactionnelle du job et de sa prochaine échéance est préparée séparément dans `20261111000000_atomic_automation_enqueue.sql` ; elle ne doit pas être déployée avant autorisation et vérification de cette migration. Le comportement historique de mise en file planifiée est conservé dans ce lot sans migration.

Tests : modèle d’états, droits administrateur et simulation, liens interclients, relecture de version, refus des workers périmés, réservation ciblée et courses entre workers. Le test PostgreSQL natif utilise une base jetable loopback ; les essais Chromium/Next desktop et mobile utilisent Clerk et stockage simulés, sans appel fournisseur ni création de job en lecture. Ces tests ne constituent pas une validation de l’environnement de production ou de PostgREST réel.
