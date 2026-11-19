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

## 2. Vérification des adresses avant envoi

`lib/emailing/address-check.ts` (pur) et `address-check-dns.ts` (résolution MX, 4 s max par domaine).

- Contrôles : syntaxe, messagerie jetable, faute de frappe connue (gmial.com…), serveur de messagerie (MX) publié et
  non nul (RFC 7505). Aucune connexion SMTP au serveur du destinataire (pas de sonde intrusive, pas de service payant).
- À la transmission vers l'emailing : seules les adresses `valid` deviennent des brouillons. Le résultat est gardé sur
  la fiche (`email_check_status`, `email_check_detail`, `email_checked_at`) et affiché dans la liste.
- Une adresse jugée non distribuable n'est pas revérifiée pendant 30 jours ; une panne DNS (`unknown`) n'est jamais
  considérée comme valide et sera retentée.
- L'envoi (PR 3) exige une vérification `valid` de moins de 30 jours, sinon il la refait.

Migration : `20261219000000_acquisition_email_checks.sql` (additive, à appliquer manuellement).

## 3. Approbation, planification et envoi progressif

`lib/acquisition/send-plan.ts` (pur), `send-service.ts`, `outreach-mail.ts`, onglet **E-mails** ; étape du
planificateur `acquisition_send` (Agent Envoi prospection, toutes les 15 min).

- **Approbation** : sélection des brouillons, case « J'ai relu… » et nombre d'e-mails retapé (confirmation cruciale).
  Refusés : adresse exclue, non vérifiée (revérifiée si > 30 jours), brouillon incomplet, entreprise déjà en réponse.
  Un brouillon se corrige avant approbation ; un message approuvé s'annule tant qu'il n'est pas parti.
- **Activation par espace** (confirmation cruciale) : exige un expéditeur prêt (domaine dédié vérifié), l'envoi serveur
  actif (`EMAIL_SENDING_ENABLED=true`) et l'URL publique (`PUBLICATIONS_OAUTH_BASE_URL`, lien de désinscription).
  « Arrêter tous les envois » est immédiat.
- **Rythme** : lundi-vendredi 9 h – 11 h 30 et 14 h – 16 h 30 (heure de l'espace, fériés exclus), 3 messages au plus
  par passage, préchauffage 10/20/35 puis 50 par jour, plafond absolu 50/jour.
- **Juste avant chaque message** : arrêt d'urgence, expéditeur toujours valide et hors domaine protégé, exclusions
  (globales, de l'expéditeur, de l'espace), étape de l'entreprise, adresse vérifiée, quota du jour, réservation
  atomique (`approved → sending`), clé d'idempotence Resend (pas de doublon).
- **Message envoyé** : texte relu + mention complète (raison sociale, adresse, origine de l'adresse, intérêt légitime,
  lien de désinscription en un clic, « STOP », confidentialité) et en-têtes RFC 8058.
- **Réputation** (7 jours, webhook Resend) : une plainte, plus de 3 % de rebonds définitifs (dès 20 envois) ou 3 rebonds
  avant 20 envois → arrêt d'urgence automatique de l'espace, motif affiché, reprise manuelle seulement.

Migration : `20261220000000_acquisition_sending.sql` (additive ; prévoit aussi les colonnes des PR 4 à 6).

## 4. Réponses, « STOP » et désinscription

`lib/acquisition/replies.ts` (pur), `reply-service.ts`, webhook `/api/webhooks/resend` (événement `email.received`).

- Réception entrante Resend sur le domaine dédié (enregistrement MX de réception à activer dans Resend) ; laisser
  « Réponses envoyées à » vide pour que les réponses passent par CODE-V OS.
- Réponse rattachée au dernier message envoyé à cette adresse (120 jours). Texte lu par l'API Resend
  (`/emails/receiving/{id}`, clé `RESEND_ADMIN_API_KEY` ou `RESEND_API_KEY`) ; à défaut, l'objet seul est analysé.
- **STOP** (stop, désinscription, « ne plus nous contacter », « pas intéressé »…) : exclusion définitive de l'espace et de
  l'expéditeur, fiche « Exclu », brouillons et messages en file annulés.
- **Vraie réponse** : fiche « Réponse reçue », extrait affiché dans l'onglet E-mails, relance annulée.
- **Absence / réponse automatique** : consignée seulement (la séquence continue).
- Lien de désinscription en un clic (PR 3) : exclusion immédiate ; le message en file est écarté au passage suivant.
- Le traitement a lieu avant l'enregistrement de l'événement : en cas d'échec, Resend renvoie l'événement.

Hypothèse à confirmer au premier essai réel : format de l'événement `email.received` (`data.email_id`, `data.from`,
`data.to`, `data.subject`) et route de lecture du contenu, la documentation Resend n'étant pas joignable depuis
l'environnement de développement.

