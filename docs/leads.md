# Agent Leads (demandes de devis)

Objectif : répondre en quelques minutes à chaque demande de devis d'un client artisan, qualifier le besoin et relancer le prospect qui ne répond pas. Écran **Demandes de devis** (`/leads`), étape `leads` du planificateur, charte `leads` (équipe Commercial).

## Entrées

| Canal | Comment | Traitement |
| --- | --- | --- |
| Formulaire du site | `POST /api/public/leads/<client>?key=<clé>` (JSON, formulaire classique ou multipart), extrait prêt à coller dans l'écran | Immédiat après la réponse HTTP (`after()`), repris par le planificateur en cas d'échec |
| E-mail | Adresse `devis-<16 caractères de la clé>@LEADS_INBOUND_DOMAIN` (réception Resend, webhook `email.received`) : demande transférée par l'artisan ou écrite directement | Idem |
| Saisie manuelle | Écran, « Ajouter une demande » (appel téléphonique, message reçu ailleurs) | Immédiat |

Protection du formulaire public : clé du client (comparaison à temps constant), client actif, origine du navigateur déclarée dans les réglages, champ piège (`website`), 5 demandes par heure et par adresse IP pour un client (20 tous clients confondus, empreinte HMAC de l'adresse, jamais l'adresse), doublon exact ignoré, corps limité à 32 Ko. Aucune lecture publique.

## Traitement

1. **Qualification** (IA mesurée dans le budget du client, `withCharter("leads")`, famille rédaction) : prestation du client concernée (recopiée de ses prestations confirmées, sinon aucune), urgence, intérêt, lieu, délai, informations manquantes, questions, citations exactes de la demande. Sortie recalée : prestation hors liste refusée, citations introuvables retirées. Sans IA ou en échec : règles déterministes.
2. **Première réponse** : rédigée par l'IA puis contrôlée (aucun chiffre, prix, délai, garantie, lien ou promesse absent des faits confirmés, des réglages ou de la demande ; aucune exclusion du client ; pas de formule toute faite). Deux essais au plus, sinon **réponse type** sans aucune promesse (le délai de rappel n'apparaît que s'il est réglé).
3. **Alerte à l'artisan** (adresse réglée) : résumé, coordonnées, urgence ; « Répondre » écrit directement au prospect.
4. **Envoi** : validation dans l'écran (texte modifiable) ou réponse automatique si le client l'a choisie. Domaine du client vérifié : `contact@<domaine>` ; sinon adresse commune `EMAIL_FROM` au nom du client. Adresse de réponse : adresse de réception de l'agent (pour arrêter les relances), sinon celle des réglages ; sans adresse de réponse, rien ne part. Liste d'exclusion vérifiée, clé d'idempotence, mention de transparence et « STOP » sous chaque message.
5. **Relances** : au plus 2 (2 puis 3 jours ouvrés après le dernier envoi, à 10 h), du lundi au samedi de 9 h à 19 h. Réponse type rappelant la demande. Envoyées seules en réponse automatique, sinon à valider.
6. **Réponse du prospect** (adresse de réception) : relances annulées, demande « a répondu », réponse transmise à l'artisan. « STOP » : demande perdue et adresse exclue pour ce client. Réponse automatique (absence) ignorée.
7. **Clôture** : sans réponse 7 jours après la dernière relance. **Conservation** : demandes supprimées 3 ans après le dernier échange.

Statuts : Reçue, Réponse à valider, Répondu (en attente du prospect), Le prospect a répondu, Gagnée, Perdue, Sans réponse (close), Indésirable. Un statut choisi à la main annule tout message en attente.

## Harness

Charte `leads` (équipe Commercial), point de situation (demandes sur 30 jours, délai médian de première réponse, demandes en attente), boîte « À valider » (catégorie e-mails à des contacts), chef de projet (fiche client → Agents : réglages et réponses à valider), lancement manuel « Traiter les demandes de devis », navigation du Directeur (« ouvre les demandes de devis »).

## Mise en service

- Migration `20261229000000_leads_agent.sql` (tables `lead_settings`, `leads`, `lead_messages`, RLS sans accès public).
- Envoi : `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDING_ENABLED=true` (déjà utilisés par les autres envois).
- Adresse publique du cockpit `PUBLICATIONS_OAUTH_BASE_URL` (adresse du formulaire affichée).
- Facultatif : `LEADS_INBOUND_DOMAIN` (sous-domaine de réception Resend, ex. `leads.code-v.fr`, avec l'événement `email.received` sur le webhook Resend existant) pour recevoir les demandes transférées et les réponses des prospects.
- Par client : écran Demandes de devis → réglages (activer, adresse de l'artisan, engagement de rappel confirmé, sites autorisés), puis coller le formulaire sur le site.
