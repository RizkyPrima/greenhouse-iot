$ErrorActionPreference = 'Stop'

$containerName = 'greenhouse-plants-test-pg-1023'
$networkName = 'greenhouse-plants-test-net-1023'
$imageName = 'postgres:16.15'
$databaseName = 'plants_phase1023_test'
$databaseUser = 'plants_test'
$hostPort = '55432'
$apiRoot = Split-Path -Parent $PSScriptRoot
$localMigrationDirectory = Join-Path $apiRoot 'prisma/migrations'
$localMigrations = @(Get-ChildItem -LiteralPath $localMigrationDirectory -Directory | Sort-Object Name | Select-Object -ExpandProperty Name)
if ($localMigrations.Count -eq 0) { throw 'Refusing integration test: no local Prisma migrations were found.' }

function Invoke-DockerText([string[]] $Arguments) {
  $result = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL read-only preflight failed.' }
  return ($result -join "`n")
}

$container = (Invoke-DockerText @('inspect', $containerName) | ConvertFrom-Json)[0]
if ($container.Config.Image -ne $imageName -or $container.State.Status -ne 'running' -or $container.State.Health.Status -ne 'healthy') {
  throw 'Refusing integration test: disposable PostgreSQL image or health state did not match.'
}
if ($container.HostConfig.RestartPolicy.Name -ne 'no') { throw 'Refusing integration test: disposable PostgreSQL restart policy must be no.' }
if ($container.Config.Labels.'codex.phase' -ne '10.2.3') { throw 'Refusing integration test: disposable purpose label did not match.' }
if ($container.Mounts.Count -ne 0) { throw 'Refusing integration test: database container has a persistent mount.' }
if ($container.HostConfig.Tmpfs.'/var/lib/postgresql/data' -ne 'rw,noexec,nosuid,size=512m') {
  throw 'Refusing integration test: database data directory is not the expected tmpfs.'
}
if ($container.NetworkSettings.Ports.'5432/tcp'.Count -ne 1 -or $container.NetworkSettings.Ports.'5432/tcp'[0].HostIp -ne '127.0.0.1' -or $container.NetworkSettings.Ports.'5432/tcp'[0].HostPort -ne $hostPort) {
  throw 'Refusing integration test: PostgreSQL is not bound only to the expected loopback port.'
}
$attachedNetworks = @($container.NetworkSettings.Networks.PSObject.Properties.Name)
if ($attachedNetworks.Count -ne 1 -or $attachedNetworks[0] -ne $networkName) { throw 'Refusing integration test: container network did not match.' }
$network = (Invoke-DockerText @('network', 'inspect', $networkName) | ConvertFrom-Json)[0]
$networkContainers = @($network.Containers.PSObject.Properties.Name)
if ($networkContainers.Count -ne 1 -or $networkContainers[0] -ne $container.Id) { throw 'Refusing integration test: test network contains another container.' }

$serverAddress = $container.NetworkSettings.Networks.$networkName.IPAddress
if ($serverAddress -notmatch '^\d{1,3}(?:\.\d{1,3}){3}$') { throw 'Refusing integration test: container server address is unavailable.' }
$identity = Invoke-DockerText @('exec', '--user', 'postgres', $containerName, 'psql', '--no-psqlrc', '--username', $databaseUser, '--tuples-only', '--no-align', '--dbname', $databaseName, '--command=SELECT current_database() || ''|'' || current_user || ''|'' || current_setting(''server_version_num'')')
if ($identity -notmatch '^plants_phase1023_test\|plants_test\|16\d{4,}(?:\s|$)') {
  throw 'Refusing integration test: PostgreSQL database, role, or version did not match.'
}
$migrationQuery = 'SELECT migration_name || ''|'' || (finished_at IS NOT NULL)::text || ''|'' || (rolled_back_at IS NOT NULL)::text FROM public."_prisma_migrations" ORDER BY migration_name, started_at'
$migrationRows = Invoke-DockerText @('exec', '--user', 'postgres', $containerName, 'psql', '--no-psqlrc', '--username', $databaseUser, '--tuples-only', '--no-align', '--dbname', $databaseName, "--command=$migrationQuery")
$migrationRecords = @{}
foreach ($row in @($migrationRows -split "`r?`n" | Where-Object { $_ })) {
  $parts = $row -split '\|'
  if ($parts.Count -ne 3 -or $parts[1] -notin @('true', 'false') -or $parts[2] -notin @('true', 'false')) {
    throw 'Refusing integration test: Prisma migration metadata could not be parsed safely.'
  }
  if ($migrationRecords.ContainsKey($parts[0])) { throw 'Refusing integration test: duplicate Prisma migration records were found.' }
  if ($parts[1] -ne 'true' -or $parts[2] -ne 'false') { throw 'Refusing integration test: failed, incomplete, or rolled-back Prisma migration records were found.' }
  $migrationRecords[$parts[0]] = $true
}
$unexpectedMigrations = @($migrationRecords.Keys | Where-Object { $_ -notin $localMigrations })
$missingMigrations = @($localMigrations | Where-Object { -not $migrationRecords.ContainsKey($_) })
if ($unexpectedMigrations.Count -gt 0 -or $missingMigrations.Count -gt 0) {
  throw 'Refusing integration test: database migration records do not exactly match all local Prisma migrations; this runner does not apply migrations.'
}

$passwordEntry = @($container.Config.Env | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' })
if ($passwordEntry.Count -ne 1 -or $passwordEntry[0].Length -le 'POSTGRES_PASSWORD='.Length) {
  throw 'Refusing integration test: dedicated container credential is unavailable.'
}
$password = $passwordEntry[0].Substring('POSTGRES_PASSWORD='.Length)
$escapedPassword = [Uri]::EscapeDataString($password)
$env:BOOTSTRAP_TEST_DATABASE_URL = "postgresql://${databaseUser}:${escapedPassword}@127.0.0.1:${hostPort}/${databaseName}?schema=public"
$env:BOOTSTRAP_TEST_SERVER_ADDRESS = $serverAddress
$env:BOOTSTRAP_TEST_PREFLIGHT = 'bootstrap-platform-admin:postgres16:127.0.0.1:55432:plants_phase1023_test:plants_test:disposable-only'

Push-Location $apiRoot
try {
  Write-Host 'Verified the dedicated PostgreSQL disposable target; running bootstrap integration fixtures only.'
  & npx vitest run --config ./vitest.config.bootstrap-integration.ts
  if ($LASTEXITCODE -ne 0) { throw "Bootstrap integration tests failed with exit code $LASTEXITCODE." }
}
finally {
  Pop-Location
  Remove-Item Env:BOOTSTRAP_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_TEST_SERVER_ADDRESS -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_TEST_PREFLIGHT -ErrorAction SilentlyContinue
  Remove-Variable password, escapedPassword, passwordEntry -ErrorAction SilentlyContinue
}
