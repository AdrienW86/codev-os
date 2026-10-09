import { UserButton, SignOutButton } from "@clerk/nextjs";
import { todayInParis } from "@/lib/dashboard/home";

const todayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

export function Header() {
  const today = new Date();
  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-8">
      <time dateTime={todayInParis(today)} className="text-xs text-muted first-letter:uppercase">{todayFormatter.format(today)}</time>
      <div className="flex items-center gap-3">
        <UserButton />
        <SignOutButton redirectUrl="/sign-in"><button className="min-h-10 rounded-lg border border-border px-3 text-xs text-muted hover:text-foreground">Déconnexion</button></SignOutButton>
      </div>
    </header>
  );
}
