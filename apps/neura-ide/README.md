# Neura IDE

`apps/neura-ide` is the downstream VSCodium/Code-OSS build area for the
separate Neura IDE app. Neura Desktop launches this sibling app from Canvas and
passes an authenticated local bridge token for the active Canvas project.

V1 rules:

- Build from VSCodium/Code-OSS sources, not Microsoft Visual Studio Code
  proprietary binaries.
- Use Open VSX as the extension gallery.
- Do not configure Microsoft Visual Studio Marketplace endpoints.
- Bundle the `extensions/neura-agent` extension so the workbench connects back
  to Neura Canvas through the authenticated local bridge.
- Ship and update Neura IDE separately from Neura Desktop. Desktop may launch it
  from the installed Windows app path, `NEURA_IDE_EXECUTABLE`, or a local
  development build under this folder.

Run `npm --prefix apps/neura-ide run verify:product` to verify the product
metadata does not include Marketplace endpoints. On Windows, run
`npm --prefix apps/neura-ide run build:win32` after installing the VSCodium
build prerequisites documented by upstream.

For local integration testing after a Windows build:

```powershell
npm --prefix apps/neura-ide run install:dev:win32
npm --prefix apps/neura run dev
```

Canvas will discover the dev install at
`%LOCALAPPDATA%\Programs\Neura IDE\Neura IDE.exe`.
