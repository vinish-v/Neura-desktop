/**
 * Copyright (c) 2025 Neura.
 * SPDX-License-Identifier: Apache-2.0
 */
const fs = require('fs');
const path = require('path');

const productPath = path.join(__dirname, '..', 'product.json');
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
const serialized = JSON.stringify(product);

if (/marketplace\.visualstudio\.com/i.test(serialized)) {
  throw new Error('Neura IDE product.json must not use Visual Studio Marketplace.');
}

if (product.extensionsGallery?.serviceUrl !== 'https://open-vsx.org/vscode/gallery') {
  throw new Error('Neura IDE must use Open VSX as the v1 extension gallery.');
}

if (product.updateUrl || product.downloadUrl) {
  throw new Error('Neura IDE updates and downloads must stay disabled for v1.');
}

if (
  product.defaultChatAgent?.chatExtensionId === 'neura.neura-agent' ||
  product.defaultChatAgent?.chatExtensionId === 'neura.neura-ai'
) {
  throw new Error(
    'Neura Agent must not be wired as the VS Code defaultChatAgent; it uses a custom Neura AI side panel.',
  );
}

const extensionIconPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'extensions',
  'neura-agent',
  'media',
  'neura-logo.png',
);
if (!fs.existsSync(extensionIconPath)) {
  throw new Error('Neura IDE must include a Neura logo asset for branding.');
}

console.log('Neura IDE product metadata is configured for Open VSX.');
