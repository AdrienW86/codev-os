$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bin=Join-Path $root '.local/runtime/pgsql-runtime/pgsql/bin'
$backup=Join-Path $root 'backups/pre-migration-2026-10-05/20261005T174418Z'
$work=Join-Path $backup ('restore-validation-'+[guid]::NewGuid().ToString('N'))
$cluster=Join-Path $work 'data'
New-Item -ItemType Directory -Path $work | Out-Null
$saved=@{}
foreach($name in @('PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGOPTIONS','PGSSLMODE','PGSERVICE','PGSERVICEFILE','PGPASSFILE')){ $saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
$started=$false
function Run([string]$exe,[string[]]$arguments,[string]$log){
  & (Join-Path $bin $exe) @arguments *> (Join-Path $work $log)
  if($LASTEXITCODE -ne 0){throw "Local operation failed: $exe; see ignored log $log"}
}
function Lifecycle([string[]]$arguments,[string]$log){
  $p=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList ($arguments | ForEach-Object {'"'+$_+'"'}) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work $log) -RedirectStandardError (Join-Path $work ($log+'.stderr'))
  $handle=$p.Handle
  $p.WaitForExit()
  if($p.ExitCode -ne 0){throw 'Local cluster lifecycle failed.'}
}
try{
  $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); $listener.Start(); $port=$listener.LocalEndpoint.Port; $listener.Stop()
  $env:PGHOST='127.0.0.1'; $env:PGHOSTADDR='127.0.0.1'; $env:PGPORT=[string]$port; $env:PGUSER='backup_local'; $env:PGDATABASE='postgres'; $env:PGSSLMODE='disable'; $env:PGPASSWORD=''; $env:PGOPTIONS='-c timezone=UTC'; $env:PGPASSFILE=Join-Path $work 'unused'
  Run 'pg_restore.exe' @('--list',(Join-Path $backup 'public.dump')) 'archive-list.txt'
  Run 'initdb.exe' @('-D',$cluster,'-U','backup_local','-A','trust','-E','UTF8','--locale=C') 'initdb.log'
  Lifecycle @('-D',$cluster,'-l',(Join-Path $work 'postgres.log'),'-o',"-h 127.0.0.1 -p $port",'-w','start') 'start.log'; $started=$true
  Run 'psql.exe' @('-X','-w','-At','-v','ON_ERROR_STOP=1','-c',"select current_setting('listen_addresses')='127.0.0.1' and inet_server_addr()='127.0.0.1'::inet;",'-o',(Join-Path $work 'loopback.txt')) 'loopback.log'
  if(([IO.File]::ReadAllText((Join-Path $work 'loopback.txt'))).Trim() -ne 't'){throw 'Loopback verification failed.'}
  Run 'psql.exe' @('-X','-w','-v','ON_ERROR_STOP=1','-c','create role postgres nologin; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin nologin;') 'roles.log'
  Run 'createdb.exe' @('-w','--template=template0','restore_test') 'createdb.log'
  $env:PGDATABASE='restore_test'
  # This DROP targets only the empty schema in our freshly created local DB.
  Run 'psql.exe' @('-X','-w','-v','ON_ERROR_STOP=1','-c','DROP SCHEMA public;') 'prepare.log'
  Run 'pg_restore.exe' @('-w','--exit-on-error','--single-transaction','--dbname=restore_test',(Join-Path $backup 'public.dump')) 'restore.log'
  Run 'pg_restore.exe' @('-w','--exit-on-error','--single-transaction','--dbname=restore_test',(Join-Path $backup 'migration-history.dump')) 'restore-history.log'
  Run 'psql.exe' @('-X','-w','-At','-v','ON_ERROR_STOP=1','-f',(Join-Path $backup 'verify-restoration.sql'),'-o',(Join-Path $work 'local-restored.json')) 'verify.log'
  $local=Get-Content -LiteralPath (Join-Path $work 'local-restored.json') -Raw | ConvertFrom-Json
  $report=[ordered]@{restored=$true;work=$work;port=$port;dumpBytes=(Get-Item (Join-Path $backup 'public.dump')).Length;sha256=(Get-FileHash (Join-Path $backup 'public.dump')).Hash;counts=$local.counts;tables=$local.tables.Count;columns=$local.columns.Count;constraints=$local.constraints.Count;indexes=$local.indexes.Count;functions=$local.functions.Count;triggers=$local.triggers.Count;rlsEnabled=(@($local.tables | Where-Object rls).Count)}
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $work 'report.json') -Encoding UTF8
  $report | ConvertTo-Json -Depth 8
}finally{
  if($started){Lifecycle @('-D',$cluster,'-m','fast','-w','stop') 'stop.log'}
  foreach($name in $saved.Keys){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
