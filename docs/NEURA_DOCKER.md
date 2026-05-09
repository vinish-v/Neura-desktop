# Neura Docker Notes

Neura Desktop is an Electron app that controls the real computer. For reliable
Windows desktop control, run the installed Neura app on the host machine.

Docker support here is for repeatable dependency install, typecheck, and
renderer/main build validation. GUI mode is provided for Linux/X11 development,
but it cannot reliably control the Windows host desktop from a Linux container.

## NVIDIA NIM

Set one of these before running:

```powershell
$env:VLM_API_KEY="nvapi_your_key"
```

or:

```powershell
$env:NVIDIA_API_KEY="nvapi_your_key"
```

Defaults:

```text
VLM_PROVIDER=NVIDIA NIM
VLM_BASE_URL=https://integrate.api.nvidia.com/v1
VLM_MODEL_NAME=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning
```

## Build In Docker

```powershell
docker compose run --rm neura-desktop-build
```

This installs the workspace without lifecycle scripts, builds only the
workspace packages used by Neura Desktop, then runs the app typecheck and
`electron-vite` production build.

## GUI Dev In Docker

Linux/X11 only:

```bash
docker compose --profile gui up neura-desktop-dev
```

On Windows, use the normal host installer for real computer control:

```text
apps/neura/out/make/squirrel.windows/x64/Neura-0.2.4-Setup.exe
```
