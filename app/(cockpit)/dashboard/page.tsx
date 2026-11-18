import { requireAdmin } from "@/lib/require-admin";
import { currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimDashboard } from "@/components/simulation/views/sim-dashboard";
import { loadInbox } from "@/lib/review/inbox-service";
import { loadTeam } from "@/lib/harness/team-service";
import { loadActivity } from "@/lib/dashboard/activity-service";
import { activityLines, decisionCards, teamStatuses } from "@/lib/dashboard/overview";
import { DecisionsBlock, ActivityBlock, TeamBlock } from "@/components/dashboard/overview-blocks";

export const metadata: Metadata = { title: "Accueil" };
export const dynamic = "force-dynamic";

async function firstName() {
  try { return (await currentUser())?.firstName || "Adrien"; } catch { return "Adrien"; }
}

// Accueil simplifié : 3 blocs dans cet ordre (décisions cruciales, ce que l'agence a fait, état des agents).
// Chaque bloc est facultatif : une source en panne est signalée sans bloquer la page.
export default async function DashboardPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimDashboard name={await firstName()} />;
  const [name, inbox, activity, team] = await Promise.all([
    firstName(),
    loadInbox().catch(() => null),
    loadActivity().catch(() => null),
    loadTeam().catch(() => null),
  ]);
  const decisions = decisionCards(inbox);
  const done = activity ? activityLines(activity) : null;
  const teams = team ? teamStatuses(team.teams.map((t) => ({ id: t.id, name: t.name, members: t.members.map((m) => ({ name: m.charter.name, state: m.health.state })) }))) : null;
  const waiting = inbox?.manualTotal ?? null;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="pt-2 sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-2 text-base text-muted">
          {waiting === null ? "Décisions momentanément illisibles." : waiting === 0 ? "Rien ne vous attend : l’agence tourne seule." : `${waiting} décision${waiting > 1 ? "s" : ""} cruciale${waiting > 1 ? "s" : ""} vous attend${waiting > 1 ? "ent" : ""}.`}
          {" "}Demandez n’importe quoi au directeur, en bas à droite.
        </p>
      </header>
      <DecisionsBlock cards={decisions} />
      <ActivityBlock activity={done} />
      <TeamBlock teams={teams} />
      <p className="text-center text-sm text-muted">
        <Link href="/work" className="text-accent hover:underline">Tout le travail</Link>{" · "}
        <Link href="/validation" className="text-accent hover:underline">Boîte « À valider »</Link>{" · "}
        <Link href="/news" className="text-accent hover:underline">Veille</Link>
      </p>
    </div>
  );
}
