param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string] $ExpectedContainerId,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string] $ExpectedNetworkId,
  [Parameter(Mandatory)][string] $ExpectedServerAddress,
  [Parameter(Mandatory)][string] $DatabaseName,
  [Parameter(Mandatory)][string] $DatabaseRole,
  [Parameter(Mandatory)][ValidatePattern('^(CHG|CHANGE|APPROVAL|RFC|SEC)-[A-Z0-9][A-Z0-9-]{1,59}$')][string] $ChangeReference,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string] $ExpectedMigrationManifestSha256,
  [Parameter(Mandatory)][string] $ConfirmTarget
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$containerName = 'greenhouse-plants-test-pg-1023'
$networkName = 'greenhouse-plants-test-net-1023'
$imageName = 'postgres:16.15'
$hostIp = '127.0.0.1'
$hostPort = '55432'
$expectedRestartPolicy = 'no'
$expectedTmpfs = 'rw,noexec,nosuid,size=512m'
$expectedPostgresVersion = 160015
$requiredMigrations = @(
  '20261001064817_init_phase_4_greenhouse',
  '20261001073359_add_phase5_telemetry',
  '20261002032900_add_phase6_auth_users_memberships',
  '20261012120000_complete_control_command_audit',
  '20261014100000_phase10_1_plant_standardization',
  '20261015090000_phase10_4_2_research_registry',
  '20261015130000_phase10_4_2h_research_grant_admin'
)

$apiRoot = Split-Path -Parent $PSScriptRoot
$prismaRoot = Join-Path $apiRoot 'prisma'
$priorDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$migrationUrl = $null
$escapedPassword = $null
$password = $null
$prismaOutput = $null
$workDir = $null
$exitCode = 0

function Invoke-DockerJson([string[]] $Arguments) {
  $raw = & docker @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker preflight failed; no migration was run.'
  }
  try {
    return ConvertFrom-Json -InputObject ($raw -join "`n")
  } catch {
    throw 'Docker returned invalid preflight metadata; no migration was run.'
  }
}

function Invoke-PrismaProbe([string] $Source, [string] $FailureMessage) {
  $output = & node --input-type=module -e $Source 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  try {
    return ConvertFrom-Json -InputObject ($output -join "`n")
  } catch {
    throw $FailureMessage
  }
}

