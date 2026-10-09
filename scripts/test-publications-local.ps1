param(
  [Parameter(Mandatory=$true)][string]$PostgresBin,
  [switch]$DatabaseOnly
)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binRoot=[IO.Path]::GetFullPath($PostgresBin)
foreach ($binary in @('initdb.exe','pg_ctl.exe','psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $binRoot $binary) -PathType Leaf)) { throw "PostgreSQL binary missing: $binary" }
}
# Each run creates its own new cluster; no old database is reset or deleted.
$clusterRoot=Join-Path $repoRoot ('.local\publications-postgres\'+[guid]::NewGuid().ToString('N'))
$dataRoot=Join-Path $clusterRoot 'data'
New-Item -ItemType Directory -Path $clusterRoot -Force | Out-Null
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
$port=$listener.LocalEndpoint.Port
$listener.Stop()
$savedUrl=$env:PUBLICATIONS_TEST_DATABASE_URL
$savedPsql=$env:PUBLICATIONS_TEST_PSQL
$savedScopeUrl=$env:AGENT_SCOPE_TEST_DATABASE_URL
$savedScopePsql=$env:AGENT_SCOPE_TEST_PSQL
$savedReplayUrl=$env:REMOTE_SCHEMA_TEST_DATABASE_URL
$savedReplayPsql=$env:REMOTE_SCHEMA_TEST_PSQL
$savedHardeningUrl=$env:HISTORICAL_PERMISSIONS_TEST_DATABASE_URL
$savedHardeningPsql=$env:HISTORICAL_PERMISSIONS_TEST_PSQL
$savedWorkspaceUrl=$env:PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL
$savedWorkspacePsql=$env:PUBLICATIONS_WORKSPACE_TEST_PSQL
$savedCalendarUrl=$env:PUBLICATIONS_CALENDAR_TEST_DATABASE_URL
$savedCalendarPsql=$env:PUBLICATIONS_CALENDAR_TEST_PSQL
$savedAgentUrl=$env:PUBLICATIONS_AGENT_TEST_DATABASE_URL
$savedAgentPsql=$env:PUBLICATIONS_AGENT_TEST_PSQL
$savedChannelsUrl=$env:PUBLICATIONS_CHANNELS_TEST_DATABASE_URL
$savedChannelsPsql=$env:PUBLICATIONS_CHANNELS_TEST_PSQL
$savedSchedulesUrl=$env:PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL
$savedSchedulesPsql=$env:PUBLICATIONS_SCHEDULES_TEST_PSQL
$savedOccurrencesUrl=$env:PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL
$savedOccurrencesPsql=$env:PUBLICATIONS_OCCURRENCES_TEST_PSQL
$savedGroupsUrl=$env:PUBLICATIONS_GROUPS_TEST_DATABASE_URL
$savedGroupsPsql=$env:PUBLICATIONS_GROUPS_TEST_PSQL
$savedP4bUrl=$env:PUBLICATIONS_P4B_TEST_DATABASE_URL
$savedP4bPsql=$env:PUBLICATIONS_P4B_TEST_PSQL
$savedP5Url=$env:PUBLICATIONS_P5_TEST_DATABASE_URL
$savedP5Psql=$env:PUBLICATIONS_P5_TEST_PSQL
$savedP7Url=$env:PUBLICATIONS_P7_TEST_DATABASE_URL
$savedP7Psql=$env:PUBLICATIONS_P7_TEST_PSQL
$savedP8Url=$env:PUBLICATIONS_P8_TEST_DATABASE_URL
$savedP8Psql=$env:PUBLICATIONS_P8_TEST_PSQL
$savedP9Url=$env:PUBLICATIONS_P9_TEST_DATABASE_URL
$savedP9Psql=$env:PUBLICATIONS_P9_TEST_PSQL
$savedP10Url=$env:PUBLICATIONS_P10_TEST_DATABASE_URL
$savedP10Psql=$env:PUBLICATIONS_P10_TEST_PSQL
$savedP11Url=$env:PUBLICATIONS_P11_TEST_DATABASE_URL
$savedP11Psql=$env:PUBLICATIONS_P11_TEST_PSQL
$savedP11bUrl=$env:PUBLICATIONS_P11B_TEST_DATABASE_URL
$savedP11bPsql=$env:PUBLICATIONS_P11B_TEST_PSQL
$savedP12Url=$env:PUBLICATIONS_P12_TEST_DATABASE_URL
$savedP12Psql=$env:PUBLICATIONS_P12_TEST_PSQL
$savedChaosUrl=$env:PUBLICATIONS_CHAOS_TEST_DATABASE_URL
$savedChaosPsql=$env:PUBLICATIONS_CHAOS_TEST_PSQL
$savedTelemetry=$env:NEXT_TELEMETRY_DISABLED
$savedClerkTelemetry=$env:CLERK_TELEMETRY_DISABLED
$savedApplicationEnv=@{}
foreach($name in @('NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SECRET_KEY','AUTHORIZED_ADMIN_USER_ID','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','GOOGLE_ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','GOOGLE_ADS_REFRESH_TOKEN')) {
  $savedApplicationEnv[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
}
$savedPg=@{}
foreach($name in @('PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE')) {
  $savedPg[$name]=[Environment]::GetEnvironmentVariable($name,'Process')
}
$started=$false
$validationPassed=$false
Push-Location $repoRoot
try {
  $env:PGHOST='127.0.0.1'
  $env:PGHOSTADDR='127.0.0.1'
  $env:PGPORT=[string]$port
  $env:PGUSER='publications_local'
  $env:PGDATABASE='postgres'
  $env:PGPASSWORD=''
  [Environment]::SetEnvironmentVariable('PGSERVICE',$null,'Process')
  [Environment]::SetEnvironmentVariable('PGSERVICEFILE',$null,'Process')
  $env:PGOPTIONS=''
  $env:PGPASSFILE=Join-Path $clusterRoot 'no-password-file'
  & (Join-Path $binRoot 'initdb.exe') -D $dataRoot -U publications_local -A trust -E UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL initialization failed.' }
  # Trust is confined to this disposable test cluster, listening on IPv4 loopback.
  & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -l (Join-Path $clusterRoot 'postgres.log') -o "-h 127.0.0.1 -p $port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL startup failed.' }
  $started=$true
  $listening=& (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -At -v ON_ERROR_STOP=1 -c "select current_setting('listen_addresses')='127.0.0.1' and inet_server_addr()='127.0.0.1'::inet;"
  if ($LASTEXITCODE -ne 0 -or $listening -ne 't') { throw 'PostgreSQL is not confirmed loopback-only.' }
  Write-Output "PostgreSQL runtime confirmed listening only on 127.0.0.1:$port."
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_lot1_test;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated local test database creation failed.' }
  $env:PUBLICATIONS_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_lot1_test"
  $env:PUBLICATIONS_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database agent_scope_test;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated scope test database creation failed.' }
  $env:AGENT_SCOPE_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/agent_scope_test"
  $env:AGENT_SCOPE_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create role postgres nologin bypassrls;'
  if ($LASTEXITCODE -ne 0) { throw 'Local replay owner role creation failed.' }
  # Roles belong to the cluster, not a database. Create once to prevent races
  # between the independent SQL integrations executed concurrently by npm test.
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_admin nologin superuser;'
  if ($LASTEXITCODE -ne 0) { throw 'Local isolated test roles creation failed.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database historical_permissions_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated historical permissions DB creation failed.' }
  $env:HISTORICAL_PERMISSIONS_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/historical_permissions_test"
  $env:HISTORICAL_PERMISSIONS_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & npm.cmd run test:historical-permissions:db
  if ($LASTEXITCODE -ne 0) { throw 'Five-migration hardening SQL failed. Application validation remains blocked.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_workspace_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated manual workspace DB creation failed.' }
  $env:PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_workspace_test"
  $env:PUBLICATIONS_WORKSPACE_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-workspace-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 2 SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_calendar_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated calendar DB creation failed.' }
  $env:PUBLICATIONS_CALENDAR_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_calendar_test"
  $env:PUBLICATIONS_CALENDAR_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-calendar-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 3 calendar SQL failed.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_agent_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated AI agent database creation failed.' }
  $env:PUBLICATIONS_AGENT_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_agent_test"
  $env:PUBLICATIONS_AGENT_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-agent-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4 agent SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_channels_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated channels database creation failed.' }
  $env:PUBLICATIONS_CHANNELS_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_channels_test"
  $env:PUBLICATIONS_CHANNELS_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-channels-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P1 channels SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_schedules_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated schedules database creation failed.' }
  $env:PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_schedules_test"
  $env:PUBLICATIONS_SCHEDULES_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-schedules-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P2-a schedules SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_occurrences_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated occurrences database creation failed.' }
  $env:PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_occurrences_test"
  $env:PUBLICATIONS_OCCURRENCES_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-occurrences-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P3 occurrences SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_groups_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated editorial groups database creation failed.' }
  $env:PUBLICATIONS_GROUPS_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_groups_test"
  $env:PUBLICATIONS_GROUPS_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-editorial-groups-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P4-a editorial groups SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p4b_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated occurrence publications database creation failed.' }
  $env:PUBLICATIONS_P4B_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p4b_test"
  $env:PUBLICATIONS_P4B_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-occurrence-publications-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P4-b occurrence publications SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p5_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated archiving database creation failed.' }
  $env:PUBLICATIONS_P5_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p5_test"
  $env:PUBLICATIONS_P5_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-archiving-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P5 archiving SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p7_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated agent v2 database creation failed.' }
  $env:PUBLICATIONS_P7_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p7_test"
  $env:PUBLICATIONS_P7_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-agent-v2-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P7 agent v2 SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p8_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated agent v2 media database creation failed.' }
  $env:PUBLICATIONS_P8_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p8_test"
  $env:PUBLICATIONS_P8_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-agent-v2-media-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P8 agent v2 media SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p9_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated publication connections database creation failed.' }
  $env:PUBLICATIONS_P9_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p9_test"
  $env:PUBLICATIONS_P9_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-connections-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P9 publication connections SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p10_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated delivery engine database creation failed.' }
  $env:PUBLICATIONS_P10_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p10_test"
  $env:PUBLICATIONS_P10_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-delivery-engine-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P10 delivery engine SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p11_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated publication OAuth database creation failed.' }
  $env:PUBLICATIONS_P11_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p11_test"
  $env:PUBLICATIONS_P11_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-oauth-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P11-a publication OAuth SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p11b_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated Meta publisher database creation failed.' }
  $env:PUBLICATIONS_P11B_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p11b_test"
  $env:PUBLICATIONS_P11B_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-meta-publisher-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P11-b Meta publisher SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_p12_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated GBP publisher database creation failed.' }
  $env:PUBLICATIONS_P12_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_p12_test"
  $env:PUBLICATIONS_P12_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-gbp-publisher-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 P12 GBP publisher SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database publications_chaos_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated chaos database creation failed.' }
  $env:PUBLICATIONS_CHAOS_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/publications_chaos_test"
  $env:PUBLICATIONS_CHAOS_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & node --test tests/publications-chaos-db.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Lot 4.3 chaos SQL failed. No remote migration permitted.' }
  & (Join-Path $binRoot 'psql.exe') -X --no-password -h 127.0.0.1 -p $port -U publications_local -d postgres -v ON_ERROR_STOP=1 -c 'create database remote_schema_test owner postgres;'
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated local replay database creation failed.' }
  $env:REMOTE_SCHEMA_TEST_DATABASE_URL="postgresql://publications_local@127.0.0.1:$port/remote_schema_test"
  $env:REMOTE_SCHEMA_TEST_PSQL=Join-Path $binRoot 'psql.exe'
  & npm.cmd run test:remote-schema:db
  if ($LASTEXITCODE -ne 0) { throw 'Faithful remote schema replay failed. Application validation remains blocked.' }
  & npm.cmd run test:publications:db
  if ($LASTEXITCODE -ne 0) { throw 'Lot 1 SQL failed. Application validation and Lot 2 remain blocked.' }
  & npm.cmd run test:scope:db
  if ($LASTEXITCODE -ne 0) { throw 'Four-migration SQL failed. Application validation and Lot 2 remain blocked.' }
  if (-not $DatabaseOnly) {
    # Build/test placeholders override dotenv without modifying .env or using
    # remote keys. Business reads are lazy; these never name a remote account.
    $env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:9'
    $env:SUPABASE_SECRET_KEY='sb_secret_local_validation_placeholder'
    $env:AUTHORIZED_ADMIN_USER_ID='user_local_validation'
    $env:NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_test_'+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('local-validation.clerk.accounts.dev$'))
    $env:CLERK_SECRET_KEY='sk_test_local_validation_placeholder'
    $env:GOOGLE_ADS_CLIENT_ID='local-validation-placeholder'
    $env:GOOGLE_ADS_CLIENT_SECRET='local-validation-placeholder'
    $env:GOOGLE_ADS_REFRESH_TOKEN='local-validation-placeholder'
    $env:NEXT_TELEMETRY_DISABLED='1'
    $env:CLERK_TELEMETRY_DISABLED='1'
    foreach($check in @('test:publications','lint','typecheck','build','test')) {
      & npm.cmd run $check
      if ($LASTEXITCODE -ne 0) { throw "Application validation failed: $check" }
    }
  }
  $validationPassed=$true
} finally {
  if ($started) {
    & (Join-Path $binRoot 'pg_ctl.exe') -D $dataRoot -m fast -w stop
    if ($LASTEXITCODE -ne 0) { $validationPassed=$false; Write-Warning "Local cluster requires manual stop: $dataRoot" }
  }
  $env:PUBLICATIONS_TEST_DATABASE_URL=$savedUrl
  $env:PUBLICATIONS_TEST_PSQL=$savedPsql
  $env:AGENT_SCOPE_TEST_DATABASE_URL=$savedScopeUrl
  $env:AGENT_SCOPE_TEST_PSQL=$savedScopePsql
  $env:REMOTE_SCHEMA_TEST_DATABASE_URL=$savedReplayUrl
  $env:REMOTE_SCHEMA_TEST_PSQL=$savedReplayPsql
  $env:HISTORICAL_PERMISSIONS_TEST_DATABASE_URL=$savedHardeningUrl
  $env:HISTORICAL_PERMISSIONS_TEST_PSQL=$savedHardeningPsql
  $env:PUBLICATIONS_WORKSPACE_TEST_DATABASE_URL=$savedWorkspaceUrl
  $env:PUBLICATIONS_WORKSPACE_TEST_PSQL=$savedWorkspacePsql
  $env:PUBLICATIONS_CALENDAR_TEST_DATABASE_URL=$savedCalendarUrl
  $env:PUBLICATIONS_CALENDAR_TEST_PSQL=$savedCalendarPsql
  $env:PUBLICATIONS_AGENT_TEST_DATABASE_URL=$savedAgentUrl
  $env:PUBLICATIONS_AGENT_TEST_PSQL=$savedAgentPsql
  $env:PUBLICATIONS_CHANNELS_TEST_DATABASE_URL=$savedChannelsUrl
  $env:PUBLICATIONS_CHANNELS_TEST_PSQL=$savedChannelsPsql
  $env:PUBLICATIONS_SCHEDULES_TEST_DATABASE_URL=$savedSchedulesUrl
  $env:PUBLICATIONS_SCHEDULES_TEST_PSQL=$savedSchedulesPsql
  $env:PUBLICATIONS_OCCURRENCES_TEST_DATABASE_URL=$savedOccurrencesUrl
  $env:PUBLICATIONS_OCCURRENCES_TEST_PSQL=$savedOccurrencesPsql
  $env:PUBLICATIONS_GROUPS_TEST_DATABASE_URL=$savedGroupsUrl
  $env:PUBLICATIONS_GROUPS_TEST_PSQL=$savedGroupsPsql
  $env:PUBLICATIONS_P4B_TEST_DATABASE_URL=$savedP4bUrl
  $env:PUBLICATIONS_P4B_TEST_PSQL=$savedP4bPsql
  $env:PUBLICATIONS_P5_TEST_DATABASE_URL=$savedP5Url
  $env:PUBLICATIONS_P5_TEST_PSQL=$savedP5Psql
  $env:PUBLICATIONS_P7_TEST_DATABASE_URL=$savedP7Url
  $env:PUBLICATIONS_P7_TEST_PSQL=$savedP7Psql
  $env:PUBLICATIONS_P8_TEST_DATABASE_URL=$savedP8Url
  $env:PUBLICATIONS_P8_TEST_PSQL=$savedP8Psql
  $env:PUBLICATIONS_P9_TEST_DATABASE_URL=$savedP9Url
  $env:PUBLICATIONS_P9_TEST_PSQL=$savedP9Psql
  $env:PUBLICATIONS_P10_TEST_DATABASE_URL=$savedP10Url
  $env:PUBLICATIONS_P10_TEST_PSQL=$savedP10Psql
  $env:PUBLICATIONS_P11_TEST_DATABASE_URL=$savedP11Url
  $env:PUBLICATIONS_P11_TEST_PSQL=$savedP11Psql
  $env:PUBLICATIONS_P11B_TEST_DATABASE_URL=$savedP11bUrl
  $env:PUBLICATIONS_P11B_TEST_PSQL=$savedP11bPsql
  $env:PUBLICATIONS_P12_TEST_DATABASE_URL=$savedP12Url
  $env:PUBLICATIONS_P12_TEST_PSQL=$savedP12Psql
  $env:PUBLICATIONS_CHAOS_TEST_DATABASE_URL=$savedChaosUrl
  $env:PUBLICATIONS_CHAOS_TEST_PSQL=$savedChaosPsql
  $env:NEXT_TELEMETRY_DISABLED=$savedTelemetry
  $env:CLERK_TELEMETRY_DISABLED=$savedClerkTelemetry
  foreach($name in $savedPg.Keys) { [Environment]::SetEnvironmentVariable($name,$savedPg[$name],'Process') }
  foreach($name in $savedApplicationEnv.Keys) { [Environment]::SetEnvironmentVariable($name,$savedApplicationEnv[$name],'Process') }
  Pop-Location
}
if ($validationPassed) { Write-Output "Complete local validation succeeded. Cluster stopped; artifacts retained in $clusterRoot" }
else { exit 1 }
