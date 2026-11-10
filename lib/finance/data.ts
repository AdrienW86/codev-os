import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { FinanceCatalogRow, FinanceCategoryRow, FinanceContractRow } from "@/lib/supabase/finance.types";
import { financeUUID } from "./validation";

function failure(area: string): never {
  console.error("[finance] Lecture impossible : " + area);
  throw new Error("Le module Finance n'est pas encore disponible (migration ou stockage).");
}
export async function financeCatalog(): Promise<{categories: FinanceCategoryRow[]; items: FinanceCatalogRow[]}> {
  await requireAdmin();
  const db = getSupabaseServerClient();
  const [categories,items] = await Promise.all([
    db.from("finance_categories").select("*").order("sort_order"),
    db.from("finance_catalog_items").select("*").order("name"),
  ]);
  if (categories.error || items.error) failure("catalogue");
  return {categories:categories.data??[],items:items.data??[]};
}
export async function financeContracts(clientId: string): Promise<FinanceContractRow[]> {
  await requireAdmin();
  if (!financeUUID.test(clientId)) return [];
  const {data,error} = await getSupabaseServerClient().from("finance_client_contracts")
    .select("*").eq("client_id",clientId).order("created_at",{ascending:false}).limit(400);
  if (error) failure("contrats");
  return data??[];
}
export function euro(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return (cents/100).toLocaleString("fr-FR",{style:"currency",currency:"EUR"});
}
export function euroInput(cents: number | null): string {
  return cents===null||cents===undefined?"":Math.trunc(cents/100)+"."+(cents%100).toString().padStart(2,"0");
}
export function contractTotalCents(price: number, qty: number): number {
  return Math.round(price*qty);
}
