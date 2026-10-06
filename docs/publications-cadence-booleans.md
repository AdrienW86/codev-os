# Correction des booléens de cadence

Le contrôle distant, exclusivement en lecture, confirme que `enabled=false` et
`auto_create_slots=false` étaient déjà présents dans la configuration reçue par
la RPC et enregistrée dans `publication_events`. La fonction distante sauvegarde
les deux champs transmis, y compris dans sa branche ON CONFLICT ; aucun défaut
SQL ne les écrase. Aucun Zod n’intervient : la validation de cadence existante
exige bien deux booléens.

L’ancien formulaire utilisait des cases non contrôlées sans valeur explicite ;
la Server Action ne reconnaissait que la chaîne `on`, convertissant toute autre
valeur ou des champs multiples en false. Le format exact du FormData du navigateur
pendant l’incident n’a pas été capturé : la cause en amont du SQL est démontrée,
mais pas une capture E2E du clic initial.

Correction du contrat formulaire/action :

- Cases contrôlées par `checked` et `onChange`, avec `value="true"` explicite.
- Case absente : false ; valeur unique `true` ou `on` : true.
- Valeur inattendue ou champ dupliqué : erreur, aucune écriture.
- Réinitialisation du composant sur la version `updated_at` rechargée du serveur,
  pour refléter les valeurs persistées après revalidation du projet.
- Aucun changement de RPC, migration ou donnée distante.

Tests : le véritable configurePlanning appelle le véritable saveCadence avec
un backend de test ; true/false et leur mapping RPC sont vérifiés, puis la cadence
est relue et le vrai PlanningForm rendu pour vérifier les cases cochées. Les
deux flags sont également testés indépendamment. En PostgreSQL local, les
transitions true → false → true sont réellement persistées ; la génération
désactivée est refusée et la génération réactivée produit huit slots sur quatre
semaines, sans doublon à la relance ni en concurrence.

Résultats finaux : **149/149 tests réussis**, aucun échec ni test ignoré ;
16 tests dédiés au calendrier. **82 contrôles SQL par reconstruction**, deux
reconstructions réussies et concurrence vérifiée. Lint, typecheck et build
réussis. Cluster local arrêté en fin de validation.

Aucune modification directe de la ligne du projet distant, aucune publication
externe, aucun appel IA, aucun worker/cron et aucun Lot 4.
