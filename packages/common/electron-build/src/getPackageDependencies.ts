/**
 * The following code is modified based on
 * https://github.com/timfish/forge-externals-plugin/blob/master/index.js
 *
 * MIT License
 * Copyright (c) 2021 Tim Fish
 * https://github.com/timfish/forge-externals-plugin/blob/master/LICENSE
 */
import { Walker, DepType } from 'flora-colossus';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { findUpSync } from './findUp';

const readPackageName = (pkgPath: string): string | undefined => {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      name?: string;
    };
    return pkg.name;
  } catch {
    return undefined;
  }
};

const findNodeModulesPackageRoot = (
  cwd: string,
  pkgName: string,
): string => {
  let current = cwd || process.cwd();

  while (true) {
    const candidate = join(current, 'node_modules', ...pkgName.split('/'));
    const pkgPath = join(candidate, 'package.json');

    if (fs.existsSync(pkgPath) && readPackageName(pkgPath) === pkgName) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return '';
    }
    current = parent;
  }
};

export const getModuleRoot = (cwd: string, pkgName: string): string => {
  const directModuleRoot = findNodeModulesPackageRoot(cwd, pkgName);
  if (directModuleRoot) {
    return directModuleRoot;
  }

  let moduleEntryPath;
  try {
    moduleEntryPath = dirname(
      require.resolve(pkgName, {
        paths: [cwd || process.cwd()],
      }),
    );
  } catch {
    return '';
  }

  let pkgPath = findUpSync('package.json', {
    cwd: moduleEntryPath,
  });

  if (!pkgPath) {
    return '';
  }

  let currentDir = dirname(pkgPath);
  let isMatched = false;

  while (pkgPath && !isMatched) {
    const foundPackageName = readPackageName(pkgPath);
    if (foundPackageName === pkgName) {
      isMatched = true;
      break;
    }

    currentDir = dirname(currentDir);
    pkgPath = findUpSync('package.json', {
      cwd: currentDir,
    });
  }

  if (!isMatched || !pkgPath) {
    return '';
  }

  const moduleRoot = dirname(pkgPath);
  return moduleRoot;
};

export async function getExternalPkgsDependencies(
  pkgNames: string[],
  cwd: string = process.cwd(),
): Promise<
  {
    name: string;
    path: string;
  }[]
> {
  const dependenciesMap = new Map<string, { name: string; path: string }>();
  pkgNames.forEach((name) => {
    dependenciesMap.set(name, { name, path: getModuleRoot(cwd, name) });
  });

  for (const pkgName of pkgNames) {
    try {
      const moduleRoot = getModuleRoot(cwd, pkgName);
      // console.log('moduleRoot', moduleRoot);

      const walker = new Walker(moduleRoot);
      // These are private so it's quite nasty!
      // @ts-ignore
      walker.modules = [];
      // @ts-ignore
      await walker.walkDependenciesForModule(moduleRoot, DepType.PROD);
      // @ts-ignore
      walker.modules
        .filter((dep: any) => dep.nativeModuleType === DepType.PROD)
        .forEach((dep: any) =>
          dependenciesMap.set(dep.name, {
            name: dep.name,
            path: dep.path,
          }),
        );

      // @ts-ignore
      // console.log('walker.modules', walker.modules);
    } catch (error) {
      console.warn('error', error);
    }
  }

  return Array.from(dependenciesMap.values());
}
