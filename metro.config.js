const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const separator = '[/\\\\]';

config.resolver.unstable_enablePackageExports = false;
config.resolver.blockList = [
  new RegExp(`^${path.resolve(__dirname, 'core').split(path.sep).join(separator)}${separator}.*`),
  new RegExp(`${separator}android${separator}(?:.*${separator})?(?:build|\\.cxx|\\.gradle)${separator}.*`),
];
const webStub = path.resolve(__dirname, 'web/native-stub.js');
config.resolver.resolveRequest = (context, moduleName, platform) =>
  platform === 'web' && moduleName.startsWith('@expo/ui/swift-ui')
    ? { type: 'sourceFile', filePath: webStub }
    :
  context.resolveRequest(
    // Web libraries (tiptap) rely on package exports, which native keeps off.
    platform === 'web' ? { ...context, unstable_enablePackageExports: true } : context,
    moduleName === 'react-native-enriched-html' && platform !== 'web' ? 'react-native-enriched-html/lib/module/index.native.js' : moduleName,
    platform,
  );
module.exports = config;
