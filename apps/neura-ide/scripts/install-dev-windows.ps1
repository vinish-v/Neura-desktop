param(
  [string]$BuildDir = "$PSScriptRoot\..\dist\win32-x64",
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\Neura IDE"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $BuildDir)) {
  throw "Neura IDE build output was not found at $BuildDir. Run npm --prefix apps/neura-ide run build:win32 first."
}

$exeCandidates = @(
  "Neura IDE.exe",
  "NeuraIDE.exe",
  "VSCodium.exe",
  "codium.exe"
) | ForEach-Object { Join-Path $BuildDir $_ }

$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$exe) {
  throw "No Neura IDE-compatible executable was found in $BuildDir."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force "$BuildDir\*" $InstallDir

Write-Host "Neura IDE dev install copied to $InstallDir"
