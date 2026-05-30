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
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  gh auth status *> $null
  if ($LASTEXITCODE -eq 0) { $loggedIn = $true }
} catch { $loggedIn = $false }

if (-not $loggedIn) {
  Write-Host "Not logged into GitHub yet - complete login in the browser window."
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { throw "GitHub login failed or was cancelled" }
}

$owner = (gh api user -q .login 2>$null).Trim()
if (-not $owner) { throw "Could not read GitHub username - run: gh auth login" }
Write-Host "GitHub user: $owner"

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
if (-not $cfg.owner) { $cfg.owner = $owner }
if (-not $cfg.repo) { $cfg.repo = "venom-erp" }

$repo = "$($cfg.owner)/$($cfg.repo)"
Write-Host "Repository: $repo"

function Write-JsonNoBom($Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 20
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $json, $utf8)
}

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$pkg.build.publish = [ordered]@{
  provider = "github"
  owner    = $cfg.owner
  repo     = $cfg.repo
}
Write-JsonNoBom $pkgPath $pkg
Write-JsonNoBom $cfgPath $cfg

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
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
$repoExists = $false
try {
  gh repo view $repo *> $null
  if ($LASTEXITCODE -eq 0) { $repoExists = $true }
} catch { $repoExists = $false }

if (-not $repoExists) {
  $vis = if ($cfg.private) { "--private" } else { "--public" }
  gh repo create $cfg.repo $vis --source=. --remote=origin --description "VENOM ERP - offline desktop ERP"
} else {
  $remotes = git remote
  if ($remotes -notcontains "origin") {
    git remote add origin "https://github.com/$repo.git"
  } elseif ((git remote get-url origin) -notmatch $cfg.owner) {
    git remote set-url origin "https://github.com/$repo.git"
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
  Write-Host "Release published - colleagues download Setup.exe from Releases; updates are automatic."
} else {
  Write-Host ""
  Write-Host "Next - publish installer to GitHub Releases (turns on auto-update):"
  Write-Host '  powershell -ExecutionPolicy Bypass -File push-to-github.ps1 -PublishRelease'
}
