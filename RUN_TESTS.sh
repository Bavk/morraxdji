#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node --test server/*.test.mjs server/test.mjs windows/*.test.cjs windows/renderer/*.test.mjs relay/*.test.mjs
node scripts/source-audit.mjs
node scripts/repo-safety.mjs
node --check windows/main.cjs
node --check windows/smoke.cjs
node --check windows/preload.cjs
node --check windows/compose-config.cjs
node --check windows/server-recovery.cjs
node --check windows/renderer/main.js
node --check server/server.mjs
node --check relay/relay.mjs
bash -n relay/install-relay-ubuntu.sh relay/migrate-firewall-v0.4-to-v0.5.sh
python3 - <<'PY'
import xml.etree.ElementTree as ET
from pathlib import Path
for f in Path('android/app/src').rglob('*.xml'): ET.parse(f)
print('Android XML: OK')
PY
printf '\nNote: this is NOT an EXE/APK build or a real streaming/VPN test.\n'
