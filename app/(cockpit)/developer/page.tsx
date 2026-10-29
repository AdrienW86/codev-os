import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listDeveloperReviews } from "@/lib/developer/service";
import { PageHeading } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Propositions de développement" };

export default async function DeveloperReviewsPage() {
  await requireAdmin();
  const { repositories, requests, errors } = await listDeveloperReviews();

  return (
    <>
      <PageHeading eyebrow="Agent Développeur · Première étape" title="Propositions GitHub"
        description="Pull requests brouillon de l'agent, séparées de la production. Le déclenchement autonome et la validation dans CODE-V OS seront ajoutés dans les prochains lots." />
      <div className="mb-6 rounded-xl border border-border bg-surface-raised p-4 text-sm text-muted">
        <p>{repositories.length} connexion(s) GitHub client détectée(s). Seules les branches commençant par <code>codev-dev/</code> apparaissent ici.</p>
        <p className="mt-2">Aucune proposition n&apos;est fusionnée depuis cet écran. Les approbations et corrections sont encore gérées manuellement dans GitHub.</p>
      </div>
      {errors.length > 0 && <div role="status" className="mb-5 rounded-xl border border-border p-4 text-sm">
        {errors.map((error, index) => <p key={index}>{error}</p>)}
      </div>}
      {!requests.length ? (
        <section className="rounded-xl border border-border p-8">
          <h2 className="font-semibold">Aucune PR de l'agent détectée</h2>
          <p className="mt-2 text-sm text-muted">Les PR d&apos;autres auteurs ou sans préfixe CODE-V ne sont pas considérées comme des missions de développement.</p>
        </section>
      ) : (
        <ul className="grid gap-4">
          {requests.map(({ clientId, clientName, pullRequest }) => (
            <li key={`${clientId}-${pullRequest.number}`} className="rounded-xl border border-border p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">{clientName} · {pullRequest.repository} · PR #{pullRequest.number}</p>
                <span className="text-xs text-muted">{pullRequest.draft ? "Brouillon" : "En revue"}</span>
              </div>
              <h2 className="mt-2 font-semibold">{pullRequest.title}</h2>
              <p className="mt-2 break-all text-xs text-muted">Commit : {pullRequest.headSha.slice(0, 12)}</p>
              <div className="mt-4 flex flex-wrap gap-5 text-sm">
                <Link className="text-accent hover:underline" href={`/developer/${clientId}/${pullRequest.number}`}>Examiner la proposition</Link>
                <a className="text-accent hover:underline" href={pullRequest.url} target="_blank" rel="noopener noreferrer">Ouvrir la PR GitHub</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
