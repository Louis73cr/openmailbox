// Web stand-in for iOS-only native modules (SwiftUI views): the app renders them on iOS only,
// so on web every export is an inert component/modifier.
const stub = () => null;
module.exports = new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : stub) });
