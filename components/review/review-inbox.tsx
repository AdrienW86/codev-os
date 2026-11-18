import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { MutationForm } from "@/components/ui/mutation-form";
import { archiveSupersededReportsAction } from "@/app/(cockpit)/validation/actions";
import { formatDate } from "@/lib/format-date";
import { crucialCategories } from "@/lib/review/crucial";
import type { Inbox } from "@/lib/review/inbox";

/**
 * Boîte « À valider » : seules les confirmations CRUCIALES (argent, envoi à un tiers, site du client, image générée)
 * attendent une décision. Ce que les agents traitent seuls est résumé en bas, pour mémoire.
 */
export function ReviewInbox({ inbox }: { inbox: Inbox }) {
  const crucial = inbox.sections.filter((s) => s.crucial && (s.manual > 0 || s.status === "unavailable"));
  const upToDate = inbox.sections.filter((s) => s.crucial && s.manual === 0 && s.status === "available");
  const automatic = inbox.sections.filter((s) => !s.crucial);
  return (
    <div className="space-y-8">
      <p className="text-sm">
        {inbox.manualTotal === 0 ? "Rien n’attend votre décision." : <><span className="font-semibold">{inbox.manualTotal}</span> décision(s) cruciale(s) vous attendent.</>}
        {inbox.unavailable > 0 && <span className="text-warning"> {inbox.unavailable} source(s) illisible(s).</span>}
      </p>
      {crucial.length > 0 && (
        <ul className="grid gap-4 lg:grid-cols-2" data-inbox="crucial">
          {crucial.map((section) => (
            <li key={section.id} id={`review-${section.id}`} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={section.href} className="font-semibold hover:underline">{section.label}</Link>
                {section.status === "unavailable" ? <StatusBadge label="Illisible" tone="amber" /> : <StatusBadge label={`${section.manual} à décider`} tone="amber" />}
              </div>
              {section.crucial && <p className="mt-1 text-xs text-muted">{crucialCategories[section.crucial].reason}</p>}
              {section.note && <p className="mt-1 text-xs text-muted">{section.note}</p>}
              {section.items.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {section.items.map((item) => (
                    <li key={`${section.id}-${item.id}`} className="flex flex-wrap justify-between gap-2">
                      <Link href={item.href} className="min-w-0 truncate text-accent hover:underline">{item.client ? `${item.client} · ` : ""}{item.title}</Link>
                      {item.at && <span className="text-xs tabular-nums text-muted">{formatDate(item.at)}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {section.manual > section.items.length && section.items.length > 0 && <p className="mt-2 text-xs text-muted"><Link href={section.href} className="hover:underline">Voir tout ({section.manual})</Link></p>}
            </li>
          ))}
        </ul>
      )}
      {upToDate.length > 0 && (
        <p className="text-xs text-muted">À jour : {upToDate.map((s) => s.label).join(" · ")}.</p>
      )}
      <section aria-labelledby="inbox-automatic" data-inbox="automatic">
        <h2 id="inbox-automatic" className="text-sm font-semibold">Traité automatiquement</h2>
        <p className="mt-1 text-xs text-muted">Ces éléments n’attendent plus votre décision. Ils restent consultables et vous pouvez toujours intervenir.</p>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface text-sm">
          {automatic.map((section) => (
            <li key={section.id} id={`review-${section.id}`} className="flex flex-wrap items-start justify-between gap-2 p-3">
              <span className="min-w-0">
                <Link href={section.href} className="font-medium hover:underline">{section.label}</Link>
                {section.note && <span className="block text-xs text-muted">{section.note}</span>}
                {section.id === "reports" && inbox.superseded.length > 0 && (
                  <span className="mt-2 block">
                    <MutationForm action={archiveSupersededReportsAction} label={`Archiver maintenant les ${inbox.superseded.length} rapport(s) remplacé(s)`} pendingLabel="Archivage…" disableOnSuccess />
                  </span>
                )}
              </span>
              {section.status === "unavailable" ? <StatusBadge label="Illisible" tone="amber" /> : <span className="text-xs tabular-nums text-muted">{section.count} en cours</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
