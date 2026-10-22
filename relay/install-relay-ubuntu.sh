#!/usr/bin/env bash
# First-run provisioning on a NEW Ubuntu/Debian VPS with public IPv4.
# USAGE: sudo bash install-relay-ubuntu.sh vpn.example.com
set -euo pipefail
if [ "$EUID" -ne 0 ]; then echo 'Use sudo/root'; exit 1; fi
DOMAIN="${1:-}"
if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]] || [[ "$DOMAIN" != *.* ]]; then echo 'Usage: sudo bash install-relay-ubuntu.sh vpn.example.com'; exit 2; fi
if ! command -v node >/dev/null 2>&1; then echo 'First install Node.js >=20 and retry'; exit 3; fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then echo 'Node.js >=20 required'; exit 4; fi
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard wireguard-tools caddy openssl iptables
if ! command -v npm >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get install -y npm; fi
install -d -m 0700 /etc/universal-stream-relay
install -d -m 0755 /opt/universal-stream-relay
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install -m 0644 "$HERE/relay.mjs" /opt/universal-stream-relay/relay.mjs
install -m 0644 "$HERE/tunnel-transport.mjs" "$HERE/package.json" "$HERE/package-lock.json" /opt/universal-stream-relay/
npm ci --prefix /opt/universal-stream-relay --omit=dev --no-audit --no-fund
if [ ! -f /etc/universal-stream-relay/wg-privatekey ]; then
 umask 077
 wg genkey > /etc/universal-stream-relay/wg-privatekey
fi
WG_PRIVATE="$(cat /etc/universal-stream-relay/wg-privatekey)"
WG_PUBLIC="$(printf '%s' "$WG_PRIVATE" | wg pubkey)"
if [ -f /etc/wireguard/usc0.conf ]; then
 echo "Existing usc0.conf found: preserving it. Existing installs must manually apply the new peer-isolation firewall rules from README."
fi
if [ ! -f /etc/wireguard/usc0.conf ]; then
 umask 077
 cat > /etc/wireguard/usc0.conf <<ENDWG
[Interface]
Address = 10.77.0.254/24
ListenPort = 51820
PrivateKey = $WG_PRIVATE
# Peer isolation: clients can reach the Windows application ports only, not each other.
# Keep separate chain so deleting this VPN does not change unrelated FORWARD rules.
PostUp = iptables -N USC_FORWARD; iptables -A USC_FORWARD -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A USC_FORWARD -d 10.77.0.1/32 -p tcp -m multiport --dports 3100,7880,7881 -j ACCEPT; iptables -A USC_FORWARD -d 10.77.0.1/32 -p udp --dport 7882 -j ACCEPT; iptables -A USC_FORWARD -j DROP; iptables -I FORWARD 1 -i usc0 -o usc0 -j USC_FORWARD
PostDown = iptables -D FORWARD -i usc0 -o usc0 -j USC_FORWARD; iptables -F USC_FORWARD; iptables -X USC_FORWARD
ENDWG
 chmod 600 /etc/wireguard/usc0.conf
fi
cat > /etc/sysctl.d/81-usc-vpn-forward.conf <<'SYSCTL'
net.ipv4.ip_forward=1
SYSCTL
sysctl --system >/dev/null
if [ ! -f /etc/universal-stream-relay/relay.env ]; then
 umask 077
 TOKEN="$(openssl rand -hex 32)"
 cat > /etc/universal-stream-relay/relay.env <<ENVFILE
USC_RELAY_TOKEN=$TOKEN
USC_RELAY_DIR=/etc/universal-stream-relay
USC_WG_INTERFACE=usc0
ENVFILE
fi
cat > /etc/systemd/system/universal-stream-relay.service <<'SYSTEMD'
[Unit]
Description=Universal Stream WireGuard Peer Provisioning
After=network-online.target wg-quick@usc0.service
Requires=wg-quick@usc0.service
[Service]
Type=simple
User=root
EnvironmentFile=/etc/universal-stream-relay/relay.env
ExecStart=/usr/bin/env node /opt/universal-stream-relay/relay.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
SYSTEMD
# Do not overwrite the administrator's existing /etc/caddy/Caddyfile.
cat > /etc/universal-stream-relay/caddy-snippet.txt <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:8777
}
CADDY
systemctl daemon-reload
systemctl enable --now wg-quick@usc0.service
systemctl enable --now universal-stream-relay.service
cat <<OUTPUT

======================================
 Universal Stream VPN relay installed
======================================
HTTPS API (in Windows): https://$DOMAIN/
WireGuard UDP endpoint: $DOMAIN:51820
WireGuard relay public key: $WG_PUBLIC
Relay admin token (KEEP SECRET): $(grep '^USC_RELAY_TOKEN=' /etc/universal-stream-relay/relay.env | cut -d= -f2-)

ACTION REQUIRED:
1. Point DNS A record of $DOMAIN to this VPS's public IPv4.
2. Open VPS inbound TCP 80,443 and UDP 51820 (cloud + system firewalls).
3. Integrate the generated Caddy site config into /etc/caddy/Caddyfile:
      /etc/universal-stream-relay/caddy-snippet.txt
   Do not overwrite existing configuration. Then run:
      caddy validate --config /etc/caddy/Caddyfile
      systemctl reload caddy
4. Test from Windows: https://$DOMAIN/health should return 401 without token.
5. Copy the four fields above into the Windows app's VPN setup screen.

SECURITY: Token and peer configs reside in root-only /etc/universal-stream-relay.
Do not send the relay admin token to Android operators.
OUTPUT
