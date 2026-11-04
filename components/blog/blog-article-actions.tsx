'use client';
import {useActionState} from 'react';
import {cancelBlogArticleAction,publishBlogArticleNowAction,updateBlogArticleAction,type BlogArticleState} from '@/app/(cockpit)/blog/[id]/actions';
import {RELAY_LABELS,RELAY_PLATFORMS,type RelayPlatform} from '@/lib/blog-agent/model';

const field='mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm';
const Note=({s}:{s:BlogArticleState})=>s.message?<p role={s.ok?'status':'alert'} className={`text-sm ${s.ok?'':'text-danger'}`}>{s.message}</p>:null;

// Fiche d'un article : publier tout de suite ou annuler (s'il est programmé), et modifier le texte (mêmes contrôles
// qu'à la rédaction). Chaque action est confirmée par le serveur.
export function BlogArticleQuickActions({id,scheduled}:{id:string;scheduled:boolean}){
 const [published,publish,publishing]=useActionState(publishBlogArticleNowAction,{} as BlogArticleState);
 const [cancelled,cancel,cancelling]=useActionState(cancelBlogArticleAction,{} as BlogArticleState);
 if(!scheduled)return <><Note s={published}/><Note s={cancelled}/></>;
 return <div className="space-y-2">
  <div className="flex flex-wrap gap-2">
   <form action={publish}><input type="hidden" name="article_id" value={id}/><button disabled={publishing} className="min-h-10 rounded-lg bg-accent-strong px-4 font-semibold text-accent-foreground disabled:opacity-60">{publishing?'Publication…':'Publier maintenant'}</button></form>
   <form action={cancel} onSubmit={e=>{if(!window.confirm('Annuler cet article ? Il ne sera pas publié.'))e.preventDefault();}}><input type="hidden" name="article_id" value={id}/><button disabled={cancelling} className="min-h-10 rounded-lg border border-danger/50 px-4 text-danger disabled:opacity-60">{cancelling?'Annulation…':'Annuler l’article'}</button></form>
  </div>
  <Note s={published}/><Note s={cancelled}/>
 </div>;
}
export function BlogArticleEditor({id,title,meta,excerpt,alt,body,social}:{id:string;title:string;meta:string;excerpt:string;alt:string;body:string;social:Partial<Record<RelayPlatform,string>>}){
 const [saved,save,saving]=useActionState(updateBlogArticleAction,{} as BlogArticleState);
 return <form action={save} className="space-y-4">
  <input type="hidden" name="article_id" value={id}/>
  <label className="block text-sm font-medium">Titre<input name="title" defaultValue={title} maxLength={90} className={field}/></label>
  <label className="block text-sm font-medium">Meta description (Google)<textarea name="meta_description" defaultValue={meta} maxLength={160} rows={2} className={field}/></label>
  <label className="block text-sm font-medium">Chapô<textarea name="excerpt" defaultValue={excerpt} maxLength={300} rows={2} className={field}/></label>
  <label className="block text-sm font-medium">Texte alternatif de l’image<input name="image_alt" defaultValue={alt} maxLength={150} className={field}/></label>
  <label className="block text-sm font-medium">Article (Markdown : « ## » pour les intertitres, « - » pour les listes)<textarea name="body_markdown" defaultValue={body} rows={18} className={`${field} font-mono`}/></label>
  {RELAY_PLATFORMS.map(p=><label key={p} className="block text-sm font-medium">Résumé {RELAY_LABELS[p]}<textarea name={`social_${p}`} defaultValue={social[p]??''} maxLength={600} rows={3} className={field}/></label>)}
  <div className="flex flex-wrap items-center gap-3"><button disabled={saving} className="min-h-10 rounded-lg bg-accent-strong px-4 font-semibold text-accent-foreground disabled:opacity-60">{saving?'Enregistrement…':'Enregistrer les modifications'}</button><Note s={saved}/></div>
 </form>;
}
