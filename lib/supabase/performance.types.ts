import type { Json } from "./database.types";

export type PerformanceAudit = {
  id: string;
  client_id: string | null;
  url: string;
  strategy: "mobile" | "desktop";
  source: string;
  scores: Json;
  lab: Json;
  field: Json;
  opportunities: Json;
  analyzed_at: string;
  created_at: string;
};
export type PerformanceAuditInsert = Omit<PerformanceAudit, "id" | "created_at">;
export type PerformanceTables = {
  performance_audits: {
    Row: PerformanceAudit;
    Insert: PerformanceAuditInsert;
    Update: Partial<PerformanceAuditInsert>;
    Relationships: [{ foreignKeyName: "performance_audits_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] }];
  };
};
