"use client";
import { useState } from "react";
import { AdsDiagnosticsPanel } from "./ads-diagnostics-panel";

type ClientOption = { id: string; name: string; account: string };
type Preview = { executed?: boolean; verified?: boolean; preview?: unknown; error?: string; approvalId?: string; requiresApproval?: boolean };

export function AdsManualManager({ clients, initialClient }: { clients: ClientOption[]; initialClient: string }) {
  const [clientId, setClientId] = useState(initialClient);
  const [campaignId, setCampaignId] = useState("");
  const [kind, setKind] = useState("negative_keyword_add");
  const [adGroupId, setAdGroupId] = useState("");
  const [criterionId, setCriterionId] = useState("");
  const [adId, setAdId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [keywords, setKeywords] = useState("");
  const [matchType, setMatchType] = useState<"EXACT" | "PHRASE">("EXACT");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [approvalId, setApprovalId] = useState("");
  const client = clients.find((item) => item.id === clientId);
  const execute = async (dryRun: boolean) => {
    if (!client || !/^\d+$/.test(campaignId)) { setPreview({ error: "Sélectionnez un client et saisissez l'ID numérique d'une campagne." }); return; }
    setBusy(true);
    setPreview(null);
    try {
      const change = ["negative_keyword_add", "keyword_add"].includes(kind)
        ? { kind, customerId: client.account, campaignId, ...(kind === "keyword_add" ? { adGroupId } : {}), keywords: keywords.split(/\r?\n/).map((text) => ({ text: text.trim(), matchType })).filter((x) => x.text) }
        : { kind, customerId: client.account, campaignId, ...(["keyword_pause", "keyword_enable"].includes(kind) ? { adGroupId, criterionId } : {}),
            ...(["ad_pause", "ad_enable"].includes(kind) ? { adGroupId, adId } : {}),
            ...(["call_asset_pause", "call_asset_enable"].includes(kind) ? { assetId } : {}) };
      const response = await fetch("/api/integrations/google-ads/manage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, change, dryRun, ...(dryRun ? {} : { confirm, ...(approvalId ? { approvalId } : {}) }) }),
      });
      const result = await response.json() as Preview;
      if (!response.ok) setPreview({ error: result.error ?? "Opération refusée." });
      else { setPreview(result); if (!dryRun && "approvalId" in result && typeof result.approvalId === "string") setApprovalId(result.approvalId); else if (!dryRun) setApprovalId(""); }
    } catch { setPreview({ error: "Connexion indisponible." }); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border border-border p-5">
    <p className="text-sm text-muted">Le mode aperçu n&apos;effectue aucune modification. Les écritures réelles sont désactivées par défaut, et les budgets ne sont jamais modifiables ici.</p>
    <label className="block text-sm">Client
      <select className="mt-2 block w-full rounded-lg border border-border bg-background p-3" value={clientId} onChange={(e) => { setClientId(e.target.value); setPreview(null); setApprovalId(""); }}>
        <option value="">Sélectionner</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.account}</option>)}
      </select>
    </label>
    <label className="block text-sm">Identifiant Google Ads de la campagne
      <input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setPreview(null); setApprovalId(""); }} placeholder="Ex. 24338541496" inputMode="numeric" />
    </label>
    <label className="block text-sm">Opération
      <select className="mt-2 block w-full rounded-lg border border-border bg-background p-3" value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setApprovalId(""); }}>
        <option value="negative_keyword_add">Ajouter des exclusions</option><option value="keyword_add">Ajouter des mots-clés positifs</option><option value="keyword_pause">Suspendre un mot-clé</option><option value="keyword_enable">Réactiver un mot-clé</option><option value="ad_pause">Suspendre une annonce</option><option value="ad_enable">Réactiver une annonce</option><option value="call_asset_pause">Suspendre un composant Appel</option><option value="call_asset_enable">Réactiver un composant Appel</option><option value="campaign_pause">Suspendre la campagne</option><option value="campaign_enable">Réactiver la campagne</option>
      </select>
    </label>
    {["keyword_add", "keyword_pause", "keyword_enable", "ad_pause", "ad_enable"].includes(kind) && <label className="block text-sm">ID du groupe d’annonces<input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" inputMode="numeric" value={adGroupId} onChange={(e) => setAdGroupId(e.target.value)} /></label>}
    {["keyword_pause", "keyword_enable"].includes(kind) && <label className="block text-sm">ID du critère (mot-clé)<input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" inputMode="numeric" value={criterionId} onChange={(e) => setCriterionId(e.target.value)} /></label>}
    {["ad_pause", "ad_enable"].includes(kind) && <label className="block text-sm">ID de l’annonce<input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" inputMode="numeric" value={adId} onChange={(e) => { setAdId(e.target.value); setApprovalId(""); }} /></label>}
    {["call_asset_pause", "call_asset_enable"].includes(kind) && <label className="block text-sm">ID du composant Appel<input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" inputMode="numeric" value={assetId} onChange={(e) => { setAssetId(e.target.value); setApprovalId(""); }} /></label>}
    {["negative_keyword_add", "keyword_add"].includes(kind) && <>
      <label className="block text-sm">Correspondance
        <select className="mt-2 block w-full rounded-lg border border-border bg-background p-3" value={matchType} onChange={(e) => setMatchType(e.target.value as "EXACT" | "PHRASE")}><option value="EXACT">Exacte</option><option value="PHRASE">Expression</option></select>
      </label>
      <label className="block text-sm">{kind === "keyword_add" ? "Mots-clés à ajouter" : "Mots-clés à exclure"} (un par ligne, 25 maximum)
        <textarea className="mt-2 block w-full rounded-lg border border-border bg-background p-3" rows={5} value={keywords} onChange={(e) => { setKeywords(e.target.value); setPreview(null); }} />
      </label>
    </>}
    <button type="button" disabled={busy} onClick={() => execute(true)} className="min-h-11 rounded-lg border border-border px-4">Prévisualiser sans modifier</button>
    {preview && <div className="rounded-lg border border-border p-3 text-sm" role="status">
      {preview.error ? <p role="alert">{preview.error}</p> : <><p>{preview.executed ? "Opération envoyée à Google Ads" : preview.requiresApproval ? "Approbation enregistrée : confirmez une seconde fois pour exécuter." : "Aperçu uniquement : aucune modification effectuée"}</p><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(preview.preview, null, 2)}</pre>{preview.executed && <p>Vérification du statut : {preview.verified ? "confirmée" : "non confirmée"}</p>}</>}
    </div>}
    <AdsDiagnosticsPanel key={clientId + ":" + campaignId} clientId={clientId} campaignId={campaignId} />
    <p className="text-sm text-muted">Les diagnostics sont en lecture seule. Les statuts des annonces et composants Appel sont modifiables uniquement après validation. La création des annonces, les conversions et les budgets restent hors périmètre.</p>
    <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Exécution réelle — confirmation renforcée</summary>
      <p className="mt-2 text-sm text-muted">Accessible uniquement lorsque le module sécurisé a été activé côté serveur. Vérifiez le périmètre avant toute opération.</p>
      <label className="mt-3 block text-sm">Saisissez exactement : CONFIRMER {campaignId || "[ID CAMPAGNE]"}
        <input className="mt-2 block w-full rounded-lg border border-border bg-background p-3" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button type="button" disabled={busy || confirm !== `CONFIRMER ${campaignId}`} onClick={() => execute(false)} className="mt-3 min-h-11 rounded-lg border border-border px-4">{approvalId ? "Confirmer et exécuter" : "Créer une approbation à usage unique"}</button>
    </details>
  </section>;
}
