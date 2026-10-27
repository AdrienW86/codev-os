// Pure rules for the board clean-up (no I/O, safe for tests). Clean-up = soft archive through publication_remove:
// nothing is deleted, every archived publication stays readable in the « Archivées » view with its full history.
export const cleanupCategories=['published','failed','rejected','past'] as const;
export type CleanupCategory=typeof cleanupCategories[number];
export const cleanupLabels:Record<CleanupCategory,string>={published:'Publiées',failed:'Échouées',rejected:'Rejetées',past:'Date passée, jamais publiées'};
// Only a send being executed right now (processing) blocks a removal; pending sends are cancelled by publication_remove.
export type CleanupInput={status:string;targetDate:string|null;editorialWeek:string;deliveries:readonly string[]};
const day=/^\d{4}-\d{2}-\d{2}/;
function addDays(date:string,days:number){const d=new Date(`${date.slice(0,10)}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
/** Last day the publication was meant for: its own date, otherwise the Sunday of its editorial week. */
export function lastDay(p:Pick<CleanupInput,'targetDate'|'editorialWeek'>):string|null{
 if(p.targetDate&&day.test(p.targetDate))return p.targetDate.slice(0,10);
 return day.test(p.editorialWeek)?addDays(p.editorialWeek,6):null;
}
/** Category of a non-archived publication, or null when it must stay on the board (in flight or still to come). */
export function cleanupCategory(p:CleanupInput,today:string):CleanupCategory|null{
 if(p.deliveries.includes('processing'))return null;
 if(p.deliveries.includes('failed'))return 'failed';
 if(p.deliveries.some(s=>s==='published'||s==='simulated'||s==='uncertain'))return 'published';
 if(p.status==='rejected')return 'rejected';
 const last=lastDay(p);
 return last!==null&&last<today?'past':null;
}
export function parseCleanupCategories(values:readonly unknown[]):CleanupCategory[]{
 return cleanupCategories.filter(c=>values.includes(c));
}
