// Technical details (IDs, raw statuses, pipeline data) are only rendered when the page is opened with ?debug=1.
// Callers must only pass non-secret values: identifiers, statuses, dates and counters.
export function DebugDetails({enabled,data,title='Détails techniques'}:{enabled:boolean;data:Record<string,unknown>;title?:string}){
 if(!enabled)return null;
 return <details data-debug="true" className="mt-6 rounded-lg border border-dashed border-border p-4 text-xs"><summary className="cursor-pointer font-medium">{title} · mode debug</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(data,null,2)}</pre></details>;
}
