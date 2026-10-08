import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import type {SecretStore} from './encrypted-vault';

// Server-only storage of the encrypted credentials (table publication_credential_secrets: RLS without policy,
// service role only, immutable rows). bytea values travel as PostgreSQL hex literals ('\x…'). Plaintext never here.
const hex=(bytes:Uint8Array)=>'\\x'+Buffer.from(bytes).toString('hex');
const bytes=(value:unknown):Uint8Array=>{if(typeof value!=='string'||!/^\\x([0-9a-f]{2})*$/.test(value))throw Error('Invalid bytea');return Buffer.from(value.slice(2),'hex');};
export function supabaseSecretStore():SecretStore{
 const table=()=>getSupabaseServerClient().from('publication_credential_secrets');
 return {
  async insert(row){const {error}=await table().insert({reference:row.reference,provider:row.provider,key_id:row.key_id,iv:hex(row.iv),ciphertext:hex(row.ciphertext),auth_tag:hex(row.auth_tag)});if(error)throw Error('store');},
  async get(reference){const {data,error}=await table().select('reference,provider,key_id,iv,ciphertext,auth_tag').eq('reference',reference).maybeSingle();if(error)throw Error('store');
   if(!data)return null;const d=data as Record<string,unknown>;
   if(d.provider!=='meta'&&d.provider!=='google_business_profile')throw Error('store');
   return {reference:String(d.reference),provider:d.provider,key_id:String(d.key_id),iv:bytes(d.iv),ciphertext:bytes(d.ciphertext),auth_tag:bytes(d.auth_tag)};},
  async remove(reference){const {error}=await table().delete().eq('reference',reference);if(error)throw Error('store');},
 };
}
