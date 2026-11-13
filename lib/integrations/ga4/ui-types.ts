import type { ga4Status } from "@/lib/integrations/ga4/connection";
/** Type transmis aux composants serveur : aucune référence à un jeton ou un secret. */
export type AwaitedGa4Status = Awaited<ReturnType<typeof ga4Status>>;
