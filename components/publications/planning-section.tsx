import {PlanningForm} from "./planning-form";
import type {CadenceConfig} from "@/lib/publications/types";
// Collapsible cadence settings; the planning form and its Server Actions are unchanged.
export function PlanningSettings({projectId,cadence,cadenceKey,startWeek,unavailable,open=false}:{projectId:string;cadence:CadenceConfig;cadenceKey:string;startWeek:string;unavailable:boolean;open?:boolean}){
 return <details open={open} className="mt-6 rounded-lg border border-border p-5"><summary className="cursor-pointer font-semibold">Paramètres du planning</summary>
 {unavailable?<p className="mt-3 text-sm">Planification indisponible. Vérifiez l’accès au stockage et l’installation du calendrier.</p>:<PlanningForm key={cadenceKey} projectId={projectId} cadence={cadence} startWeek={startWeek}/>}</details>;
}
