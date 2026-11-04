import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';

// Articles de l'Agent Blog programmés (annoncés 24 h avant) : lecture légère pour la file « À traiter ».
// Toute erreur de lecture donne une liste vide : la supervision reste affichée.
export type UpcomingArticle={id:string;clientId:string;clientName:string;title:string;publishAt:string};
export async function upcomingBlogArticles(limit=10):Promise<UpcomingArticle[]>{
 try{
  const {data,error}=await getSupabaseServerClient().from('blog_articles' as never).select('id,client_id,title,publish_at,clients(name)').eq('status','scheduled').order('publish_at').limit(limit);
  if(error||!data)return [];
  return (data as unknown as {id:string;client_id:string;title:string;publish_at:string;clients:{name?:string}|null}[]).map(a=>({id:a.id,clientId:a.client_id,clientName:a.clients?.name??'Client',title:a.title,publishAt:a.publish_at}));
 }catch{return [];}
}
