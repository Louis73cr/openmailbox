const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const separator = '[/\\\\]';

config.resolver.unstable_enablePackageExports = false;
config.resolver.blockList = [
  new RegExp(`^${path.resolve(__dirname, 'core').split(path.sep).join(separator)}${separator}.*`),
  new RegExp(`${separator}android${separator}(?:.*${separator})?(?:build|\\.cxx|\\.gradle)${separator}.*`),
];
const WEB_REPLACEMENTS = {
  '@expo/ui/swift-ui': 'web/native-stub.js',
  '@expo/ui/swift-ui/modifiers': 'web/native-stub.js',
  'expo-glass-effect': 'web/glass.tsx',
  'react-native-webview': 'web/webview.tsx',
};
config.resolver.resolveRequest = (context, moduleName, platform) =>
  platform === 'web' && WEB_REPLACEMENTS[moduleName]
    ? { type: 'sourceFile', filePath: path.resolve(__dirname, WEB_REPLACEMENTS[moduleName]) }
    :
  context.resolveRequest(
    // Web libraries (tiptap) rely on package exports, which native keeps off.
    platform === 'web' ? { ...context, unstable_enablePackageExports: true } : context,
    moduleName === 'react-native-enriched-html' && platform !== 'web' ? 'react-native-enriched-html/lib/module/index.native.js' : moduleName,
    platform,
  );
module.exports = config;
