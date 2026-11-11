# Finance PR 2 — Qonto : factures et crédits EUR (lecture seule)

## Périmètre livré
- API Qonto V2 : `GET /v2/organization`, `GET /v2/client_invoices`, `GET /v2/transactions` (comptes EUR).
- Authentification **clé API serveur** Qonto, sans OAuth client : en-tête `Authorization: <login>:<secret>`, **jamais** de Bearer ni de Basic. Pas de clé dans le navigateur, GitHub, la base ou les logs.
- Synchronisation **manuelle uniquement**, déclenchée par administrateur Clerk hors simulation.
- Ne lire que les changements des **366 derniers jours**. Import idempotent des identifiants externes. Pagination limitée à 100 pages par ressource ; erreur explicite en cas de résultat tronqué, aucune réussite trompeuse.
- Données locales minimisées : référence/numéro facture, montant TTC EUR, état de facture tel que rapporté par Qonto, échéance, ID client Qonto et nom d'entreprise, crédit EUR / référence / date. **Aucun IBAN, e-mail, adresse, carte, PDF ou justificatif stocké.**
- Aucun rapprochement automatique : seulement suggestions **exactes et non ambiguës** (référence + montant). Confirmation humaine obligatoire.
- Les factures Qonto sont reliées **manuellement** au bon dossier `clients.id`. Aucun rapprochement possible sans ce lien.
- Rapprochements manuels totaux ou partiels auditables, RPC PostgreSQL atomique bloquant les montants excessifs, double-allocation, les crédits renversés et les factures sans client associé.
- Statut `paid` Qonto affiché comme **information externe** ; un rapprochement n'altère pas son statut, et un crédit bancaire non affecté ne valide pas une facture.
- `client_services` / agents / sites / campagnes inchangés. Aucun envoi de relance, aucun débit/virment, aucune suspension, aucun calcul URSSAF.

## Activation
1. **CI verte** et revue de la PR.
2. Appliquer `supabase/migrations/20261203000000_finance_qonto_readonly.sql` à CODE-V OS *avant* le déploiement de la route, vérifier RLS et permissions.
3. Merger et contrôler la preview/production avec l'écran `/finance/qonto`.
4. Dans Vercel, configurer les secrets **Production uniquement**, hors Git :
   - `QONTO_LOGIN` : identifiant API Qonto (Paramètres → Intégrations et avantages → Clé API).
   - `QONTO_SECRET_KEY` : clé secrète API.
   - `QONTO_EXPECTED_ORGANIZATION_SLUG` : slug de l'organisation CODE-V attendu ; empêche la synchronisation sur une mauvaise entreprise.
5. Redéployer la production après ajout des variables. Vérifier l'organisation depuis la console Qonto. Ne copier **aucune clé dans un chat ou dans une PR**.
6. Depuis `/finance/qonto`, cliquer « Synchroniser maintenant ». Rapprocher manuellement un **client test** et un **paiement test** ; vérifier les doublons, soldes partiels, une facture payée et un crédit renversé.

## Contrôles et limites
- Si les clés ne sont pas configurées, l'interface reste consultable mais la synchronisation est désactivée.
- Si le fournisseur est indisponible, si la pagination dépasse la borne, si l'organisation est incorrecte ou si l'import échoue, le dernier résultat est marqué **erreur**. Les données importées peuvent être périmées.
- Qonto reste **source de vérité** des factures. La base CODE-V ne crée ni facture ni contrepartie bancaire.
- Les tableaux affichent au maximum 250 factures/crédits récents et 500 allocations ; pour un volume plus élevé, prévoir pagination et recherche serveur.
- Une transaction crédit peut être autre chose qu'un règlement client. Aucun solde ne déclenche automatiquement une action contre un client.
- Le montant importé est le total TTC de Qonto ; les tarifs CODE-V sont des repères HT. Ne pas les comparer sans TVA/facturation correspondante.
- La PR n'installe **aucun webhook** : synchronisation à la demande. Évolution ultérieure : OAuth à portée limitée et webhooks signés, avec validation spécifique.
- La PR 3 ajoutera la supervision des échéances, des litiges et des relances après approbation ; pas avant.
