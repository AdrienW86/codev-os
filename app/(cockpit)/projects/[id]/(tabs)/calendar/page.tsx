import {notFound} from "next/navigation";
import {ProjectCalendar,type ProjectCalendarEntry} from "@/components/publications/project-calendar";
import {PlanningSettings} from "@/components/publications/planning-section";
import {DebugDetails} from "@/components/projects/debug-details";
import {getProjectById} from "@/lib/projects/data";
import {getCalendar,getProjectCadence} from "@/lib/publications/planning";
import {addDays,calendarPeriod,defaultCadence,editorialMonday,parisToday,validDate} from "@/lib/publications/calendar";
import {allowedPlatforms} from "@/lib/publications/editor";
import {isDebugView,slotDisplay} from "@/lib/projects/workspace-view";
function monthShift(date:string,months:number){const d=new Date(date.slice(0,7)+"-01T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10);}
export default async function ProjectCalendarPage({params,searchParams}:PageProps<"/projects/[id]/calendar">){
 const {id}=await params,search=await searchParams,project=await getProjectById(id);if(!project||!allowedPlatforms(project.type).length)notFound();
 const field=(key:string)=>typeof search[key]==="string"?search[key] as string:"",mode=field("mode")==="month"?"month":"week",date=validDate(field("date"))?field("date"):parisToday(),period=calendarPeriod(date,mode);
 const [calendar,cadence]=await Promise.all([getCalendar({...period,project:id}).catch(()=>null),getProjectCadence(id).catch(()=>undefined)]);
 const entries:ProjectCalendarEntry[]=(calendar??[]).map(e=>({key:e.key,date:e.date,time:e.time,subject:e.subject,platforms:e.platforms,display:slotDisplay(e),publicationId:e.publication_id,conflict:e.conflict})).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??"").localeCompare(b.time??""));
 return <><ProjectCalendar projectId={id} mode={mode} from={period.from} to={period.to} previous={mode==="week"?addDays(period.from,-7):monthShift(period.from,-1)} next={mode==="week"?addDays(period.from,7):monthShift(period.from,1)} entries={entries} error={calendar===null}/>
 <PlanningSettings projectId={id} cadence={cadence??defaultCadence(project.type)} cadenceKey={cadence?.updated_at??id} startWeek={editorialMonday(parisToday())} unavailable={cadence===undefined} open={cadence===null}/>
 <DebugDetails enabled={isDebugView(search)} data={{project_id:id,period,cadence:cadence??null,entries:(calendar??[]).map(e=>({key:e.key,publication_id:e.publication_id,status:e.status,revision:e.revision,origin:e.origin,validation:e.validation}))}}/></>;
}
