# CODE-V Performance dans l'OS

## Architecture
- Interface privée : /performance (sous cockpit Clerk + requireAdmin).
- Route serveur : POST /api/performance, vérifiée via requireAdmin ; appel HTTPS du moteur public hébergé par Codev2 avec secret serveur.
- Aucune clé Google PageSpeed ni clé de service exposée au navigateur.
- Sélection facultative d'un client, URL préremplie depuis le champ website ; analyse mobile/ordinateur et rapport imprimable.
- Audit sauvegardé dans public.performance_audits, rattaché au client si choisi. Les 30 derniers résultats sont présentés sur la page.

## Variables Vercel (CODE-V OS)
- CODEV_PERFORMANCE_API_URL=https://www.code-v.fr/api/performance (par défaut, sur production). En prévisualisation, pointer vers la preview Codev2 correspondante.
- CODEV_PERFORMANCE_SERVICE_KEY : même secret d'au moins 24 caractères que sur Codev2. NE PAS utiliser NEXT_PUBLIC_.
- Variables Supabase actuelles inchangées.

## Schéma SQL
Appliquer **après fusion** la migration supabase/migrations/20261205010000_performance_audits.sql dans l'environnement ciblé. La table active RLS, retire les droits anon/authenticated et donne l'accès exclusivement au service_role server-only. Sans migration, les audits restent affichables mais ne peuvent pas être archivés, et la page indique que l'historique est indisponible.

## Non inclus dans cette première version
- Exécutions planifiées par client, alertes de baisse de score, baseline/compensation, rapport PDF serveur et création de missions automatiquement.
- L'interface ne déclenche aucun correctif sur les sites audités. Validation humaine obligatoire.\n- Agent Performance : bouton manuel pour interpréter un audit enregistré ou une ligne d'historique ; route /api/performance/explain sécurisée par requireAdmin, origin/CSRF, limite par administrateur et validation du JSON de sortie.\n- Données IA : uniquement scores, mesures, opportunités, comparaisons passées même URL/appareil et informations professionnelles limitées (nom, entreprise, activité, zone, site, projets). Jamais les coordonnées ou notes libres du client. Le rapport IA n'est pas archivé, ni envoyé au client ; fournisseur IA existant dans l'OS (OPENAI_API_KEY ou ANTHROPIC_API_KEY).\n- Sans audit enregistré (table Supabase inaccessible), l'agent reste désactivé ; aucune analyse inventée.
- Score Lighthouse ponctuel non équivalent à la performance réelle des visiteurs.

## Validation avant publication
npm run lint && npm run typecheck && npm run test && npm run build
Tests manuels avec une session Clerk admin puis non-admin, absence de secret, sans migration et avec migration, audit d'un client et URL libre, score mobile/desktop et consultation d'historique.
