const fs = require('node:fs');
const path = require('node:path');

const distDir = path.resolve(__dirname, '..', 'dist');
fs.mkdirSync(distDir, { recursive: true });

const indexDeclaration = [
  'export declare class GUIAgent<T = any> {',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  'export type GUIAgentConfig<T = any> = any;',
  'export type GUIAgentData = any;',
  'export declare const StatusEnum: any;',
  'export declare const NeuraModelVersion: any;',
  '',
].join('\n');

const coreDeclaration = [
  'export declare class Operator<T = any> {',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  'export type InvokeParams = any;',
  'export type InvokeOutput = any;',
  'export type ExecuteParams = any;',
  'export type ExecuteOutput = any;',
  'export type ScreenshotOutput = any;',
  'export declare class NeuraModel {',
  '  constructor(...args: any[]);',
  '  [key: string]: any;',
  '}',
  'export type NeuraModelConfig = any;',
  'export declare const useContext: any;',
  'export declare const parseBoxToScreenCoords: any;',
  'export declare const preprocessResizeImage: any;',
  'export declare const convertToOpenAIMessages: any;',
  'export declare const StatusEnum: any;',
  '',
].join('\n');

const constantsDeclaration = [
  'export declare const NeuraModelVersion: any;',
  'export declare const StatusEnum: any;',
  '',
].join('\n');

fs.writeFileSync(path.join(distDir, 'index.d.ts'), indexDeclaration);
fs.writeFileSync(path.join(distDir, 'core.d.ts'), coreDeclaration);
fs.writeFileSync(path.join(distDir, 'constants.d.ts'), constantsDeclaration);
