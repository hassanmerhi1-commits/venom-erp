param(
  [Parameter(Mandatory = $true)]
  [string]$Url
)

$ErrorActionPreference = "Stop"

if ($Url -notmatch "/$") { $Url = "$Url/" }

$pkgPath = "c:\Users\user\Desktop\VENOM-ERP-win32-x64-v2\_asar_extracted\package.json"
$content = Get-Content $pkgPath -Raw
$content = $content -replace '("provider":\s*"generic",\s*"url":\s*")[^"]*(")', "`${1}$Url`${2}"
Set-Content $pkgPath $content -Encoding UTF8 -NoNewline

Write-Host "Update URL set to: $Url"
Write-Host "Rebuild with build-installer.ps1 so the installer embeds this URL."
