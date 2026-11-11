import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { MutationForm } from "@/components/ui/mutation-form";
import { archiveSupersededReportsAction } from "@/app/(cockpit)/validation/actions";
import { formatDate } from "@/lib/format-date";
import type { Inbox } from "@/lib/review/inbox";

/** Boîte « À valider » : une section par source, les plus anciens d'abord, lien direct vers l'écran de décision. */
export function ReviewInbox({ inbox }: { inbox: Inbox }) {
  return (
    <div className="space-y-6">
      <p className="text-sm">
        {inbox.manualTotal === 0 ? "Rien n’attend votre décision." : <><span className="font-semibold">{inbox.manualTotal}</span> élément(s) attendent votre décision.</>}
        {inbox.unavailable > 0 && <span className="text-warning"> {inbox.unavailable} source(s) illisible(s).</span>}
      </p>
      <ul className="grid gap-4 lg:grid-cols-2">
        {inbox.sections.map((section) => (
          <li key={section.id} id={`review-${section.id}`} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link href={section.href} className="font-semibold hover:underline">{section.label}</Link>
              {section.status === "unavailable" ? <StatusBadge label="Illisible" tone="amber" />
                : <StatusBadge label={section.manual ? `${section.manual} à décider` : section.count ? `${section.count} en règle auto` : "À jour"} tone={section.manual ? "amber" : "green"} />}
            </div>
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
            {section.id === "reports" && inbox.superseded.length > 0 && (
              <div className="mt-3">
                <MutationForm action={archiveSupersededReportsAction} label={`Archiver les ${inbox.superseded.length} rapport(s) remplacé(s)`} pendingLabel="Archivage…" disableOnSuccess
                  confirm="Archiver les rapports remplacés par un plus récent du même client ? Rien n’est envoyé ; le plus récent reste à relire." />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
