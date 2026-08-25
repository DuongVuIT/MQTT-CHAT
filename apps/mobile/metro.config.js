const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const path = require("path");

/**
 * Metro configuration for a pnpm monorepo:
 * - watch the workspace packages the app imports (contracts, realtime-core)
 * - resolve node_modules from both the app and the repo root
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const appSourceRoot = path.resolve(projectRoot, "src");
const appAliasPrefix = "@app/";

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    resolveRequest(context, moduleName, platform) {
      const resolvedModuleName = moduleName.startsWith(appAliasPrefix)
        ? path.join(appSourceRoot, moduleName.slice(appAliasPrefix.length))
        : moduleName;

      return context.resolveRequest(context, resolvedModuleName, platform);
    },
    nodeModulesPaths: [
      path.resolve(projectRoot, "node_modules"),
      path.resolve(workspaceRoot, "node_modules"),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
