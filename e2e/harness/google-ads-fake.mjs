// E2E UNIQUEMENT (chargé par --import dans le serveur Next de e2e/output) : remplace les réponses des
// deux hôtes Google utilisés par le connecteur Google Ads (jeton OAuth, googleAds:search) par des
// données fixes. Le vrai client de l'application (pagination, normalisation, périodes) est exercé ;
// Resend est aussi simulé. Toute autre destination distante est refusée ; seul le réseau local reste accessible.
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const day = 86_400_000;
const span = (query) => {
  const match = /BETWEEN '(\d{4}-\d{2}-\d{2})' AND '(\d{4}-\d{2}-\d{2})'/.exec(query) ?? /creation_date_time >= '(\d{4}-\d{2}-\d{2}) .*<= '(\d{4}-\d{2}-\d{2})/.exec(query);
  return match ? Math.round((Date.parse(match[2]) - Date.parse(match[1])) / day) + 1 : 0;
};
// Coûts proportionnels au nombre de jours : un changement de période se voit dans les chiffres.
const campaigns = [
  { id: "9001", name: "Search Toulouse", status: "ENABLED", type: "SEARCH", budget: "20000000", perDay: { cost: 2_000_000, clicks: 3, impressions: 40, conversions: 0.5 } },
  { id: "9002", name: "Search Albi", status: "PAUSED", type: "SEARCH", budget: "10000000", perDay: { cost: 1_000_000, clicks: 1, impressions: 20, conversions: 0 } },
  { id: "9003", name: "Local Services Jrenov", status: "ENABLED", type: "LOCAL_SERVICES", budget: null, perDay: { cost: 5_000_000, clicks: 2, impressions: 10, conversions: 1 } },
];
const metricsFor = (perDay, days) => ({ costMicros: String(perDay.cost * days), clicks: String(perDay.clicks * days), impressions: String(perDay.impressions * days), conversions: perDay.conversions * days, conversionsValue: 0 });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "e2e-access", expires_in: 3600 });
  if (url === "https://api.resend.com/emails") return json({ id: "fake-email-accepted" });
  if (!url.startsWith("https://googleads.googleapis.com/")) {
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("E2E external network blocked");
    return realFetch(input, init);
  }
  if (!url.endsWith("/googleAds:search")) return json({ error: "e2e: seule la lecture est simulée" }, 403);
  const { query } = JSON.parse(String(init.body ?? "{}"));
  if (query.includes("FROM customer LIMIT 1")) return json({ results: [{ customer: { id: "1234567890", descriptiveName: "Compte E2E Jrenov", currencyCode: "EUR", timeZone: "Europe/Paris" } }] });
  if (query.includes("FROM local_services_lead")) return json({ results: Array.from({ length: Math.min(span(query), 5) }, (_, index) => ({ localServicesLead: { leadType: index % 2 ? "MESSAGE" : "PHONE_CALL", leadStatus: "NEW" } })) });
  if (query.includes("FROM customer")) {
    const days = span(query);
    const sum = (key) => campaigns.reduce((total, campaign) => total + campaign.perDay[key] * days, 0);
    return json({ results: [{ metrics: { costMicros: String(sum("cost")), clicks: String(sum("clicks")), impressions: String(sum("impressions")), conversions: sum("conversions"), conversionsValue: 0 } }] });
  }
  if (query.includes("segments.date")) return json({ results: campaigns.map((campaign) => ({ campaign: { id: campaign.id }, metrics: metricsFor(campaign.perDay, span(query)) })) });
  if (query.includes("FROM campaign")) return json({ results: campaigns.map((campaign) => ({
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status, advertisingChannelType: campaign.type },
    ...(campaign.budget ? { campaignBudget: { amountMicros: campaign.budget, explicitlyShared: false, period: "DAILY" } } : {}),
  })) });
  return json({ results: [] });
};
