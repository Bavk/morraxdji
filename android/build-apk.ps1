# Run this PowerShell script from android/ after installing Android Studio + Android SDK 35.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.\gradlew.bat')) {
  Write-Host 'Fetching Gradle 8.9 from the official distribution...'
  $zip = Join-Path $env:TEMP 'gradle-8.9-bin.zip'
  $unzip = Join-Path $env:TEMP 'universal-stream-gradle-tools'
  if (-not (Test-Path $zip)) { Invoke-WebRequest 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' -OutFile $zip }
  if (-not (Test-Path (Join-Path $unzip 'gradle-8.9\bin\gradle.bat'))) {
    Expand-Archive $zip -DestinationPath $unzip -Force
  }
  & (Join-Path $unzip 'gradle-8.9\bin\gradle.bat') wrapper --gradle-version 8.9
  if ($LASTEXITCODE -ne 0) { throw 'Gradle wrapper generation failed' }
}
& '.\gradlew.bat' assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'APK build failed. Check Android SDK and Gradle output.' }
Write-Host 'APK is at app\build\outputs\apk\debug\app-debug.apk'
