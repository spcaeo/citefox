import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { Arch, type AfterPackContext, type Configuration } from 'electron-builder'

/**
 * Packaging for CiteFox. `npm run dist` builds for the current OS and arch;
 * see Docs/RELEASING.md for the release process and the file list.
 *
 * Every file is named `CiteFox-<version>-<os>-<arch>.<ext>` (the portable
 * Windows build adds `-portable`). A `publish` provider is set so each build
 * writes `latest*.yml` update files; every build command passes
 * `--publish never`, and the release workflow uploads to a draft release.
 *
 * Signing only happens when credentials are in the environment:
 * - macOS: CSC_NAME (the release workflow imports the certificate with
 *   scripts/ci/mac-keychain.sh) or CSC_LINK (+ CSC_KEY_PASSWORD). Without them the app is
 *   ad-hoc signed (`identity: '-'`, no hardened runtime), never with a
 *   certificate that happens to be in the keychain. Ad-hoc signing seals the
 *   bundle, so macOS offers "Open Anyway" instead of calling the app damaged.
 *   Notarization runs only when APPLE_API_KEY/APPLE_API_KEY_ID/APPLE_API_ISSUER
 *   or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID are set.
 * - Windows: CSC_LINK / WIN_CSC_LINK (+ password). Unsigned otherwise.
 */
const macSigning = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)

/** `CiteFox-0.13.0-mac-universal.dmg`, `CiteFox-0.13.0-win-x64.exe`, `CiteFox-0.13.0-linux-x64.AppImage`. */
const artifactName = '${productName}-${version}-${os}-${arch}.${ext}'

