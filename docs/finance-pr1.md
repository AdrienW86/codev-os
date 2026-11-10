# Prestations & Finance — PR 1 : catalogue et contrats
Référence : `CODE-V_Devis-cadre_prestations.pdf`, 5 familles, 27 prestations.

## Découpage
Cette PR ne crée aucune facture, ne lit aucune donnée bancaire et n'active aucune relance ou suspension. Les montants du PDF sont des **repères HT non contractuels**. L'import laisse `default_price_cents` à NULL. Une prestation facturée doit recevoir un tarif convenu explicite.

## Architecture
- `finance_categories`, `finance_catalog_items` : catalogue global éditable, archivage logique sans effacer les contrats.
- `finance_client_contracts` : vente liée à `clients(id)`, prix négocié en centimes, quantité, période, fréquence, référence devis, statut commercial.
- `finance_catalog_history` et `finance_contract_history` : version intégrale après chaque écriture, insertions atomiques via triggers, acteur `updated_by`.
- RLS activée, aucun accès anon/authenticated. Rôles serveur uniquement.
- `client_services` et agents techniques restent indépendants. La modification d'un prix global ne modifie pas les contrats clients.
- Aucune suppression physique : catalogue archivé, contrat terminé pour conserver l'historique.

## Déploiement
1. CI de la PR verte et revue du schéma ; ne pas merger automatiquement.
2. Avant d'exposer la route en production, appliquer la migration `20261202000000_finance_catalog_contracts.sql` au bon projet Supabase CODE-V OS (environnement contrôlé). Vérifier 5 familles et 27 prestations, aucune ligne de contrat ajoutée.
3. Merger la PR validée, vérifier `/finance` et une fiche `/finance?client=...`.
4. Test réel en environnement de préproduction : attribuer deux tarifs différents à la même prestation pour deux clients tests, changer le prix de référence et constater que les contrats restent identiques. Éviter les tests avec les vrais clients.
5. Surveillance des erreurs, contrôle du journal des versions.

## Chantiers suivants
- PR 2 : Qonto lecture seule + factures, webhook signé, rapprochement prudent des crédits bancaires.
- PR 3 : relances avec approbations, exceptions, déduplication.
- PR 4 : suspension contractuelle proposée, consentie et cantonnée à des jobs non critiques ; aucune coupure web/domaine/Ads sans revue humaine.
- PR 5 : MRR/ARR, facturé vs encaissé, prévision de trésorerie, profil fiscal et simulation URSSAF.

## Limites de la PR
Le « total théorique » affiché n'est pas un CA encaissé et n'a aucune valeur déclarative URSSAF. Les modifications des contrats sont historisées mais ne génèrent pas de facture ou d'avenant signé.
