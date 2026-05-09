/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
import fs, { readdirSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import path, { resolve } from 'node:path';

import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import setLanguages from 'electron-packager-languages';
import { rimraf, rimrafSync } from 'rimraf';

import { getExternalPkgs } from './scripts/getExternalPkgs';
import { getModuleRoot, hooks } from '@common/electron-build';

const keepModules = new Set([
  ...getExternalPkgs(),
  '@computer-use/mac-screen-capture-permissions',
]);
const needSubDependencies = ['@computer-use/node-mac-permissions', 'sharp'];
const ignorePattern = new RegExp(
  `^/node_modules/(?!${[...keepModules].join('|')})`,
);
const unpack = `**/node_modules/{@img,${[...keepModules].join(',')}}/**/*`;

const keepLanguages = new Set(['en', 'en_GB', 'en-US', 'en_US']);
const noopAfterCopy = (
  _buildPath,
  _electronVersion,
  _platform,
  _arch,
  callback,
) => callback();

const copyRuntimeModule = (_moduleRoot: string) => ({
  recursive: true,
  filter: (src: string) => {
    try {
      return !fs.lstatSync(src).isSymbolicLink();
    } catch {
      return false;
    }
  },
});

const readDependencyNames = (moduleRoot: string) => {
  try {
    const modulePackageJson = JSON.parse(
      fs.readFileSync(path.join(moduleRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };

    return Object.keys({
      ...(modulePackageJson.dependencies || {}),
      ...(modulePackageJson.optionalDependencies || {}),
    });
  } catch {
    console.warn('read_dependency_names_error', moduleRoot);
    return [];
  }
};

const resolveModuleRoot = (projectRoot: string, name: string) => {
  try {
    return getModuleRoot(projectRoot, name);
  } catch {
    let current = projectRoot;
    while (true) {
      const candidate = path.join(current, 'node_modules', name);
      if (
        fs.existsSync(candidate) &&
        fs.existsSync(path.join(candidate, 'package.json'))
      ) {
        return candidate;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    console.warn('resolve_module_root_missing', name);
    return '';
  }
};

const collectRuntimeDependencyModules = (
  rootModules: string[],
  projectRoot: string,
) => {
  const modules = new Map<string, string>();
  const queue = [...rootModules];

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || modules.has(name)) {
      continue;
    }

    try {
      const moduleRoot = resolveModuleRoot(projectRoot, name);
      if (!moduleRoot || !fs.existsSync(moduleRoot)) {
        continue;
      }

      modules.set(name, moduleRoot);
      queue.push(...readDependencyNames(moduleRoot));
    } catch (error) {
      console.warn('collect_runtime_dependency_error', name, error);
    }
  }

  return Array.from(modules.entries()).map(([name, moduleRoot]) => ({
    name,
    path: moduleRoot,
  }));
};

const enableOsxSign =
  process.env.APPLE_ID &&
  process.env.APPLE_PASSWORD &&
  process.env.APPLE_TEAM_ID;

// remove folders & files not to be included in the app
async function cleanSources(
  buildPath,
  _electronVersion,
  platform,
  _arch,
  callback,
) {
  // folders & files to be included in the app
  const appItems = new Set([
    'dist',
    'node_modules',
    'package.json',
    'resources',
  ]);

  if (platform === 'darwin' || platform === 'mas') {
    const frameworkResourcePath = resolve(
      buildPath,
      '../../Frameworks/Electron Framework.framework/Versions/A/Resources',
    );

    for (const file of readdirSync(frameworkResourcePath)) {
      if (file.endsWith('.lproj') && !keepLanguages.has(file.split('.')[0]!)) {
        rimrafSync(resolve(frameworkResourcePath, file));
      }
    }
  }

  // Keep only node_modules to be included in the app
  await Promise.all([
    ...(await readdir(buildPath).then((items) =>
      items
        .filter((item) => !appItems.has(item))
        .map((item) => rimraf(path.join(buildPath, item))),
    )),
    ...(await readdir(path.join(buildPath, 'node_modules')).then((items) =>
      items
        .filter((item) => !keepModules.has(item))
        .map((item) => rimraf(path.join(buildPath, 'node_modules', item))),
    )),
  ]);

  const projectRoot = path.resolve(__dirname, '.');

  const runtimeModules = collectRuntimeDependencyModules(
    [...keepModules, ...needSubDependencies],
    projectRoot,
  );

  await Promise.all(
    runtimeModules.map((runtimeModule) => {
      // Check is exist
      if (
        fs.existsSync(path.join(buildPath, 'node_modules', runtimeModule.name))
      ) {
        // eslint-disable-next-line array-callback-return
        return;
      }

      if (fs.existsSync(runtimeModule.path)) {
        return cp(
          runtimeModule.path,
          path.join(buildPath, 'node_modules', runtimeModule.name),
          copyRuntimeModule(runtimeModule.path),
        );
      }

      return;
    }),
  );

  callback();
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Neura',
    icon: 'resources/icon',
    extraResource: ['./resources/app-update.yml'],
    asar: {
      unpack,
    },
    ignore: [ignorePattern],
    prune: false,
    afterCopy: [
      cleanSources,
      process.platform !== 'win32'
        ? noopAfterCopy
        : setLanguages([...keepLanguages.values()]),
    ],
    executableName: 'Neura',
    ...(enableOsxSign
      ? {
          osxSign: {
            keychain: process.env.KEYCHAIN_PATH,
            optionsForFile: () => ({
              entitlements: 'build/entitlements.mac.plist',
            }),
          },
          osxNotarize: {
            appleId: process.env.APPLE_ID!,
            appleIdPassword: process.env.APPLE_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: { owner: 'neura-ai', name: 'neura-desktop' },
        draft: true,
        force: true,
        generateReleaseNotes: true,
      },
    },
  ],
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({
      // CamelCase version without spaces
      name: 'Neura',
      setupIcon: 'resources/icon.ico',
    }),
    // https://github.com/electron/forge/issues/3712
    new MakerDMG({
      overwrite: true,
      background: 'static/dmg-background.png',
      // icon: 'static/dmg-icon.icns',
      iconSize: 160,
      format: 'UDZO',
      additionalDMGOptions: { window: { size: { width: 660, height: 400 } } },
      contents: (opts) => [
        { x: 180, y: 170, type: 'file', path: opts.appPath },
        { x: 480, y: 170, type: 'link', path: '/Applications' },
      ],
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    // https://github.com/microsoft/playwright/issues/28669#issuecomment-2268380066
    ...(process.env.CI === 'e2e'
      ? []
      : [
          new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
          }),
        ]),
  ],
  hooks: {
    postMake: async (forgeConfig, makeResults) => {
      return await hooks.postMake?.(forgeConfig, makeResults);
    },
  },
};

export default config;
