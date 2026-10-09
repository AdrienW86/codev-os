import type { Metadata } from "next";
import Link from "next/link";
import { ActionControls } from "@/components/actions/action-controls";
import { Badge, PageHeading } from "@/components/ui/primitives";
import { actionStatuses } from "@/lib/actions/validation";
import { listActions } from "@/lib/actions/data";
import { requireAdmin } from "@/lib/require-admin";
import { formatDate } from "@/lib/format-date";

export const metadata: Metadata = { title: "Actions" };

export default async function ActionsPage({ searchParams }: PageProps<"/actions">) {
  await requireAdmin();
  const params = await searchParams;
  const status = typeof params.status === "string" && actionStatuses.includes(params.status as (typeof actionStatuses)[number]) ? params.status : undefined;
  const actions = await listActions({ status });
  return <>
    <PageHeading eyebrow="Validation" title="Actions" description="Actions structurées nécessitant une approbation explicite. Les exécutions disponibles sont simulées et internes." />
    <form method="get" className="mb-6 flex flex-wrap items-end gap-4 border-b border-border pb-5">
      <label className="text-xs text-muted">Statut<select name="status" defaultValue={status ?? ""} className="mt-2 block min-w-48 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="">Tous</option>{actionStatuses.map((value) => <option key={value}>{value}</option>)}</select></label>
      <button type="submit" className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium">Filtrer</button>
    </form>
    {actions.length ? <ul className="divide-y divide-border">{actions.map((action) => <li key={action.id} className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{action.action_type}</h2><Badge>{action.status}</Badge>{action.requires_approval && <span className="text-xs text-muted">Approbation requise</span>}</div>
        <p className="mt-2 text-sm text-muted"><Link href={`/clients/${action.client_id}`} className="text-accent hover:underline">{action.client?.name ?? "Client indisponible"}</Link> · <Link href={`/agents/${action.agent_id}`} className="text-accent hover:underline">{action.agent?.name ?? "Agent indisponible"}</Link>{action.recommendation && <> · <Link href={`/recommendations/${action.recommendation.id}`} className="text-accent hover:underline">{action.recommendation.title}</Link></>}</p>
        <time dateTime={action.created_at} className="mt-2 block text-xs text-muted">{formatDate(action.created_at)}</time>
        {action.result && <p className="mt-2 text-xs text-muted">Résultat interne enregistré.</p>}
        {action.error_message && <p className="mt-2 text-xs text-amber-300">Exécution échouée. Consultez l’état et réessayez après vérification.</p>}
      </div>
      <ActionControls action={action} />
    </li>)}</ul> : <p className="border-t border-border py-8 text-sm text-muted">Aucune action enregistrée.</p>}
  </>;
}