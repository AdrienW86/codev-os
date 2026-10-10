import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const db = () => getSupabaseServerClient();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Résout un nom de client saisi librement ; refuse l'ambiguïté plutôt que de deviner. */
export async function resolveClient(name: string): Promise<{ ok: true; id: string; name: string } | { ok: false; message: string }> {
  const query = name.trim().slice(0, 120);
  if (!query) return { ok: false, message: "Précisez le client." };
  const { data, error } = await db().from("clients").select("id,name").ilike("name", `%${escapeLike(query)}%`).order("name").limit(6);
  if (error) throw new Error("client search");
  const rows = data ?? [];
  const exact = rows.find((row) => row.name.localeCompare(query, "fr", { sensitivity: "base" }) === 0);
  if (exact) return { ok: true, id: exact.id, name: exact.name };
  if (rows.length === 1) return { ok: true, id: rows[0].id, name: rows[0].name };
  if (!rows.length) return { ok: false, message: `Aucun client ne correspond à « ${query} ».` };
  return { ok: false, message: `Plusieurs clients correspondent à « ${query} » : ${rows.slice(0, 5).map((row) => row.name).join(", ")}. Précisez lequel.` };
}

