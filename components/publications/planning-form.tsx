"use client";
import {useActionState,useState} from "react";
import {configurePlanning,generatePlanning} from "@/app/(cockpit)/publications/calendar/actions";
import type {CadenceConfig} from "@/lib/publications/types";
const days=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
export function PlanningForm({projectId,cadence,startWeek}:{projectId:string;cadence:CadenceConfig;startWeek:string}){
 const [enabled,setEnabled]=useState(cadence.enabled),[autoCreateSlots,setAutoCreateSlots]=useState(cadence.auto_create_slots);
 const [saved,save,pending]=useActionState(configurePlanning,{message:""});const [generated,generate,running]=useActionState(generatePlanning,{message:""});const input="rounded-lg border border-border bg-background p-2";
 return <div className="mt-4 space-y-6"><form action={save} className="grid gap-4 md:grid-cols-2"><input type="hidden" name="project_id" value={projectId}/>
 <label><input type="checkbox" name="enabled" value="true" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> Cadence active</label><label><input type="checkbox" name="auto_create_slots" value="true" checked={autoCreateSlots} onChange={event=>setAutoCreateSlots(event.target.checked)}/> Autoriser la réservation des créneaux</label>
 <label className="grid gap-1">Publications / semaine<select name="posts_per_week" className={input} defaultValue={cadence.posts_per_week}><option value="1">1</option><option value="2">2</option></select></label>
 <label className="grid gap-1">Horizon (semaines)<input name="planning_horizon_weeks" type="number" min="1" max="12" required className={input} defaultValue={cadence.planning_horizon_weeks}/></label>
 {[0,1].map(i=><div key={i} className="flex flex-wrap items-center gap-2"><label>Créneau {i+1} <select name={`day_${i}`} className={input} defaultValue={cadence.preferred_weekdays[i]??5}>{days.map((day,d)=><option key={day} value={d+1}>{day}</option>)}</select></label><label>Heure <input name={`time_${i}`} type="time" className={input} required defaultValue={cadence.preferred_times[i]??"12:00"}/></label></div>)}
 <label className="grid gap-1">Fuseau horaire<input name="timezone" required className={input} defaultValue={cadence.timezone}/></label><p className="self-center text-sm text-muted">Validation admin obligatoire. Le second créneau est ignoré pour une cadence de 1.</p>
 <button disabled={pending||running} className="rounded-lg border border-border p-3">{pending?"Enregistrement…":"Enregistrer la cadence"}</button><p role="status" className="self-center text-sm">{saved.message}</p></form>
 <form action={generate} className="flex flex-wrap items-end gap-4"><input type="hidden" name="project_id" value={projectId}/><label className="grid gap-1">Semaine de départ (lundi)<input required name="start_week" type="date" className={input} defaultValue={startWeek}/></label><label><input type="checkbox" name="placeholders" defaultChecked/> Créer les brouillons vides</label><button disabled={running||pending} className="rounded-lg bg-accent px-4 py-3 text-background">{running?"Réservation…":"Générer les créneaux"}</button><p role="status" className="w-full text-sm">{generated.message}</p></form>
 <p className="text-sm text-muted">Test manuel uniquement : aucune rédaction, aucun worker et aucune publication. Les créneaux existants ne sont pas déplacés.</p></div>;
}
