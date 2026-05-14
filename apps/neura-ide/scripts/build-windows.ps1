param(
  [string]$VscodiumRef = "1.116.02821",
  [string]$WorkDir = "$PSScriptRoot\..\work",
  [string]$OutputDir = "$PSScriptRoot\..\dist\win32-x64"
)

$ErrorActionPreference = "Stop"

$repoDir = Join-Path $WorkDir "vscodium"
$toolsDir = Join-Path $WorkDir "tools"
$jqExe = Join-Path $toolsDir "jq.exe"
$nodeVersionFile = Join-Path $repoDir "vscode\.nvmrc"
$productJson = Resolve-Path "$PSScriptRoot\..\product.json"
$extensionDir = Resolve-Path "$PSScriptRoot\..\..\..\extensions\neura-agent"
$repoRoot = Resolve-Path "$PSScriptRoot\..\..\.."
$neuraLogoSvg = Resolve-Path "$PSScriptRoot\..\..\..\extensions\neura-agent\media\neura-logo.svg"
$productJsonBash = ($productJson.Path -replace "\\", "/")
$gitBash = @(
  "$env:ProgramFiles\Git\bin\bash.exe",
  "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
  "bash"
) | Where-Object { $_ -and (($_ -eq "bash") -or (Test-Path $_)) } | Select-Object -First 1

if (!$gitBash) {
  throw "Git Bash was not found. Install Git for Windows and ensure bash.exe is available."
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

if (!(Get-Command jq -ErrorAction SilentlyContinue) -and !(Test-Path $jqExe)) {
  Invoke-WebRequest `
    -Uri "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe" `
    -OutFile $jqExe
}

$env:PATH = "$toolsDir;$env:PATH"

if (!(Test-Path $repoDir)) {
  git clone https://github.com/VSCodium/vscodium.git $repoDir
}

Set-Location $repoDir
git reset --hard
Remove-Item -Force -ErrorAction SilentlyContinue ".\neura-vs18-node-gyp-patch.cjs"
Remove-Item -Force -ErrorAction SilentlyContinue ".\patches\*.bak"
git fetch --tags origin
git checkout $VscodiumRef
git reset --hard

$generatedCodeDir = Join-Path $repoDir "vscode"
if (Test-Path $generatedCodeDir) {
  $resolvedGeneratedCodeDir = Resolve-Path $generatedCodeDir
  if (!$resolvedGeneratedCodeDir.Path.StartsWith((Resolve-Path $repoDir).Path)) {
    throw "Refusing to remove unexpected generated VSCodium checkout: $($resolvedGeneratedCodeDir.Path)"
  }
  Remove-Item -LiteralPath $resolvedGeneratedCodeDir.Path -Recurse -Force
}

$env:SHOULD_BUILD = "yes"
$env:SHOULD_BUILD_REH = "no"
$env:CI_BUILD = "no"
$env:OS_NAME = "windows"
$env:VSCODE_ARCH = "x64"
$env:VSCODE_QUALITY = "stable"
$env:SHOULD_BUILD_CLI = "no"

$getRepoOutput = & $gitBash -lc ". ./get_repo.sh"
$getRepoOutput | ForEach-Object { Write-Host $_ }
$releaseVersionLine = $getRepoOutput | Where-Object { $_ -match '^RELEASE_VERSION=' } | Select-Object -Last 1
if ($releaseVersionLine -and $releaseVersionLine -match '^RELEASE_VERSION="([^"]+)"') {
  $env:RELEASE_VERSION = $Matches[1]
}
if (!$env:RELEASE_VERSION) {
  throw "Could not resolve VSCodium RELEASE_VERSION from get_repo.sh."
}
Copy-Item -Force $productJson ".\vscode\product.json"
Copy-Item -Force $productJson ".\product.json"

$requiredNodeVersion = (Get-Content $nodeVersionFile -Raw).Trim()
$nodeDir = Join-Path $toolsDir "node-v$requiredNodeVersion-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"
if (!(Test-Path $nodeExe)) {
  $nodeZip = Join-Path $toolsDir "node-v$requiredNodeVersion-win-x64.zip"
  Invoke-WebRequest `
    -Uri "https://nodejs.org/dist/v$requiredNodeVersion/node-v$requiredNodeVersion-win-x64.zip" `
    -OutFile $nodeZip
  Expand-Archive -Force -Path $nodeZip -DestinationPath $toolsDir
}

$env:PATH = "$nodeDir;$env:PATH"
$env:npm_config_user_agent = $null
$env:npm_execpath = $null
$env:npm_command = "ci"
$env:GYP_MSVS_VERSION = "2026"
$env:npm_config_msvs_version = "2026"
Get-ChildItem Env: | Where-Object {
  $_.Name -match "(^|_)(API_KEY|ACCESS_TOKEN|AUTH_TOKEN|TOKEN|SECRET|PASSWORD)$"
} | ForEach-Object {
  Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue
}

$nodeGypPatchScript = Join-Path $repoDir "neura-vs18-node-gyp-patch.cjs"
@'
const fs = require('fs');
const path = require('path');

function replaceAll(file, replacements) {
  if (!fs.existsSync(file)) {
    console.log(`[neura] node-gyp patch skipped, missing ${file}`);
    return;
  }

  let source = fs.readFileSync(file, 'utf8');
  let changed = false;

  for (const [from, to] of replacements) {
    if (source.includes(to)) {
      continue;
    }
    if (source.includes(from)) {
      source = source.replaceAll(from, to);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, source);
    console.log(`[neura] patched ${file}`);
  }
}

function insertBefore(source, marker, insertion) {
  if (source.includes(insertion)) {
    return [source, false];
  }
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    return [source, false];
  }
  return [
    source.slice(0, markerIndex) + insertion + source.slice(markerIndex),
    true
  ];
}

