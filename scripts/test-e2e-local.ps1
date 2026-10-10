param([string]$PostgresBin = '.local\runtime\postgresql17\pgsql\bin')
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot $PostgresBin))
$clusterRoot = Join-Path $repoRoot ('.local\e2e-postgres\' + [guid]::NewGuid().ToString('N'))
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
 $env:E2E_DATABASE_URL = "postgresql://postgres@127.0.0.1:$port/codev_e2e"
 $env:CODEV_CORE_TEST_PSQL = Join-Path $binRoot 'psql.exe'
 $env:PATH = $binRoot + ';' + $env:PATH
 $env:POSTGREST_BIN = Join-Path $repoRoot '.local\runtime\postgrest16\postgrest.exe'
 $env:E2E_CHROMIUM = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 $env:E2E_VIEWPORTS = 'desktop,mobile'
 & node scripts/e2e.mjs
 if ($LASTEXITCODE -ne 0) { throw 'Local browser validation failed.' }
} finally { if ($started) { & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -m fast -w stop } }
