'use strict';
// Publish LiveKit only to the selected operator-facing interface and localhost.
// Do not publish to 0.0.0.0: exposure to the public NIC would bypass the VPN boundary.
const net=require('node:net');
const PORTS=Object.freeze([
  {external:7880,internal:7880,protocol:'tcp'},
  {external:7881,internal:7881,protocol:'tcp'},
  {external:7882,internal:7882,protocol:'udp'}
]);
function validateAddress(ip){
  if(net.isIP(ip)!==4 || ip==='127.0.0.1' || ip==='0.0.0.0' || ip.startsWith('169.254.'))
    throw Error('Для LiveKit укажите действительный IPv4 сетевого интерфейса (не 0.0.0.0/loopback)');
  return ip;
}
function renderLivekitConfig(ip,apiKey,apiSecret){
  validateAddress(ip);
  if(!/^usc[a-f0-9]{18}$/.test(apiKey) || !/^[A-Za-z0-9_-]{40,}$/.test(apiSecret))
    throw Error('Неверный формат внутренних учётных данных LiveKit');
  return `port: 7880\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  node_ip: ${ip}\n  use_external_ip: false\nkeys:\n  ${apiKey}: ${apiSecret}\n`;
}
function renderCompose(ip){
  validateAddress(ip);
  const lines=PORTS.flatMap(({external,internal,protocol})=>[
    `      - "127.0.0.1:${external}:${internal}/${protocol}"`,
    `      - "${ip}:${external}:${internal}/${protocol}"`
  ]);
  return `# Managed by Universal Stream Control; do not reuse for other Docker projects.\nname: universalstreamcontrol\nservices:\n  livekit:\n    image: livekit/livekit-server:v1.13.8\n    command: ["--config", "/etc/livekit.yaml"]\n    restart: "no"\n    volumes:\n      - ./livekit.yaml:/etc/livekit.yaml:ro\n    ports:\n${lines.join('\n')}\n`;
}
module.exports={PORTS,validateAddress,renderLivekitConfig,renderCompose};
