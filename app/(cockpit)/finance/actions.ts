"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminWriter, SimulationWriteBlocked } from "@/lib/core/guards";
import { cents, enumValue, field, financeFrequencies, financeStatuses, financeUnits, financeUUID, isoDay, quantity, textRequired, FinanceInputError } from "@/lib/finance/validation";

const done = (notice: string, client = ""): never => {
  redirect("/finance?notice="+encodeURIComponent(notice)+(client ? "&client="+encodeURIComponent(client):""));
};
const readActor = async () => {
  try { return await requireAdminWriter(); }
  catch (error) { if (error instanceof SimulationWriteBlocked) done("simulation"); throw error; }
};
const errNotice = (error: unknown) => error instanceof FinanceInputError ? error.message : "Enregistrement impossible. Vérifiez la migration et réessayez.";
const cleanName = (text: string) => textRequired(text, "Intitulé");
const validateRef = (min: number | null,max: number | null) => {
  if (max!==null && (min===null || max<min)) throw new FinanceInputError("La borne maximale doit dépasser la borne minimale.");
};
const uuidOrEmpty = (x: string) => {
  if (x && !financeUUID.test(x)) throw new FinanceInputError("Identifiant invalide.");
  return x;
};

export async function saveFinanceCatalog(form: FormData): Promise<void> {
  const actor = await readActor();
  let notice = "prestation-ok";
  try {
    const id = uuidOrEmpty(field(form,"id",40));
    const category_code = textRequired(field(form,"category_code",49),"Famille");
    const name = cleanName(field(form,"name",160));
    const description = field(form,"description",3000);
    const billing_unit = enumValue(field(form,"billing_unit",30),financeUnits,"Unité");
    const billing_frequency = enumValue(field(form,"billing_frequency",20),financeFrequencies,"Fréquence");
    const reference_min_cents = cents(field(form,"reference_min",30));
    const reference_max_cents = cents(field(form,"reference_max",30));
    const default_price_cents = cents(field(form,"default_price",30));
    validateRef(reference_min_cents,reference_max_cents);
    const db = getSupabaseServerClient();
    const common = {category_code,name,description,billing_unit,billing_frequency,reference_min_cents,reference_max_cents,default_price_cents,updated_by:actor.userId};
    if (id) {
      const {data,error}=await db.from("finance_catalog_items").update(common).eq("id",id).select("id").maybeSingle();
      if (error||!data) throw new Error("catalog update");
    } else {
      const code="custom-"+randomUUID().replace(/-/g,"").slice(0,20);
      const {error}=await db.from("finance_catalog_items").insert({...common,code,source:"personnalise"});
      if (error) throw new Error("catalog insert");
    }
    revalidatePath("/finance");
  } catch (error) { console.error("[finance] catalogue : opération refusée"); notice=errNotice(error); }
  done(notice);
}

export async function changeFinanceCatalogArchive(form: FormData): Promise<void> {
  const actor=await readActor();
  let notice="archivage-ok";
  try {
    const id=uuidOrEmpty(field(form,"id",40));
    if (!id) throw new FinanceInputError("Prestation non identifiée.");
    const operation=enumValue(field(form,"operation",20),["archive","restore"] as const,"Opération");
    const db=getSupabaseServerClient();
    const {data,error}=await db.from("finance_catalog_items")
      .update({archived_at:operation==="archive"?new Date().toISOString():null,updated_by:actor.userId})
      .eq("id",id).select("id").maybeSingle();
    if (error||!data) throw new Error("archive");
    revalidatePath("/finance");
  } catch(error){console.error("[finance] archivage refusé");notice=errNotice(error);}
  done(notice);
}

export async function saveFinanceContract(form: FormData): Promise<void> {
  const actor=await readActor();
  let notice="contrat-ok",clientId="";
  try {
    const id=uuidOrEmpty(field(form,"id",40));
    clientId=uuidOrEmpty(field(form,"client_id",40));
    if (!clientId) throw new FinanceInputError("Client obligatoire.");
    const db=getSupabaseServerClient();
    const {data:client,error:clientError}=await db.from("clients").select("id").eq("id",clientId).maybeSingle();
    if (clientError||!client) throw new FinanceInputError("Client introuvable.");
    const unit_price_cents = cents(field(form,"unit_price",30),true)!;
    const qty = quantity(field(form,"quantity",30));
    const starts_on = isoDay(field(form,"starts_on",10),true)!;
    const ends_on = isoDay(field(form,"ends_on",10),false);
    if (ends_on && ends_on < starts_on) throw new FinanceInputError("Fin antérieure au début.");
    const billing_frequency = enumValue(field(form,"billing_frequency",20),financeFrequencies,"Fréquence");
    const status = enumValue(field(form,"status",20),financeStatuses,"Statut");
    const reference=field(form,"reference",160)||null;
    const notes=field(form,"notes",3000)||null;
    let catalog_item_id: string|null=null,name="",description="",billing_unit="";
    if (id) {
      // Ne jamais recharger le libellé du catalogue pour un contrat existant : snapshot contractuel immuable par défaut.
      const {data:original,error}=await db.from("finance_client_contracts").select("*").eq("id",id).eq("client_id",clientId).maybeSingle();
      if (error||!original) throw new FinanceInputError("Contrat introuvable pour ce client.");
      catalog_item_id=original.catalog_item_id;
      name=catalog_item_id?original.name:cleanName(field(form,"name",160));
      description=catalog_item_id?original.description:field(form,"description",3000);
      billing_unit=catalog_item_id?original.billing_unit:enumValue(field(form,"billing_unit",30),financeUnits,"Unité");
    } else {
      const requestedCatalog=uuidOrEmpty(field(form,"catalog_item_id",40));
      if (requestedCatalog) {
        const {data:item,error}=await db.from("finance_catalog_items").select("*").eq("id",requestedCatalog).is("archived_at",null).maybeSingle();
        if (error||!item) throw new FinanceInputError("Prestation du catalogue introuvable ou archivée.");
        catalog_item_id=item.id;name=item.name;description=item.description;billing_unit=item.billing_unit;
      } else {
        name=cleanName(field(form,"name",160));
        description=field(form,"description",3000);
        billing_unit=enumValue(field(form,"billing_unit",30),financeUnits,"Unité");
      }
    }
    const values={name,description,billing_unit,billing_frequency,unit_price_cents,quantity:qty,starts_on,ends_on,status,reference,notes,updated_by:actor.userId};
    if (id) {
      const {data,error}=await db.from("finance_client_contracts").update(values).eq("id",id).eq("client_id",clientId).select("id").maybeSingle();
      if (error||!data) throw new Error("contract update");
    } else {
      const {error}=await db.from("finance_client_contracts").insert({...values,client_id:clientId,catalog_item_id});
      if (error) throw new Error("contract insert");
    }
    revalidatePath("/finance");revalidatePath("/clients/"+clientId);
  } catch(error){console.error("[finance] contrat : opération refusée");notice=errNotice(error);}
  done(notice,clientId);
}
