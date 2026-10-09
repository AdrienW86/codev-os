# Publications — Lot 2 manuel

Implémenté et installé sur `codev-os`, 5 octobre 2026. Préparation humaine uniquement : aucune génération, API Meta/GBP, publication externe, tâche automatique ou changement de scope d'agent.

## 1. Pages

- `/publications` : liste, titre, client/projet, statut, plateformes, révision actuelle, date cible, dernière modification. Recherche sur titre, client/projet, angle, source et variantes ; filtres client/projet/plateforme/statut/période. Dernière modification en premier.
- `/publications/new` : formulaire client/projet dépendant, titre, angle, source, cible facultative, semaine facultative et slot facultatif.
- `/publications/[id]` : statut, contexte, source, variantes, médias, aperçus, validation, révisions et journal.
- `/publications/[id]/edit` : nouvelle révision complète ; client et identité semaine/slot restent conservés.

Le distant contient actuellement deux clients et aucun projet. Créer d'abord un projet « Réseaux sociaux » ou « Google Business Profile » pour le client dans l'interface Projets. Aucun projet ou client de démonstration n'a été créé sur le distant.

## 2. Workflow

Création via `publication_save_draft` → `draft`, soumission explicite via `publication_submit_manual` → `pending_review`, décision via `publication_review_manual` → `approved` ou `rejected`. Le refus exige un motif. Le rejet manuel n'insère aucun job de régénération. Les anciennes RPC restent disponibles pour la compatibilité du socle ; les nouveaux formulaires utilisent exclusivement les RPC manuelles.

Le slot omis est choisi sous verrou transactionnel client/semaine parmi 1 et 2 ; un troisième contenu est refusé. La semaine omise est dérivée de la cible ou de la semaine actuelle. La date cible est éditoriale : elle ne crée aucune livraison programmée.

## 3. Révisions

Chaque enregistrement éditorial crée une révision et ses variantes, avec titre, angle, source, date cible, auteur Clerk et projet. Historique immuable, numérotation, date, auteur et contenu affichés. Nouvelle révision en brouillon, aucune approbation héritée. Révision attendue contrôlée sous verrou ; édition ou validation périmée refusée.

La création réutilise la RPC de création par projet ; la révision réutilise le helper transactionnel de snapshots et les protections existantes, avec une mise à jour atomique du contexte racine. Les champs historiques absents restent NULL, sans auteur ou contenu inventé.

## 4. Variantes

Facebook/Instagram pour « Réseaux sociaux », GBP pour « Google Business Profile ». Une variante par plateforme et révision, texte manuel, titre et CTA facultatifs dans la metadata existante. Vocabulaire fermé, pas de configuration de credentials. Cohérence client/projet et projet/plateforme contrôlée dans le service serveur et par les contraintes/triggers SQL. Aucun nouveau modèle parallèle de variantes.

## 5. Médias

Bucket `publication-images` privé, versionné avec la migration. JPEG/PNG/WebP, 786 432 octets maximum (768 Ko), provenance et confirmation des droits obligatoires. Vérifications MIME et signatures de fichier, chemins UUID dérivés du client/publication, hash SHA256, aucun nom de fichier fourni par le navigateur utilisé comme chemin.

Upload par Server Action et SDK serveur, puis enregistrement/audit via RPC. Si l'enregistrement échoue, tentative de suppression de l'objet non référencé. Aucun écrasement Storage (`upsert=false`). Aperçus par URLs signées de 120 secondes, sans URL publique permanente ni proxy d'image susceptible de prolonger leur cache.

Retrait/remplacement contrôlé : charger l'image, puis l'associer/désassocier dans une nouvelle révision. Les fichiers et associations historiques restent conservés ; aucune suppression physique d'un média référencé. Les aperçus montrent le texte, titre, CTA et les images ordonnées de la bonne variante.

## 6. Validation

Soumission et décision liées à la révision actuelle. Une décision couvre atomiquement toutes les variantes de cette révision. Qui/quand/révision/motif visibles. Les validations anciennes restent affichées comme historiques et ne valident jamais une nouvelle révision.

## 7. Journal

Lecture seule, libellés lisibles : création, révision, projet modifié, variante enregistrée, upload, association/retrait d'image, soumission, décision. Les RPC insèrent ces événements dans leur transaction ; un audit défectueux annule les écritures éditoriales. Journal, révisions, variantes, reviews et médias sont lus avec pagination, sans troncature au premier plafond Supabase.

## 8. Sécurité

Clerk → requireAdmin → Server Actions/services server-only → client Supabase privilégié. Les composants clients ne possèdent aucun SDK métier ni secret. Garde sur chaque action/service, validation serveur, erreurs contrôlées, texte React échappé. RLS inchangée sur les 27 tables applicatives, aucune policy publique ou Storage ajoutée. Les quatre nouvelles RPC sont SECURITY INVOKER, search_path pg_catalog, exécutables par service_role seulement, anon/authenticated refusés.

