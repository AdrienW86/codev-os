# Rapports clients : PDF, téléchargement et envoi

Cette fonctionnalité réutilise le moteur de rapports existant : les rapports restent versionnés, relus, approuvés puis envoyés manuellement ou par e-mail Resend.

## Depuis CODE-V OS

1. Ouvrir **Rapports** (`/reports`) : choisir un client, des dates inclusives (1 à 366 jours), une famille et les sources du document. Les familles proposées sont Google Ads, SEO, site web, activité et global. Confirmer la préparation, puis ouvrir le document et son PDF. La génération rapide de semaine/mois clos et la préparation Ads depuis les Campagnes restent accessibles.
2. Ouvrir le rapport. La version **client** est distincte de la version interne, qui n'est jamais jointe.
3. Cliquer sur **Télécharger le PDF**. Le téléchargement fonctionne également pour une version non approuvée, mais celle-ci est estampillée **BROUILLON - NON APPROUVÉ**.
4. Relire puis **Approuver la version** si vous voulez l'envoyer. Dans la section Envoi, confirmer l'adresse unique du client et utiliser **Envoyer le PDF par e-mail**.
5. Le destinataire reçoit le texte client et le PDF en pièce jointe. La version approuvée et son contenu font l'objet du même verrou transactionnel et de la même clé anti-doublon que les envois de rapports préexistants.

L'URL `/api/reports/[id]/pdf` exige une session administrateur Clerk et renvoie un téléchargement privé `application/pdf` non mis en cache. Ce lien n'est **pas un lien public à transmettre au client**. Il faut télécharger le document, ou utiliser l'envoi e-mail.

Le moteur PDF utilise le format A4, le logo vectoriel CODE-V existant, des mesures Helvetica pour les retours à la ligne, des tableaux avec en-têtes répétés, une pagination automatique et les caractères accentués français. Il n'a pas besoin de navigateur sans interface ni d'un fournisseur PDF tiers. Les rapports client trop volumineux sont refusés avant enregistrement au lieu d'être silencieusement tronqués. Les sections longues sont réparties en plusieurs blocs, sans perte des éléments collectés. Aucun graphique ni indicateur n'est déduit artificiellement d'une ligne de prose.

## Période et sources personnalisées

Cette préparation utilise `kind=custom` et le même moteur de versions, d'approbation et de réservation des envois. Le client, la période et les sources sont immuables. Une même clé de préparation renvoie le document existant : un double clic ou une requête rejouée ne crée ni doublon ni nouvelle version. Le bouton **Actualiser le document** relit uniquement le périmètre enregistré, crée la version suivante et invalide l'approbation.

Les sources affichent **Disponible**, **Partiel**, **Indisponible** ou **Non connecté**, avec les dates et la fraîcheur réellement connues. Les limites ne deviennent jamais des zéros. Les identifiants internes et diagnostics de migration restent dans la version interne.

- **Google Ads** : compte du client vérifié, toutes les campagnes renvoyées, Search et Local Services distincts, constats et recommandations du moteur déterministe existant. Aucun appel de modification. Les périodes suivent le fuseau du compte.
- **SEO** : propriété associée au client, historique quotidien, comparaison seulement avec couverture suffisante, requêtes/pages uniquement pour la propriété et les dates exactes, opportunités liées à des analyses vérifiables. L'absence des tables SEO V2 dégrade cette section, sans couper les autres sources.
- **Site** : projet Vercel et période exacts ; repli sur instantané clairement daté. Les contrôles du site sont des échantillons, pas une mesure d'uptime continu. Les événements ne sont pas assimilés à des conversions commerciales.
- **Activité** : dates de réalisation et diffusions effectives ; une approbation de publication seule n'est jamais une diffusion. Les tâches terminées sans date sont exclues avec une limite visible.

La migration locale `20261110000000_professional_client_reports.sql` est nécessaire. Si elle manque, le formulaire est désactivé avec une explication ; les rapports existants restent utilisables. Aucune migration distante n'est exécutée par les tests ou la préparation du lot.

## Sécurité et prérequis e-mail

- Le contenu PDF provient exclusivement de `client_content` après validation stricte. Les données internes, incidents techniques et tokens ne doivent jamais apparaître dans le PDF client.
- Une version non approuvée ne peut pas être envoyée. Modifier la synthèse ou régénérer le rapport crée une nouvelle version et invalide toute approbation antérieure.
- L'e-mail nécessite **RESEND_API_KEY**, **EMAIL_FROM**, **EMAIL_SENDING_ENABLED=true**. Sans ces variables, seuls la préparation et le téléchargement sont disponibles.
- Les envois automatiques restent soumis à la configuration de récurrence, au planificateur et à une approbation séparée. Aucun cron ni secret n'est activé par cette évolution.
- L'acceptation de l'envoi par Resend **ne garantit pas sa livraison finale** ; le suivi existant différencie acceptation, échec et incertitude, sans nouvelle tentative automatique.
- Le PDF est préparé avant la réservation d'envoi : en cas d'échec de génération, aucun e-mail n'est envoyé ou réservé.

## Tests

`tests/report-pdf.test.mjs` vérifie l'en-tête PDF, les objets, la pagination, le support du français, l'absence de contenu interne et l'accès Clerk du téléchargement.

`tests/report-email.test.mjs` vérifie les envois approuvés, la sérialisation d'une pièce jointe PDF en base64 pour Resend, les destinataires, la déduplication et les erreurs de fournisseur.

**Aucun e-mail réel n'est envoyé par les tests.** Le fournisseur réseau est simulé.
