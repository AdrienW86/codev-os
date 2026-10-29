import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getDeveloperReview } from "@/lib/developer/service";
import { PageHeading } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Vérification de PR" };

export default async function DeveloperReviewPage({ params }: { params: Promise<{ clientId: string; number: string }> }) {
  await requireAdmin();
  const { clientId, number: raw } = await params;
  const number = Number(raw);
  if (!/^\d{1,8}$/.test(raw) || !Number.isSafeInteger(number)) notFound();
  const review = await getDeveloperReview(clientId, number);
  if (!review) notFound();
  const { pullRequest: pr, checks, previewUrl, warning } = review;
  const labels = { passed: "Vérifications observées : réussies", failed: "Échec de vérification", pending: "Vérifications en cours", unknown: "Vérifications non confirmées" } as const;

  return (
    <>
      <div className="mb-4 text-sm"><Link href="/developer" className="text-accent hover:underline">← Toutes les propositions</Link></div>
      <PageHeading eyebrow={`${review.clientName} · ${pr.repository} · PR #${pr.number}`} title={pr.title}
        description="Contrôle sur le commit exact de la proposition. Le code reste sur une branche, sans publication automatique." />
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-border p-5">
          <h2 className="font-semibold">GitHub</h2>
          <dl className="mt-4 grid gap-2 text-sm">
            <div><dt className="text-muted">État</dt><dd>{pr.draft ? "Brouillon" : "En cours de revue"}</dd></div>
            <div><dt className="text-muted">Vérifications</dt><dd>{labels[checks]}</dd></div>
            <div><dt className="text-muted">Branche</dt><dd className="break-all">{pr.headBranch}</dd></div>
            <div><dt className="text-muted">Commit vérifié</dt><dd className="break-all font-mono text-xs">{pr.headSha}</dd></div>
          </dl>
          {warning && <p role="alert" className="mt-4 text-sm">{warning}</p>}
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-sm text-accent hover:underline">Voir les modifications et commentaires GitHub</a>
        </section>
        <section className="rounded-xl border border-border p-5">
          <h2 className="font-semibold">Prévisualisation Vercel</h2>
          {previewUrl ? (
            <>
              <p className="mt-3 text-sm text-muted">Déploiement de prévisualisation confirmé pour le commit affiché.</p>
              <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block break-all text-sm text-accent hover:underline">Ouvrir la prévisualisation réelle</a>
              <p className="mt-3 text-xs text-muted">L'accès peut nécessiter une authentification Vercel.</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">Aucune URL Vercel vérifiée pour ce commit. Nous n'affichons pas de capture ni de lien supposé.</p>
          )}
        </section>
      </div>
      <section className="mt-5 rounded-xl border border-border p-5">
        <h2 className="font-semibold">Décision humaine obligatoire</h2>
        <p className="mt-2 text-sm text-muted">Cette première version permet uniquement de consulter. Aucun bouton de validation n'est activé : la demande de correction, l'approbation et la fusion s'effectuent encore dans GitHub. Le futur circuit CODE-V OS sera lié au SHA affiché pour empêcher l'approbation d'un code modifié après lecture.</p>
      </section>
    </>
  );
}
