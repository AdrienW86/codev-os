param([string]$PostgresBin = '.local\runtime\postgresql17\pgsql\bin')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot $PostgresBin))
$clusterRoot = Join-Path $repoRoot ('.local\ads-postgres\' + [guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $clusterRoot 'data'
New-Item -ItemType Directory -Path $clusterRoot -Force | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$started = $false
try {
  & (Join-Path $binRoot 'initdb.exe') -D $dataRoot -U postgres -A trust -E UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Local initdb failed.' }
  & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -l (Join-Path $clusterRoot 'postgres.log') -o "-h 127.0.0.1 -p $port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed.' }
  $started = $true
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;'
  if ($LASTEXITCODE -ne 0) { throw 'Local roles initialization failed.' }
  $env:CODEV_CORE_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:$port/codev_core_test"
  $env:CODEV_CORE_TEST_PSQL = Join-Path $binRoot 'psql.exe'
  & node --test tests/google-ads-reports-db.test.mjs tests/ads-workspace-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Local SQL validation failed.' }
} finally {
  if ($started) { & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -m fast -w stop }
}
