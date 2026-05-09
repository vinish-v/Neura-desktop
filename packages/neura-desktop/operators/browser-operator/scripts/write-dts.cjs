const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

const declaration = [
  'export declare class BrowserOperator {',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  'export declare class DefaultBrowserOperator extends BrowserOperator {',
  '  static getInstance(...args: any[]): Promise<DefaultBrowserOperator>;',
  '  static hasBrowser(...args: any[]): boolean;',
  '}',
  'export declare class RemoteBrowserOperator extends BrowserOperator {',
  '  static getInstance(...args: any[]): Promise<RemoteBrowserOperator>;',
  '}',
  'export declare enum SearchEngine {',
  "  GOOGLE = 'google',",
  "  BAIDU = 'baidu',",
  "  BING = 'bing'",
  '}',
  'export type BrowserOperatorOptions = any;',
  'export type ParsedPrediction = any;',
  'export type Page = any;',
  'export type ScreenshotOutput = any;',
  'export type ExecuteParams = any;',
  '',
].join('\n');

fs.writeFileSync(path.join(distDir, 'index.d.ts'), declaration);
