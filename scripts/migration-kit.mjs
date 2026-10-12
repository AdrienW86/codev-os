// Kits d'application manuelle des migrations du socle Publications (SQL Editor de Supabase).
//
// Pour chaque docs/migration-prNN/kit.json, ce script :
//  1. reconstruit en local la chaîne de production (supabase/local/remote-schema.sql, puis les migrations du dépôt
//     déjà appliquées, un historique au format du connecteur et un jeu de données représentatif) ;
//  2. applique la migration brute sur une copie et compare les catalogues avant/après (fonctions, tables, colonnes,
//     index, contraintes, déclencheurs, politiques, buckets) ;
//  3. écrit dans le dossier du kit : apply_sql_editor.sql (précontrôles, migration du dépôt octet pour octet,
//     postcontrôles, une seule transaction), sync_migration_history.sql (texte officiel transporté en base64, md5
//     contrôlé, anti-doublon), verify.sql (contrôles en lecture seule) ;
//  4. en mode --check, rejoue les scripts générés sur des copies locales : application LF puis CRLF, inscription,
//     refus d'une seconde application et d'une seconde inscription, refus d'inscrire sans application.
//
// Usage (base locale uniquement, jamais la production) :
//   MIGRATION_KIT_DATABASE_URL=postgres://postgres@127.0.0.1:55432 node scripts/migration-kit.mjs [--check] [37 38 ...]
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const admin = process.env.MIGRATION_KIT_DATABASE_URL;
if (!admin) { console.error("MIGRATION_KIT_DATABASE_URL manquant (serveur PostgreSQL local)."); process.exit(1); }
const adminUrl = new URL(admin);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(adminUrl.hostname)) { console.error("Base locale uniquement."); process.exit(1); }
const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => /^\d+$/.test(a));
const SCHEMAS = ["public", "codev_private", "publications_private", "agent_scope_private", "storage"];
const RESERVED = ["$pre$", "$post$", "$sync$", "$snap$", "$kit$"];

const read = (f) => fs.readFileSync(path.join(root, f));
const md5 = (b) => createHash("md5").update(b).digest("hex");
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
const dbUrl = (db) => { const u = new URL(admin); u.pathname = `/${db}`; return u.toString(); };

function psql(db, sql, {allowError = false} = {}) {
  const r = spawnSync("psql", [dbUrl(db), "-qAtX", "-v", "ON_ERROR_STOP=1", "-F", "\t"], {input: sql, encoding: "utf8", maxBuffer: 1 << 28});
  if (r.status !== 0 && !allowError) throw new Error(`psql ${db}: ${r.stderr.slice(0, 2000)}`);
  return allowError ? {ok: r.status === 0, out: r.stdout, err: r.stderr} : r.stdout;
}
const rows = (db, sql) => psql(db, `set search_path=pg_catalog;\n${sql}`).split("\n").filter(Boolean).map((l) => l.split("\t"));
const dropDb = (db) => psql("postgres", `drop database if exists ${db} with (force);`);
const cloneDb = (from, to) => { dropDb(to); psql("postgres", `create database ${to} template ${from};`); };

const migrations = fs.readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const shortName = (file) => file.replace(/^\d{14}_/, "").replace(/\.sql$/, "");
const kits = fs.readdirSync(path.join(root, "docs")).filter((d) => /^migration-pr\d+$/.test(d) && fs.existsSync(path.join(root, "docs", d, "kit.json")))
  .map((d) => ({dir: `docs/${d}`, ...JSON.parse(read(`docs/${d}/kit.json`))})).filter((k) => k.file).sort((a, b) => a.file.localeCompare(b.file));
if (!kits.length) { console.error("Aucun kit (docs/migration-prNN/kit.json)."); process.exit(1); }

