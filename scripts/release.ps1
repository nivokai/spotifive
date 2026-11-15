<#
.SYNOPSIS
  Publie une nouvelle version de Spotifive : tous les utilisateurs la recoivent automatiquement.

.DESCRIPTION
  1. ecrit le numero de version dans le projet
  2. compile l'application et signe l'installeur avec la cle privee
  3. cree la version sur GitHub avec l'installeur et le fichier latest.json
     que les applications deja installees consultent pour se mettre a jour

  (Ce fichier est volontairement ecrit sans accents : Windows PowerShell 5.1 les lit mal.)

.EXAMPLE
  .\scripts\release.ps1 -Version 0.2.0 -Notes "Nouvelle page Radios"

.EXAMPLE
  .\scripts\release.ps1 -Version 0.2.0 -BuildOnly      # compile sans rien publier
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version,

  [string]$Notes = "Ameliorations et corrections.",

  [string]$Repo = "nivokai/spotifive",

  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$utf8 = New-Object System.Text.UTF8Encoding $false

$keyFile = "$env:USERPROFILE\.tauri\spotifive.key"
$passwordFile = "$keyFile.password"
if (-not (Test-Path $keyFile) -or -not (Test-Path $passwordFile)) {
  throw "Cle de signature introuvable ($keyFile). Sans elle, impossible de publier une mise a jour."
}

function Set-FirstMatch([string]$Path, [string]$Pattern, [string]$Replacement) {
  $text = [IO.File]::ReadAllText($Path)
  $regex = New-Object System.Text.RegularExpressions.Regex($Pattern, 'Multiline')
  if (-not $regex.IsMatch($text)) { throw "Numero de version introuvable dans $Path" }
  [IO.File]::WriteAllText($Path, $regex.Replace($text, $Replacement, 1), $utf8)
}

Write-Host "==> Version $Version" -ForegroundColor Cyan
Set-FirstMatch "$root\src-tauri\tauri.conf.json" '"version":\s*"[^"]+"' "`"version`": `"$Version`""
Set-FirstMatch "$root\package.json" '"version":\s*"[^"]+"' "`"version`": `"$Version`""
Set-FirstMatch "$root\src-tauri\Cargo.toml" '^version\s*=\s*"[^"]+"' "version = `"$Version`""

# Si Spotifive tourne depuis le dossier de compilation, son exe est verrouille et la compilation echoue.
# Windows autorise a renommer un exe en cours d'execution : on libere ainsi le nom sans fermer l'application.
$release = "$root\src-tauri\target\release"
Get-ChildItem "$release\spotifive-ancien*.exe" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
if (Test-Path "$release\spotifive.exe") {
  try {
    $stream = [IO.File]::Open("$release\spotifive.exe", 'Open', 'ReadWrite', 'None')
    $stream.Close()
  } catch {
    Rename-Item "$release\spotifive.exe" "spotifive-ancien-$([DateTime]::Now.Ticks).exe"
  }
}

Write-Host "==> Compilation et signature (quelques minutes)" -ForegroundColor Cyan
$env:TAURI_SIGNING_PRIVATE_KEY = ([IO.File]::ReadAllText($keyFile)).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ([IO.File]::ReadAllText($passwordFile)).Trim()
$env:CI = "true"
if (-not (Test-Path "$root\node_modules")) { npm install --no-fund --no-audit }
npx tauri build
if ($LASTEXITCODE -ne 0) { throw "La compilation a echoue." }

$bundle = "$root\src-tauri\target\release\bundle\nsis"
$setupName = "Spotifive_${Version}_x64-setup.exe"
$setup = Join-Path $bundle $setupName
$signatureFile = "$setup.sig"
if (-not (Test-Path $setup)) { throw "Installeur introuvable : $setup" }
if (-not (Test-Path $signatureFile)) { throw "Signature introuvable : $signatureFile" }

# Le fichier que chaque application installee lit pour savoir s'il existe une version plus recente.
$latest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = ([IO.File]::ReadAllText($signatureFile)).Trim()
      url       = "https://github.com/$Repo/releases/download/v$Version/$setupName"
    }
  }
}
$latestFile = Join-Path $bundle "latest.json"
[IO.File]::WriteAllText($latestFile, ($latest | ConvertTo-Json -Depth 5), $utf8)

Write-Host "==> Installeur : $setup" -ForegroundColor Green
if ($BuildOnly) {
  Write-Host "Compilation seule : rien n'a ete publie." -ForegroundColor Yellow
  return
}

Write-Host "==> Publication sur GitHub ($Repo)" -ForegroundColor Cyan
if (Test-Path "$root\.git") {
  git add -A
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -m "Version $Version" | Out-Null }
  git push origin HEAD
  if ($LASTEXITCODE -ne 0) { throw "Envoi du code vers GitHub impossible." }
}
gh release create "v$Version" $setup $latestFile --repo $Repo --title "Spotifive $Version" --notes $Notes
if ($LASTEXITCODE -ne 0) { throw "Creation de la version GitHub impossible." }

Write-Host "Version $Version publiee. Les applications installees la proposeront au prochain demarrage." -ForegroundColor Green
