import {notFound} from "next/navigation";
import {ProjectCalendar,type ProjectCalendarEntry} from "@/components/publications/project-calendar";
import {OccurrenceCalendar} from "@/components/publications/occurrence-calendar";
import {PlanningSettings} from "@/components/publications/planning-section";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {getCalendar,getProjectCadence} from "@/lib/publications/planning";
import {getProjectOccurrences} from "@/lib/publications/occurrences";
import {addDays,calendarPeriod,defaultCadence,editorialMonday,parisToday,validDate} from "@/lib/publications/calendar";
import {getPublicationProjectChannels} from "@/lib/publications/project-channels";
import {legacyProductionBlock,projectHasPublicationsWorkspace} from "@/lib/publications/channels";
import {platformLabels} from "@/lib/publications/editor";
import {isDebugView,slotDisplay,slotDisplayLabels} from "@/lib/projects/workspace-view";
function monthShift(date:string,months:number){const d=new Date(date.slice(0,7)+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10);}
export default async function ProjectCalendarPage({params,searchParams}:PageProps<"/projects/[id]/calendar">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project)notFound();const capabilities=await getPublicationProjectChannels(project);if(!projectHasPublicationsWorkspace(capabilities))notFound();
 const field=(key:string)=>typeof search[key]==="string"?search[key] as string:"",mode=field("mode")==="month"?"month":"week",date=validDate(field("date"))?field("date"):parisToday(),period=calendarPeriod(date,mode);
 const previous=mode==="week"?addDays(period.from,-7):monthShift(period.from,-1),next=mode==="week"?addDays(period.from,7):monthShift(period.from,1);
 // Configured project (Lot 4.3 P3): the calendar is made of dated channel occurrences. The legacy calendar stays
 // readable as history; no new legacy slot is ever generated for it (refused server-side too). Display never writes.
 if(capabilities.source==="configured"){
  const [occurrences,calendar]=await Promise.all([getProjectOccurrences(id,period.from,period.to).catch(()=>null),getCalendar({...period,project:id}).catch(()=>[])]);
  const legacy=calendar.map(e=>({key:e.key,date:e.date,time:e.time,subject:e.subject,platforms:e.platforms.map(p=>platformLabels[p]).join(" · "),status:slotDisplayLabels[slotDisplay(e)]}));
  return <><OccurrenceCalendar projectId={id} mode={mode} from={period.from} to={period.to} previous={previous} next={next} entries={occurrences??[]} error={occurrences===null} legacy={legacy}/>
   <DebugDetails enabled={isDebugView(search)} data={{project_id:id,period,source:capabilities.source,occurrences:(occurrences??[]).map(e=>({id:e.key,platform:e.platform,date:e.date,time:e.time,state:e.state,publication_id:e.publication?.id??null}))}}/></>;
 }
 // Legacy project: historical calendar, unchanged.
 const blocked=legacyProductionBlock(capabilities,"calendar");
 const [calendar,cadence]=await Promise.all([getCalendar({...period,project:id}).catch(()=>null),getProjectCadence(id).catch(()=>undefined)]);
 const entries:ProjectCalendarEntry[]=(calendar??[]).map(e=>({key:e.key,date:e.date,time:e.time,subject:e.subject,platforms:e.platforms,display:slotDisplay(e),publicationId:e.publication_id,conflict:e.conflict})).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??"").localeCompare(b.time??""));
 return <>{blocked&&<p role="status" data-channel-transition="calendar" className="mb-4 rounded-lg border border-border p-3 text-sm">{blocked}</p>}<ProjectCalendar projectId={id} mode={mode} from={period.from} to={period.to} previous={previous} next={next} entries={entries} error={calendar===null}/>
 <PlanningSettings projectId={id} cadence={cadence??defaultCadence(capabilities.platforms)} cadenceKey={cadence?.updated_at??id} startWeek={editorialMonday(parisToday())} unavailable={cadence===undefined} open={cadence===null}/>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,period,cadence:cadence??null,entries:(calendar??[]).map(e=>({key:e.key,publication_id:e.publication_id,status:e.status,revision:e.revision,origin:e.origin,validation:e.validation}))}}/></>;
}