// --- Base locale représentative de la production : tout ce qui précède le premier kit. ------------------------
const PRELUDE = `do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`;
// Historique au format du connecteur (version = horodatage d'application, nom court, texte dans statements).
const HISTORY = `create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
`;
const historyRow = (i, file) => `insert into supabase_migrations.schema_migrations(version,name,statements) values (${lit(String(20261001000000 + i))},${lit(shortName(file))},array[${lit(read(`supabase/migrations/${file}`).toString())}]);\n`;
// Données représentatives : 4 clients, réglages, photothèque validée, notifications et une préférence personnalisée.
const SEED = `
insert into public.clients(id,name) select ('c9000000-0000-4000-8000-00000000000'||i)::uuid,'Client '||i from generate_series(1,4) i;
insert into public.publication_client_settings(client_id,editorial_brief) values('c9000000-0000-4000-8000-000000000001','Brief existant'),('c9000000-0000-4000-8000-000000000002','');
insert into public.admin_notifications(event_key,category,href) values('seed:1','report_ready','/reports/c9000000-0000-4000-8000-000000000001'),('seed:2','media_received','/clients/c9000000-0000-4000-8000-000000000001?tab=media');
insert into public.admin_notification_preferences(user_id,categories) values('user_seed',array['report_ready','incident']);
`;

function buildBase(db) {
  const first = kits[0].file;
  const applied = migrations.filter((f) => f < first);
  dropDb(db); psql("postgres", `create database ${db};`);
  psql(db, PRELUDE + read("supabase/local/remote-schema.sql") + applied.map((f) => read(`supabase/migrations/${f}`)).join("\n"));
  psql(db, HISTORY + applied.map((f, i) => historyRow(i, f)).join(""));
  psql(db, SEED);
  const seedAssets = psql(db, `select count(*) from information_schema.tables where table_schema='public' and table_name='whatsapp_assets';`).trim();
  if (seedAssets === "1") psql(db, fs.readFileSync(path.join(root, "scripts/migration-kit-seed.sql"), "utf8"));
}

// --- Empreintes de catalogue. ---------------------------------------------------------------------------------
const inSchemas = (col) => `${col} in (${SCHEMAS.map(lit).join(",")})`;
function snapshot(db) {
  const q = {
    functions: `select p.oid::regprocedure::text, md5(replace(p.prosrc,E'\\r\\n',E'\\n')), p.prosecdef::text, coalesce(array_to_string(p.proconfig,','),''),
      has_function_privilege('public',p.oid,'EXECUTE')::text, has_function_privilege('anon',p.oid,'EXECUTE')::text, has_function_privilege('authenticated',p.oid,'EXECUTE')::text,
      has_function_privilege('service_role',p.oid,'EXECUTE')::text, p.prokind::text
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${inSchemas("n.nspname")}`,
    tables: `select c.oid::regclass::text, c.relrowsecurity::text,
      (has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'))::text,
      (has_table_privilege('authenticated',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'INSERT') or has_table_privilege('authenticated',c.oid,'UPDATE') or has_table_privilege('authenticated',c.oid,'DELETE'))::text,
      concat_ws(',',case when has_table_privilege('service_role',c.oid,'SELECT') then 'SELECT' end,case when has_table_privilege('service_role',c.oid,'INSERT') then 'INSERT' end,
       case when has_table_privilege('service_role',c.oid,'UPDATE') then 'UPDATE' end,case when has_table_privilege('service_role',c.oid,'DELETE') then 'DELETE' end)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and ${inSchemas("n.nspname")}`,
    columns: `select a.attrelid::regclass::text, a.attname::text, format_type(a.atttypid,a.atttypmod), a.attnotnull::text, coalesce(pg_get_expr(d.adbin,d.adrelid),'')
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and ${inSchemas("n.nspname")}`,
    indexes: `select i.indexrelid::regclass::text, i.indrelid::regclass::text, i.indisunique::text from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
      where ${inSchemas("n.nspname")} and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid and k.contype in ('p','u','x'))`,
    constraints: `select k.conrelid::regclass::text, k.conname::text, k.contype::text, md5(pg_get_constraintdef(k.oid)) from pg_constraint k join pg_namespace n on n.oid=k.connamespace
      where k.conrelid<>0 and ${inSchemas("n.nspname")}`,
    triggers: `select t.tgrelid::regclass::text, t.tgname::text, t.tgfoid::regprocedure::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where not t.tgisinternal and ${inSchemas("n.nspname")}`,
    policies: `select schemaname||'.'||tablename, policyname::text, cmd, roles::text from pg_policies where ${inSchemas("schemaname")}`,
    buckets: `select id, public::text, coalesce(file_size_limit::text,''), coalesce(allowed_mime_types::text,'') from storage.buckets`,
  };
  const out = {};
  for (const [k, sql] of Object.entries(q)) out[k] = new Map(rows(db, sql).map((r) => [k === "columns" || k === "constraints" || k === "triggers" || k === "policies" ? `${r[0]}|${r[1]}` : r[0], r]));
  return out;
}
function diff(pre, post) {
  const d = {};
  for (const k of Object.keys(post)) {
    d[k] = {added: [], changed: [], removed: []};
    // Ordre stable (par clé) : les scripts générés sont reproductibles octet pour octet.
    for (const [key, r] of [...post[k]].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) { const p = pre[k].get(key); if (!p) d[k].added.push(r); else if (p.join("\t") !== r.join("\t")) d[k].changed.push({pre: p, post: r}); }
    for (const [key, r] of pre[k]) if (!post[k].has(key)) d[k].removed.push(r);
  }
  return d;
}

