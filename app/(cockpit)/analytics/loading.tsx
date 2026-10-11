// Squelette du tableau de bord Analytics (même grille que la page chargée).
export default function AnalyticsLoading() {
  const block = "animate-pulse rounded-2xl border border-[#1b2942] bg-[#0b1322]";
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">Chargement des données…</span>
      <div className="h-4 w-56 animate-pulse rounded bg-white/5" />
      <div className="h-9 w-80 max-w-full animate-pulse rounded-lg bg-white/5" />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className={`h-32 ${block}`} />)}
      </div>
      <div className={`h-80 ${block}`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((key) => <div key={key} className={`h-72 ${block}`} />)}
      </div>
    </div>
  );
}
