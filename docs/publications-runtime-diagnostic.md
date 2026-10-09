# Diagnostic runtime Publications — 2026-10-05

## Erreur réelle et chronologie

L'inspection en lecture seule des journaux Supabase confirme trois erreurs PostgreSQL
`42703`, avec le message `column publications.target_date does not exist`, aux heures
UTC 19:34:09, 19:37:06 et 19:41:02. Les requêtes REST correspondantes retournent HTTP 400.

La migration `20261005000005_publications_manual_workspace` est déjà enregistrée
sous la version distante `20261005194148`. Le premier appel suivant observé,
à 19:42:38 UTC, retourne HTTP 200. La colonne `target_date` existe actuellement.
L'erreur historique correspond donc à une lecture du code Lot 2 avant la disponibilité
de cette colonne. Aucun mismatch actuel de select ou de relation n'a été reproduit.

## Vérification de la requête actuelle

La requête exacte est :

```text
GET /rest/v1/publications
select=id,client_id,project_id,editorial_week,slot,subject,status,current_revision_id,target_date,created_at,updated_at,client:clients(name),project:projects(id,name)
order=updated_at.desc,id.asc
offset=0
limit=100
```

Résultat réel : HTTP 200, `data=[]`, `error=null`.

Les onze colonnes sont présentes avec les types attendus. Les relations correspondent
aux FK `publications_client_id_fkey` et `publications_project_client_fk`.
`current_revision_id` est sélectionné comme UUID nullable : aucune relation
`current_revision` ou `variants` n'est embarquée dans cette requête.
Les résumés de révision et de variantes sont lus séparément, seulement lorsque des
révisions sont présentes. Aucun cast ne masque une erreur de relation.

Le code réel `listPublications()` puis le composant serveur de `/publications` ont
également été exécutés avec le chargement `.env` de `@next/env`, le client serveur réel
et les lectures Supabase réelles. Le harnais bloque tout appel réseau autre qu'un GET
REST sur le projet attendu. Seule la garde admin est remplacée par une fixture dans
ce harnais ; aucune garde applicative n'est modifiée.

Résultats : zéro publication, état « Aucune publication pour ces critères. »,
aucun message de stockage indisponible et aucun log d'erreur.
Ce contrôle ne constitue pas un test navigateur avec une session Clerk authentifiée.

## Changements applicatifs

- `lib/publications/data.ts` : conserve l'erreur Supabase avant le catch et journalise
  ses diagnostics sécurisés côté serveur. Le message utilisateur de la liste ne
  présume plus que des migrations manquent. La requête correcte est conservée.
- `lib/supabase/read-error.ts` : sélectionne uniquement code/message/details/hint,
  masque les secrets de l'environnement et les formats usuels de credentials,
  retire les caractères de contrôle et limite la taille des champs.
- `tests/publications.test.mjs` : vérifie les diagnostics, leur masquage et la
  conservation des erreurs réseau Supabase dont le code est vide.

Aucune migration nouvelle ou modification du schéma distant.

## Validation

- Tests Publications ciblés : 18 réussis.
- Suite Node complète : 129 réussis, zéro échec, zéro test ignoré, intégrations SQL incluses.
- Phase SQL locale dédiée : 6 288 assertions/rejets attendus réussis sur des
  reconstructions jetables. PostgreSQL 17.11, écoute uniquement sur 127.0.0.1 ;
  cluster arrêté après validation.
- `npm run lint` : réussi.
- `npm run typecheck` : réussi.
- `npm run build` : réussi.

Contrôle distant en lecture seule : zéro publication ; `emergency_stop=true` ;
`generation_enabled=false`, `automation_enabled=false`, `publishing_enabled=false`.
Aucune écriture distante, aucune publication créée, aucun changement de kill switch.
Le Lot 3 n'a pas été commencé.
