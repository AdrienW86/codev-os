"use client";

import { useMemo, useState } from "react";
import { buildRankingReport, type Observation, type Surface } from "@/lib/local-seo/ranking-engine";

const sampleShape = {
  evidence: {
    source: "Nom du fournisseur de mesure",
    capturedAt: "2026-11-14T09:00:00Z",
    query: "couvreur Décines-Charpieu",
    location: { latitude: 45.768, longitude: 4.959, language: "fr", device: "desktop" },
    surface: "maps",
    verified: false
  },
  targetId: "client-place-id",
  results: [
    { id: "concurrent-1", name: "Concurrent", rank: 1, reviewCount: 120, rating: 4.8 },
    { id: "client-place-id", name: "Client", rank: 2, reviewCount: 60, rating: 4.5 }
  ]
};

export default function LocalSeoRankingsPage() {
  const [surface, setSurface] = useState<Surface>("maps");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [observation, setObservation] = useState<Observation | null>(null);
  const report = useMemo(() => observation ? buildRankingReport(observation) : null, [observation]);
  function importObservation() {
    try {
      const value = JSON.parse(raw) as Observation;
      if (!value || !value.evidence || !Array.isArray(value.results) || typeof value.targetId !== "string" ||
          !["maps", "organic"].includes(value.evidence.surface) || !["mobile", "desktop"].includes(value.evidence.location?.device)) {
        throw new Error("Structure d'observation invalide.");
      }
      buildRankingReport(value);
      setObservation(value);
      setSurface(value.evidence.surface);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'importer les données.");
    }
  }
  const visible = report?.evidence.surface === surface ? report : null;
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Classement concurrentiel local</h1>
        <p className="text-sm opacity-75">Google Maps et Google Search sont analysés séparément, pour un mot-clé et une localisation précis.</p>
      </header>
      <div className="flex gap-2">
        {(["maps","organic"] as const).map(s => <button key={s} type="button" onClick={() => setSurface(s)}
          aria-pressed={surface===s} className="rounded border px-4 py-2 text-sm">{s==="maps"?"Google Maps":"Google Search"}</button>)}
      </div>
      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Importer une observation de classement</h2>
        <p className="text-sm opacity-75">En attente du connecteur de positions réelles. Import JSON provisoire : une observation non vérifiée ne produit aucun classement affirmé.</p>
        <textarea aria-label="Observation JSON" className="min-h-48 w-full rounded border bg-transparent p-3 font-mono text-xs"
          value={raw} onChange={e=>setRaw(e.target.value)} placeholder={JSON.stringify(sampleShape,null,2)}/>
        <button type="button" className="rounded border px-4 py-2" onClick={importObservation}>Analyser les positions</button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </section>
      {visible && <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">{visible.evidence.query}</h2>
        <p className="text-sm">Source : {visible.evidence.source} · Mesure : {visible.evidence.capturedAt} · {visible.evidence.location.latitude}, {visible.evidence.location.longitude}</p>
        <p className="font-medium">{visible.status==="verified" && visible.target
          ? `Client : position #${visible.target.rank} · ${visible.totalAhead} concurrents devant`
          : "Position client non vérifiée ou indisponible"}</p>
        {visible.warnings.map(w=><p role="alert" key={w} className="text-sm text-amber-700">{w}</p>)}
        {visible.competitorsAhead.length>0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr><th className="p-2">Position</th><th className="p-2">Concurrent</th><th className="p-2">Avis / Note</th><th className="p-2">Actions recommandées</th></tr></thead>
          <tbody>{visible.competitorsAhead.map(c=><tr key={c.id} className="border-t">
            <td className="p-2">#{c.rank}</td><td className="p-2">{c.website?<a className="underline" href={c.website} target="_blank" rel="noopener noreferrer">{c.name}</a>:c.name}</td>
            <td className="p-2">{c.reviewCount??"—"} / {c.rating??"—"}</td>
            <td className="p-2">{c.recommendations.length ? c.recommendations.map(r=><p key={r.code}><strong>{r.title}</strong> — {r.rationale}</p>):"Audit approfondi nécessaire"}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>}
    </main>
  );
}
