# Agent Newsletter

Écran : **Newsletters** (`/emailing?client=<id>`). Migration : `20261207000000_email_newsletters.sql` (à appliquer).

## Ce que fait l'agent
1. **Rédaction** (« Rédiger la newsletter »). Il part des seules sources citables du client :
   - les articles publiés ces 90 derniers jours, avec leur adresse publique ;
   - les prestations confirmées ;
   - le profil du client.
   Sa méthode d'expert : un seul thème utile, un objet de 30 à 50 caractères, un pré-en-tête, 1 à 3 rubriques, 150 à 300 mots et un seul appel à l'action.
2. **Contrôle anti-invention.** Le brouillon est refusé s'il cite un prix, un pourcentage, une promotion, une garantie, une certification, un délai, des avis, un chantier réalisé ou une prestation absents des faits. Il est aussi refusé s'il contient une adresse non fournie ou du balisage. L'agent fait un second essai avec le motif du refus ; sinon, rien n'est enregistré.
3. **Note de qualité sur 100.** Elle porte sur :
   - la longueur de l'objet ;
   - les majuscules et points d'exclamation ;
   - le pré-en-tête ;
   - le nombre de mots ;
   - l'appel à l'action ;
   - les termes qui déclenchent les filtres anti-spam.
4. **Approbation** par un administrateur. Elle est obligatoire : la base refuse tout envoi d'une newsletter non approuvée.
5. **Envoi par lots de 100** (« Envoyer », case de confirmation cochée).
   - Destinataires : les seuls contacts `subscribed` du client, hors liste d'exclusion. La liste est relue juste avant chaque message, pour respecter un désabonnement reçu pendant l'envoi.
   - Chaque message porte un lien de désabonnement signé, l'en-tête RFC 8058 (désabonnement en un clic) et une version texte.
   - Le journal `email_newsletter_sends` est écrit avant l'appel à Resend, avec une clé d'idempotence par destinataire. Relancer l'envoi n'envoie jamais deux fois.

## Prérequis d'envoi
- `RESEND_API_KEY`, `EMAIL_FROM` et `EMAIL_SENDING_ENABLED=true`.
- `PUBLICATIONS_OAUTH_BASE_URL` : adresse publique, pour le lien de désabonnement.
- `PUBLICATION_CREDENTIALS_KEY` : signature du lien de désabonnement.
- `OPENAI_API_KEY`, pour la rédaction.

## Contacts
On ajoute les contacts sur la même page, une adresse par ligne, avec :
- leur base légale : inscription volontaire, double confirmation, client existant ou contact professionnel ;
- l'origine du consentement.

Une adresse déjà connue n'est pas modifiée. Les désabonnements, rebonds définitifs et plaintes sont exclus automatiquement par le socle emailing.
