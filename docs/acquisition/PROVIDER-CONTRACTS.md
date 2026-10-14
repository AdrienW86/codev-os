# CODE-V OS Acquisition — contracts des connecteurs

Implémentés dans `lib/acquisition/provider-contracts.ts` : interfaces pour envoi, réception, découverte et génération IA.

**Ce n'est PAS encore un connecteur SMTP ni IMAP fonctionnel.** L'adaptateur par défaut refuse toujours l'envoi. Aucun fournisseur ni SDK n'est installé par ce lot.

## Prochains lots nécessaires
- Infomaniak SMTP réel : négociation TLS, auth serveur, délais d'attente, stockage sécurisé des identifiants propres à chaque entreprise ; preuve de compatibilité avec leur politique de prospection avant activation.
- IMAP réel : curseurs incrémentaux, UID et expéditeur vérifiés, arrêt immédiat des relances lors d'une réponse ou d'un refus ; éviter stockage excessif.
- Travailleur persistant avec transaction atomique, clef d'idempotence et cas timeout incertain. Aucun envoi direct depuis Server Action.
- Recherche : fournisseur ayant explicitement autorisé l'utilisation des données, rate limits, provenance et date de preuve.
- IA : schéma de sortie contrôlé, pas d'invention, contrôle du coût et validation humaine.
- Pages de consentement / liste d'opposition, tests de double envoi, sécurité mono-admin et isolation des entreprises.

## Garde-fous
Les contrats ne contournent pas `acquisition_workspaces.emergency_stop` ni `sending_enabled`. Le code exécutable doit faire les vérifications **au moment de chaque réservation et de chaque envoi**. Les futures identités clients doivent être isolées côté stockage, secrets et quotas.

Pour piloter CODE-V en pilote : 50 e-mails/jour est un plafond cible à terme, pas une valeur activée. Aucun envoi réel, ni automatique ni manuel, tant que l'autorisation du fournisseur n'est pas confirmée.