function patchFindVisualStudio(file) {
  if (!fs.existsSync(file)) {
    console.log(`[neura] node-gyp patch skipped, missing ${file}`);
    return;
  }

  let source = fs.readFileSync(file, 'utf8');
  let changed = false;

  const normalizedSource = source
    .replace(
      /(\s*\} else if \(versionYear === 2022\) \{\r?\n\s*return 'v143'\r?\n\s*\})\r?\n\s*\} else if \(versionYear === 2026\) \{\r?\n\s*return 'v145'\r?\n\s*\}/g,
      `$1 else if (versionYear === 2026) {
      return 'v145'
    }`
    )
    .replace(
      /(\s*\} else if \(versionYear === 2026\) \{\r?\n\s*return 'v145'\r?\n\s*\})\r?\n\s*if \(versionYear === 2026\) \{\r?\n\s*return 'v145'\r?\n\s*\}/g,
      '$1'
    );
  if (normalizedSource !== source) {
    source = normalizedSource;
    changed = true;
  }

  for (const [from, to] of findVisualStudioReplacements) {
    if (source.includes(to)) {
      continue;
    }
    if (source.includes(from)) {
      source = source.replaceAll(from, to);
      changed = true;
    }
  }

  let result = insertBefore(
    source,
    `    this.log.silly('- unsupported version:', ret.versionMajor)`,
    `    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
`
  );
  source = result[0];
  changed = changed || result[1];

  if (!source.includes('versionYear === 2026')) {
    result = insertBefore(
      source,
      `    this.log.silly('- invalid versionYear:', versionYear)`,
      `    if (versionYear === 2026) {
      return 'v145'
    }
`
    );
    source = result[0];
    changed = changed || result[1];
  }

  if (changed) {
    fs.writeFileSync(file, source);
    console.log(`[neura] patched ${file}`);
  }

  if (!source.includes('versionMajor === 18') || !source.includes("return 'v145'")) {
    throw new Error(`[neura] failed to patch VS 2026 support into ${file}`);
  }
}

