export type ConnectionStatus = "Connected" | "Not connected" | "Attention";
export const connectionNames = ["Google Ads", "Local Services", "GA4", "Search Console", "Google Business Profile", "Google Drive", "Airtable"] as const;
export type ConnectionName = (typeof connectionNames)[number];

export const demoConnections: Record<ConnectionName, ConnectionStatus> = {
  "Google Ads": "Connected",
  "Local Services": "Not connected",
  GA4: "Connected",
  "Search Console": "Attention",
  "Google Business Profile": "Connected",
  "Google Drive": "Connected",
  Airtable: "Not connected",
};