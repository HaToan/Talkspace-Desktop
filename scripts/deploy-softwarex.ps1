param(
  [string]$DeployHost = "192.168.101.43",
  [string]$DeployUser = "vxs",
  [string]$TargetDir = "/home/vxs/vxspace/nginx/html/software.x/talkspace/",
  [string]$ReleaseDir = "release",
  [string]$ManifestPath = ".deploy-softwarex-manifest.json"
)

$ErrorActionPreference = "Stop"

$releasePath = Resolve-Path -LiteralPath $ReleaseDir
$manifestFullPath = Join-Path (Get-Location) $ManifestPath

$patterns = @(
  "latest*.yml",
  "TalkSpace-Setup-*.exe",
  "TalkSpace-Setup-*.exe.blockmap",
  "TalkSpace-*.AppImage",
  "TalkSpace-*.AppImage.blockmap",
  "TalkSpace-*.dmg",
  "TalkSpace-*.zip"
)

$files = @()
foreach ($pattern in $patterns) {
  $files += Get-ChildItem -LiteralPath $releasePath -File -Filter $pattern -ErrorAction SilentlyContinue
}

$files = $files | Sort-Object FullName -Unique

if (-not $files -or $files.Count -eq 0) {
  throw "No deploy artifacts found in '$releasePath'. Build/package first."
}

$manifest = @{}
if (Test-Path -LiteralPath $manifestFullPath) {
  try {
    $rawManifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json
    if ($rawManifest) {
      foreach ($prop in $rawManifest.PSObject.Properties) {
        $manifest[$prop.Name] = $prop.Value
      }
    }
  } catch {
    Write-Host "Warning: could not parse manifest. A new one will be generated."
  }
}

$pendingFiles = @()
foreach ($file in $files) {
  $key = $file.Name
  $signature = "$($file.Length)|$($file.LastWriteTimeUtc.Ticks)"
  $prev = $manifest[$key]
  if ($null -eq $prev -or [string]$prev.signature -ne $signature) {
    $pendingFiles += [PSCustomObject]@{
      Name = $file.Name
      FullName = $file.FullName
      Signature = $signature
    }
  }
}

Write-Host "Deploy target: ${DeployUser}@${DeployHost}:${TargetDir}"
if (-not $pendingFiles -or $pendingFiles.Count -eq 0) {
  Write-Host "No changed artifacts detected. Nothing to upload."
  exit 0
}

Write-Host "Uploading $($pendingFiles.Count) changed file(s)..."
foreach ($file in $pendingFiles) {
  Write-Host " -> $($file.Name)"
}

$sourceFiles = @($pendingFiles | ForEach-Object { $_.FullName })
& scp @sourceFiles "${DeployUser}@${DeployHost}:${TargetDir}"
if ($LASTEXITCODE -ne 0) {
  throw "scp failed."
}

foreach ($file in $pendingFiles) {
  $manifest[$file.Name] = @{
    signature = $file.Signature
    uploadedAtUtc = [DateTime]::UtcNow.ToString("o")
  }
}

$manifestJson = ($manifest | ConvertTo-Json -Depth 6)
Set-Content -LiteralPath $manifestFullPath -Value $manifestJson -Encoding UTF8

Write-Host "Deploy completed. Manifest updated: $ManifestPath"
