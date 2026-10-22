#!/usr/bin/env bash
# Explicit maintenance operation. It will interrupt VPN connections briefly.
set -euo pipefail
if [ "$EUID" -ne 0 ]; then echo 'Run as root'; exit 1; fi
TARGET=/etc/wireguard/usc0.conf
if [ ! -f "$TARGET" ]; then echo 'No existing usc0.conf'; exit 2; fi
if grep -q 'USC_FORWARD' "$TARGET"; then echo 'Already uses isolated v0.5 firewall'; exit 0; fi
if ! grep -Fxq 'PostUp = iptables -A FORWARD -i usc0 -o usc0 -j ACCEPT' "$TARGET" || \
   ! grep -Fxq 'PostDown = iptables -D FORWARD -i usc0 -o usc0 -j ACCEPT' "$TARGET"; then
 echo 'Unknown firewall configuration; refusing automated modification.'; exit 3
fi
BACKUP="${TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
cp -p "$TARGET" "$BACKUP"
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
s=s.replace('PostUp = iptables -A FORWARD -i usc0 -o usc0 -j ACCEPT', '''PostUp = iptables -N USC_FORWARD; iptables -A USC_FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A USC_FORWARD -d 10.77.0.1/32 -p tcp -m multiport --dports 3100,7880,7881 -j ACCEPT; iptables -A USC_FORWARD -d 10.77.0.1/32 -p udp --dport 7882 -j ACCEPT; iptables -A USC_FORWARD -j DROP; iptables -I FORWARD 1 -i usc0 -o usc0 -j USC_FORWARD''')
s=s.replace('PostDown = iptables -D FORWARD -i usc0 -o usc0 -j ACCEPT', 'PostDown = iptables -D FORWARD -i usc0 -o usc0 -j USC_FORWARD; iptables -F USC_FORWARD; iptables -X USC_FORWARD')
p.write_text(s)
PY
chmod 600 "$TARGET"
echo "Backup: $BACKUP"
echo 'Restarting WireGuard; active streams will disconnect temporarily...'
systemctl restart wg-quick@usc0.service
echo 'v0.5 isolated firewall enabled. Verify: iptables -S USC_FORWARD'
