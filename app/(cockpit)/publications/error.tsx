"use client";

export default function PublicationsError({ reset }: { reset: () => void }) {
  return <section role="alert" className="rounded-xl border border-border bg-surface p-6">
    <h1 className="text-xl font-semibold">Publications indisponibles</h1>
    <p className="mt-3 text-sm text-muted">Impossible de lire le stockage. Vérifiez que les migrations Publications ont été appliquées. La génération et la publication restent inexécutables dans cette étape.</p>
    <button onClick={reset} className="mt-5 rounded-lg border border-border px-4 py-2 text-sm">Réessayer</button>
  </section>;
}