function patchMsvsGenerator(file) {
  if (!fs.existsSync(file)) {
    console.log(`[neura] gyp MSVS generator patch skipped, missing ${file}`);
    return;
  }

  let source = fs.readFileSync(file, 'utf8');
  const to = `        # VS 2026 Community installations may omit Spectre-mitigated C++ runtime
        # libraries. Neura's sidecar build uses the standard runtime libraries.
        spectre_mitigation = None
        if spectre_mitigation:
            _AddConditionalProperty(properties, condition, "SpectreMitigation",
                                    spectre_mitigation)`;
  if (source.includes('spectre_mitigation = None')) {
    return;
  }

  const patched = source.replace(
    /        spectre_mitigation = msbuild_attributes\.get\('SpectreMitigation'\)\r?\n        if spectre_mitigation:\r?\n            _AddConditionalProperty\(properties, condition, "SpectreMitigation",\r?\n                                    spectre_mitigation\)/,
    to
  );
  if (patched === source) {
    throw new Error(`[neura] failed to locate SpectreMitigation block in ${file}`);
  }

  fs.writeFileSync(file, patched);
  console.log(`[neura] patched ${file}`);
}

const findVisualStudioReplacements = [
  ['return this.findVSFromSpecifiedLocation([2019, 2022])', 'return this.findVSFromSpecifiedLocation([2019, 2022, 2026])'],
  ['return this.findNewVSUsingSetupModule([2019, 2022])', 'return this.findNewVSUsingSetupModule([2019, 2022, 2026])'],
  ['return this.findNewVS([2019, 2022])', 'return this.findNewVS([2019, 2022, 2026])'],
  [
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }`,
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }`
  ],
  [
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`,
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`
  ],
  [
    `    } else if (versionYear === 2022) {
      return 'v143'
    }`,
    `    } else if (versionYear === 2022) {
      return 'v143'
    } else if (versionYear === 2026) {
      return 'v145'
    }`
  ],
  [
    `    } else if (versionYear === 2022) {
      return 'v143'
    }
    this.log.silly('- invalid versionYear:', versionYear)`,
    `    } else if (versionYear === 2022) {
      return 'v143'
    } else if (versionYear === 2026) {
      return 'v145'
    }
    this.log.silly('- invalid versionYear:', versionYear)`
  ]
];

const msvsVersionReplacements = [
  [
    `    versions = {
        "2022": VisualStudioVersion(`,
    `    versions = {
        "2026": VisualStudioVersion(
            "2026",
            "Visual Studio 2026",
            solution_version="12.00",
            project_version="18.0",
            flat_sln=False,
            uses_vcxproj=True,
            path=path,
            sdk_based=sdk_based,
            default_toolset="v145",
            compatible_sdks=["v8.1", "v10.0"],
        ),
        "2022": VisualStudioVersion(`
  ],
  ['      2022    - Visual Studio 2022 (17)', '      2022    - Visual Studio 2022 (17)\n      2026    - Visual Studio 2026 (18)'],
  ['        "17.0": "2022",', '        "17.0": "2022",\n        "18.0": "2026",'],
  [
    `        "auto": ("17.0", "16.0", "15.0", "14.0", "12.0", "10.0", "9.0", "8.0", "11.0"),`,
    `        "auto": ("18.0", "17.0", "16.0", "15.0", "14.0", "12.0", "10.0", "9.0", "8.0", "11.0"),`
  ],
  ['        "2022": ("17.0",),', '        "2022": ("17.0",),\n        "2026": ("18.0",),']
];

const nodeGypRoots = [
  path.join(process.cwd(), 'build', 'npm', 'gyp', 'node_modules', 'node-gyp'),
  path.resolve(process.cwd(), '..', '..', '..', '..', '..', 'node_modules', '@electron', 'node-gyp'),
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp')
];

for (const nodeGypRoot of nodeGypRoots) {
  patchFindVisualStudio(path.join(nodeGypRoot, 'lib', 'find-visualstudio.js'));
  replaceAll(path.join(nodeGypRoot, 'gyp', 'pylib', 'gyp', 'MSVSVersion.py'), msvsVersionReplacements);
  patchMsvsGenerator(path.join(nodeGypRoot, 'gyp', 'pylib', 'gyp', 'generator', 'msvs.py'));
}
'@ | Set-Content -Encoding ascii $nodeGypPatchScript

