const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

const declaration = [
  'export declare class NutJSOperator {',
  '  static MANUAL: any;',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  '',
].join('\n');

fs.writeFileSync(path.join(distDir, 'index.d.ts'), declaration);
