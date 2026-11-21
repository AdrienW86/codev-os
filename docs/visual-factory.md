# CODE-V Visual Factory — photos hebdomadaires de sites Vercel

## État et périmètre

Ce module est un workflow GitHub Actions, indépendant du runtime Vercel. Il ne modifie aucun site en production.

- Découvre les projets Vercel du compte configuré à chaque exécution ; aucune liste de sites figée.
- Ignore les domaines de preview, les pages non publiques ou protégées et les projets internes.
- Privilégie les domaines personnalisés et les domaines de production publics.
- Analyse le titre, les descriptions et les H1/H2 pour adapter les scènes au secteur.
- Conserve les 16 noms de dossiers connus, reconnaît de nouveaux domaines.
- Génère 30 photographies autonomes par site (GPT Image 2, WebP 1536x1024, medium).
- Classe chaque fichier dans Google Drive : Visuels IA - Sites web CODE-V / Nom du site / AAAA-MM-JJ / 01-description.webp.
- Reprend une génération incomplète en ignorant les noms déjà présents dans le dossier daté.
- Vérifie le nom, le type WebP et la taille auprès de Drive après chaque dépôt.
- Génère un rapport JSON avec les résultats réels. Les photos sont illustratives et ne prétendent pas présenter de véritables chantiers.

Dossier principal : https://drive.google.com/drive/folders/15JDPgR7R5uF9Re59tkwT2b59zMC2E3w2

## 1. Secrets requis dans GitHub

Dans AdrienW86/codev-os → Settings → Secrets and variables → Actions, ajouter sans communiquer les valeurs :

| Secret | Signification |
| --- | --- |
| VERCEL_TOKEN | Jeton Vercel permettant de lire les projets |
| VERCEL_TEAM_ID | Identifiant de l'équipe Vercel, préfixe team_ |
| VISUAL_OPENAI_API_KEY | Clé OpenAI API autorisée à produire des images |
| VISUAL_GOOGLE_DRIVE_CLIENT_ID | Identifiant OAuth Google Drive |
| VISUAL_GOOGLE_DRIVE_CLIENT_SECRET | Secret du client OAuth Google |
| VISUAL_GOOGLE_DRIVE_REFRESH_TOKEN | Token de renouvellement du compte Google avec droits d'écriture |

Les variables Vercel CODE-V OS ne sont pas automatiquement transmises aux GitHub Actions. Un accès OAuth Google Drive avec permission suffisante sur le dossier principal est nécessaire ; un token limité au scope drive.file pour une autre application peut ne pas y accéder. Ne coller aucune clé dans un chat.

## 2. Test en lecture seule

Dans GitHub Actions, lancer CODE-V Visual Factory - images vers Google Drive → Run workflow en laissant dry_run à true. Le workflow interroge Vercel et analyse les sites mais ne produit aucune image et n'écrit rien dans Drive.

Le test local sans accès réseau :

    node --test scripts/visual-factory/generate.test.mjs

## 3. Test réel sur une seule image

Lancer manuellement avec :
- dry_run : false
- site : nuisibles-provence
- max_images : 1

Vérifier ensuite le fichier WebP 1536x1024 et le rapport archivé dans GitHub Actions. N'activer la tâche hebdomadaire qu'après ce contrôle. L'accès Google Drive peut exiger une autorisation OAuth initiale sur le dossier.

## 4. Activation hebdomadaire

Créer la variable de dépôt GitHub Actions VISUAL_FACTORY_ENABLED avec la valeur true après validation du test. Le workflow s'exécute chaque samedi à 08 h UTC (09 h en hiver ou 10 h en été à Paris).

Une automatisation ChatGPT ayant le même objectif est déjà programmée. Une fois la chaîne GitHub opérationnelle, la désactiver ou la limiter au reporting pour éviter les exécutions concurrentes.

## 5. Budget et nombre de sites

Variables de dépôt facultatives :
- VISUAL_MAX_IMAGES = 480 (nombre maximum de nouvelles générations par exécution).
- VISUAL_MAX_OUTPUT_USD = 21 (plafond indicatif du coût image de sortie, sans les tokens d'entrée).

Le calcul est fondé sur 0,041 USD par image GPT Image 2 1536x1024, qualité moyenne. Les tokens entrants, reprises facturées, stockages et variations de tarifs ne sont pas inclus. Configurer également des limites de dépense dans la plateforme OpenAI. Pour les 16 sites historiques, 480 images représentent environ 19,68 USD de sortie images. Si davantage de sites publics sont détectés, les sites prioritaires sont traités d'abord ; le rapport signale les sites non couverts par le plafond.

## 6. Résilience et périmètre de sécurité

La génération reprend par dossier daté sans reproduire les fichiers déjà présents. Une relance un autre jour ouvre un nouveau sous-dossier. Les erreurs d'authentification ou de quota interrompent le job ; les échecs de génération sont consignés et signalés dans la CI.

Le workflow n'a que contents: read sur GitHub et ne publie rien sur les sites. Le rapport JSON est conservé 30 jours dans les artefacts GitHub Actions. Un contrôle humain des images est recommandé avant publication.
