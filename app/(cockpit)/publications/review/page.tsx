/* eslint-disable @next/next/no-img-element -- Private previews must not enter an image proxy cache. */
import Link from 'next/link';
import {requireAdmin} from '@/lib/require-admin';
import {listPublications} from '@/lib/publications/data';
import {getWorkspace} from '@/lib/publications/workspace';
import {getGenerationDetails} from '@/lib/publications/agent-data';
import {platformLabels} from '@/lib/publications/editor';
import {PublicationReviewForm} from '@/components/publications/workflow-forms';
import {PageHeading,Panel} from '@/components/ui/primitives';
export default async function PublicationsReviewPage(){
 await requireAdmin();const pending=(await listPublications()).filter(p=>p.status==='pending_review');
 const rows=await Promise.all(pending.map(async p=>({p,w:await getWorkspace(p.id),details:await getGenerationDetails(p.current_revision_id)})));
 return <><PageHeading title="Publications à valider" eyebrow="Validation humaine" description="Chaque décision concerne une seule révision. Aucune diffusion externe."/><Link href="/publications" className="text-accent">← Publications</Link>
 {!rows.length?<Panel className="mt-6 p-6">Aucune publication en attente de validation.</Panel>:rows.map(({p,w,details})=>{if(!w||!p.current_revision_id)return null;const opportunity=details?.selected_opportunity as {subject?:string;score?:number;reasons?:string[]}|undefined;return <Panel key={p.id} className="mt-6 space-y-4 p-6"><h2 className="font-semibold"><Link href={`/publications/${p.id}`}>{p.subject}</Link></h2><p>{p.client?.name} · {p.project?.name} · {p.target_date??'Sans date'}</p>
 {details&&<div><p>Opportunité : {opportunity?.subject} · Score {opportunity?.score??'—'}/100</p><p className="text-sm text-muted">{details.generation_summary}</p><p className="text-xs text-muted">{opportunity?.reasons?.join(' · ')}</p></div>}
 {w.variants.filter(v=>v.revision_id===p.current_revision_id).map(v=><article key={v.id}><h3>{platformLabels[v.platform]}</h3>{w.links.filter(l=>l.variant_id===v.id).map(l=>{const a=w.assets.find(a=>a.id===l.asset_id);return a?.preview?<img key={l.asset_id} src={a.preview} alt="Photo client sélectionnée" className="my-3 max-h-64 rounded-lg object-contain"/>:<p key={l.asset_id}>Aperçu indisponible</p>;})}<p className="whitespace-pre-wrap text-sm">{v.text_content}</p></article>)}
 <PublicationReviewForm id={p.id} revision={p.current_revision_id} status={p.status}/></Panel>;})}</>;
}
