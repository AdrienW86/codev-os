import Link from "next/link";
export function ProjectContext({projectId,project}:{projectId:string|null;project?:{name:string}|null}) {
 return <p className="mt-2 text-xs text-muted">{projectId ? <Link href={`/projects/${projectId}`} className="text-accent hover:underline">Projet : {project?.name??projectId}</Link> : "Portée client / historique sans projet"}</p>;
}
