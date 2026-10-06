"use client";
import {useActionState} from "react";
import {changePublicationProjectAction} from "@/app/(cockpit)/publications/project-actions";
export function PublicationProjectForm({publicationId,revisionId,projectId,projects}:{publicationId:string;revisionId:string|null;projectId:string|null;projects:Array<{id:string;name:string}>}) {
 const [state,action,pending]=useActionState(changePublicationProjectAction,{});
 return <form action={action} className="mt-3 flex flex-wrap gap-2"><input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="revision_id" value={revisionId??""}/><label className="text-xs">Projet <select name="project_id" defaultValue={projectId??""} disabled={pending} className="rounded border border-border p-2"><option value="">Sans projet</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={pending} type="submit" className="rounded border border-border px-3 text-xs">Rattacher et revalider</button>{state.message&&<p role="status" className="basis-full text-xs text-muted">{state.message}</p>}</form>;
}
