# Agent Avis Google

Agent de l’équipe **Réputation** (`reviews` dans `lib/harness/charter.ts`). Il répond à chaque avis Google des clients dans leur voix, signale tout de suite les avis négatifs et envoie une demande d’avis après chaque chantier enregistré.

## Fonctionnement

| Étape | Où | Ce qui se passe |
| --- | --- | --- |
| Relevé | étape `google_reviews` du planificateur, toutes les 2 heures par client (3 clients par passage, nouvel essai 1 h après un échec) | Lecture des 50 derniers avis de chaque fiche connectée (My Business API v4, connexion Google Business Profile existante). Au premier relevé, seuls les avis sans réponse de moins de 30 jours reçoivent un brouillon ; les plus anciens restent « Sans réponse » (bouton « Rédiger une réponse »). |
| Alerte | dès le relevé | Avis de 3 étoiles ou moins sans réponse : notification `negative_review` (cloche et push) vers `/avis?client=…` et incident (`reviews:<client>:<avis>`, élevé pour 1 et 2 étoiles), résolu à la publication d’une réponse, à « Ne pas répondre » ou si une réponse apparaît sur Google. |
| Brouillon | même étape, 3 par passage, avis négatifs d’abord | IA (famille rédaction, budget IA du client, cadre de mission) avec le ton et la signature réglés, les consignes de communication et les faits confirmés du client (mémoire client). Contrôle : aucun chiffre, lien, e-mail, téléphone ou promesse (remboursement, gratuité, garantie…) absent de l’avis et des faits, aucun terme exclu, pas de tiret long, pas de mélange tu / vous, longueur bornée. Deux essais par passage ; 3 passages en échec → « À traiter ». |
| Publication | `/avis` | « Publier sur Google » (case de confirmation obligatoire pour un avis négatif) → `reviews.updateReply`. Réservation en base : une seule publication par avis. |
| Publication automatique | réglage du client, désactivée par défaut | Avis 5 étoiles (ou 4 et 5) seulement, après un délai de relecture (12 h par défaut). Jamais pour un avis de 3 étoiles ou moins (contrainte en base). Une réponse modifiée à la main n’est jamais publiée automatiquement. |
| Demande d’avis | `/avis` → « Demander un avis après un chantier » | E-mail (Resend) au client final, au jour du chantier + délai réglé, entre 9 h et 19 h (Paris), avec le lien « Laisser un avis » (saisi ou détecté sur la fiche via la Business Information API). Une adresse n’est sollicitée qu’une fois tous les 180 jours ; adresses désinscrites ou en rebond exclues ; coordonnées effacées 90 jours après. Aucune contrepartie (règles Google). |

La boîte « À valider » montre les réponses prêtes à publier (catégorie cruciale « Réponses publiques ») ; le Directeur lit le point de situation de l’agent ; « Lancer une action » → « Relever les avis Google » relève un client tout de suite.

## Pré-requis

- Migration `supabase/migrations/20261224010000_google_reviews_agent.sql` (tables `google_review_settings`, `google_reviews`, `google_review_requests`, catégorie de notification `negative_review`). Sans elle, l’étape est « disabled » et `/avis` l’indique.
- Fiche Google Business Profile connectée au client (connexion déjà utilisée par les publications et le référencement local, portée `business.manage`).
- Dans Google Cloud, les API **Google My Business API** (v4, avis) et **My Business Business Information API** (lien d’avis) activées pour le projet OAuth, avec l’accès à l’API Business Profile accordé par Google.
- Demandes d’avis : envoi e-mail déjà configuré (`EMAIL_SENDING_ENABLED=true`, `RESEND_API_KEY`, `EMAIL_FROM`) ; domaine du client vérifié pour envoyer à son nom (sinon `EMAIL_FROM`).
