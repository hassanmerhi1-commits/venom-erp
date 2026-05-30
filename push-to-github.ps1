param(
  [switch]$PublishRelease
)

$ErrorActionPreference = "Stop"
$root = "c:\Users\user\Desktop\VENOM-ERP-win32-x64-v2"
$cfgPath = Join-Path $root "github-config.json"
$pkgPath = Join-Path $root "_asar_extracted\package.json"

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue

Write-Host "==> Checking GitHub login..."
$loggedIn = $false
try {
  gh auth status *> $null
  if ($LASTEXITCODE -eq 0) { $loggedIn = $true }
} catch { $loggedIn = $false }

if (-not $loggedIn) {
  Write-Host "Not logged into GitHub yet — complete login in the browser window."
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw "GitHub login failed or was cancelled" }
}

$owner = (gh api user -q .login).Trim()
Write-Host "GitHub user: $owner"

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
if (-not $cfg.owner) { $cfg.owner = $owner }
if (-not $cfg.repo) { $cfg.repo = "venom-erp" }
$cfg | ConvertTo-Json | Set-Content $cfgPath -Encoding UTF8

$repo = "$($cfg.owner)/$($cfg.repo)"
Write-Host "Repository: $repo"

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.build.publish = [ordered]@{
  provider = "github"
  owner    = $cfg.owner
  repo     = $cfg.repo
}
$pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8

Write-Host "==> Initializing git (if needed)..."
Push-Location $root
if (-not (Test-Path ".git")) { git init -b main }

Write-Host "==> Committing source..."
git add -A
$status = git status --porcelain
if ($status) {
  git commit -m "$( @'
Add VENOM ERP with installer and GitHub auto-update.

Desktop ERP for purchases, sales, stock, accounts, and reports; ships as NSIS installer with electron-updater via GitHub Releases.
'@ )"
}

Write-Host "==> Creating GitHub repo (if needed) and pushing..."
gh repo view $repo 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  $vis = if ($cfg.private) { "--private" } else { "--public" }
  gh repo create $cfg.repo $vis --source=. --remote=origin --description "VENOM ERP — offline desktop ERP"
} else {
  $remotes = git remote
  if ($remotes -notcontains "origin") {
    git remote add origin "https://github.com/$repo.git"
  }
}

git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Pop-Location
  throw "git push failed"
}
Pop-Location

Write-Host "==> Source pushed: https://github.com/$repo"

if ($PublishRelease) {
  Write-Host "==> Building installer and publishing GitHub Release..."
  $env:GH_TOKEN = gh auth token
  & (Join-Path $root "build-installer.ps1") -SkipInstall -Publish
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  Write-Host "Release published — colleagues download Setup.exe from Releases; updates are automatic."
} else {
  Write-Host ""
  Write-Host "Next — publish installer to GitHub Releases (turns on auto-update):"
  Write-Host "  powershell -ExecutionPolicy Bypass -File push-to-github.ps1 -PublishRelease"
}