L'accès Storage serveur sans policy navigateur suit le fonctionnement documenté par [Supabase Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control). Les aperçus utilisent [createSignedUrl](https://supabase.com/docs/reference/javascript/storage-from-createsignedurl), avec durée explicite.

## 9. Migration

`supabase/migrations/20261005000005_publications_manual_workspace.sql`, testée deux fois localement puis appliquée sur le distant. Nom enregistré `20261005000005_publications_manual_workspace`, version générée par le connecteur `20261005194148`. SHA256 `1B8FC746D824E36DE03D1CEE18A71E062EC07C12E622EB265EFB7EC9CBF03981`.

Ajoute les champs éditoriaux des révisions, target_date racine, les quatre RPC manuelles et le bucket. Ajuste les helpers de validation/snapshot existants pour permettre le titre/CTA et les mises à jour éditoriales versionnées. Ne touche ni aux settings ni aux scopes agents. La baseline locale n'a pas été appliquée au distant.

Le stockage est simulé par une table buckets locale pour tester le DDL et ses valeurs ; ce fixture n'est jamais appliqué au distant. L'existence, la confidentialité, la limite et l'accessibilité backend du bucket réel ont été vérifiées ensuite avec SQL read-only et `storage.getBucket`.

## 10–14. Tests

| Contrôle | Résultat |
| --- | --- |
| Tests Node complets | 128/128 réussis, 0 échec, 0 ignoré, y compris les cinq intégrations SQL locales |
| Dernier contrôle ciblé après messages/journal | 26/26 réussis |
| SQL Lot 2 | 37 assertions réussies par rebuild × 2 ; workflow, variantes, scope, slots, médias, événements, audit rollback, révisions périmées et contraintes immédiates |
| SQL historiques | 6 214 assertions réussies sur les suites de reconstruction existantes |
| Total de la phase SQL dédiée | 6 288 assertions réussies ; intégrations rejouées également par npm test |
| lint | Réussi, aucune erreur ni warning |
| typecheck | Réussi |
| build | Réussi ; les quatre routes sont compilées et dynamiques |

Commandes : `scripts/test-publications-local.ps1 -PostgresBin .local/runtime/pgsql-runtime/pgsql/bin`, qui enchaîne les suites SQL, npm run lint, npm run typecheck, npm run build et npm test. Les contrôles utilisent des clusters loopback et des données fictives ; le build reçoit des variables de validation, aucune génération ou API métier distante. Les clusters sont arrêtés à la fin. Journaux dans `.local/lot2-final-validation.log`, `.local/lot2-ui-final.log`, `.local/lot2-build-final.log`.

Les tests Node couvrent non-admin refusé avant DB/Storage, formulaire/date/slots/assets, sélection des plateformes, RPC avec acteur de session, URLs signées de 120 secondes, pagination au-delà d'une page et nettoyage après enregistrement d'image refusé.

## 15. Limites / observations

- Upload réel de bout en bout et nouveaux écrans dans une session navigateur Clerk authentifiée non exercés ici : aucun navigateur authentifié disponible. Couverture des services/Storage par tests Node, DB par SQL local, et bucket réel vérifié en lecture. Le serveur local est relancé et prêt pour cette revue.
- Aucun projet distant actuellement ; le premier contenu exige la création humaine d'un projet compatible.
- Images limitées à 768 Ko ; pas de vidéo, transformation d'image avancée, suppression physique d'historique ou publication externe.
- Storage et Postgres ne partagent pas une transaction distribuée : une interruption entre upload et enregistrement peut laisser un objet non référencé ; la compensation traite les échecs explicites, sans worker de nettoyage automatique.
- Le comptage distant final des tâches est 2, contre 1 lors du rapport historique. Aucune écriture de ce lot n'a visé les tâches ; l'origine de cet ajout n'est pas attribuée. Les autres comptages historiques restent 2 clients, 0 projet, 2 agents, 1 assignation/run/recommendation/action/message et 15 audits.
- Les versions enregistrées par le connecteur diffèrent des timestamps locaux : préserver la correspondance documentée avant une future utilisation de la CLI.

## 16–17. État final

Après migration : 0 publication, 0 job, 0 livraison, aucun contenu de test créé sur le distant. Les deux agents restent scope=client et review_required=true. Backend SDK : lectures clients/projets/tâches/agents/recommendations/actions/runs/publications/settings réussies. Les routes locales non authentifiées redirigent vers sign-in, sans contournement Clerk.

generation_enabled=false, automation_enabled=false, publishing_enabled=false, emergency_stop=true, confirmés après migration et lors des lectures SDK. Aucun code de ce lot ne les modifie.

Aucune publication externe, aucun Meta/GBP, Google Ads mutate, email, IA, worker ou cron. Aucun Agent Social/GBP créé. Arrêt à la fin du Lot 2.
