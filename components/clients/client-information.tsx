import type { Client } from "@/lib/clients/types";

const createdDate = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Paris" });

export function ClientInformation({ client, includeNotes = false }: { client: Client; includeNotes?: boolean }) {
  const rows = [
    ["Entreprise", client.company_name], ["Activité", client.activity],
    ["Email", client.email], ["Téléphone", client.phone],
    ["Site web", client.website], ["Zone géographique", client.geographic_area],
  ];
  if (includeNotes) rows.push(["Notes", client.notes]);
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value || "Non renseigné"}</dd></div>)}
      <div><dt className="text-xs text-muted">Date de création</dt><dd className="mt-1"><time dateTime={client.created_at}>{createdDate.format(new Date(client.created_at))}</time></dd></div>
    </dl>
  );
}
