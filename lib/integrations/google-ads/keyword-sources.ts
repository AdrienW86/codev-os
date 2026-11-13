import "server-only";
// Sources d'opportunités de mots-clés ajoutées aux signaux experts (lecture seule) : requêtes Search Console déjà
// synchronisées, Planificateur de mots-clés Google (zone du client, français) et recommandations Google du compte
// (lues avec les signaux). Chaque source indisponible reste « non lue » (null) : rien n'est complété ni inventé.
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadOrganicQueries } from "./organic";
import { keywordSeeds } from "./expert";
import type { AdsBusinessContext } from "./business-context";
import type { AdsAccount, AdsExpertSignals, GoogleAdsReadClient } from "./types";

export async function withKeywordSources(reader: GoogleAdsReadClient, account: AdsAccount, signals: AdsExpertSignals, options: { clientId: string; business: AdsBusinessContext | null; managerId?: string }): Promise<AdsExpertSignals> {
  const organicQueries = await loadOrganicQueries(options.clientId);
  let keywordIdeas: AdsExpertSignals["keywordIdeas"] = null;
  if (reader.getKeywordIdeas) {
    const seeds = keywordSeeds({ ...signals, organicQueries }, options.business);
    if (seeds.length) {
      const { data } = await getSupabaseServerClient().from("clients").select("geographic_area").eq("id", options.clientId).maybeSingle();
      const area = typeof data?.geographic_area === "string" && data.geographic_area.trim() ? data.geographic_area.trim() : null;
      const zone = options.business?.areas?.trim() || area;
      try { keywordIdeas = await reader.getKeywordIdeas(account, { seeds, zone, language: "fr" }, options.managerId); } catch { keywordIdeas = null; }
    }
  }
  return { ...signals, organicQueries, keywordIdeas };
}
