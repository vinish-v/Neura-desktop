/**
 * The following code is modified based on
 * https://github.com/shirshak55/edge-paths/blob/master/index.ts
 *
 * MIT Licensed
 * Copyright (c) 2020 Shirshak
 * https://github.com/shirshak55/edge-paths/blob/master/LICENSE
 */
import { existsSync } from 'fs';
import { join, sep } from 'path';
import which from 'which';

const platform = process.platform;

function getEdgeOnLinux(
  name: 'microsoft-edge-stable' | 'microsoft-edge-beta' | 'microsoft-edge-dev',
): string | null {
  try {
    return which.sync(name);
  } catch (e) {}

  return null;
}

function getEdgeOnWindows(
  edgeDirName: 'Edge' | 'Edge Beta' | 'Edge Dev' | 'Edge SxS',
): string | null {
  const suffix = `${sep}Microsoft${sep}${edgeDirName}${sep}Application${sep}msedge.exe`;
  const prefixes = [
    process.env.LOCALAPPDATA,
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
  ].filter(Boolean);

  for (const prefix of prefixes) {
    const edgePath = join(prefix!, suffix);
    if (existsSync(edgePath)) {
      return edgePath;
    }
  }

  return null;
}

function getEdgeOnDarwin(
  name:
    | 'Microsoft Edge'
    | 'Microsoft Edge Beta'
    | 'Microsoft Edge Dev'
    | 'Microsoft Edge Canary',
): string | null {
  const edgePath = `/Applications/${name}.app/Contents/MacOS/${name}`;
  if (existsSync(edgePath)) {
    return edgePath;
  }

  return null;
}

const edgePaths = {
  edge: {
    linux: () => getEdgeOnLinux('microsoft-edge-stable'),
    darwin: () => getEdgeOnDarwin('Microsoft Edge'),
    win32: () => getEdgeOnWindows('Edge'),
  },
  beta: {
    linux: () => getEdgeOnLinux('microsoft-edge-beta'),
    darwin: () => getEdgeOnDarwin('Microsoft Edge Beta'),
    win32: () => getEdgeOnWindows('Edge Beta'),
  },
  dev: {
    linux: () => getEdgeOnLinux('microsoft-edge-dev'),
    darwin: () => getEdgeOnDarwin('Microsoft Edge Dev'),
    win32: () => getEdgeOnWindows('Edge Dev'),
  },
  canary: {
    darwin: () => getEdgeOnDarwin('Microsoft Edge Canary'),
    win32: () => getEdgeOnWindows('Edge SxS'),
  },
};

function getEdgePath() {
  const edge = edgePaths.edge;

  if (platform && Object.keys(edge).includes(platform)) {
    const pth = edge[platform as keyof typeof edge]();
    if (pth) {
      return pth;
    }
  }
}

function getEdgeBetaPath() {
  const beta = edgePaths.beta;

  if (platform && Object.keys(beta).includes(platform)) {
    const pth = beta[platform as keyof typeof beta]();
    if (pth) {
      return pth;
    }
  }
}

function getEdgeDevPath() {
  const dev = edgePaths.dev;

  if (platform && Object.keys(dev).includes(platform)) {
    const pth = dev[platform as keyof typeof dev]();
    if (pth) {
      return pth;
    }
  }
}

function getEdgeCanaryPath() {
  const canary = edgePaths.canary;

  if (platform && Object.keys(canary).includes(platform)) {
    const pth = canary[platform as keyof typeof canary]();
    if (pth) {
      return pth;
    }
  }
}

export function getAnyEdgeStable(): string {
  const edge = getEdgePath();
  if (edge) {
    return edge;
  }

  const beta = getEdgeBetaPath();
  if (beta) {
    return beta;
  }

  const dev = getEdgeDevPath();
  if (dev) {
    return dev;
  }

  const canary = getEdgeCanaryPath();
  if (canary) {
    return canary;
  }

  const error = new Error('Unable to find any edge browser.');
  error.name = 'EdgePathsError';
  throw error;
}
