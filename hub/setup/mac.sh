#!/bin/bash
# SpiritHUB local AI setup for Mac. One command in Terminal does all of it:
#   curl -fsSL https://prabhaskodela.github.io/Spirit/hub/setup/mac.sh | bash
# It installs Ollama if needed, lets the SpiritHUB website talk to it (kept after restarts),
# restarts Ollama, downloads the AI model, and checks that SpiritHUB can reach it.
set -euo pipefail

SITE="${SPIRITHUB_SITE:-https://prabhaskodela.github.io}"
MODEL="${SPIRITHUB_MODEL:-qwen3.5:4b}"
API="http://127.0.0.1:11434"
OLLAMA="/Applications/Ollama.app/Contents/Resources/ollama"
AGENT="$HOME/Library/LaunchAgents/com.spirithub.ollama-origins.plist"

step() { printf '\n\033[1;35m%s\033[0m\n' "$1"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
stop() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || stop "This command is for Mac. On Windows, use the PowerShell command instead."
free_gb=$(( $(df -k "$HOME" | awk 'NR == 2 {print $4}') / 1024 / 1024 ))
[ "$free_gb" -ge 5 ] || stop "Only ${free_gb} GB of disk space is free. The AI needs about 5 GB, so free up some space and run this again."

step "1 of 4 · Ollama"
if [ -d /Applications/Ollama.app ]; then
  ok "Already installed"
else
  echo "  Installing Ollama with its official installer (about 230 MB). It may ask for your Mac password."
  curl -fsSL https://ollama.com/install.sh | OLLAMA_NO_START=1 sh
  ok "Installed"
fi

step "2 of 4 · Let SpiritHUB talk to Ollama"
current="$(launchctl getenv OLLAMA_ORIGINS || true)"
case ",$current," in
  *",$SITE,"*) origins="$current" ;;
  ",,") origins="$SITE" ;;
  *) origins="$current,$SITE" ;;
esac
launchctl setenv OLLAMA_ORIGINS "$origins"
# A Mac forgets launchctl settings when it restarts, so a small login item sets it again and reopens Ollama with it.
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.spirithub.ollama-origins</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>/bin/launchctl setenv OLLAMA_ORIGINS '$origins'; /usr/bin/pkill -x Ollama; /bin/sleep 2; /usr/bin/open -ga Ollama</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
ok "Allowed $SITE (also after restarts)"

step "3 of 4 · Restart Ollama with this setting"
pkill -x Ollama 2>/dev/null || true
pkill -x ollama 2>/dev/null || true # a server started from Terminal instead of the app
sleep 2
open -ga Ollama
for _ in $(seq 30); do
  curl -fs "$API/api/version" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "$API/api/version" >/dev/null 2>&1 || stop "Ollama didn't start. Open Ollama from Applications, then run this command again."
ok "Ollama is running"

step "4 of 4 · Download the AI model ($MODEL, about 3.4 GB)"
"$OLLAMA" pull "$MODEL"
ok "Model ready"

allowed="$(curl -s -o /dev/null -D - -H "Origin: $SITE" "$API/api/version" | tr -d '\r' | awk -F': ' 'tolower($1) == "access-control-allow-origin" {print $2}' || true)"
if [ "$allowed" = "$SITE" ] || [ "$allowed" = "*" ]; then
  ok "SpiritHUB can reach your AI"
else
  echo "  ! Ollama isn't allowing SpiritHUB yet. Quit Ollama from the menu bar, open it again, then press Test connection."
fi

printf '\n\033[1;32mAll set!\033[0m In SpiritHUB, click ⚙ next to your name, then Test connection, then Save.\n\n'
