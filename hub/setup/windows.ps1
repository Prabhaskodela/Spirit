# SpiritHUB local AI setup for Windows. One command in PowerShell does all of it:
#   irm https://prabhaskodela.github.io/Spirit/hub/setup/windows.ps1 | iex
# It installs Ollama if needed, lets the SpiritHUB website talk to it (kept after restarts),
# restarts Ollama, downloads the AI model, and checks that SpiritHUB can reach it.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # the download progress bar makes Windows PowerShell download far slower

$Site = if ($env:SPIRITHUB_SITE) { $env:SPIRITHUB_SITE } else { "https://prabhaskodela.github.io" }
$Model = if ($env:SPIRITHUB_MODEL) { $env:SPIRITHUB_MODEL } else { "qwen3.5:4b" }
$Api = "http://127.0.0.1:11434"

function Step($text) { Write-Host ""; Write-Host $text -ForegroundColor Magenta }
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Assert-FreeSpace($gb, $what) {
  $free = [math]::Floor((Get-PSDrive -Name $env:SystemDrive.TrimEnd(":")).Free / 1GB)
  if ($free -lt $gb) { throw "Only $free GB of disk space is free on $($env:SystemDrive), and $what needs about $gb GB. Free up some space, then run this again." }
}

Step "1 of 4 - Ollama"
$found = Get-Command ollama -ErrorAction SilentlyContinue
$exe = if ($found) { $found.Source } else { Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe" }
if (Test-Path $exe) {
  Ok "Already installed"
} else {
  Assert-FreeSpace 8 "installing Ollama"
  Write-Host "  Downloading Ollama's official installer (about 1.7 GB). This can take a while..."
  $setup = Join-Path $env:TEMP "OllamaSetup.exe"
  Invoke-WebRequest "https://ollama.com/download/OllamaSetup.exe" -OutFile $setup -UseBasicParsing
  Write-Host "  Installing..."
  Start-Process $setup -ArgumentList "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES" -Wait
  Remove-Item $setup -ErrorAction SilentlyContinue
  if (-not (Test-Path $exe)) { throw "Ollama didn't install. Install it from https://ollama.com/download, then run this command again." }
  Ok "Installed"
}

Step "2 of 4 - Let SpiritHUB talk to Ollama"
$current = [Environment]::GetEnvironmentVariable("OLLAMA_ORIGINS", "User")
if (-not $current) { $origins = $Site }
elseif (($current -split ",") -contains $Site) { $origins = $current }
else { $origins = "$current,$Site" }
# A user setting stays after restarts; this window needs it too, so Ollama started below picks it up.
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", $origins, "User")
$env:OLLAMA_ORIGINS = $origins
Ok "Allowed $Site (also after restarts)"

Step "3 of 4 - Restart Ollama with this setting"
Get-Process -Name "ollama app", "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$tray = Join-Path (Split-Path $exe) "ollama app.exe"
if (Test-Path $tray) { Start-Process $tray } else { Start-Process $exe -ArgumentList "serve" -WindowStyle Hidden }
$ready = $false
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
  try { Invoke-RestMethod "$Api/api/version" | Out-Null; $ready = $true } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw "Ollama didn't start. Open Ollama from the Start menu, then run this command again." }
Ok "Ollama is running"

Step "4 of 4 - The AI model ($Model)"
$haveModel = $true
try { Invoke-RestMethod "$Api/api/show" -Method Post -ContentType "application/json" -Body (@{ model = $Model } | ConvertTo-Json) | Out-Null } catch { $haveModel = $false }
if ($haveModel) {
  Ok "Already downloaded"
} else {
  Assert-FreeSpace 4 "the AI model"
  Write-Host "  Downloading (about 3.4 GB)..."
  & $exe pull $Model
  if ($LASTEXITCODE -ne 0) { throw "The model download didn't finish. Check your internet connection, then run this command again." }
  Ok "Model ready"
}

try {
  $check = Invoke-WebRequest "$Api/api/version" -Headers @{ Origin = $Site } -UseBasicParsing
  $allowed = $check.Headers["Access-Control-Allow-Origin"]
} catch {
  $allowed = $null
}
if ($allowed -eq $Site -or $allowed -eq "*") {
  Ok "SpiritHUB can reach your AI"
} else {
  Write-Host "  !   Ollama isn't allowing SpiritHUB yet. Quit Ollama from the taskbar tray, open it again, then press Test connection." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All set! In SpiritHUB, click the gear next to your name, then Test connection, then Save." -ForegroundColor Green
Write-Host ""
