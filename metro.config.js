const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Required for react-native-reanimated v4 + New Architecture
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
