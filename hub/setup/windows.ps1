# SpiritHUB local AI setup for Windows. One command in Command Prompt or PowerShell does all of it:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object Net.WebClient).DownloadString('https://prabhaskodela.github.io/Spirit/hub/setup/windows.ps1'))"
# It installs Ollama if needed, lets the SpiritHUB website talk to it (kept after restarts),
# restarts Ollama, downloads the AI model, and checks that SpiritHUB can reach it.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # PowerShell's own progress bar makes its downloads far slower; big ones use curl instead
# Older Windows PowerShell may leave TLS 1.2 off, and ollama.com and GitHub require it.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072

$Site = if ($env:SPIRITHUB_SITE) { $env:SPIRITHUB_SITE } else { "https://prabhaskodela.github.io" }
$Model = if ($env:SPIRITHUB_MODEL) { $env:SPIRITHUB_MODEL } else { "qwen3.5:4b" }
$Api = "http://127.0.0.1:11434"

function Step($text) { Write-Host ""; Write-Host $text -ForegroundColor Magenta }
function Ok($text) { Write-Host "  OK  $text" -ForegroundColor Green }
function Assert-FreeSpace($gb, $what) {
  $free = [math]::Floor((Get-PSDrive -Name $env:SystemDrive.TrimEnd(":")).Free / 1GB)
  if ($free -lt $gb) { throw "Only $free GB of disk space is free on $($env:SystemDrive), and $what needs about $gb GB. Free up some space, then run this again." }
}

# Where Ollama is installed, or nothing. Its installer adds it to PATH, but this window
# doesn't see PATH changes made after it opened, so look in the usual folders too.
function Find-Ollama {
  $found = Get-Command ollama -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { return $found.Source }
  foreach ($path in @((Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"), (Join-Path $env:ProgramFiles "Ollama\ollama.exe"))) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

# Downloads a big file with a progress bar: curl.exe comes with Windows 10 and 11, and BITS is the fallback.
function Save-Download($url, $path) {
  Remove-Item $path -ErrorAction SilentlyContinue
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($curl) {
    & $curl.Source -L --fail --retry 3 -o $path $url
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host "  That download stopped. Trying another way..." -ForegroundColor Yellow
    Remove-Item $path -ErrorAction SilentlyContinue
  }
  try {
    $ProgressPreference = "Continue" # BITS shows a progress bar without slowing down
    Start-BitsTransfer -Source $url -Destination $path -DisplayName "Downloading Ollama"
  } catch {
    $ProgressPreference = "SilentlyContinue"
    Write-Host "  Downloading without a progress bar. Leave this window open; it can take 10 to 30 minutes..." -ForegroundColor Yellow
    Invoke-WebRequest $url -OutFile $path -UseBasicParsing
  }
}

Step "1 of 4 - Ollama"
$exe = Find-Ollama
if ($exe) {
  Ok "Already installed"
} else {
  Assert-FreeSpace 8 "installing Ollama"
  Write-Host "  Downloading Ollama's official installer (about 1.7 GB). The progress shows below."
  $setup = Join-Path $env:TEMP "OllamaSetup.exe"
  Save-Download "https://ollama.com/download/OllamaSetup.exe" $setup
  if ((Get-Item $setup).Length -lt 100MB) { throw "The Ollama download was cut off. Check your internet connection, then run this command again." }
  Write-Host "  Installing Ollama. A small window shows the progress..."
  # Wait for the installer itself only: it starts the Ollama app at the end, and that keeps running.
  $installer = Start-Process $setup -ArgumentList "/SILENT", "/NORESTART", "/SUPPRESSMSGBOXES" -PassThru
  $null = $installer.Handle # lets Windows PowerShell read the exit code afterwards
  $installer.WaitForExit()
  Remove-Item $setup -ErrorAction SilentlyContinue
  $exe = Find-Ollama
  if (-not $exe) { throw "Ollama didn't install (the installer stopped with code $($installer.ExitCode)). Install it from https://ollama.com/download, then run this command again." }
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
