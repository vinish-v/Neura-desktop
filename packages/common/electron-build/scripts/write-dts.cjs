const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

const declaration = [
  'export declare const getModuleRoot: (cwd: string, pkgName: string) => string;',
  'export declare function getExternalPkgsDependencies(pkgNames: string[], cwd?: string): Promise<{ name: string; path: string }[]>;',
  'export declare const hooks: any;',
  '',
].join('\n');

fs.writeFileSync(path.join(distDir, 'index.d.ts'), declaration);