// --- Génération des contrôles. ----------------------------------------------------------------------------------
const fnMd5 = (sig) => `(select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid=to_regprocedure(${lit(sig)}))`;
function postChecks(d, kit) {
  const c = [];
  for (const r of [...d.functions.added, ...d.functions.changed.map((x) => x.post)]) {
    const [sig, body, secdef, config, pub, anon, auth, service, kind] = r;
    c.push([`fonction ${sig} : présente, code identique au dépôt`, `coalesce(${fnMd5(sig)}=${lit(body)},false)`]);
    c.push([`fonction ${sig} : SECURITY ${secdef === "true" ? "DEFINER" : "INVOKER"}, search_path ${config || "non fixé"}`,
      `coalesce((select prosecdef=${secdef} and coalesce(array_to_string(proconfig,','),'')=${lit(config)} from pg_proc where oid=to_regprocedure(${lit(sig)})),false)`]);
    if (kind === "f" || kind === "p") c.push([`fonction ${sig} : EXECUTE interdit à public, anon et authenticated${service === "true" ? ", accordé à service_role" : ""}`,
      `coalesce(not has_function_privilege('public',to_regprocedure(${lit(sig)}),'EXECUTE') and not has_function_privilege('anon',to_regprocedure(${lit(sig)}),'EXECUTE')
       and not has_function_privilege('authenticated',to_regprocedure(${lit(sig)}),'EXECUTE') and has_function_privilege('service_role',to_regprocedure(${lit(sig)}),'EXECUTE')=${service},false)`]);
    if (pub === "true" || anon === "true" || auth === "true") throw new Error(`${kit.file}: ${sig} exécutable par public/anon/authenticated`);
  }
  for (const [rel, rls, anon, auth, service] of d.tables.added) {
    if (anon === "true" || auth === "true") throw new Error(`${kit.file}: ${rel} accessible à anon/authenticated`);
    c.push([`table ${rel} : présente, RLS active`, `coalesce((select relrowsecurity from pg_class where oid=to_regclass(${lit(rel)})),false)=${rls}`]);
    c.push([`table ${rel} : aucun droit pour anon et authenticated, service_role ${service || "aucun"}`,
      `coalesce(not (has_table_privilege('anon',to_regclass(${lit(rel)}),'SELECT') or has_table_privilege('anon',to_regclass(${lit(rel)}),'INSERT') or has_table_privilege('anon',to_regclass(${lit(rel)}),'UPDATE') or has_table_privilege('anon',to_regclass(${lit(rel)}),'DELETE')
        or has_table_privilege('authenticated',to_regclass(${lit(rel)}),'SELECT') or has_table_privilege('authenticated',to_regclass(${lit(rel)}),'INSERT') or has_table_privilege('authenticated',to_regclass(${lit(rel)}),'UPDATE') or has_table_privilege('authenticated',to_regclass(${lit(rel)}),'DELETE'))
       and ${["SELECT", "INSERT", "UPDATE", "DELETE"].map((p) => `has_table_privilege('service_role',to_regclass(${lit(rel)}),'${p}')=${service.split(",").includes(p)}`).join(" and ")},false)`]);
  }
  for (const [rel, col, type, notnull, def] of d.columns.added) {
    if (d.tables.added.some((t) => t[0] === rel)) continue;
    c.push([`colonne ${rel}.${col} : ${type}${notnull === "true" ? " not null" : ""}${def ? ` default ${def}` : ""}`,
      `exists(select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass(${lit(rel)}) and a.attname=${lit(col)} and not a.attisdropped
        and format_type(a.atttypid,a.atttypmod)=${lit(type)} and a.attnotnull=${notnull} and coalesce(pg_get_expr(d.adbin,d.adrelid),'')=${lit(def)})`]);
  }
  for (const [idx, rel, unique] of d.indexes.added) c.push([`index ${idx} sur ${rel} : présent et valide`,
    `exists(select 1 from pg_index where indexrelid=to_regclass(${lit(idx)}) and indrelid=to_regclass(${lit(rel)}) and indisvalid and indisunique=${unique})`]);
  const named = (name) => kit.sql.includes(name);
  for (const [rel, name, type] of [...d.constraints.added, ...d.constraints.changed.map((x) => x.post)]) {
    if (!named(name)) continue; // contraintes anonymes des nouvelles tables : couvertes par la présence de la table
    c.push([`contrainte ${name} sur ${rel} : présente et validée`, `exists(select 1 from pg_constraint where conrelid=to_regclass(${lit(rel)}) and conname=${lit(name)} and contype=${lit(type)} and convalidated)`]);
  }
  for (const [rel, name, fn] of d.triggers.added) c.push([`déclencheur ${name} sur ${rel} : présent, actif, appelle ${fn}`,
    `exists(select 1 from pg_trigger where tgrelid=to_regclass(${lit(rel)}) and tgname=${lit(name)} and tgenabled='O' and tgfoid=to_regprocedure(${lit(fn)}))`]);
  for (const [id, pub, size, mimes] of d.buckets.added) c.push([`bucket ${id} : privé, ${size} octets maximum, types ${mimes}`,
    `exists(select 1 from storage.buckets where id=${lit(id)} and public=${pub} and coalesce(file_size_limit::text,'')=${lit(size)} and coalesce(allowed_mime_types::text,'')=${lit(mimes)})`]);
  for (const [label, expr] of kit.post ?? []) c.push([label, expr]);
  return c;
}
function absentChecks(d) {
  const c = [];
  for (const r of d.functions.added) c.push(`to_regprocedure(${lit(r[0])}) is not null`);
  for (const r of d.tables.added) c.push(`to_regclass(${lit(r[0])}) is not null`);
  for (const r of d.columns.added) if (!d.tables.added.some((t) => t[0] === r[0])) c.push(`exists(select 1 from pg_attribute where attrelid=to_regclass(${lit(r[0])}) and attname=${lit(r[1])} and not attisdropped)`);
  for (const r of d.indexes.added) c.push(`to_regclass(${lit(r[0])}) is not null`);
  for (const r of d.triggers.added) c.push(`exists(select 1 from pg_trigger where tgrelid=to_regclass(${lit(r[0])}) and tgname=${lit(r[1])})`);
  for (const r of d.buckets.added) c.push(`exists(select 1 from storage.buckets where id=${lit(r[0])})`);
  return c;
}
const raiseUnless = (prefix, checks, indent = " ") => checks.map(([label, expr]) => `${indent}if not (${expr}) then raise exception '${prefix} : %', ${lit(label)}; end if;`).join("\n");
const snap = (rel) => `_kit_snap_${rel.replace(/\W/g, "_")}`;
const historyMatch = (n) => `(name=${lit(n)} or name ~ ${lit(`^[0-9]{14}_${n}$`)})`;

