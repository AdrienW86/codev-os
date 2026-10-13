// Registre des fournisseurs et de leur configuration serveur.
// Ne lit que la PRÉSENCE des variables : aucune valeur n'est jamais renvoyée ni journalisée.
import type { ProviderId } from "@/lib/agents/registry";

export type Env = Record<string, string | undefined>;

export type ProviderRequirement = {
  id: ProviderId | "clerk" | "supabase" | "scheduler" | "speech" | "credentials" | "google-drive-import" | "whatsapp-webhook" | "whatsapp-ingestion" | "push";
  label: string;
  /** Variables indispensables. */
  required: string[];
  /** Variables facultatives (améliorent le fonctionnement). */
  optional?: string[];
  /** Au moins une des combinaisons doit être complète (fournisseurs alternatifs). */
  anyOf?: string[][];
  description: string;
  /** Démarche manuelle à effectuer (console fournisseur, OAuth…). */
  setup: string;
  /** Lien vers la documentation du dépôt. */
  docs: string;
};

export const providerRequirements: ProviderRequirement[] = [
  { id: "clerk", label: "Clerk (authentification)", required: ["CLERK_SECRET_KEY", "AUTHORIZED_ADMIN_USER_ID"], description: "Connexion de l’administrateur.", setup: "Clé secrète et clé publiable de l’application Clerk (voir docs/setup.md) ; AUTHORIZED_ADMIN_USER_ID = identifiant user_… de l’administrateur.", docs: "docs/setup.md#clerk" },
  { id: "supabase", label: "Supabase (données)", required: ["SUPABASE_SECRET_KEY"], description: "Base de données métier, accès serveur uniquement.", setup: "URL publique du projet (voir docs/setup.md) et clé secrète sb_secret_… (jamais exposée au navigateur).", docs: "docs/setup.md#supabase" },
  { id: "scheduler", label: "Planificateur (cron)", required: ["CRON_SECRET"], description: "Déclenche les automatisations via /api/internal/scheduler/tick.", setup: "Générer un secret aléatoire (32+ caractères) ; Vercel Cron l’envoie automatiquement.", docs: "docs/automation.md" },
  { id: "openai", label: "OpenAI", required: ["OPENAI_API_KEY"], description: "Assistant, génération des publications, transcription vocale.", setup: "Clé API OpenAI côté serveur.", docs: "docs/integrations.md#openai" },
  { id: "anthropic", label: "Anthropic (Claude)", required: ["ANTHROPIC_API_KEY"], description: "Fournisseur alternatif pour l’assistant.", setup: "Clé API Anthropic côté serveur ; AI_PROVIDER=anthropic pour l’utiliser.", docs: "docs/integrations.md#anthropic" },
  { id: "speech", label: "Transcription vocale", required: [], anyOf: [["OPENAI_API_KEY"]], description: "Transcription du mode vocal (push-to-talk).", setup: "Utilise la clé OpenAI ; sinon repli sur la reconnaissance vocale du navigateur.", docs: "docs/integrations.md#voix" },
  { id: "search-console", label: "Google Search Console", required: [], anyOf: [
    ["PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"],
    ["PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID", "GOOGLE_BUSINESS_PROFILE_CLIENT_ID", "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET"],
    ["GOOGLE_SEARCH_CONSOLE_CLIENT_ID", "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET", "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"],
  ], description: "Clics, impressions, CTR, positions, requêtes et pages (Données et performances, Agent SEO, rapports).", setup: "Client OAuth Google (scope webmasters.readonly, dédié ou partagé avec Google Business Profile) puis « Connecter Google Search Console » dans Paramètres → Connexions ; une propriété par fiche client.", docs: "docs/integrations.md#search-console" },
  { id: "pagespeed", label: "PageSpeed Insights", required: [], optional: ["PAGESPEED_API_KEY"], description: "Performances Lighthouse (Agent SEO, Agent Monitoring).", setup: "Fonctionne sans clé avec un quota réduit ; ajouter une clé API Google pour un usage régulier.", docs: "docs/integrations.md#pagespeed" },
  { id: "http", label: "Contrôles HTTP", required: [], description: "Disponibilité et temps de réponse des sites.", setup: "Aucune configuration ; seules les URL publiques https des clients sont contrôlées.", docs: "docs/integrations.md#monitoring" },
  { id: "vercel", label: "Vercel", required: ["VERCEL_TOKEN"], optional: ["VERCEL_TEAM_ID"], description: "Déploiements et builds des sites clients.", setup: "Jeton Vercel en lecture ; identifiant de projet renseigné par client.", docs: "docs/integrations.md#vercel" },
  { id: "github", label: "GitHub", required: ["GITHUB_TOKEN"], description: "Derniers changements des dépôts clients (lecture seule).", setup: "Jeton à granularité fine, lecture seule (contents, metadata).", docs: "docs/integrations.md#github" },
  { id: "google-ads", label: "Google Ads", required: ["GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN"], optional: ["GOOGLE_ADS_LOGIN_CUSTOMER_ID"], description: "Campagnes en lecture seule (Agent Google Ads).", setup: "Client OAuth, jeton développeur Google Ads approuvé, jeton de rafraîchissement ; identifiant client par fiche client.", docs: "docs/integrations.md#google-ads" },
  { id: "meta", label: "Meta (Facebook & Instagram)", required: ["META_APP_ID", "META_APP_SECRET", "PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID"], description: "Publication sur les pages des clients (après validation).", setup: "Application Meta validée ; autorisation OAuth par projet.", docs: "docs/publications-meta-setup.md" },
  { id: "google-business-profile", label: "Google Business Profile", required: ["GOOGLE_BUSINESS_PROFILE_CLIENT_ID", "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET", "PUBLICATIONS_OAUTH_BASE_URL", "PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID"], description: "Publications Google (après validation).", setup: "Client OAuth Google approuvé pour l’API Business Profile ; autorisation par projet.", docs: "docs/publications-oauth.md" },
  { id: "google-drive", label: "Google Drive", required: ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"], description: "Photos des clients pour les publications.", setup: "Client OAuth Google avec accès en lecture au dossier des médias.", docs: "docs/publications-architecture.md" },
  { id: "credentials", label: "Trousseau des identifiants de publication", required: ["PUBLICATION_CREDENTIALS_KEY", "PUBLICATION_CREDENTIALS_KEY_ID"], description: "Chiffrement des jetons OAuth Meta et Google Business Profile.", setup: "Clé de chiffrement et son identifiant (voir docs/publications-oauth.md) ; jamais affichée.", docs: "docs/publications-oauth.md" },
  { id: "google-drive-import", label: "Google Drive (import des photos clients)", required: ["GOOGLE_DRIVE_IMPORT_CLIENT_ID", "GOOGLE_DRIVE_IMPORT_CLIENT_SECRET", "GOOGLE_DRIVE_IMPORT_REFRESH_TOKEN"], description: "Dépôt des médias WhatsApp dans Drive (portée drive.file, distincte du Drive des publications).", setup: "Client OAuth d’import et refresh token avec la portée drive.file uniquement.", docs: "docs/whatsapp-drive.md" },
  { id: "whatsapp-webhook", label: "WhatsApp (réception)", required: ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID"], description: "Webhook Meta des photos et vidéos envoyées par les clients.", setup: "Jeton de vérification, secret de l’application Meta, numéro et compte WhatsApp Business.", docs: "docs/whatsapp-drive.md" },
  { id: "whatsapp-ingestion", label: "WhatsApp (téléchargement des médias)", required: ["WHATSAPP_ACCESS_TOKEN"], description: "Téléchargement des médias reçus avant leur dépôt dans Drive. Actif seulement si WHATSAPP_INGESTION_ENABLED=true.", setup: "Jeton d’accès système WhatsApp Business ; puis WHATSAPP_INGESTION_ENABLED=true.", docs: "docs/whatsapp-drive.md" },
  { id: "push", label: "Notifications push", required: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], optional: ["PUSH_SENDING_ENABLED"], description: "Notifications web push de l’administrateur. Désactivées tant que PUSH_SENDING_ENABLED ≠ true.", setup: "Paire de clés VAPID et adresse de contact ; puis PUSH_SENDING_ENABLED=true.", docs: "docs/notifications-pwa.md" },
  { id: "email", label: "E-mail (Resend)", required: ["RESEND_API_KEY", "EMAIL_FROM"], optional: ["EMAIL_SENDING_ENABLED"], description: "Envoi des rapports approuvés. Désactivé tant que EMAIL_SENDING_ENABLED ≠ true.", setup: "Clé Resend, domaine d’envoi vérifié, adresse EMAIL_FROM ; puis EMAIL_SENDING_ENABLED=true.", docs: "docs/integrations.md#email" },
  { id: "rss", label: "Flux de veille", required: [], description: "Flux publics de la veille tech & IA.", setup: "Aucune configuration ; sources définies dans lib/news/sources.ts.", docs: "docs/integrations.md#veille" },
  { id: "internal", label: "Interne", required: [], description: "Traitements internes à CODE-V OS.", setup: "—", docs: "docs/architecture.md" },
];

const present = (env: Env, name: string) => typeof env[name] === "string" && env[name]!.trim().length > 0;

export type ProviderStatus = { id: ProviderRequirement["id"]; label: string; state: "configured" | "missing"; missing: string[]; optionalMissing: string[] };

export function providerStatus(requirement: ProviderRequirement, env: Env = process.env): ProviderStatus {
  let missing = requirement.required.filter((name) => !present(env, name));
  if (requirement.anyOf && !requirement.anyOf.some((group) => group.every((name) => present(env, name)))) {
    missing = [...missing, ...requirement.anyOf[0].filter((name) => !present(env, name))];
  }
  return {
    id: requirement.id, label: requirement.label, state: missing.length ? "missing" : "configured", missing: [...new Set(missing)],
    optionalMissing: (requirement.optional ?? []).filter((name) => !present(env, name)),
  };
}

export function isProviderConfigured(provider: ProviderId | ProviderRequirement["id"], env: Env = process.env) {
  const requirement = providerRequirements.find((item) => item.id === provider);
  return requirement ? providerStatus(requirement, env).state === "configured" : false;
}

export function allProviderStatuses(env: Env = process.env) {
  return providerRequirements.filter((item) => item.id !== "internal").map((item) => ({ ...providerStatus(item, env), requirement: item }));
}

export type ConnectionState = "ok" | "todo" | "attention";

/**
 * ✓ ok : configuré et sans erreur récente ; ○ todo : rien de configuré ;
 * ! attention : configuration partielle (incohérente) ou dernière synchronisation en erreur.
 */
export function connectionState(requirement: ProviderRequirement, env: Env = process.env, lastError?: string | null): ConnectionState {
  const status = providerStatus(requirement, env);
  if (status.state === "configured") return lastError ? "attention" : "ok";
  const names = [...requirement.required, ...(requirement.anyOf?.flat() ?? [])];
  return names.some((name) => present(env, name)) ? "attention" : "todo";
}

/**
 * Interrupteurs serveur : uniquement « activé » ou « désactivé » (valeur exacte attendue), jamais la valeur lue.
 * Aucun n'est activé par défaut. PUBLICATIONS_SCHEDULED_DELIVERY suit scheduledDeliveryEnabled (lib/publications/delivery/registry.ts).
 */
export type FeatureFlag = { id: "publications-scheduled-delivery" | "whatsapp-ingestion" | "push-sending" | "email-sending"; label: string; variable: string; enabledValue: string; description: string };
export const featureFlags: FeatureFlag[] = [
  { id: "publications-scheduled-delivery", label: "Diffusion automatique des publications", variable: "PUBLICATIONS_SCHEDULED_DELIVERY", enabledValue: "enabled", description: "Envoi à l’heure prévue par le planificateur des publications approuvées par un humain." },
  { id: "whatsapp-ingestion", label: "Réception des médias WhatsApp", variable: "WHATSAPP_INGESTION_ENABLED", enabledValue: "true", description: "Réception et dépôt dans Drive des médias envoyés par les clients." },
  { id: "push-sending", label: "Diffusion des notifications push", variable: "PUSH_SENDING_ENABLED", enabledValue: "true", description: "Notifications web push vers l’appareil de l’administrateur." },
  { id: "email-sending", label: "Expédition des e-mails", variable: "EMAIL_SENDING_ENABLED", enabledValue: "true", description: "Envoi des rapports approuvés par e-mail." },
];
export function isFlagEnabled(id: FeatureFlag["id"], env: Env = process.env) {
  const flag = featureFlags.find((item) => item.id === id);
  return flag ? env[flag.variable] === flag.enabledValue : false;
}
