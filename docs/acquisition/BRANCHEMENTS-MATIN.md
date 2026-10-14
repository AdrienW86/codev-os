# Acquisition — raccordements du matin (CODE-V OS)

> Etat au 14/10/2026 : socle SQL PR #49 dans master ; interface/diagnostic déclaratif PR #50 et formulaires CRM PR #51 fusionnés. **Aucune preuve de fonctionnement SMTP, IMAP, recherche automatique, qualification IA ou expédition**. Le code actuel ne comporte pas de transport e-mail Acquisition actif. Ne promettre « plus qu'à brancher » qu'après tests E2E.

## Ordre des opérations
1. **Base de recette d'abord** : tester `supabase/migrations/20261107000000_acquisition_foundation.sql` sur un projet isolé ; vérifier RLS, contrats de clés étrangères, validations, et vues mono-admin. Une fois validé, appliquer en production, puis contrôler dans l'historique.
2. **Domaine** : code-v.net (si réellement commandé) ; créer `contact@code-v.net` chez Infomaniak Starter et vérifier les fonctions SMTP/IMAP du forfait réel. Conserver MX existants, vérifier SPF (un seul enregistrement), DKIM et DMARC ; ne pas copier les secrets dans les tickets.
3. **Autorisation fournisseur** : obtenir réponse écrite d'Infomaniak à la demande « envois B2B personnalisés, contacts professionnels publics, jusqu'à 50/j ouvrés, automatisés via SMTP », en complément de la conformité des listes et sources. Tant que non confirmé, aucun envoi à des tiers.
4. **Vercel > Variables d'environnement** : renseigner uniquement côté serveur les variables ci-dessous. Configurer séparément preview/production ; redéployer après changement.
5. **Initialisation CRM** : ouvrir /acquisition ; créer l'espace interne CODE-V avec sa confirmation, arrêt d'urgence actif et limite 0 ; créer un prospect factice contrôlé puis un modèle désactivé, sans envoi.
6. **Connecteurs** : installer/implémenter la couche d'envoi SMTP et la couche IMAP dans une PR dédiée. Elles n'existent pas encore : le tableau « Connecteurs » ne vérifie que la présence des variables, pas l'authentification ou les échanges.
7. **Tests locaux uniquement** : envoyer à des boîtes possédées par CODE-V, répondre, vérifier réception, dédoublonnage, timeouts incertains, désinscription, erreurs et état d'urgence.
8. **Découverte** : choisir une source avec API/droit d'utilisation documenté ; pas de scraping interdit. Mettre une limite par source, conserver URL et date vérifiée, rejeter les preuves insuffisantes.
9. **IA** : définir schémas Zod, instructions de non-invention, quotas et coûts. Aucun brouillon sans preuve ; revue humaine obligatoire.
10. **Moteur d'envoi** : implémenter transaction de claim durable, idempotence, fenêtres locales, limite combinant premiers mails et relances, liste d'exclusion, journal d'audit et arrêt manuel.
11. **Conditions d'activation** : approbation fournisseur + tests E2E + validation RGPD + surveillance des rebonds/plaintes + domaine authentifié.
12. **Démarrage** : 5 e-mails réels/jour seulement si toutes conditions validées ; augmenter uniquement sur résultats réels jusqu'à **50 envois au total par jour**, relances incluses.

## Variables serveur attendues (aucune valeur sensible dans Git)
```dotenv
ACQUISITION_SMTP_HOST=mail.infomaniak.com
ACQUISITION_SMTP_PORT=587
ACQUISITION_SMTP_USERNAME=
ACQUISITION_SMTP_PASSWORD=
ACQUISITION_IMAP_HOST=mail.infomaniak.com
ACQUISITION_IMAP_PORT=993
ACQUISITION_IMAP_USERNAME=
ACQUISITION_IMAP_PASSWORD=
ACQUISITION_DISCOVERY_API_KEY=
OPENAI_API_KEY=
```

> IMPORTANT : ce sont des **variables de préparation** lues par le diagnostic ; actuellement elles ne déclenchent pas d'envoi et ne démontrent pas la réussite d'une connexion. Le fournisseur de découverte et sa clé restent à choisir. Ne pas créer de clés fictives, ne pas enregistrer de mots de passe client en base en clair. Prévoir un coffre de secrets adapté à chaque entreprise.

## Architecture des connecteurs à développer
- `DiscoveryProvider` : `discover(category, area, limit)` -> sources, entreprises, dates, droits ; aucune adresse non justifiée.
- `EmailTransport` : `verify(sender)`, `sendApproved(message, idempotencyKey)` -> identifiant externe, état confirmé/incertain ; aucune reprise aveugle.
- `InboxProvider` : synchronisation incrémentale et idempotente, corrélation message-id/thread, gestion réponse humaine et STOP.
- `AiProspectReviewer` : extraction structurée du signal, score explicable, génération contrôlée du modèle, pas de jugement inventé.
- `AcquisitionScheduler` : file durable distincte des Publications, refuse tout travail lorsque l'arrêt d'urgence est actif ; décompte global par expéditeur.

## Tests de sécurité indispensables
- Utilisateur Clerk non administrateur rejeté sur routes et Server Actions.
- Une entreprise ne peut consulter/modifier les enregistrements d'une autre ; secrets jamais renvoyés au navigateur.
- Source falsifiée/URL non HTTPS, domaine privé/localhost, données invalides : rejeter.
- Prospect déjà contacté, opposition antérieure, rebond dur, fournisseur non autorisé : jamais envoyé.
- Même job exécuté deux fois ou délai réseau incertain : aucun doublon.
- Erreur de migration ou absence de tables : diagnostic clair, aucun contournement.
- Ne jamais activer une boîte mail par simple présence de variables.

## État et périmètre
Le dashboard actuel est une **interface de configuration et de collecte manuelle**, pas une machine autonome. Les paramètres et la documentation peuvent être préparés maintenant ; les connecteurs actifs, la collecte quotidienne et l'envoi n'ont pas encore été développés ni validés. Pas de mise en production automatique depuis ce guide.
