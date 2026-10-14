"use client";

import { useState } from "react";
import type { AdsDiagnostics } from "@/lib/ads/diagnostics";

export function AdsDiagnosticsPanel({ clientId, campaignId }: { clientId: string; campaignId: string }) {
  const [result, setResult] = useState<AdsDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function inspect() {
    if (!clientId || !/^\d{1,20}$/.test(campaignId)) {
      setError("Sélectionnez un compte et un identifiant de campagne.");
      return;
    }
    setBusy(true); setResult(null); setError("");
    try {
      const params = new URLSearchParams({ clientId, campaignId });
      const response = await fetch(`/api/integrations/google-ads/diagnostics?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Lecture Google Ads indisponible.");
      setResult(await response.json() as AdsDiagnostics);
    } catch { setError("Diagnostic indisponible. Vérifiez les accès Google Ads."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-border p-5" aria-label="Diagnostic Google Ads">
    <div>
      <h3 className="font-semibold">Diagnostic des conversions, annonces et composants</h3>
      <p className="mt-1 text-sm text-muted">Lecture seule. Le résultat porte sur la campagne sélectionnée, pas sur tous les comptes.</p>
    </div>
    <button type="button" disabled={busy || !clientId} onClick={() => void inspect()}
      className="min-h-10 rounded-lg border border-border px-4 text-sm">
      {busy ? "Analyse en cours…" : "Analyser la campagne"}
    </button>
    {error && <p role="alert" className="text-sm text-warning">{error}</p>}
    {result && <div className="space-y-3 text-sm">
      <p className="text-muted">Campagne {result.campaignId} · {result.conversionActions.length} actions de conversion · {result.ads.length} annonces · {result.assets.length} composants</p>
      {result.unavailable.length > 0 && <p role="alert" className="text-warning">Sections non vérifiables : {result.unavailable.join(", ")}. Aucun résultat négatif ne doit être déduit de leur absence.</p>}
      {result.issues.length === 0 && <p>Aucune anomalie détectée dans les données accessibles. Cela ne prouve pas que les conversions sont correctement déclenchées sur le site.</p>}
      {result.issues.map((issue, index) => <div key={index} className="rounded-lg border border-border p-3">
        <strong>{issue.severity === "high" ? "Priorité haute" : "À améliorer"} — {issue.title}</strong>
        <p className="mt-1">{issue.detail}</p>
        <p className="mt-1 text-muted">Action proposée : {issue.recommendation}</p>
      </div>)}
    </div>}
  </section>;
}
