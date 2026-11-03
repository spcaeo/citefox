import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import { nextBuildNumber } from './scripts/build-number'

const shared = resolve('src/shared')

/** Ship report fonts next to the main bundle so packaged `out/main` can read them. */
function copyPdfFonts(): Plugin {
  return {
    name: 'copy-pdf-fonts',
    closeBundle() {
      cpSync(resolve('resources/fonts'), resolve('out/main/fonts'), { recursive: true })
    }
  }
}

/**
 * Ship the help topics (`Docs/help/*.md`) next to the main bundle: Ask CiteFox
 * ranks their sections in main (`src/main/ask/help/library.ts` reads
 * `out/main/help`), and `out/**` is packed into app.asar. A missing folder
 * ships none; Ask then answers without help sections.
 */
function copyHelpDocs(): Plugin {
  return {
    name: 'copy-help-docs',
    closeBundle() {
      const target = resolve('out/main/help')
      rmSync(target, { recursive: true, force: true })
      if (!existsSync(resolve('Docs/help'))) return
      cpSync(resolve('Docs/help'), target, {
        recursive: true,
        filter: (source) => !/\.(png|jpe?g|gif|webp)$/i.test(source)
      })
    }
  }
}

/**
 * Which build this is (`AppInfo.build`): the short commit, or null outside git,
 * the build number that only goes up (the git commit count, or a stored
 * counter outside git) and when the bundle was made. Read once per build;
 * `src/main/build-info.ts` reads it and the footer shows it as the release line.
 */
function buildInfo(): { commit: string | null; number: number; builtAt: string } {
  let commit: string | null
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    commit = /^[0-9a-f]{4,40}$/.test(out) ? out : null
  } catch {
    commit = null
  }
  return { commit, number: nextBuildNumber(), builtAt: new Date().toISOString() }
}

/**
 * The official CiteFox Apps Script web app (owner's Sheet, server/README.md). It is public
 * (every installed app carries it); only installed apps use it, never dev or tests
 * (src/main/account/runtime.ts). Override with CITEFOX_REGISTER_URL.
 */
const OFFICIAL_REGISTER_URL =
  'https://script.google.com/macros/s/AKfycbxFnAKk0Gv3XjXHTzctFUoLrV57inRbsoHg54kw__xyTV7qJ2Bb659AO6XT-4VM9IpVdQ/exec'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['fontkit'] }), copyPdfFonts(), copyHelpDocs()],
    define: {
      __CITEFOX_BUILD__: JSON.stringify(buildInfo()),
      // "Join CiteFox" and the daily ping go to the owner's Apps Script web app
      // (server/README.md). Unset: the app sends nothing (src/main/account/endpoint.ts).
      __CITEFOX_REGISTER__: JSON.stringify({
        // `||`, not `??`: GitHub Actions passes an unset repository variable as an empty
        // string, which `??` would keep, leaving every released app without an address.
        url: process.env.CITEFOX_REGISTER_URL || OFFICIAL_REGISTER_URL,
        token: process.env.CITEFOX_REGISTER_TOKEN || null
      })
    },
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    build: {
      rolldownOptions: {
        output: {
          // Main stays readable (unminified) but ships without doc comments:
          // they carry developer notes and example sites that do not belong in
          // a release. Licence and pure-annotation comments stay.
          // src/main/export/real-data-guard.test.ts checks the bundle.
          comments: { legal: true, annotation: true, jsdoc: false }
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': shared
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': shared
      }
    },
    plugins: [react()],
    build: {
      // electron-vite leaves the renderer unminified by default. `vite build`
      // is production-only here (dev uses the dev server), so always minify.
      minify: true
    }
  }
})
