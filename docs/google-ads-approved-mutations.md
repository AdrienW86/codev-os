# Google Ads — écritures sous approbation (travail en cours)

Cette branche prépare l'écriture de mots-clés négatifs dans la campagne sélectionnée, sans modifier la connexion Google Ads de lecture actuelle.

## Statut
- `approved-mutations.ts` : validation stricte de la proposition, aperçu, appel API ciblé.
- **Non connecté à l'interface** et **aucun changement de campagne déclenché**.
- `GOOGLE_ADS_MUTATIONS_ENABLED` est désactivé par défaut.
- La fonction d'exécution **refuse systématiquement les mutations** tant que l'approbation persistée à usage unique n'est pas implémentée. Le champ `approvalId` est un emplacement réservé, pas une autorisation valide. Ne pas exposer cette fonction à l'agent ou à une server action avant vérification transactionnelle de l'approbation.
- Vérifier que le compte OAuth Google Ads est autorisé en écriture avant essai, sans retirer les garde-fous de lecture du reste du système.
- Ne pas activer le flag en production avant tests, audit durable, antifraude/anti-rejeu, vérification du compte lié et retour d'état après écriture.

## Suite d'implémentation indispensable
1. Ajouter une proposition persistée immuable (client, customer ID, campagne, terme, correspondance, empreinte, expiration).
2. Afficher un diff avant/après et une confirmation explicite de l'admin Clerk.
3. Vérifier en transaction la réservation unique de l'approbation et sa correspondance avec la connexion client actuelle.
4. Exécuter puis relire Google Ads; journaliser résultat et erreurs sans secrets.
5. Ajouter tests unitaires et intégration factice, puis valider en préproduction.
6. Ajouter ensuite la gestion du refus de composant Appel et les actions de conversion, avec des flux de validation distincts.

La fonctionnalité Jrenov **n'est pas encore utilisable** sur cette branche.