function Get-MigrationManifest([string] $Root) {
  $migrationRoot = Join-Path $Root 'migrations'
  $schemaFile = Join-Path $Root 'schema.prisma'
  $lockFile = Join-Path $migrationRoot 'migration_lock.toml'
  if (-not (Test-Path -LiteralPath $schemaFile -PathType Leaf) -or
      -not (Test-Path -LiteralPath $lockFile -PathType Leaf)) {
    throw 'Prisma schema or migration lock file is missing.'
  }

  $directories = @(Get-ChildItem -LiteralPath $migrationRoot -Directory | Sort-Object Name)
  if ($directories.Count -eq 0) { throw 'No local Prisma migrations were found.' }
  $migrationFiles = @()
  foreach ($directory in $directories) {
    $migrationFile = Join-Path $directory.FullName 'migration.sql'
    if (-not (Test-Path -LiteralPath $migrationFile -PathType Leaf)) {
      throw "Migration directory has no migration.sql: $($directory.Name)"
    }
    $migrationFiles += $migrationFile
  }

  $files = @($schemaFile, $lockFile) + $migrationFiles
  $entries = @(
    $files | ForEach-Object {
      $relativePath = [System.IO.Path]::GetRelativePath($Root, $_).Replace('\', '/')
      $fileHash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
      '{0}:{1}' -f $relativePath, $fileHash
    } | Sort-Object
  )
  $payload = [System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", [string[]]$entries))
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = [System.BitConverter]::ToString($sha256.ComputeHash($payload)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
  return [pscustomobject]@{ Names = @($directories | ForEach-Object { $_.Name }); Hash = $hash }
}

try {
  if ($DatabaseName -cne 'plants_phase1023_test' -or $DatabaseRole -cne 'plants_test') {
    throw 'Database name or role is not the fixed disposable test target.'
  }

  try {
    $parsedAddress = [System.Net.IPAddress]::Parse($ExpectedServerAddress)
  } catch {
    throw 'Expected server address is not a valid IPv4 address.'
  }
  if ($parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Expected server address is not a valid IPv4 address.'
  }

  $manifest = Get-MigrationManifest $prismaRoot
  $localMigrationNames = @($manifest.Names)
  $missingLocalRequired = @($requiredMigrations | Where-Object { $_ -notin $localMigrationNames })
  if ($missingLocalRequired.Count -gt 0) {
    throw 'One or more required integration-test migrations are missing locally.'
  }
  if ($manifest.Hash -cne $ExpectedMigrationManifestSha256) {
    throw 'Local schema/migration manifest did not match the reviewed hash.'
  }

  $expectedConfirmation = 'APPLY-ALL-PENDING-LOCAL-MIGRATIONS:{0}:{1}:{2}:{3}:{4}:{5}:{6}' -f `
    $ExpectedContainerId, $ExpectedNetworkId, $ExpectedServerAddress, `
    $DatabaseName, $DatabaseRole, $ChangeReference, $manifest.Hash
  if ($ConfirmTarget -cne $expectedConfirmation) {
    throw 'Explicit all-pending-migrations target confirmation did not match.'
  }

  $containerResult = Invoke-DockerJson @('inspect', $containerName)
  $container = @($containerResult)[0]
  if ($container.Id -cne $ExpectedContainerId -or
      $container.Config.Image -cne $imageName -or
      $container.State.Status -cne 'running' -or
      $container.State.Health.Status -cne 'healthy' -or
      $container.HostConfig.RestartPolicy.Name -cne $expectedRestartPolicy -or
      $container.Config.Labels.'codex.phase' -cne '10.2.3') {
    throw 'Container identity, image, purpose label, health, or restart policy did not match.'
  }
  if (@($container.Mounts).Count -ne 0 -or
      $container.HostConfig.Tmpfs.'/var/lib/postgresql/data' -cne $expectedTmpfs) {
    throw 'Container storage was not the expected tmpfs-only configuration.'
  }

  $bindings = @($container.NetworkSettings.Ports.'5432/tcp')
  if ($bindings.Count -ne 1 -or
      $bindings[0].HostIp -cne $hostIp -or
      $bindings[0].HostPort -cne $hostPort) {
    throw 'Container port was not bound only to the expected loopback address.'
  }

  $attachedNetworks = @($container.NetworkSettings.Networks.PSObject.Properties.Name)
  if ($attachedNetworks.Count -ne 1 -or $attachedNetworks[0] -cne $networkName) {
    throw 'Container network did not match the dedicated test network.'
  }

  $networkResult = Invoke-DockerJson @('network', 'inspect', $networkName)
  $network = @($networkResult)[0]
  if ($network.Id -cne $ExpectedNetworkId) {
    throw 'Network identity did not match the approved target.'
  }
  $networkMembers = @($network.Containers.PSObject.Properties.Name)
  if ($networkMembers.Count -ne 1 -or $networkMembers[0] -cne $ExpectedContainerId) {
    throw 'Dedicated network did not contain exactly the expected container.'
  }

  $containerAddress = $container.NetworkSettings.Networks.$networkName.IPAddress
  if ($containerAddress -cne $ExpectedServerAddress) {
    throw 'Container server address did not match the approved target.'
  }

  # Read the dedicated test credential into process memory only. Never print it
  # or pass it as a command-line argument.
  $passwordEntries = @($container.Config.Env | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' })
  $userEntries = @($container.Config.Env | Where-Object { $_ -like 'POSTGRES_USER=*' })
  $databaseEntries = @($container.Config.Env | Where-Object { $_ -like 'POSTGRES_DB=*' })
  if ($passwordEntries.Count -ne 1 -or
      $passwordEntries[0].Length -le 'POSTGRES_PASSWORD='.Length -or
      $userEntries.Count -ne 1 -or
      $userEntries[0] -cne "POSTGRES_USER=$DatabaseRole" -or
      $databaseEntries.Count -ne 1 -or
      $databaseEntries[0] -cne "POSTGRES_DB=$DatabaseName") {
    throw 'Dedicated test database environment metadata did not match.'
  }

  $password = $passwordEntries[0].Substring('POSTGRES_PASSWORD='.Length)
  $escapedPassword = [Uri]::EscapeDataString($password)
  $migrationUrl = "postgresql://${DatabaseRole}:${escapedPassword}@${hostIp}:${hostPort}/${DatabaseName}?schema=public"

  # Explicitly point Prisma and its child processes at the verified disposable
  # target. This script never reads .env or uses an inherited URL as a target.
  $env:DATABASE_URL = $migrationUrl

  $identityProbe = @'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ log: [] });
try {
  const rows = await db.$queryRaw`
    SELECT current_database() AS "database",
           current_user AS "role",
           inet_server_addr()::text AS "serverAddress",
           current_setting('server_version_num')::integer AS "serverVersion"
  `;
  process.stdout.write(JSON.stringify(rows[0]));
} catch {
  process.exitCode = 1;
} finally {
  try { await db.$disconnect(); } catch { process.exitCode = 1; }
}
'@

  Push-Location $apiRoot
  try {
    $identity = Invoke-PrismaProbe $identityProbe 'TCP database identity verification failed.'
  } finally {
    Pop-Location
  }

  if ($identity.database -cne $DatabaseName -or
      $identity.role -cne $DatabaseRole -or
      $identity.serverAddress -cne $ExpectedServerAddress -or
      [int]$identity.serverVersion -ne $expectedPostgresVersion) {
    throw 'Actual TCP database identity did not match the approved disposable target.'
  }

  $metadataProbe = @'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ log: [] });
try {
  const rows = await db.$queryRaw`SELECT to_regclass('public."_prisma_migrations"')::text AS "migrationTable"`;
  process.stdout.write(JSON.stringify(rows[0]));
} catch {
  process.exitCode = 1;
} finally {
  try { await db.$disconnect(); } catch { process.exitCode = 1; }
}
'@
  $inventoryProbe = @'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ log: [] });
try {
  const rows = await db.$queryRaw`
    SELECT n.nspname AS "schemaName", 'schema'::text AS "objectType", ''::text AS "objectName"
      FROM pg_namespace n
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'public')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'relation'::text, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')
        AND NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
    UNION ALL
    SELECT n.nspname, 'type'::text, t.typname
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'operator'::text, o.oprname
      FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'collation'::text, c.collname
      FROM pg_collation c JOIN pg_namespace n ON n.oid = c.collnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'conversion'::text, c.conname
      FROM pg_conversion c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'operator class'::text, c.opcname
      FROM pg_opclass c JOIN pg_namespace n ON n.oid = c.opcnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'operator family'::text, f.opfname
      FROM pg_opfamily f JOIN pg_namespace n ON n.oid = f.opfnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'routine'::text, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT n.nspname, 'extension'::text, e.extname
      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_'
    UNION ALL
    SELECT 'database'::text, 'event trigger'::text, e.evtname
      FROM pg_event_trigger e
    UNION ALL
    SELECT 'database'::text, 'foreign server'::text, s.srvname
      FROM pg_foreign_server s
    UNION ALL
    SELECT 'database'::text, 'publication'::text, p.pubname
      FROM pg_publication p
    UNION ALL
    SELECT 'database'::text, 'subscription'::text, s.subname
      FROM pg_subscription s
    ORDER BY 1, 2, 3
  `;
  process.stdout.write(JSON.stringify(rows));
} catch {
  process.exitCode = 1;
} finally {
  try { await db.$disconnect(); } catch { process.exitCode = 1; }
}
'@

  Push-Location $apiRoot
  try {
    $metadata = Invoke-PrismaProbe $metadataProbe 'Prisma migration metadata inspection failed.'
    $schemaInventory = @(Invoke-PrismaProbe $inventoryProbe 'Database schema inventory failed.')
  } finally {
    Pop-Location
  }
  if ($metadata.migrationTable) {
    throw 'Prisma migration metadata already exists; this preparer accepts only a fresh disposable database. Review its history and use a separately approved recovery path.'
  }
  if ($schemaInventory.Count -gt 0) {
    throw "Prisma metadata is absent but $($schemaInventory.Count) user schema objects were found; refusing to assume the database is empty. Review the catalog inventory and use a fresh disposable database."
  }

  Write-Host "Verified fresh disposable target: container=$ExpectedContainerId network=$ExpectedNetworkId database=$DatabaseName role=$DatabaseRole endpoint=${hostIp}:$hostPort server=$ExpectedServerAddress image=$imageName PostgreSQL=16.15 change=$ChangeReference"
  Write-Host "Approved local migration set ($($localMigrationNames.Count), manifest sha256=$($manifest.Hash)): $($localMigrationNames -join ', ')"

  # Stage only schema and migrations in a fresh temp folder. Prisma CLI is run
  # from that folder so the application .env files are not in its working path.
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  $workDir = Join-Path $tempRoot ("bootstrap-migrate-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $workDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $apiRoot 'prisma\schema.prisma') -Destination $workDir
  Copy-Item -LiteralPath (Join-Path $apiRoot 'prisma\migrations') -Destination $workDir -Recurse
  $stagedManifest = Get-MigrationManifest $workDir
  if ($stagedManifest.Hash -cne $manifest.Hash) {
    throw 'Staged schema/migrations changed after approval; no migration was run.'
  }

  $prismaCli = Join-Path $apiRoot 'node_modules\.bin\prisma.cmd'
  if (-not (Test-Path -LiteralPath $prismaCli -PathType Leaf)) {
    throw 'Local Prisma CLI is missing; no migration was run.'
  }

  Push-Location $workDir
  try {
    $prismaOutput = & $prismaCli migrate deploy --schema '.\schema.prisma' 2>&1
    $migrationExitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($migrationExitCode -ne 0) {
    throw 'Prisma migrate deploy failed; command output was suppressed to avoid credential disclosure.'
  }

  $migrationProbe = @'
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient({ log: [] });
try {
  const rows = await db.$queryRaw`
    SELECT migration_name AS "migrationName",
           finished_at IS NOT NULL AS "succeeded",
           rolled_back_at IS NOT NULL AS "rolledBack"
    FROM public."_prisma_migrations"
    ORDER BY migration_name
  `;
  process.stdout.write(JSON.stringify(rows));
} catch {
  process.exitCode = 1;
} finally {
  try { await db.$disconnect(); } catch { process.exitCode = 1; }
}
'@

  Push-Location $apiRoot
  try {
    $applied = @(Invoke-PrismaProbe $migrationProbe 'Post-migration read-only verification failed.')
  } finally {
    Pop-Location
  }

  $invalidRows = @($applied | Where-Object { -not $_.succeeded -or $_.rolledBack })
  if ($invalidRows.Count -gt 0) {
    throw 'Post-migration verification found failed, incomplete, or rolled-back migration records.'
  }
  $appliedNames = @($applied | ForEach-Object { $_.migrationName })
  $duplicateNames = @($appliedNames | Group-Object | Where-Object { $_.Count -ne 1 })
  if ($duplicateNames.Count -gt 0) {
    throw 'Post-migration verification found duplicate migration records.'
  }
  $unexpectedMigrations = @($appliedNames | Where-Object { $_ -notin $localMigrationNames })
  if ($unexpectedMigrations.Count -gt 0) {
    throw 'Post-migration verification found database migrations absent from the reviewed local directory.'
  }
  $missingMigrations = @($localMigrationNames | Where-Object { $_ -notin $appliedNames })
  if ($missingMigrations.Count -gt 0) {
    throw 'Post-migration verification did not find every local migration in successful state.'
  }
  $missingRequired = @($requiredMigrations | Where-Object { $_ -notin $appliedNames })
  if ($missingRequired.Count -gt 0) {
    throw 'Post-migration verification did not find every required integration-test migration.'
  }

  Write-Host "Migration preparation complete: $($localMigrationNames.Count) local migrations verified successful with no failed, incomplete, rolled-back, or unexpected records. No test suite or bootstrap was run."
} catch {
  [Console]::Error.WriteLine("Preparation failed: $($_.Exception.Message)")
  $exitCode = 1
} finally {
  if ($null -eq $priorDatabaseUrl) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:DATABASE_URL = $priorDatabaseUrl
  }

  $migrationUrl = $null
  $escapedPassword = $null
  $password = $null
  $prismaOutput = $null
  $priorDatabaseUrl = $null

  if ($workDir) {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedWorkDir = [System.IO.Path]::GetFullPath($workDir)
    if ($resolvedWorkDir.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedWorkDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

if ($exitCode -ne 0) { exit $exitCode }
