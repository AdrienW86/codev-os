// Modèle de la simulation UX. Données 100 % frontend : jamais écrites en base.
import type { AgentBlueprintId } from "@/lib/agents/catalog";
import type { ServiceId } from "@/lib/services/catalog";

export type SimId = string;

export type SimServiceStatus = "active" | "to-configure";
export type SimAgentStatus = "active" | "ready" | "to-connect" | "config-required" | "coming-soon" | "error" | "disconnected" | "paused";
export type SimHistory = { at: string; label: string }[];

export type SimClient = {
  id: SimId; name: string; activity: string; zone: string; website: string; createdAt: string;
  services: Partial<Record<ServiceId, SimServiceStatus>>; isNew?: boolean;
};

export type SimProject = { id: SimId; clientId: SimId; name: string; serviceId: ServiceId; status: "setup" | "active" | "done" };

export type SimAgent = { status: SimAgentStatus; note?: string; config?: Record<string, string> };

export type SimWorkKind = "task" | "recommendation" | "action" | "incident";
export type SimWorkStatus =
  | "todo" | "in-progress" | "waiting" | "done"                 // tâches
  | "to-review" | "accepted" | "rejected"                       // recommandations
  | "draft" | "to-approve" | "approved" | "refused" | "executed" | "failed" // actions
  | "open" | "investigating" | "resolved";                      // incidents

export type SimWorkItem = {
  id: SimId; kind: SimWorkKind; title: string; summary: string; status: SimWorkStatus;
  clientId: SimId; projectId?: SimId; agentId?: AgentBlueprintId;
  priority: "high" | "medium" | "low"; due?: string; createdAt: string;
  /** Élément à l’origine de celui-ci (incident → recommandation → action). */
  sourceId?: SimId;
  details?: { label: string; value: string }[];
  history: SimHistory;
};

export type SimPlatform = "facebook" | "instagram" | "google_business_profile";
export type SimPublication = {
  id: SimId; clientId: SimId; projectId?: SimId; subject: string; text: string; date: string; time: string;
  status: "draft" | "to-review" | "approved" | "scheduled" | "published" | "partial";
  channels: { platform: SimPlatform; status: "pending" | "published" | "failed"; error?: string }[];
  history: SimHistory;
};

export type SimReport = {
  id: SimId; clientId?: SimId; kind: "weekly" | "monthly" | "global"; period: string;
  status: "to-generate" | "generating" | "ready" | "approved" | "sent";
  summary: string; sections: { title: string; lines: string[] }[]; recipient: string; history: SimHistory;
};

export type SimEventKind = "task" | "meeting" | "check" | "agent-run";
export type SimEvent = {
  id: SimId; kind: SimEventKind; title: string; date: string; time: string;
  clientId?: SimId; projectId?: SimId; agentId?: AgentBlueprintId; recurrence: "none" | "daily" | "weekly" | "monthly";
};

export type SimAutomation = {
  id: SimId; label: string; schedule: string; agentId: AgentBlueprintId; target: string;
  nextRun: string; lastRun?: string; status: "active" | "paused" | "error";
  history: { at: string; status: "success" | "failed"; summary: string }[];
};

export type SimCampaign = { id: SimId; clientId: SimId; name: string; spend: number; budget: number; conversions: number; cpa: number; state: "stable" | "anomaly" | "growing"; note: string };
export type SimSite = { clientId: SimId; url: string; status: "up" | "degraded" | "down"; uptime: string; performance: number; lastCheck: string };
export type SimSeo = { clientId: SimId; clicks: number; clicksChange: number; position: number; positionChange: number };
export type SimActivity = { id: SimId; agentId: AgentBlueprintId; clientId?: SimId; summary: string; at: string; status: "success" | "running" | "failed" };
export type SimConnection = { id: string; name: string; description: string; status: "connected" | "to-connect" | "error" | "coming-soon" };
export type SimNews = { id: string; title: string; category: "IA" | "Développement" | "SEO" | "Ads" | "Web"; source: string; summary: string; date: string };

export type SimWorld = {
  today: string;
  clients: SimClient[]; projects: SimProject[]; agents: Record<AgentBlueprintId, SimAgent>;
  work: SimWorkItem[]; publications: SimPublication[]; reports: SimReport[]; events: SimEvent[];
  automations: SimAutomation[]; campaigns: SimCampaign[]; sites: SimSite[]; seo: SimSeo[];
  activity: SimActivity[]; connections: SimConnection[]; news: SimNews[];
};

/** Entités ouvrables dans le panneau de détail commun. */
export type SimEntityRef =
  | { type: "work"; id: string } | { type: "project"; id: string } | { type: "publication"; id: string }
  | { type: "report"; id: string } | { type: "agent"; id: AgentBlueprintId } | { type: "automation"; id: string }
  | { type: "campaign"; id: string } | { type: "site"; id: string };