$prepareScript = Join-Path $repoDir "prepare_vscode.sh"
$prepareSource = Get-Content $prepareScript -Raw
if ($prepareSource -notmatch "neura-vs18-node-gyp-patch") {
  $prepareSource = $prepareSource -replace "node build/npm/preinstall\.ts", "node build/npm/preinstall.ts`nnode ../neura-vs18-node-gyp-patch.cjs`nexport GYP_MSVS_VERSION=2026`nexport npm_config_msvs_version=2026`nexport npm_config_node_gyp=`"`$(pwd)/build/npm/gyp/node_modules/.bin/node-gyp.cmd`"`nexport PATH=`"`$(pwd)/build/npm/gyp/node_modules/.bin:`$PATH`""
  Set-Content -Encoding ascii $prepareScript $prepareSource
}

$buildScript = Join-Path $repoDir "build.sh"
$buildSource = Get-Content $buildScript -Raw
if ($buildSource -notmatch "SHOULD_BUILD_CLI") {
  $buildSource = $buildSource -replace "\. \.\./build_cli\.sh", "if [[ `"`${SHOULD_BUILD_CLI}`" != `"no`" ]]; then . ../build_cli.sh; fi"
  Set-Content -Encoding ascii $buildScript $buildSource
}

if (!$env:vs2022_install) {
  $vswhere = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
      $env:vs2022_install = $vsPath
    }
  }
}

& $gitBash -lc "cp '$productJsonBash' ./product.json && cp '$productJsonBash' ./vscode/product.json && . ./build.sh"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$possibleBuilds = @(
  ".\VSCode-win32-x64",
  ".\vscode\VSCode-win32-x64",
  ".\vscode\.build\win32-x64\user"
)

$buildPath = $possibleBuilds | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$buildPath) {
  throw "Could not find the VSCodium Windows build output."
}

Copy-Item -Recurse -Force "$buildPath\*" $OutputDir
$distProductJson = Join-Path $OutputDir "resources\app\product.json"
if (Test-Path $distProductJson) {
  $distProduct = Get-Content $distProductJson -Raw | ConvertFrom-Json
  $distProduct.updateUrl = ""
  $distProduct.downloadUrl = ""
  if ($null -eq $distProduct.builtInExtensionsEnabledWithAutoUpdates) {
    $distProduct | Add-Member -NotePropertyName builtInExtensionsEnabledWithAutoUpdates -NotePropertyValue @() -Force
  }
  $distProduct.extensionsGallery.serviceUrl = "https://open-vsx.org/vscode/gallery"
  $distProduct.extensionsGallery.itemUrl = "https://open-vsx.org/vscode/item"
  $distProduct | ConvertTo-Json -Depth 100 | Set-Content -Encoding ascii $distProductJson
}
New-Item -ItemType Directory -Force -Path (Join-Path $OutputDir "resources\app\extensions\neura-agent") | Out-Null
Copy-Item -Recurse -Force "$extensionDir\*" (Join-Path $OutputDir "resources\app\extensions\neura-agent")

$logoPngCandidates = @(
  (Join-Path $repoRoot "apps\neura\dist\renderer\assets\logo-vector-o-LOXt64.png"),
  (Get-ChildItem -ErrorAction SilentlyContinue -Path (Join-Path $repoRoot "apps\neura\dist\renderer\assets") -Filter "logo*.png" | Select-Object -First 1).FullName
) | Where-Object { $_ -and (Test-Path $_) }
$neuraLogoPng = $logoPngCandidates | Select-Object -First 1

$mediaDir = Join-Path $OutputDir "resources\app\out\media"
if (Test-Path $mediaDir) {
  foreach ($name in @(
    "code-icon.svg",
    "letterpress-dark.svg",
    "letterpress-hcDark.svg",
    "letterpress-hcLight.svg",
    "letterpress-light.svg",
    "sessions-logo-dark.svg",
    "sessions-logo-light.svg"
  )) {
    Copy-Item -Force $neuraLogoSvg (Join-Path $mediaDir $name)
  }
}

if ($neuraLogoPng) {
  $win32Resources = Join-Path $OutputDir "resources\app\resources\win32"
  if (Test-Path $win32Resources) {
    foreach ($name in @("code_70x70.png", "code_150x150.png")) {
      Copy-Item -Force $neuraLogoPng (Join-Path $win32Resources $name)
    }
  }
}

Write-Host "Neura IDE Windows build copied to $OutputDir"
