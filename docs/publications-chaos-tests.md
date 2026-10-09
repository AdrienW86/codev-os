# Publications — tests de chaos locaux (Lot 4.3, Gate 5)

Deux suites, **100 % locales** : aucun appel réel à Meta ou Google, aucune base distante.

- `tests/publications-chaos.test.mjs` — côté worker : le **vrai** moteur P10 avec les **vrais** publishers Meta et
  Google Business Profile ; seuls le réseau (transport fournisseur) et la base (double des RPC) sont simulés.
- `supabase/tests/publications-chaos.sql` (lancé par `tests/publications-chaos-db.test.mjs` dans
  `scripts/test-publications-local.ps1`) — côté base : les vraies RPC P10 / P11-b / P12 sur PostgreSQL jetable,
  après les 22 migrations, deux reconstructions (74 vérifications chacune).

Invariants vérifiés partout : une delivery n’est jamais envoyée deux fois ; une réponse ambiguë n’est jamais
réessayée automatiquement ; rien ne part quand un interrupteur est fermé ; aucun secret dans les journaux, l’audit
ou les appels base.

| # | Scénario | Résultat attendu (et vérifié) | Où |
|---|---|---|---|
| 1 | Crash du worker avant le dispatch | Bail expiré → job repris (tentative 2) ; l’ancien worker ne peut plus envoyer ; marqueur perdu → aucune requête | SQL C01, Node C01 |
| 2 | Crash du worker après le dispatch | Bail expiré → `uncertain`, jamais repris ni réessayé ; réconciliation → `published` | SQL C02, Node C02 |
| 3 | Timeout fournisseur | Après l’écriture → `uncertain` ; avant (jeton de Page, conteneur IG) → réessayable | SQL C03, Node C03 |
| 4 | Réponse perdue | `uncertain` ; « inconnu » n’autorise pas « non publiée » | SQL C04, Node C03 |
| 5 | Échec base après succès fournisseur | Une seule écriture ; complétion tardive refusée ; réconciliation retrouve l’identifiant | SQL C02, Node C02 |
| 6 | Jeton expiré | `auth` → bloquée, aucune requête (Meta) ; GBP renouvelé en mémoire si possible | SQL C06, Node C06 |
| 7 | Jeton révoqué | `auth` ; réessai refusé tant que la connexion est révoquée, possible après reconnexion | SQL C06, Node C06 |
| 8 | Compte désactivé | Contexte bloqué `account_inactive`, jamais envoyé | SQL C08, Node C08 |
| 9 | Canal désactivé | Dispatch refusé, delivery bloquée | SQL C09, Node C08 |
| 10 | `emergency_stop` | Aucun claim ; fermé entre contexte et dispatch → refusé | SQL C10, Node C08 |
| 11 | Publication archivée | Archivage refusé tant qu’une delivery est `uncertain` ; archivée → jamais préparée | SQL C11, Node C08 |
| 12 | Révision modifiée | Révision refusée pendant un envoi en cours ; seul le texte approuvé part | SQL C12, Node C08 |
| 13 | Média manquant | Pas de dispatch sans toutes les URL signées | Node C13 |
| 14 | URL signée expirée | Refus du fournisseur → `invalid_payload`, pas de réessai automatique | SQL C14, Node C13 |
| 15 | Workers dupliqués | Un seul claim ; contexte / dispatch / complétion d’un autre worker refusés | SQL C15, Node C15 |
| 16 | Réessais dupliqués | Même delivery, un seul job vivant | SQL C16, Node C16 |
| 17 | Déconnexion pendant le job | Avant dispatch → aucune requête ; après → la vérité fournisseur est enregistrée, la suite est bloquée | SQL C17, Node C16 |
| 18 | Compte retiré par une synchronisation | Dispatch refusé (`account_inactive`) | SQL C18, Node C18 |
| 19 | Limite de débit Meta | `rate_limit`, délai fournisseur respecté, jamais `uncertain` | SQL C19, Node C18 |
| 20 | Quota GBP | `rate_limit` (429) borné par `max_attempts` ; 403 (0 QPM) → `auth` | SQL C20, Node C18 |
