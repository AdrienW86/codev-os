import { Badge } from "@/components/ui/primitives";
import { UserButton, SignOutButton } from "@clerk/nextjs";

export function Header() {
  return (
    <header className="flex min-h-18 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-8">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span>CODE-V</span><span aria-hidden="true">/</span>
        <span className="text-foreground">Cockpit interne</span>
      </div>
      <div className="flex items-center gap-4">
        <Badge>Clients réels · autres domaines démo</Badge>
        <span className="hidden text-xs text-muted sm:inline">Espace CODE-V</span>
        <UserButton />
        <SignOutButton redirectUrl="/sign-in"><button className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground">Déconnexion</button></SignOutButton>
      </div>
    </header>
  );
}
