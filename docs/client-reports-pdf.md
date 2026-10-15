# Rapports clients : PDF, téléchargement et envoi

Cette fonctionnalité réutilise le moteur de rapports existant : les rapports restent versionnés, relus, approuvés puis envoyés manuellement ou par e-mail Resend.

## Depuis CODE-V OS

1. Ouvrir **Rapports** (`/reports`) et générer un rapport hebdomadaire ou mensuel en choisissant un client. Les rapports Google Ads se préparent depuis sa fiche **Campagnes** avec un périmètre de campagne précis.
2. Ouvrir le rapport. La version **client** est distincte de la version interne, qui n'est jamais jointe.
3. Cliquer sur **Télécharger le PDF**. Le téléchargement fonctionne également pour une version non approuvée, mais celle-ci est estampillée **BROUILLON - NON APPROUVÉ**.
4. Relire puis **Approuver la version** si vous voulez l'envoyer. Dans la section Envoi, confirmer l'adresse unique du client et utiliser **Envoyer le PDF par e-mail**.
5. Le destinataire reçoit le texte client et le PDF en pièce jointe. La version approuvée et son contenu font l'objet du même verrou transactionnel et de la même clé anti-doublon que les envois de rapports préexistants.

L'URL `/api/reports/[id]/pdf` exige une session administrateur Clerk et renvoie un téléchargement privé `application/pdf` non mis en cache. Ce lien n'est **pas un lien public à transmettre au client**. Il faut télécharger le document, ou utiliser l'envoi e-mail.

Le moteur PDF utilise le format A4, une pagination automatique et les caractères accentués français ; il n'a pas besoin de navigateur sans interface ni d'un fournisseur PDF tiers. Les rapports client trop volumineux sont refusés au lieu d'être silencieusement tronqués.

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
