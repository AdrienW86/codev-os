# Prospection e-mail sécurisée

Objectif : envoyer des premiers contacts B2B personnalisés sans jamais abîmer la réputation du domaine principal
(site, rapports, newsletters) et dans le cadre posé par la CNIL pour la prospection entre professionnels.

Chaîne complète : Agent Prospection (entreprises de la zone, adresse générique publiée + source) → transmission →
brouillons → approbation humaine → envoi planifié et progressif depuis un domaine dédié → réponses et désinscriptions
traitées automatiquement.

## 1. Expéditeur sur domaine dédié

Onglet **Expéditeur** de l'espace Acquisition (`lib/acquisition/prospecting-sender.ts`, `sender-service.ts`).

- Un seul expéditeur par espace, chez Resend (`provider = 'resend'`), sur un domaine **dédié** :
  - refusé s'il est égal au domaine d'`EMAIL_FROM`, au site du client, à son domaine de newsletters, ou s'il est le
    domaine principal de l'un d'eux ;
  - sous-domaine du domaine principal accepté avec avertissement ; domaine séparé recommandé (ex. `code-v-pro.fr`).
- Le contrôle est refait à chaque envoi (`resolveProspectingSender`) : un domaine devenu protégé bloque l'envoi.
- Vérification chez Resend (SPF, DKIM) avec la clé `RESEND_ADMIN_API_KEY` (ou `RESEND_API_KEY` en accès complet) ;
  enregistrement DMARC conseillé affiché (`v=DMARC1; p=none; adkim=s; aspf=s;`, puis `p=quarantine` après 4 semaines).
- Mention légale obligatoire : raison sociale et adresse postale (reprises dans chaque message), politique de
  confidentialité facultative.

Migration : `20261218000000_acquisition_prospecting_sender.sql` (additive, à appliquer manuellement).

Correctif inclus : la validation des identifiants des actions `/acquisition` attendait un format 8-4-4-4-4-12 ;
toutes les actions avec un identifiant (espace client, recherche, transmission…) étaient refusées. Format standard
8-4-4-4-12 rétabli.
