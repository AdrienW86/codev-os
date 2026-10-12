import 'server-only';
import {NextResponse,type NextRequest} from 'next/server';
import {completeOAuthCallback} from './service';
import type {ConnectionProvider} from '../connections/model';
import {OAUTH_VIEW_COOKIE} from './model';

// Shared OAuth callback handler (Lot 4.3 P11-a). Behind the Clerk admin proxy and requireAdmin (in the service).
// Always answers with a 303 to an INTERNAL path built by oauthReturnPath (no returnTo parameter is ever read), with
// no-store and no-referrer so the provider code in the callback URL is not forwarded anywhere.
// Socle lot 1: a short-lived cookie set by the start action selects between two internal views only (closed value).
export async function handleOAuthCallback(provider:ConnectionProvider,request:NextRequest):Promise<NextResponse>{
 const view=request.cookies?.get(OAUTH_VIEW_COOKIE)?.value==='client'?'client':'project';
 const path=await completeOAuthCallback(provider,request.nextUrl.searchParams,undefined,view);
 if(!path.startsWith('/')||path.startsWith('//'))throw Error('Unsafe redirect');
 const response=NextResponse.redirect(new URL(path,request.nextUrl.origin),303);
 if(view==='client')response.cookies?.delete({name:OAUTH_VIEW_COOKIE,path:'/api/publications/oauth'});
 response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
 return response;
}
