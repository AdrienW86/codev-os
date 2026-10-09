const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const equal = (query, expected, label) => `select pg_temp.replay_assert((${query})=${literal(JSON.stringify(expected))}::jsonb,${literal(label)});\n`;

export function catalogChecks(snapshot) {
  let sql = "";
  for (const t of snapshot.tables) {
    sql += equal(`select jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,'owner',pg_get_userbyid(c.relowner)) from pg_class c where c.oid=${literal(`public.${t.name}`)}::regclass`,t,`table ${t.name}`);
  }
  for (const c of snapshot.columns) {
    sql += equal(`select jsonb_build_object('table',r.relname,'position',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) from pg_attribute a join pg_class r on r.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where r.oid=${literal(`public.${c.table}`)}::regclass and a.attname=${literal(c.name)}`,c,`column ${c.table}.${c.name}`);
  }
  for (const c of snapshot.constraints) {
    sql += equal(`select jsonb_build_object('table',r.relname,'name',x.conname,'type',x.contype,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated) from pg_constraint x join pg_class r on r.oid=x.conrelid where r.oid=${literal(`public.${c.table}`)}::regclass and x.conname=${literal(c.name)}`,c,`constraint ${c.name}`);
  }
  for (const i of snapshot.indexes) {
    sql += equal(`select jsonb_build_object('table',r.relname,'name',n.relname,'definition',pg_get_indexdef(x.indexrelid),'constraint_index',exists(select 1 from pg_constraint where conindid=x.indexrelid)) from pg_index x join pg_class r on r.oid=x.indrelid join pg_class n on n.oid=x.indexrelid where r.oid=${literal(`public.${i.table}`)}::regclass and n.relname=${literal(i.name)}`,i,`index ${i.name}`);
  }
  for (const f of snapshot.functions) {
    sql += equal(`select jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner)) from pg_proc p where p.oid=${literal(`public.${f.name}()`)}::regprocedure`,f,`function ${f.name}`);
  }
  for (const t of snapshot.triggers) {
    sql += equal(`select jsonb_build_object('table',r.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) from pg_trigger t join pg_class r on r.oid=t.tgrelid where r.oid=${literal(`public.${t.table}`)}::regclass and t.tgname=${literal(t.name)}`,t,`trigger ${t.name}`);
  }
  for (const d of snapshot.default_acl) {
    sql += equal(`select jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'type',d.defaclobjtype,'acl',d.defaclacl) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public' and pg_get_userbyid(d.defaclrole)=${literal(d.role)} and d.defaclobjtype=${literal(d.type)}`,d,`default ACL ${d.role}/${d.type}`);
  }
  for (const [catalog, filter, count] of [
    ["pg_class c join pg_namespace n on n.oid=c.relnamespace","n.nspname='public' and c.relkind='r'",13],
    ["pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace","n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped",125],
    ["pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace","n.nspname='public'",38],
    ["pg_indexes","schemaname='public'",39],
    ["pg_proc p join pg_namespace n on n.oid=p.pronamespace","n.nspname='public'",2],
    ["pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace","n.nspname='public' and not t.tgisinternal",8],
    ["pg_policies","schemaname='public'",0],
  ]) sql += `select pg_temp.replay_assert((select count(*)=${count} from ${catalog} where ${filter}),${literal(`inventory cardinality ${catalog}`)});\n`;
  return sql;
}

