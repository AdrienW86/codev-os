# Publications dans l'assistant et mode vocal (phase 6)

L'assistant de CODE-V OS (zone d'accueil, texte ou micro « appuyer pour parler ») comprend maintenant les demandes Publications. Il ne crée **aucun second moteur** : chaque outil appelle les fonctions serveur existantes, avec le même contrôle `requireAdmin` que l'interface.

## Ce que l'on peut demander

| Demande (exemples) | Outil | Type | Fonction existante appelée |
| --- | --- | --- | --- |
| « Prépare les publications de JRenov pour la semaine prochaine. » | `publications_prepare` (`period=next_week`) | Écriture, **confirmée** | `prepareNextPublications` (Agent v2), brouillons uniquement |
| « Prépare deux publications pour Couverture Catalane. » | `publications_prepare` (`count=2`) | Écriture, **confirmée** | idem |
| « Montre-moi les publications à valider. » | `publications_review_list` | Lecture | `listPublications` (même source que la file de validation) |
| « Pourquoi cette photo de Protection Nuisibles a été rejetée ? » | `publications_photo_explain` | Lecture | photothèque + évaluations (voir « Lectures provisoires ») |
| « Affiche les comptes Instagram qui doivent être reconnectés. » | `publications_reconnect_list` | Lecture | `getSupervision` (état des comptes) |
| « Quels clients manquent de photos ? » | `publications_photo_shortage` | Lecture | `getSupervision` (seuil « Trop peu de photos ») |
| « Reprogramme cette publication à vendredi 18 h. » | `publications_reschedule` | Écriture, **confirmée** | `reschedulePublication` → RPC `publication_reschedule` |

Les phrases sont reconnues par l'analyseur déterministe (`lib/assistant/publications-intents.ts`, branché dans `parseIntent` avant les lectures génériques) et, quand un fournisseur d'IA est configuré, par le modèle (outils déclarés dans `lib/assistant/tools.ts`, règles ajoutées au prompt système). Les transcriptions vocales sans ponctuation ni accents (« prepare deux publications pour couverture catalane ») sont couvertes par les tests.

## Voix

Le micro réutilise **exactement** le même chemin que le texte (`useVoice` → `send(text, "voice")` → `/api/assistant`) : aucune action propre à la voix. Comme pour le reste de l'assistant :

