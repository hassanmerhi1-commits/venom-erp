$ErrorActionPreference = "Stop"

$root  = "c:\Users\user\Desktop\VENOM-ERP-win32-x64-v2"
$ex    = Join-Path $root "_asar_extracted"
$web   = Join-Path $ex "web"
$rel   = Join-Path $root "dev-server\electron-app\release\installer\win-unpacked"
$res   = Join-Path $rel "resources"
$stash = Join-Path $root "_nm_stash"
$build = Join-Path $ex "build"
$iconPng = Join-Path $build "icon.png"
$iconIco = Join-Path $build "icon.ico"
$venomPng = Join-Path $web "src\assets\venom-icon.png"
$exe = Join-Path $rel "VENOM ERP.exe"

Write-Host "==> Stopping running app (if any)..."
Stop-Process -Name "VENOM ERP" -Force -ErrorAction SilentlyContinue
Stop-Process -Name VENOM-ERP -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Write-Host "==> Ensuring app icon..."
New-Item -ItemType Directory -Force -Path $build | Out-Null
if (-not (Test-Path $iconPng)) {
  if (-not (Test-Path $venomPng)) { throw "Missing icon source: $venomPng" }
  Copy-Item $venomPng $iconPng -Force
}
Push-Location $ex
node build/make-ico.cjs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Icon conversion failed" }
Pop-Location

Write-Host "==> Building web (vite)..."
Push-Location $web
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Build failed" }
Pop-Location

if (-not (Test-Path $exe)) {
  Write-Host "==> Branded exe missing - building win-unpacked (first run may take a few minutes)..."
  Push-Location $ex
  npm run dist
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "electron-builder failed" }
  Pop-Location
  if (-not (Test-Path $exe)) { throw "Expected exe not found: $exe" }
}

Write-Host "==> Packing app.asar (node_modules excluded)..."
New-Item -ItemType Directory -Force -Path $res | Out-Null
if (Test-Path $stash) { Move-Item $stash (Join-Path $web "node_modules") -Force }
if (Test-Path (Join-Path $web "node_modules")) {
  Move-Item (Join-Path $web "node_modules") $stash
}
try {
  npx --yes @electron/asar pack $ex (Join-Path $res "app.asar")
  Copy-Item $iconIco (Join-Path $res "icon.ico") -Force
} finally {
  if (Test-Path $stash) { Move-Item $stash (Join-Path $web "node_modules") }
}

Write-Host "==> Done. Launching VENOM ERP..."
Start-Process -FilePath $exe