function generate(kit, d, preDb) {
  const sql = kit.sql;
  for (const r of RESERVED) if (sql.includes(r)) throw new Error(`${kit.file} contient ${r}`);
  if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) throw new Error(`${kit.file} gère sa propre transaction`);
  const hash = md5(kit.bytes), name = shortName(kit.file), version = kit.file.slice(0, 14), checks = postChecks(d, kit);
  const replaced = d.functions.changed.map((x) => x.pre);
  if (d.functions.removed.length || d.tables.removed.length || d.columns.removed.length || d.triggers.removed.length || d.policies.removed.length || d.buckets.removed.length)
    throw new Error(`${kit.file} supprime des objets : revoir le kit à la main`);
  const removedConstraints = d.constraints.removed.map((r) => `${r[0]}.${r[1]}`);
  if (removedConstraints.length) throw new Error(`${kit.file} supprime des contraintes : ${removedConstraints.join(", ")}`);
  const snapTables = [...new Set([...(kit.snapshot ?? []), "public.publication_settings", "public.publication_client_settings", "public.clients", "public.publications", "public.publication_deliveries"])];
  for (const t of snapTables) if (rows(preDb, `select to_regclass(${lit(t)}) is not null`)[0][0] !== "t") throw new Error(`table ${t} absente`);
  const exclude = kit.exclude ?? {};
  const header = (title, lines) => `-- ${"=".repeat(105)}\n-- PR #${kit.pr} : ${title}\n${lines.map((l) => `-- ${l}`).join("\n")}\n-- Généré par scripts/migration-kit.mjs depuis supabase/migrations/${kit.file} (md5 ${hash}, ${kit.bytes.length} octets).\n-- ${"=".repeat(105)}\n`;

  const apply = `${header(`application manuelle de supabase/migrations/${kit.file}`, [
    "À exécuter dans le SQL Editor de Supabase (projet codev-os), en entier, en une seule fois.",
    "Une seule transaction : si un contrôle préalable ou une vérification échoue, rien n'est appliqué (ROLLBACK).",
    "La section 2 est la migration du dépôt, sans aucune modification. L'historique n'est PAS écrit ici :",
    "exécuter ensuite sync_migration_history.sql, seulement après la réussite de ce script.",
    "Aucun interrupteur de publication, aucun réglage client et aucune donnée existante n'est modifié",
    "(vérifié à la fin par comparaison avec une photographie prise au début).",
  ])}begin;
set local lock_timeout = '5s';        -- abandonne au lieu d'attendre si une table est verrouillée
set local statement_timeout = '120s';

-- 1. Contrôles préalables ------------------------------------------------------------------------------------
do $pre$
declare missing text;
begin
 select string_agg(n, ', ') into missing from unnest(array[${kit.requires.map(lit).join(",")}]::text[]) n
  where not exists(select 1 from supabase_migrations.schema_migrations where name=n or name ~ ('^[0-9]{14}_'||n||'$'));
 if missing is not null then raise exception 'ARRET : migrations préalables absentes de l''historique : %', missing; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where ${historyMatch(name)}) then
  raise exception 'ARRET : la migration ${version} est déjà inscrite dans l''historique, ne pas la rejouer'; end if;
 if ${absentChecks(d).join("\n  or ") || "false"} then
  raise exception 'ARRET : des objets de la migration ${version} existent déjà, ne pas la rejouer'; end if;
${replaced.map(([sig, body]) => ` if coalesce(${fnMd5(sig)}<>${lit(body)},true) then
  raise exception 'ARRET : % absente ou différente de la version attendue avant migration', ${lit(sig)}; end if;`).join("\n")}
${(kit.pre ?? []).map(([label, expr]) => ` if not (${expr}) then raise exception 'ARRET : %', ${lit(label)}; end if;`).join("\n")}
end $pre$;

-- Photographie des données existantes, comparée à la fin (tables modifiées et interrupteurs de publication).
${snapTables.map((t) => `create temporary table ${snap(t)} on commit drop as select * from ${t};`).join("\n")}
create temporary table _kit_flags on commit drop as
 select (select count(*) from public.publication_client_settings where auto_prepare_enabled) as auto_prepare,
        (select count(*) from public.publication_settings where emergency_stop) as emergency_stop;

-- 2. Migration du dépôt, octet pour octet ---------------------------------------------------------------------
${sql}
-- 3. Vérifications -------------------------------------------------------------------------------------------
do $post$
declare t record; cols text; n bigint;
begin
${raiseUnless("VERIFICATION", checks)}
 -- Données existantes inchangées (seules les colonnes qui existaient avant sont comparées).
 for t in select * from (values ${snapTables.map((rel) => `(${lit(rel)},'${snap(rel)}',${lit((exclude[rel] ?? []).join(","))})`).join(",")}) v(rel, snap, excluded) loop
  select string_agg(format('%I', attname), ',' order by attnum) into cols from pg_attribute
   where attrelid=('pg_temp.'||t.snap)::regclass and attnum>0 and not attisdropped and attname<>all(string_to_array(t.excluded, ','));
  execute format('select count(*) from ((select row(%s)::text from pg_temp.%I) except all (select row(%s)::text from %s)) d', cols, t.snap, cols, t.rel) into n;
  if n<>0 then raise exception 'VERIFICATION : % ligne(s) de % modifiée(s)', n, t.rel; end if;
  execute format('select (select count(*) from %s)-(select count(*) from pg_temp.%I)', t.rel, t.snap) into n;
  if n<>0 then raise exception 'VERIFICATION : le nombre de lignes de % a changé', t.rel; end if;
 end loop;
 if (select auto_prepare from _kit_flags)<>(select count(*) from public.publication_client_settings where auto_prepare_enabled)
  or (select emergency_stop from _kit_flags)<>(select count(*) from public.publication_settings where emergency_stop) then
  raise exception 'VERIFICATION : un interrupteur de publication a changé'; end if;
${(kit.postData ?? []).map(([label, expr]) => ` if not (${expr}) then raise exception 'VERIFICATION : %', ${lit(label)}; end if;`).join("\n")}
 raise notice 'Migration ${version} appliquée et vérifiée (% contrôles).', ${checks.length};
end $post$;
commit;

-- 4. Compte rendu (lecture seule) ----------------------------------------------------------------------------
select ${lit(`${version} appliquée`)} as migration, ${checks.length} as controles_reussis,
       (select count(*) from public.publication_client_settings where auto_prepare_enabled) as clients_avec_preparation_automatique,
       (select string_agg(format('emergency_stop=%s automation=%s generation=%s publishing=%s', emergency_stop, automation_enabled, generation_enabled, publishing_enabled), '; ') from public.publication_settings) as interrupteurs;
`;

  const b64 = Buffer.from(kit.bytes).toString("base64").match(/.{1,76}/g).join("\n");
  const sync = `${header(`inscription de ${kit.file} dans l'historique Supabase`, [
    "À exécuter APRÈS une application réussie de apply_sql_editor.sql, dans une nouvelle requête du SQL Editor.",
    `Convention de l'historique de ce projet : version = horodatage UTC de l'inscription, nom court (${name}), texte dans statements.`,
    "Refuse d'écrire si la migration n'est pas réellement en place (mêmes contrôles qu'après application) ou si elle est",
    "déjà inscrite. Le texte inscrit est le fichier du dépôt, transporté en base64 : un copier-coller qui change les fins",
    "de ligne (CRLF sous Windows) ou l'encodage ne peut pas l'altérer. Les corps de fonctions en base sont comparés à",
    "ceux du dépôt en ignorant seulement les fins de ligne. Une seule transaction : en cas d'anomalie, rien n'est écrit.",
  ])}begin;
