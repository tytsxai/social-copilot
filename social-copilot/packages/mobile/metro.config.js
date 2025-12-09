// @ts-check
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/**
 * Metro config to allow monorepo imports of @social-copilot/core.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.extraNodeModules = {
  '@social-copilot/core': path.resolve(workspaceRoot, 'packages/core'),
};

module.exports = config;
