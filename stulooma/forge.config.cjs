module.exports = {
  packagerConfig: {
    name: 'STULOOMA', executableName: 'STULOOMA', appBundleId: 'com.stulooma.desktop',
    asar: true,
    prune: true,
    extraResource: ['THIRD_PARTY_NOTICES.json', 'THIRD_PARTY_NOTICES.txt'],
    download: {
      cacheRoot: process.env.electron_config_cache,
      checksums: require('electron/checksums.json'),
    },
    ignore: [
      /^\/src(?:\/|$)/, /^\/electron(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/scripts(?:\/|$)/,
      /^\/docs(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/out(?:\/|$)/, /^\/test-results(?:\/|$)/,
      /^\/playwright-report(?:\/|$)/, /^\/node_modules(?:\/|$)/,
      /^\/public(?:\/|$)/,
      /^\/(?:tsconfig.*\.json|vite\.config\.ts|playwright.*\.ts|package-lock\.json)$/,
    ],
    extendInfo: {
      CFBundleDocumentTypes: [{
        CFBundleTypeName: 'STULOOMA project', CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner', LSItemContentTypes: ['com.stulooma.project'],
      }],
      UTExportedTypeDeclarations: [{
        UTTypeIdentifier: 'com.stulooma.project', UTTypeDescription: 'STULOOMA project',
        UTTypeConformsTo: ['public.data', 'public.archive'],
        UTTypeTagSpecification: { 'public.filename-extension': ['stulooma'], 'public.mime-type': 'application/x-stulooma' },
      }],
    },
  },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['linux', 'win32', 'darwin'] }],
};
