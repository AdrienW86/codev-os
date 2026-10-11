// OFFLINE ONLY. Writes reviewable Management API packets; never calls a remote service.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=join(root,'.local','pr16-migrations');
const files=['20261016000000_google_ads_reports.sql','20261016000001_whatsapp_drive_ingestion.sql','20261017000000_google_ads_campaign_tracking.sql','20261018000000_google_ads_client_context.sql','20261019000000_report_delivery_claims.sql','20261020000000_notifications_web_push.sql','20261020000001_ads_recurring_reports.sql','20261021000000_ads_recurring_hardening.sql'];
mkdirSync(out,{recursive:true});
const manifest=files.map(file=>{
 const query=readFileSync(join(root,'supabase','migrations',file),'utf8');
 if(/\bdrop\s+(?:table|schema|column|database)\b|\btruncate\b/i.test(query))throw Error('Destructive DDL requires separate review');
 const sha256=createHash('sha256').update(query).digest('hex'),name=file.replace(/\.sql$/,'');
 writeFileSync(join(out,file+'.json'),JSON.stringify({name,query},null,2)+'\n');
 return {file,name,sha256,idempotencyKey:`codev-${sha256}`,packet:file+'.json'};
});
const query=readFileSync(join(root,'supabase','tests','ads-recurring-remote-audit.sql'),'utf8');
writeFileSync(join(out,'catalog-audit.json'),JSON.stringify({query,read_only:true},null,2)+'\n');
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Prepared ${manifest.length} ordered migration packets and read-only audit in .local/pr16-migrations. No remote access or application performed.`);
