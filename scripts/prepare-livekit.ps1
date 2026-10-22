$ErrorActionPreference = 'Stop'
$version = '1.13.8'
$archive = "livekit_${version}_windows_amd64.zip"
$expected = '1c9bc93adf19528a86865dbdce5fb3958e7310c43ff8b437287aeb72669f26bd'
$destination = Join-Path $PSScriptRoot '../windows/vendor/livekit'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.zip')
try {
    Invoke-WebRequest "https://github.com/livekit/livekit/releases/download/v$version/$archive" -OutFile $temporary
    if ((Get-FileHash $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'LiveKit checksum mismatch' }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Expand-Archive -LiteralPath $temporary -DestinationPath $destination -Force
    if (-not (Test-Path (Join-Path $destination 'livekit-server.exe'))) { throw 'Missing LiveKit executable' }
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
