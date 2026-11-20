const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const separator = '[/\\\\]';

config.resolver.unstable_enablePackageExports = false;
config.resolver.blockList = [
  new RegExp(`^${path.resolve(__dirname, 'core').split(path.sep).join(separator)}${separator}.*`),
  new RegExp(`${separator}android${separator}(?:.*${separator})?(?:build|\\.cxx|\\.gradle)${separator}.*`),
];
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    context,
    moduleName === 'react-native-enriched-html' && platform !== 'web' ? 'react-native-enriched-html/lib/module/index.native.js' : moduleName,
    platform,
  );
module.exports = config;