- une dictée ne fait que **proposer** une écriture, avec la transcription affichée (« Compris à l'oral : … — vérifiez avant de confirmer ») ;
- un « oui », « confirme » ou « vas-y » dicté ou écrit ne confirme jamais rien : seul le bouton **Confirmer** exécute ;
- la synthèse vocale ne lit que la phrase de résumé, jamais les tableaux.

## Confirmation : le mécanisme existant

Les deux écritures sont des outils `kind: "write"` du registre. Elles suivent le parcours déjà utilisé pour les rapports Google Ads et les tâches :

1. `prepareProposal` vérifie tout avant de proposer (client, projet, créneaux, publication, révision). Au moindre doute, une **question** est posée et rien n'est proposé.
2. La proposition affiche une phrase explicite : « Brouillons uniquement : rien n'est soumis, approuvé, programmé ni publié. Confirmer autorise l'appel IA réel (4 préparations au plus). » ou « … l'approbation est remise à zéro : nouvelle validation humaine nécessaire avant toute diffusion. »
3. Le bouton **Confirmer** envoie `{ confirm: { tool, input } }` dans une requête distincte. Le serveur revalide le schéma strict, **refait** la préparation (la révision attendue doit être inchangée, le créneau toujours libre), puis exécute.

La confirmation de la préparation vaut autorisation explicite de l'appel IA réel, comme la case « J'autorise l'appel IA » du formulaire Agent v2.

## Aucune publication, aucune approbation

Choix conservateur, vérifié par les tests :

- **aucun outil** ne publie, n'approuve, ne soumet ni ne diffuse. L'approbation reste un geste de l'interface (carte de validation). Il n'existe pas d'action d'approbation confirmée réutilisable depuis l'assistant : on n'en crée pas ;
- les demandes « publie… », « approuve… », « valide la publication… », « mets en ligne… » sont refusées **avant** toute IA (`isPublishRequest`), avec un lien vers la vue « À valider » ;
- `lib/assistant/publications-deps.ts` n'importe aucune fonction de validation (`reviewPublication`), de diffusion ou de soumission (contrôle statique dans les tests) ;
- la préparation ne crée que des brouillons (contrat de l'Agent v2) ; la reprogrammation remet l'approbation à zéro (règle de `publication_reschedule`).

## Règles de résolution

- **Client** : `resolveClient` (correspondance exacte, sinon unique) ; plusieurs correspondances → « Plusieurs clients correspondent… Précisez lequel. » ; aucun → question.
- **Projet** : projets du client où l'Agent Publications est activé, droits médias confirmés. Plusieurs → question (« … projet Réseaux sociaux ») ; aucun → message vers l'onglet Agent.
- **Semaine prochaine** : lundi → dimanche suivant la date du jour (Paris). Seules les occurrences ouvertes de cette semaine sont candidates : les autres occurrences ouvertes sont passées en `excludeOccurrenceIds` au service Agent v2. Aucun créneau libre → question, pas de proposition.
- **Nombre** : 1 à 4 (`MAX_ASSISTANT_PREPARATIONS`). Une préparation Agent v2 = une idée déclinée en un brouillon par plateforme du créneau. L'assistant lance au plus `count` préparations et s'arrête dès que `count` brouillons existent (« deux publications » sur un créneau Facebook + Instagram = une seule préparation). En mode semaine, 4 préparations au plus par confirmation ; s'il reste des créneaux, le résultat invite à relancer.
- **Publication à reprogrammer** : la publication courante du contexte (`publicationId`), un numéro de la dernière liste (« reprogramme la 2 à samedi 9 h »), ou un client qui n'a qu'une publication reprogrammable. Sinon : question, ou liste numérotée des candidates.
- **Créneau** : la reprogrammation utilise un créneau **existant** de la cadence (mêmes règles que la supervision : même projet et plateforme, libre, à venir, 4 semaines). Le jour et l'heure demandés doivent correspondre exactement (heure de Paris) ; sinon la réponse liste les créneaux libres. L'assistant ne crée pas de créneau.
- **Photo** : si plusieurs photos du client sont écartées, l'assistant demande laquelle (liste numérotée, « la photo 2 »). L'explication suit l'ordre d'autorité : décision humaine (rejet, archivage, hors sujet), quarantaine, classement IA (confidentiel, hors sujet, à examiner, visage ou mineur), qualité, format. Jamais de légende, de nom de fichier ni d'identifiant Drive ; la description IA d'une photo confidentielle est masquée.

## Contexte de conversation

`AssistantContext` gagne `publicationId`, `assetId` et `items` (identifiants des éléments numérotés de la dernière liste, 10 au plus) et les vues `publications_list` et `publication_photos`. Ce sont de simples identifiants : le serveur les revérifie en base avant toute lecture ou proposition ; ils ne donnent aucun droit.

`useAssistant(initialContext)` accepte un contexte de départ : une fiche publication ou le hub mobile de supervision (#45) peuvent passer `{ publicationId }` pour que « Reprogramme cette publication… » vise la publication ouverte.

## Liens

- Vue « À valider » : `/publications/supervision?view=review` (`&client=<id>` si un client est précisé), deep link du hub de #45 ; la file complète `/publications/review` est aussi proposée.
- Reconnexion : `/clients/<id>?tab=publications` (même lien que la supervision).
- Photothèque : `/clients/<id>?tab=media`.

## Lectures provisoires (à remplacer)

Deux lectures sont isolées derrière une fonction chacune dans `lib/assistant/publications-deps.ts`. Seul leur corps changera :

- `clientsLackingPhotos()` : seuil et comptage de la supervision (`getSupervision`, `tooFewPhotos`). À remplacer par la fonction « clients sans photos utilisables » de **#42**.
- `photoDecisions(clientId)` : statut de photothèque et évaluation IA (200 dernières photos du client). À remplacer par le modèle de lecture « usage / exclusion des photos » de **#43**.

## Fichiers

- `lib/assistant/publications-intents.ts` : analyse déterministe, garde-fou « publier / approuver ».
- `lib/assistant/publications-model.ts` : règles pures (semaine, créneaux de Paris, liens, raisons d'exclusion, phrases de confirmation).
- `lib/assistant/publications-tool.ts` : outils à dépendances injectées (`createPublicationsTools`).
- `lib/assistant/publications-deps.ts` : liaison serveur réelle (fonctions existantes uniquement).
- `lib/assistant/tools.ts`, `intents.ts`, `orchestrator.ts`, `executor.ts`, `views.ts` : branchements. Une question de préparation peut désormais porter une liste numérotée (vue et contexte), sans proposition.
- `tests/assistant-publications.test.mjs` ; chargeur partagé `tests/helpers/assistant-publications.mjs` (ajouté aux suites qui chargent `intents.ts`, `tools.ts` et `orchestrator.ts`).

Aucune migration, aucune variable d'environnement, aucun interrupteur modifié.

## Limites

- Une confirmation de préparation peut durer plusieurs appels IA (4 au plus) dans une requête de 120 s maximum ; en cas d'échec d'une préparation (budget, agent désactivé, contenu refusé), les brouillons déjà créés sont conservés et le message de l'agent est relayé.
- Pas de nom de projet reconnu à l'oral au-delà de « … projet <nom> ».
- La reprogrammation ne vise que les publications présentes dans la supervision (programmées, en erreur ou publiées récemment, avec un créneau) ; les autres s'ouvrent depuis leur fiche.
