import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { describeClientWatch, type ClientWatch } from "@/lib/dashboard/home";

export function ClientWatchCard({ client }: { client: ClientWatch }) {
  const needsDecision = client.pendingActions + client.pendingRecommendations > 0;
  return (
    <Link href={`/clients/${client.id}`} className="group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/40">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-sm font-semibold">{client.name.slice(0, 2).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium group-hover:text-accent">{client.name}</span>
          {needsDecision && <span className="shrink-0 rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-300">Décision attendue</span>}
        </span>
        <span className="mt-1 block truncate text-xs text-muted">{describeClientWatch(client)}</span>
      </span>
      <Icon name="arrow" width={16} height={16} className="shrink-0 text-muted group-hover:text-accent" />
    </Link>
  );
}
