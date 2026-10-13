export const ACQUISITION_CATEGORIES = [
  { id: "platform_shutdown", label: "Plateforme en fermeture", description: "Migration de site avec fermeture confirmée" },
  { id: "site_issues", label: "Site vieillissant ou défectueux", description: "Défauts observés et documentés" },
  { id: "no_professional_site", label: "Entreprise sans site", description: "Présence professionnelle sans site identifiable" },
  { id: "agency_partner", label: "Agence partenaire", description: "Sous-traitance et collaborations" },
  { id: "digital_needs", label: "Automatisation et besoins numériques", description: "Besoins métier étayés par des sources" },
] as const;

export type AcquisitionCategory = (typeof ACQUISITION_CATEGORIES)[number]["id"];
export type AcquisitionStage = "discovered" | "verified" | "qualified" | "draft_ready" | "approved" | "contacted" | "responded" | "won" | "lost" | "excluded";
export const ACQUISITION_STAGES: Record<AcquisitionStage, string> = {
  discovered: "Découvert", verified: "Vérifié", qualified: "Qualifié", draft_ready: "Brouillon prêt",
  approved: "Approuvé", contacted: "Contacté", responded: "Réponse reçue", won: "Client",
  lost: "Sans suite", excluded: "Exclu",
};
export type AcquisitionWorkspace = {
  id: string; client_id: string | null; label: string; is_internal: boolean;
  discovery_enabled: boolean; sending_enabled: boolean; emergency_stop: boolean;
  daily_send_limit: number; timezone: string;
};
export type AcquisitionProspect = {
  id: string; workspace_id: string; company_name: string; website: string | null;
  category: AcquisitionCategory; stage: AcquisitionStage; score: number | null;
  source_url: string | null; source_checked_at: string | null; explanation: string | null;
  created_at: string;
};
export type AcquisitionMessage = {
  id: string; workspace_id: string; prospect_id: string; recipient_email: string;
  subject: string; body_text: string; state: string; created_at: string;
};
export type AcquisitionSender = {
  id: string; workspace_id: string; address: string; provider: string;
  status: string; daily_limit: number;
};
export type AcquisitionTemplate = {
  id: string; workspace_id: string; category: AcquisitionCategory; name: string;
  subject_template: string; body_template: string; enabled: boolean;
};
