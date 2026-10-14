$ErrorActionPreference = 'Stop'

$containerName = 'greenhouse-plants-test-pg-1023'
$networkName = 'greenhouse-plants-test-net-1023'
$imageName = 'postgres:16.15'
$databaseName = 'plants_phase1023_test'
$databaseUser = 'plants_test'
$hostPort = '55432'
$apiRoot = Split-Path -Parent $PSScriptRoot

function Invoke-DockerText([string[]] $Arguments) {
  $result = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker preflight failed: docker $($Arguments -join ' ')" }
  return ($result -join "`n")
}

$container = (Invoke-DockerText @('inspect', $containerName) | ConvertFrom-Json)[0]
if ($container.Config.Image -ne $imageName -or $container.State.Status -ne 'running' -or $container.State.Health.Status -ne 'healthy') {
  throw 'Disposable PostgreSQL container image or health state did not match the approved target.'
}
if ($container.Config.Labels.'codex.phase' -ne '10.2.3') {
  throw 'Disposable PostgreSQL container is missing the expected purpose label.'
}
if ($container.Mounts.Count -ne 0) { throw 'Disposable PostgreSQL container has a mount; refusing to continue.' }
if ($container.HostConfig.Tmpfs.'/var/lib/postgresql/data' -ne 'rw,noexec,nosuid,size=512m') {
  throw 'Disposable PostgreSQL data directory is not the expected tmpfs.'
}
if ($container.NetworkSettings.Ports.'5432/tcp'.Count -ne 1 -or $container.NetworkSettings.Ports.'5432/tcp'[0].HostIp -ne '127.0.0.1' -or $container.NetworkSettings.Ports.'5432/tcp'[0].HostPort -ne $hostPort) {
  throw 'Disposable PostgreSQL port is not bound only to the expected loopback port.'
}
$attachedNetworks = @($container.NetworkSettings.Networks.PSObject.Properties.Name)
if ($attachedNetworks.Count -ne 1 -or $attachedNetworks[0] -ne $networkName) {
  throw 'Disposable PostgreSQL container is attached to an unexpected network.'
}
$network = (Invoke-DockerText @('network', 'inspect', $networkName) | ConvertFrom-Json)[0]
$networkContainers = @($network.Containers.PSObject.Properties.Name)
if ($networkContainers.Count -ne 1 -or $networkContainers[0] -ne $container.Id) {
  throw 'Dedicated test network contains an unexpected container.'
}

$identity = Invoke-DockerText @('exec', '--user', 'postgres', $containerName, 'psql', '--no-psqlrc', '--username', $databaseUser, '--tuples-only', '--no-align', '--dbname', $databaseName, '--command=SELECT current_database(), current_user, current_setting(''server_version'')')
if ($identity -notmatch '^plants_phase1023_test\|plants_test\|16\.15(?:\s|$)') {
  throw 'PostgreSQL identity query did not match the approved disposable database and version.'
}
Write-Host "Verified isolated target: $identity; image=$imageName; tmpfs only; loopback=127.0.0.1:$hostPort; network=$networkName"

$passwordEntry = @($container.Config.Env | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' })
if ($passwordEntry.Count -ne 1 -or $passwordEntry[0].Length -le 'POSTGRES_PASSWORD='.Length) {
  throw 'Disposable container does not have exactly one dedicated test password.'
}
$password = $passwordEntry[0].Substring('POSTGRES_PASSWORD='.Length)
$escapedPassword = [Uri]::EscapeDataString($password)
$connectionString = "postgresql://${databaseUser}:${escapedPassword}@127.0.0.1:${hostPort}/${databaseName}?schema=public"
$env:PLANTS_E2E_DATABASE_URL = $connectionString
$env:DATABASE_URL = $connectionString
$env:PLANTS_E2E_PREFLIGHT_VERIFIED = 'greenhouse-plants-test-pg-1023:16.15:tmpfs'

Push-Location $apiRoot
try {
  Write-Host 'Applying existing Prisma migrations to the verified disposable database.'
  & npx prisma migrate deploy --schema prisma/schema.prisma
  if ($LASTEXITCODE -ne 0) { throw "Prisma migrate deploy failed with exit code $LASTEXITCODE." }

  Write-Host 'Running isolated Plants HTTP integration tests.'
  & npx vitest run --config vitest.config.plants-e2e.ts
  if ($LASTEXITCODE -ne 0) { throw "Plants HTTP integration tests failed with exit code $LASTEXITCODE." }
}
finally {
  Pop-Location
  Remove-Item Env:PLANTS_E2E_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PLANTS_E2E_PREFLIGHT_VERIFIED -ErrorAction SilentlyContinue
}
