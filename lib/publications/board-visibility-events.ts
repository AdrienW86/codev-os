// Pure part of the board removal: event names and the latest-event-wins rule. No I/O.
export const BOARD_HIDDEN='publication.board_hidden',BOARD_RESTORED='publication.board_restored';
export type BoardVisibilityEvent={resource_id:string;action:string;created_at:string};

export function hiddenPublications(events:BoardVisibilityEvent[]):Set<string>{
 const latest=new Map<string,BoardVisibilityEvent>();
 for(const e of events){const seen=latest.get(e.resource_id);if(!seen||e.created_at>=seen.created_at)latest.set(e.resource_id,e);}
 return new Set([...latest.values()].filter(e=>e.action===BOARD_HIDDEN).map(e=>e.resource_id));
}
