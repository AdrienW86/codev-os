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
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-8">
      <time dateTime={todayInParis(today)} className="text-xs text-muted first-letter:uppercase">{todayFormatter.format(today)}</time>
      <div className="flex items-center gap-3">
        <Link href="/notifications" aria-label={count === null ? "Notifications indisponibles" : `Notifications : ${count} non lues`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-2 text-xs"><Icon name="bell" /><span className="hidden sm:inline">Notifications</span><span>{count === null ? "!" : count}</span></Link>
        <UserButton />
        <SignOutButton redirectUrl="/sign-in"><button className="min-h-10 rounded-lg border border-border px-3 text-xs text-muted hover:text-foreground">Déconnexion</button></SignOutButton>
      </div>
    </header>
  );
}
