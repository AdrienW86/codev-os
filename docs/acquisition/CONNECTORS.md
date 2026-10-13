# Acquisition — branchements restants (aucun envoi actif)

## État livré
- Route `/acquisition` protégée par le contrôle Clerk administrateur unique, navigation bureau et mobile.
- Affichage lecture seule des espaces, prospects, brouillons, expéditeurs et modèles.
- Diagnostic **déclaratif** des quatre connexions : SMTP, IMAP, recherche autorisée, OpenAI.
- Variables jamais renvoyées au client ; statut « configuré » ne signifie pas « testé ».
- Base: migration `20261107000000_acquisition_foundation.sql` présente dans master depuis PR #49, mais **non appliquée en production** à la création de cette branche. Tester avant application.

## Variables serveur prévues
```
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
Ne pas fournir de secrets dans GitHub, cette documentation ou le chat. Configurer ultérieurement dans Vercel (environnement serveur seulement) et un gestionnaire de secrets adapté pour chaque entreprise.

## Intégrations encore à réaliser, avant toute mise en service
1. Implémenter et tester le fournisseur SMTP/IMAP réel, avec gestion des délais, erreurs inconnues et déduplication stricte.
2. Vérifier l'accord explicite d'Infomaniak pour la prospection B2B ciblée depuis SMTP.
3. Développer le connecteur de découverte avec sources autorisées, limitations, et preuves datées.
4. Implémenter l'agent IA et ses schémas de sortie ; aucun fait inventé.
5. Construire l'administration complète : création espace/prospect, validation, approbation et gestion des suppressions.
6. Files persistantes, scheduler, limites incluant les relances, oppositions et surveillance des rebonds.
7. Essais SQL sur Supabase isolé, sécurité multi-espace, tests complets et recette de bout en bout.

## Sécurité
L'interface ne déclenche jamais d'envoi. L'intégration transporte uniquement des états et des brouillons, jamais des accès mail.
Les interrupteurs d'arrêt restent indépendants des Publications. Ne pas activer les envois réels lors d'une fusion GitHub.
