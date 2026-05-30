$ErrorActionPreference = "Stop"

$root  = "c:\Users\user\Desktop\VENOM-ERP-win32-x64-v2"
$ex    = Join-Path $root "_asar_extracted"
$web   = Join-Path $ex "web"
$rel   = Join-Path $root "dev-server\electron-app\release\VENOM-ERP-win32-x64"
$res   = Join-Path $rel "resources"
$stash = Join-Path $root "_nm_stash"

Write-Host "==> Stopping running app (if any)..."
Stop-Process -Name VENOM-ERP -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "==> Building web (vite)..."
Push-Location $web
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Build failed" }
Pop-Location

Write-Host "==> Packing app.asar (node_modules excluded)..."
if (Test-Path $stash) { Move-Item $stash (Join-Path $web "node_modules") -Force }
Move-Item (Join-Path $web "node_modules") $stash
try {
  npx --yes @electron/asar pack $ex (Join-Path $res "app.asar")
} finally {
  Move-Item $stash (Join-Path $web "node_modules")
}

Write-Host "==> Done. Launching app..."
Start-Process -FilePath (Join-Path $rel "VENOM-ERP.exe")