do $sync$
declare
 expected_md5 constant text := ${lit(hash)};
 migration_text text := convert_from(decode('
${b64}
', 'base64'), 'UTF8');
begin
 if exists(select 1 from supabase_migrations.schema_migrations where ${historyMatch(name)}) then
  raise exception 'ARRET : la migration ${version} est déjà inscrite dans l''historique'; end if;
${raiseUnless("ARRET (migration non appliquée ou différente du dépôt)", checks)}
 if md5(migration_text)<>expected_md5 then
  raise exception 'ARRET : texte décodé inattendu (md5 %, % octets)', md5(migration_text), octet_length(migration_text); end if;
 insert into supabase_migrations.schema_migrations(version, name, statements)
 values (to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISS'), ${lit(name)}, array[migration_text]);
 if (select md5(statements[1]) from supabase_migrations.schema_migrations where name=${lit(name)})<>expected_md5 then
  raise exception 'ARRET : le texte inscrit ne correspond pas au fichier du dépôt'; end if;
 raise notice 'Migration ${version} inscrite dans l''historique.';
end $sync$;
commit;

select version, name, md5(statements[1]) as md5_texte, octet_length(statements[1]) as octets
  from supabase_migrations.schema_migrations order by version desc limit 3;
`;

  const verify = `${header(`vérifications en lecture seule de ${kit.file}`, [
    "À exécuter à tout moment après l'application : n'écrit rien. Chaque ligne doit indiquer ok = true.",
  ])}select controle, ok from (values
${[...checks, [`historique : ${name} inscrite avec le texte du dépôt`, `exists(select 1 from supabase_migrations.schema_migrations where name=${lit(name)} and md5(statements[1])=${lit(hash)})`],
    ["publication : arrêt d'urgence toujours actif, aucun client en préparation automatique", `(select bool_and(emergency_stop) from public.publication_settings) and not exists(select 1 from public.publication_client_settings where auto_prepare_enabled)`],
  ].map(([label, expr]) => ` (${lit(label)}, coalesce((${expr}), false))`).join(",\n")}
) v(controle, ok);
`;
  fs.writeFileSync(path.join(root, kit.dir, "apply_sql_editor.sql"), apply);
  fs.writeFileSync(path.join(root, kit.dir, "sync_migration_history.sql"), sync);
  fs.writeFileSync(path.join(root, kit.dir, "verify.sql"), verify);
  return {hash, checks: checks.length, replaced: replaced.map((r) => r[0]), d};
}

function expectFail(db, file, needle, label) {
  const r = psql(db, fs.readFileSync(file, "utf8"), {allowError: true});
  if (r.ok || !r.err.includes(needle)) throw new Error(`${label} : échec attendu (${needle}), obtenu ${r.ok ? "succès" : r.err.slice(0, 400)}`);
}
function runKit(db, kit, crlf) {
  const conv = (f) => { const t = fs.readFileSync(path.join(root, kit.dir, f), "utf8"); return crlf ? t.replace(/\r?\n/g, "\r\n") : t; };
  expectFail(db, path.join(root, kit.dir, "sync_migration_history.sql"), "ARRET", `${kit.dir} inscription avant application`);
  psql(db, conv("apply_sql_editor.sql"));
  psql(db, conv("sync_migration_history.sql"));
  const v = rows(db, fs.readFileSync(path.join(root, kit.dir, "verify.sql"), "utf8"));
  const bad = v.filter((r) => r[1] !== "t");
  if (bad.length) throw new Error(`${kit.dir} verify : ${bad.map((r) => r[0]).join("; ")}`);
  expectFail(db, path.join(root, kit.dir, "apply_sql_editor.sql"), "ARRET", `${kit.dir} seconde application`);
  expectFail(db, path.join(root, kit.dir, "sync_migration_history.sql"), "ARRET", `${kit.dir} seconde inscription`);
  return v.length;
}

const prefix = "migration_kit";
buildBase(`${prefix}_base`);
let pre = `${prefix}_base`;
for (const [i, kit] of kits.entries()) {
  kit.bytes = read(`supabase/migrations/${kit.file}`); kit.sql = kit.bytes.toString("utf8");
  if (!kit.sql.endsWith("\n")) throw new Error(`${kit.file} doit finir par un saut de ligne`);
  const raw = `${prefix}_raw_${i}`;
  cloneDb(pre, raw);
  const before = snapshot(pre);
  psql(raw, kit.sql);
  const result = (only.length && !only.includes(String(kit.pr))) ? null : generate(kit, diff(before, snapshot(raw)), pre);
  const next = `${prefix}_state_${i}`;
  if (result && check) {
    const crlf = `${prefix}_crlf_${i}`;
    cloneDb(pre, crlf); const n = runKit(crlf, kit, true); dropDb(crlf);
    cloneDb(pre, next); runKit(next, kit, false);
    console.log(`PR #${kit.pr} ${kit.file} md5 ${result.hash} : ${result.checks} contrôles, ${n} vérifications ; LF et CRLF appliqués, inscrits, doublons refusés.${result.replaced.length ? ` Fonctions remplacées : ${result.replaced.join(", ")}.` : ""}`);
  } else {
    cloneDb(raw, next);
    psql(next, `insert into supabase_migrations.schema_migrations(version,name,statements) values (${lit(kit.file.slice(0, 14))},${lit(shortName(kit.file))},array[${lit(kit.sql)}]);`);
    if (result) console.log(`PR #${kit.pr} ${kit.file} md5 ${result.hash} : ${result.checks} contrôles générés.`);
  }
  dropDb(raw);
  if (pre !== `${prefix}_base`) dropDb(pre);
  pre = next;
}
console.log(`Base finale : ${pre}`);
