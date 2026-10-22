/** Only provisioned WireGuard address space may request operator tokens in VPN mode.
 * Defense-in-depth: still configure Windows Firewall to restrict LiveKit ports too.
 */
export function isProvisionedVpnAddress(address) {
  const normalized = String(address ?? '').replace(/^::ffff:/i,'');
  const parts = normalized.split('.');
  if(parts.length!==4 || parts.some(p=>!/^(0|[1-9][0-9]{0,2})$/.test(p)))return false;
  const octets=parts.map(Number);
  return octets.every(x=>x>=0 && x<=255) && octets[0]===10 && octets[1]===77 && octets[2]===0 && octets[3]>=100 && octets[3]<=240;
}

/** Bind an invite to the WireGuard peer for that operator.
 * WireGuard AllowedIPs prevents clients from freely choosing source addresses;
 * this additional check prevents one connected operator using another's code.
 * Missing/corrupt peer records deny access (fail closed).
 */
export function vpnPeerMatchesOperator(remoteAddress, operatorId, addressForOperator) {
  if (!isProvisionedVpnAddress(remoteAddress) || typeof addressForOperator !== 'function') return false;
  if (!/^key_[a-f0-9]{20}$/.test(String(operatorId))) return false;
  try {
    const expected = addressForOperator(operatorId);
    return isProvisionedVpnAddress(expected) &&
      String(remoteAddress).replace(/^::ffff:/i, '') === String(expected).replace(/^::ffff:/i, '');
  } catch { return false; }
}