## 5. Rédaction personnalisée par entreprise

`lib/acquisition/writer.ts` (pur), `writer-service.ts` ; Agent Rédacteur prospection (étape `acquisition_writer`,
famille IA « rédaction »).

- Case « Rédaction personnalisée » (cochée par défaut) à la transmission : le brouillon du modèle est créé tout de suite
  (`draft_source = 'ai_pending'`) puis réécrit en tâche de fond, quelques brouillons par passage.
- Faits utilisés : activité au registre (fiche Sirene, lien de preuve) et page publique de l'entreprise (titre,
  description, titre principal ; robots.txt respecté, adresses publiques uniquement). Chaque fait garde sa source,
  affichée sous le brouillon.
- Contrôle avant remplacement : au moins un fait cité et existant, 40 à 130 mots, objet de 60 caractères au plus,
  nom du destinataire présent, aucun lien ni adresse, aucun nombre absent des données, note qualité ≥ 70 sans terme
  anti-spam. Échec ou IA indisponible : le brouillon du modèle reste (`last_error = writer_<raison>`).
- Un brouillon en cours de réécriture n'est pas approuvable. Coût IA compté sur le budget du client (espaces clients).

## 6. Relance unique et résultats

`outreach-mail.ts` (`followUpMessage`), `stats.ts` (pur), `stats-service.ts`, onglet **E-mails**.

- Case « Une seule relance à J+5 ouvrés » (cochée par défaut) lors de l'approbation : la relance est approuvée en même
  temps, mais programmée seulement quand le premier message est parti (5 jours ouvrés plus tard, mêmes créneaux et
  mêmes verrous). Texte court, sans nouvelle affirmation, qui annonce l'absence d'autre relance.
- Annulée automatiquement en cas de réponse, de « STOP », de désinscription, d'exclusion, d'échec ou d'annulation du
  premier message. Jamais plus d'une relance par message (index unique).
- Résultats sur 90 jours par espace : premiers contacts, relances, en file, réponses (taux), désinscriptions, rebonds
  définitifs (taux), plaintes, remises confirmées. Pas de pixel de suivi des ouvertures (meilleure délivrabilité).

## Mise en service (actions manuelles)

1. Appliquer les migrations `20261218000000`, `20261219000000`, `20261220000000` (SQL Editor Supabase).
2. Acheter le domaine dédié (ex. `code-v-pro.fr`), le saisir dans l'onglet Expéditeur, cliquer « Vérifier le domaine »,
   créer les enregistrements DNS affichés + DMARC chez le registrar, relancer la vérification.
3. Resend : activer la réception (inbound) sur ce domaine et ajouter l'événement `email.received` au webhook existant
   (`/api/webhooks/resend`, secret `RESEND_WEBHOOK_SECRET`).
4. Vercel (Production) : `RESEND_ADMIN_API_KEY` (clé « Full access », gestion des domaines et lecture des réponses),
   `EMAIL_SENDING_ENABLED=true`, `PUBLICATIONS_OAUTH_BASE_URL` (déjà utilisé), `RESEND_WEBHOOK_SECRET`.
5. Transmettre une première liste, relire, approuver (relance incluse), activer les envois avec un quota de 10/jour.
