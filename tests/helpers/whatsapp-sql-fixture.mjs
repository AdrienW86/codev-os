// Schéma minimal pour rejouer les migrations WhatsApp sur une base locale jetable (aucune base distante).
import { readFileSync, readdirSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = suffix => read(`supabase/migrations/${readdirSync(new URL("../../supabase/migrations", import.meta.url)).find(f => f.endsWith(suffix))}`);
export const whatsappRoles = `do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;\n`;
export const whatsappPrerequisites = `create table public.clients(id uuid primary key,name text not null);
create table public.publication_agent_projects(client_id uuid,drive_folder_id text);
create table public.publication_drive_media(client_id uuid,drive_folder_id text);
create table public.publications(id uuid primary key,client_id uuid not null references public.clients(id),unique(id,client_id));
create table public.publication_assets(id uuid primary key,client_id uuid not null references public.clients(id),unique(id,client_id));
create schema if not exists storage; create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create schema if not exists codev_private;
create table public.reports(id uuid); create table public.agent_runs(id uuid); create table public.incidents(id uuid); create table public.report_deliveries(id uuid);\n`;
export const whatsappMigrations = () => migration("_notifications_web_push.sql") + migration("_whatsapp_drive_ingestion.sql") + migration("_whatsapp_media_library.sql");
export const whatsappChecks = () => read("supabase/tests/whatsapp-drive.sql") + read("supabase/tests/whatsapp-media-library.sql");
