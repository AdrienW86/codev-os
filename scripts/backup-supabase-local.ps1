param()
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bin=Join-Path $root '.local/runtime/pgsql-runtime/pgsql/bin'
$dest=Join-Path $root ('backups/pre-migration-2026-10-05/'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$saved=@{}
foreach($name in @('PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGOPTIONS','PGSSLMODE','PGCONNECT_TIMEOUT','PGSERVICE','PGSERVICEFILE','PGPASSFILE')) { $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
$started=$false
$cluster=Join-Path $dest 'local-cluster'
function Run-Pg([string]$exe,[string[]]$arguments,[string]$log) {
  if($exe -eq 'pg_ctl.exe') {
    $process=Start-Process -FilePath (Join-Path $bin $exe) -ArgumentList ($arguments | ForEach-Object { '"'+$_+'"' }) -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError ($log+'.stderr') -PassThru
    $process.WaitForExit()
    if($process.ExitCode -ne 0){throw 'Local PostgreSQL lifecycle operation failed.'}
    return
  }
  & (Join-Path $bin $exe) @arguments *> $log
  if($LASTEXITCODE -ne 0){ throw "PostgreSQL operation failed: $exe. Details remain in ignored backup folder; no secret displayed." }
}
try {
  $line=Get-Content -LiteralPath (Join-Path $root '.env') -Encoding UTF8 | Where-Object {$_ -match '^SUPABASE_DB_URL='} | Select-Object -Last 1
  [Uri]$uri=($line -replace '^SUPABASE_DB_URL=','').Trim().Trim('"').Trim("'")
  $credentials=$uri.UserInfo.Split([char[]]@(':'),2,[StringSplitOptions]::None)
  $username=[Uri]::UnescapeDataString($credentials[0])
  if($uri.Scheme -notin @('postgres','postgresql') -or ($username -ne 'postgres.lehlbcnpufkllcykvtlg' -and $uri.Host -ne 'db.lehlbcnpufkllcykvtlg.supabase.co') -or $uri.Port -ne 5432){throw 'Connection target is not the approved project/session connection.'}
  $env:PGHOST=$uri.Host; $env:PGPORT=[string]$uri.Port; $env:PGUSER=$username; $env:PGPASSWORD=[Uri]::UnescapeDataString($credentials[1]); $env:PGDATABASE=$uri.AbsolutePath.TrimStart('/'); $env:PGSSLMODE='require'; $env:PGCONNECT_TIMEOUT='15'; $env:PGOPTIONS='-c default_transaction_read_only=on'; $env:PGPASSFILE=Join-Path $dest 'unused-passfile'
  $query=@'
select jsonb_build_object(
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl,'owner',pg_get_userbyid(c.relowner)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'triggers',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid)) order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by c.relname,x.conname) from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'),
 'indexes',(select jsonb_agg(indexdef order by tablename,indexname) from pg_indexes where schemaname='public'),
 'policies',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'),
 'counts',jsonb_build_object('clients',(select count(*) from public.clients),'projects',(select count(*) from public.projects),'tasks',(select count(*) from public.tasks),'agents',(select count(*) from public.agents),'assignments',(select count(*) from public.agent_client_assignments),'runs',(select count(*) from public.agent_runs),'recommendations',(select count(*) from public.recommendations),'actions',(select count(*) from public.actions),'messages',(select count(*) from public.agent_messages),'audits',(select count(*) from public.audit_logs),'services',(select count(*) from public.client_services),'connections',(select count(*) from public.client_connections),'events',(select count(*) from public.client_events))
);
'@
  $queryFile=Join-Path $dest 'verify.sql'; [IO.File]::WriteAllText($queryFile,$query,[Text.UTF8Encoding]::new($false))
  Run-Pg 'psql.exe' @('-X','--no-password','-At','-v','ON_ERROR_STOP=1','-f',$queryFile,'-o',(Join-Path $dest 'remote-before.json')) (Join-Path $dest 'remote-before.log')
  $dump=Join-Path $dest 'public.dump'
  Run-Pg 'pg_dump.exe' @('--no-password','--format=custom','--schema=public','--encoding=UTF8','--file',$dump) (Join-Path $dest 'dump.log')
  if((Get-Item -LiteralPath $dump).Length -eq 0){throw 'Empty dump.'}
  Run-Pg 'pg_restore.exe' @('--list',$dump) (Join-Path $dest 'archive-list.txt')
  Run-Pg 'psql.exe' @('-X','--no-password','-At','-v','ON_ERROR_STOP=1','-f',$queryFile,'-o',(Join-Path $dest 'remote-after.json')) (Join-Path $dest 'remote-after.log')
  # Migration history is separate from the public archive and contains no keys.
  Run-Pg 'pg_dump.exe' @('--no-password','--format=custom','--schema=supabase_migrations','--file',(Join-Path $dest 'migration-history.dump')) (Join-Path $dest 'migration-history.log')
  $env:PGHOST='127.0.0.1'; $env:PGHOSTADDR='127.0.0.1'; $env:PGUSER='backup_local'; $env:PGPASSWORD=''; $env:PGDATABASE='postgres'; $env:PGSSLMODE='disable'; $env:PGOPTIONS=''
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop(); $env:PGPORT=[string]$port
  Run-Pg 'initdb.exe' @('-D',$cluster,'-U','backup_local','-A','trust','-E','UTF8','--locale=C') (Join-Path $dest 'initdb.log')
  Run-Pg 'pg_ctl.exe' @('-D',$cluster,'-l',(Join-Path $dest 'postgres.log'),'-o',"-h 127.0.0.1 -p $port",'-w','start') (Join-Path $dest 'start.log'); $started=$true
  Run-Pg 'psql.exe' @('-X','--no-password','-v','ON_ERROR_STOP=1','-c','create role postgres nologin; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin nologin; create role pg_database_owner_placeholder nologin;') (Join-Path $dest 'roles.log')
  Run-Pg 'createdb.exe' @('--no-password','--template=template0','restore_test') (Join-Path $dest 'createdb.log'); $env:PGDATABASE='restore_test'
  Run-Pg 'pg_restore.exe' @('--no-password','--exit-on-error','--single-transaction','--dbname=restore_test',$dump) (Join-Path $dest 'restore.log')
  Run-Pg 'pg_restore.exe' @('--no-password','--exit-on-error','--single-transaction','--dbname=restore_test',(Join-Path $dest 'migration-history.dump')) (Join-Path $dest 'restore-history.log')
  Run-Pg 'psql.exe' @('-X','--no-password','-At','-v','ON_ERROR_STOP=1','-f',$queryFile,'-o',(Join-Path $dest 'local-restored.json')) (Join-Path $dest 'local-verify.log')
  $before=[IO.File]::ReadAllText((Join-Path $dest 'remote-before.json')).Trim(); $after=[IO.File]::ReadAllText((Join-Path $dest 'remote-after.json')).Trim(); $local=[IO.File]::ReadAllText((Join-Path $dest 'local-restored.json')).Trim()
  if($before -ne $after -or $local -ne $after){throw 'Restoration comparison differs or remote changed during backup; stop.'}
  $report=[ordered]@{destination=$dest;format='PostgreSQL custom';bytes=(Get-Item $dump).Length;sha256=(Get-FileHash $dump -Algorithm SHA256).Hash;restorationSucceeded=$true;comparisonIdentical=$true;counts=($local | ConvertFrom-Json).counts;tables=(($local | ConvertFrom-Json).tables).Count;functions=(($local | ConvertFrom-Json).functions).Count;triggers=(($local | ConvertFrom-Json).triggers).Count}
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $dest 'report.json') -Encoding UTF8
  $report | ConvertTo-Json -Depth 8
} finally {
  if($started){ Run-Pg 'pg_ctl.exe' @('-D',$cluster,'-m','fast','-w','stop') (Join-Path $dest 'stop.log') }
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
