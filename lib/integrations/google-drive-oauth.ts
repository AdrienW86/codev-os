import 'server-only';
// Server-side OAuth for the read-only Drive connector. Client secret, refresh token and access tokens
// never leave this module except as the Bearer header built by the caller; they are never logged.
const tokenUrl='https://oauth2.googleapis.com/token';
export const driveReadScope='https://www.googleapis.com/auth/drive.readonly';
const allowedScopes=new Set([driveReadScope,'https://www.googleapis.com/auth/drive.metadata.readonly']);
const opaque=(value:unknown,min:number,max:number):value is string=>typeof value==='string'&&value.length>=min&&value.length<=max&&/^[\x21-\x7e]+$/.test(value);
export type DriveCredentials={clientId:string;clientSecret:string;refreshToken:string};
export function driveCredentials():DriveCredentials{
 const clientId=process.env.GOOGLE_DRIVE_CLIENT_ID,clientSecret=process.env.GOOGLE_DRIVE_CLIENT_SECRET,refreshToken=process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
 if(!opaque(clientId,20,300)||!clientId.endsWith('.apps.googleusercontent.com')||!opaque(clientSecret,10,200)||!opaque(refreshToken,20,1000))throw Error('Drive read credential unavailable');
 return {clientId,clientSecret,refreshToken};
}
// Returns a getter that refreshes the access token on demand, reuses it until one minute before expiry,
// and refuses any token whose granted scopes go beyond Drive read-only access.
export function driveAccessTokenSource(credentials:DriveCredentials,now:()=>number=Date.now):()=>Promise<string>{
 let cached:{token:string;expiresAt:number}|undefined;let pending:Promise<string>|undefined;
 const refresh=async()=>{
  const response=await fetch(tokenUrl,{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:credentials.clientId,client_secret:credentials.clientSecret,refresh_token:credentials.refreshToken,grant_type:'refresh_token'})});
  if(!response.ok)throw Error('Drive authorization failed');
  let body:{access_token?:unknown;token_type?:unknown;expires_in?:unknown;scope?:unknown};
  try{body=await response.json();}catch{throw Error('Drive authorization invalid');}
  const scopes=typeof body.scope==='string'?body.scope.split(' ').filter(Boolean):[];
  if(!opaque(body.access_token,10,4096)||typeof body.token_type!=='string'||body.token_type.toLowerCase()!=='bearer'||typeof body.expires_in!=='number'||!Number.isFinite(body.expires_in)||body.expires_in<=60
   ||!scopes.includes(driveReadScope)||scopes.some(scope=>!allowedScopes.has(scope)))throw Error('Drive authorization invalid');
  cached={token:body.access_token,expiresAt:now()+(body.expires_in-60)*1000};return body.access_token;
 };
 return ()=>{if(cached&&cached.expiresAt>now())return Promise.resolve(cached.token);pending??=refresh().finally(()=>{pending=undefined;});return pending;};
}
