# Выполняется на Windows PowerShell при установленном Node.js >=22.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$tests = @(
  Get-ChildItem './server' -Filter '*.test.mjs';
  Get-Item './server/test.mjs';
  Get-ChildItem './windows' -Filter '*.test.cjs';
  Get-ChildItem './relay' -Filter '*.test.mjs';
  Get-ChildItem './windows/renderer' -Filter '*.test.mjs'
) | ForEach-Object { $_.FullName }
& node --test @tests
if ($LASTEXITCODE -ne 0) { throw 'Node.js tests FAILED' }
& node scripts/source-audit.mjs
node scripts/repo-safety.mjs
if ($LASTEXITCODE -ne 0) { throw 'Source audit FAILED' }
Write-Host 'Tests passed. EXE/APK and real network still require separate testing.'

Write-Host 'Checks finished. EXE/APK and real network tests still required.'