const config: Configuration = {
  appId: 'app.citefox.desktop',
  productName: 'CiteFox',
  copyright:
    'Copyright © 2026 Space-O Technologies (and vBridge Technologies, a division of Space-O)',
  artifactName,
  // The .deb control file needs a homepage, and electron-builder reads it
  // from package.json metadata. Placeholder until the project has a public
  // site (Docs/RELEASING.md), like the deb maintainer below.
  extraMetadata: {
    homepage: 'https://github.com/spcaeo/citefox'
  },
  directories: {
    output: 'release',
    buildResources: 'build'
  },
  // Each platform below also drops the other platforms' better-sqlite3
  // prebuilds and @napi-rs/keyring binaries.
  files: [
    'out/**/*',
    'package.json',
    // better-sqlite3 ships N-API prebuilds; its C sources are dead weight.
    '!node_modules/better-sqlite3/{deps,src}{,/**}',
    '!node_modules/better-sqlite3/binding.gyp',
    '!**/*.map'
  ],
  asar: true,
  // Native addons cannot be loaded from inside app.asar.
  asarUnpack: ['**/*.node'],
  // Every native dependency is an N-API prebuild (better-sqlite3 13,
  // @napi-rs/keyring), so there is nothing to compile against Electron.
  npmRebuild: false,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // Must stay on: with it off, Electron's file: handler cannot read
    // app.asar, so loadFile(out/renderer/index.html) fails with
    // ERR_FILE_NOT_FOUND (verified on Electron 44.9). Turning it off needs
    // the renderer served from a custom app:// protocol instead.
    grantFileProtocolExtraPrivileges: true,
    // Flipping fuses edits the Electron binary; re-sign it ad hoc so an
    // unsigned arm64 build still launches. A real identity re-signs later.
    resetAdHocDarwinSignature: true
  },
  afterPack: verifyNativeModules,
  mac: {
    category: 'public.app-category.productivity',
    // One universal app for every Mac (dmg + zip, the zip is what an updater
    // downloads), plus smaller single-arch dmgs. All three are built on one
    // Apple-chip runner; scripts/add-native-arch.mjs adds the Intel keyring
    // binary first (Docs/RELEASING.md).
    target: [
      { target: 'dmg', arch: ['universal', 'arm64', 'x64'] },
      { target: 'zip', arch: ['universal'] }
    ],
    artifactName,
    // Both builds of a universal app must hold the same files, so each ships
    // both darwin prebuilds; @electron/universal then keeps them as they are.
    files: [
      '!node_modules/better-sqlite3/prebuilds/!(darwin-*.node)',
      '!node_modules/@napi-rs/keyring-!(darwin-x64|darwin-arm64){,/**}'
    ],
    x64ArchFiles:
      '**/node_modules/{better-sqlite3/prebuilds/darwin-*.node,@napi-rs/keyring-darwin-*/*.node}',
    identity: macSigning ? undefined : '-',
    // Hardened runtime needs a real identity: with an ad-hoc signature,
    // library validation would refuse the app's own native addons.
    hardenedRuntime: macSigning,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  },
  dmg: {
    artifactName,
    // The installer window: our artwork (build/dmg-background.svg, npm run dmg:background) with
    // the app on the left and an Applications shortcut on the right, so "drag it over" is obvious.
    // electron-builder joins build/dmg-background.png and build/dmg-background@2x.png for Retina.
    title: '${productName} ${version}',
    background: 'build/dmg-background.png',
    window: { width: 660, height: 400 },
    iconSize: 128,
    iconTextSize: 13,
    contents: [
      { x: 180, y: 190, type: 'file' },
      { x: 480, y: 190, type: 'link', path: '/Applications' }
    ]
  },
  win: {
    // Build one arch per electron-builder run (`--win --x64`, then
    // `--win --arm64`): one run with both makes a single two-arch installer.
    target: ['nsis', 'portable'],
    artifactName,
    files: [
      '!node_modules/better-sqlite3/prebuilds/!(win32-${arch}.node)',
      '!node_modules/@napi-rs/keyring-!(win32-${arch}-msvc){,/**}'
    ]
  },
  nsis: {
    artifactName,
    // A per-user install under %LOCALAPPDATA%: no admin prompt. The assisted
    // installer lets people pick the folder; "Only for me" is the default.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'CiteFox',
    runAfterFinish: true,
    deleteAppDataOnUninstall: false
  },
  portable: {
    artifactName: '${productName}-${version}-${os}-${arch}-portable.${ext}'
  },
  appImage: {
    artifactName
  },
  linux: {
    target: ['AppImage', 'deb'],
    artifactName,
    files: [
      '!node_modules/better-sqlite3/prebuilds/!(linux-${arch}.node)',
      '!node_modules/@napi-rs/keyring-!(linux-${arch}-gnu|linux-${arch}-musl){,/**}'
    ],
    category: 'Utility',
    synopsis: 'Track whether Google AI Overviews cite your pages',
    // Placeholder until the project has a public contact address (Docs/RELEASING.md).
    maintainer: 'CiteFox contributors <hello@welco.ai>'
  },
  deb: {
    artifactName,
    // Setting `depends` replaces electron-builder's default list, so it is
    // spelled out here: that default (which already has libsecret-1-0 for
    // @napi-rs/keyring's Secret Service) plus libgbm1 and libasound2, which
    // Electron links but the default omits. Without them a minimal Ubuntu
    // 24.04 install could not start /opt/CiteFox/citefox. libasound2t64
    // comes first: on Ubuntu 24.04 plain `libasound2` is a virtual package
    // that apt may satisfy with the OSS stub liboss4-salsa-asound2, and
    // Electron then fails with "undefined symbol: snd_device_name_get_hint".
    depends: [
      'libgtk-3-0',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'xdg-utils',
      'libatspi2.0-0',
      'libuuid1',
      'libsecret-1-0',
      'libgbm1',
      'libasound2t64 | libasound2'
    ]
  },
  toolsets: {
    // The static type2 AppImage runtime (20251108). The legacy default
    // ("0.0.0") needs libfuse2, which Ubuntu 22.04+ no longer installs, and
    // its arm64 runtime links the unversioned libz.so, so an arm64 AppImage
    // failed to start without zlib1g-dev ("libz.so: cannot open shared object file").
    appimage: '1.0.3'
  },
  // Only so each build writes latest.yml / latest-mac.yml / latest-linux.yml
  // (beta.yml… for a beta). Nothing uploads from here: every command passes
  // `--publish never` and the release workflow attaches the files to a draft.
  publish: {
    provider: 'github',
    owner: 'spcaeo',
    repo: 'citefox',
    releaseType: 'draft'
  }
}

/**
 * Fails the build when a native addon for the target arch is missing, for
 * example an x64 package built on an arm64 machine where npm installed only
 * the arm64 `@napi-rs/keyring-*` binary. Build each arch on a matching runner.
 */
async function verifyNativeModules(context: AfterPackContext): Promise<void> {
  // A universal app is merged from an x64 and an arm64 build, and each of
  // those passed through here first.
  if (context.arch === Arch.universal) return
  const arch = Arch[context.arch]
  const platform = context.electronPlatformName
  const resources =
    platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources'
        )
      : path.join(context.appOutDir, 'resources')
  const modules = path.join(resources, 'app.asar.unpacked', 'node_modules')
  const sqlite = path.join(modules, 'better-sqlite3', 'prebuilds', `${platform}-${arch}.node`)
  const keyringDir = path.join(modules, '@napi-rs')
  const keyring = existsSync(keyringDir)
    ? readdirSync(keyringDir).find((name) => name.startsWith(`keyring-${platform}-${arch}`))
    : undefined
  const missing: string[] = []
  if (!existsSync(sqlite)) missing.push(`better-sqlite3 prebuild ${platform}-${arch}`)
  if (keyring === undefined) missing.push(`@napi-rs/keyring-${platform}-${arch}*`)
  if (missing.length > 0) {
    throw new Error(
      `Packaged app is missing native modules: ${missing.join(', ')}. Build ${platform}-${arch} on a matching machine after npm ci.`
    )
  }
}

export default config
