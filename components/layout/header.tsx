import { UserButton, SignOutButton } from "@clerk/nextjs";
import { todayInParis } from "@/lib/dashboard/home";
import Link from "next/link";
import { unreadNotificationCount } from "@/lib/notifications/service";
import { Icon } from "@/components/ui/icon";

const todayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

export async function Header({ simulation = false }: { simulation?: boolean }) {
  const today = new Date();
  const count = simulation ? null : await unreadNotificationCount().catch(() => null);
  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-5 py-3 backdrop-blur sm:px-8">
      <time dateTime={todayInParis(today)} className="text-xs text-muted first-letter:uppercase">{todayFormatter.format(today)}</time>
      <div className="flex items-center gap-3">
        <Link href="/notifications" aria-label={count === null ? "Notifications indisponibles" : `Notifications : ${count} non lues`} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-raised/40 px-2.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground"><Icon name="bell" /><span className="hidden sm:inline">Notifications</span><span className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${count ? "bg-accent-strong text-accent-foreground" : "bg-surface-raised text-muted"}`}>{count === null ? "!" : count}</span></Link>
        <UserButton />
        <SignOutButton redirectUrl="/sign-in"><button className="min-h-10 rounded-lg border border-border-strong px-3 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground">Déconnexion</button></SignOutButton>
      </div>
    </header>
  );
}
