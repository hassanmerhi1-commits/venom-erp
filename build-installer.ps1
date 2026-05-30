param(
  [string]$UpdateUrl = "",
  [switch]$SkipInstall,
  [switch]$Publish
)

$ErrorActionPreference = "Stop"

$root = "c:\Users\user\Desktop\VENOM-ERP-win32-x64-v2"
$ex   = Join-Path $root "_asar_extracted"
$web  = Join-Path $ex "web"
$out  = Join-Path $root "dev-server\electron-app\release\installer"
$upload = Join-Path $root "updates-upload"

Write-Host "==> Stopping running app (if any)..."
Stop-Process -Name "VENOM ERP" -Force -ErrorAction SilentlyContinue
Stop-Process -Name VENOM-ERP -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

if ($UpdateUrl) {
  Write-Host "==> Setting update URL: $UpdateUrl"
  & (Join-Path $root "set-update-url.ps1") -Url $UpdateUrl
}

Write-Host "==> Converting icon PNG -> ICO for Windows installer..."
Push-Location $ex
node build/make-ico.cjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Icon conversion failed" }
# Vite walks up to parent package.json — strip UTF-8 BOM if present
$pkgJson = Join-Path $ex "package.json"
$bytes = [System.IO.File]::ReadAllBytes($pkgJson)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
  [System.IO.File]::WriteAllBytes($pkgJson, $bytes[3..($bytes.Length - 1)])
}
Pop-Location

Write-Host "==> Building web (vite)..."
Push-Location $web
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Web build failed" }
Pop-Location

Push-Location $ex
if (-not $SkipInstall -or -not (Test-Path (Join-Path $ex "node_modules\electron-builder"))) {
  Write-Host "==> Installing electron + electron-builder (first run may take a few minutes)..."
  npm install
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "npm install failed" }
}

Write-Host "==> Building NSIS installer..."
if ($Publish) {
  npm run dist -- --publish always
} else {
  npm run dist
}
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "electron-builder failed" }
Pop-Location

Write-Host "==> Preparing upload folder..."
New-Item -ItemType Directory -Force -Path $upload | Out-Null
Get-ChildItem $out -Filter "*.exe" | ForEach-Object { Copy-Item $_.FullName $upload -Force }
Get-ChildItem $out -Filter "latest.yml" | ForEach-Object { Copy-Item $_.FullName $upload -Force }

$setup = Get-ChildItem $upload -Filter "*.exe" | Select-Object -First 1
Write-Host ""
Write-Host "========================================"
Write-Host " DONE"
Write-Host " Installer: $($setup.FullName)"
Write-Host " Upload folder: $upload"
Write-Host "   -> copy BOTH files to your update server:"
Write-Host "      - latest.yml"
Write-Host "      - $($setup.Name)"
Write-Host ""
Write-Host " Colleagues: run Setup once. Future updates download automatically."
Write-Host "========================================"

if ($setup) {
  explorer.exe $upload
}
