# Run in elevated Windows PowerShell only after WireGuard has been activated.
# These rules accept operator traffic from USC VPN addresses only.
# NOTE: they do not override existing broader 'allow' firewall rules.
$ErrorActionPreference = 'Stop'
$vpnSubnet = '10.77.0.0/24'
$definitions = @(
  @{ Name = 'USC VPN - API TCP 3100'; Protocol = 'TCP'; Port = '3100' },
  @{ Name = 'USC VPN - LiveKit signal TCP 7880'; Protocol = 'TCP'; Port = '7880' },
  @{ Name = 'USC VPN - LiveKit media fallback TCP 7881'; Protocol = 'TCP'; Port = '7881' },
  @{ Name = 'USC VPN - LiveKit media UDP 7882'; Protocol = 'UDP'; Port = '7882' }
)
foreach ($item in $definitions) {
  $present = Get-NetFirewallRule -DisplayName $item.Name -ErrorAction SilentlyContinue
  if (-not $present) {
    New-NetFirewallRule -DisplayName $item.Name -Direction Inbound -Action Allow -Enabled True `
      -Profile Any -Protocol $item.Protocol -LocalPort $item.Port -RemoteAddress $vpnSubnet | Out-Null
    Write-Host "Added restricted rule: $($item.Name)"
  } else {
    Write-Host "Already present: $($item.Name)"
  }
}
Write-Host 'Review existing inbound allow rules for ports 3100,7880,7881,7882; remove any unrestricted rules.'
