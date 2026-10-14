"use client";
import { useRouter } from "next/navigation";
export function AdsClientSwitcher({ clients, selected }: { clients: { id: string; name: string }[]; selected: string }) {
  const router = useRouter();
  return <label className="block min-w-0 flex-1 text-sm">Client
    <select aria-label="Changer rapidement de client" value={selected} onChange={(event) => {
      const url = new URL(window.location.href);
      if (event.target.value) url.searchParams.set("client", event.target.value);
      else url.searchParams.delete("client");
      for (const key of ["ads_campaigns", "ads_scope", "ads_types"]) url.searchParams.delete(key);
      router.push(url.pathname + url.search);
    }} className="mt-2 block min-h-12 w-full rounded-lg border border-border bg-background px-3">
      <option value="">Choisir un client</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  </label>;
}
