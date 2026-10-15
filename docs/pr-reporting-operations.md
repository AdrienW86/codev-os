# Rapports clients personnalisés, Directeur IA et automatisations supervisées

Les rapports se limitaient aux semaines/mois clos, le diagnostic transversal ne structurait pas ses preuves et l'interface des automatisations confondait mise en file et résultat. Cette branche complète ces parcours sur les moteurs existants, avec la PR #89 comme base PDF/e-mail.

- Rapports par client, période et sources : aperçu, correction, approbation de version, PDF A4 CODE-V et pièce jointe de la version approuvée. Déduplication des préparations et refus des documents inexportables avant stockage.
- Diagnostic multi-clients : priorités, faits/hypothèses, confiance et preuves datées, couverture partielle visible, propositions via la confirmation existante.
- Automatisations : historique des vrais jobs et rapports, mise en file atomique, fencing de bail et exécution manuelle limitée au job choisi.

Validation locale : 1 056 tests réussis, zéro échec, 43 facultatifs ignorés ; lint (deux avertissements existants), typecheck, build ; neuf tests PostgreSQL natifs ; Chromium desktop/mobile sur données et sessions simulées ; PDF analysés avec Poppler.

Deux migrations locales sont nécessaires (`20261110000000`, `20261111000000`) et n'ont pas été appliquées à distance. La seconde est obligatoire avant le déploiement du moteur. La migration SEO V2 n'est pas autorisée en production par ce lot. Aucun envoi réel, prospection, publication externe, secret, cron ou campagne Ads modifié.

Les checks GitHub/Vercel et la preview distante restent à vérifier : l'API GitHub est bloquée par le proxy de l'environnement. Aucun merge effectué. Détails et procédure dans `docs/2026-10-15-reporting-operations-delivery.md`.
