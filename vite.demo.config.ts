import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { nextBuildNumber } from './scripts/build-number'

/**
 * The browser demo (Docs/DEMO.md): the renderer built for the web with the demo
 * bridge (src/renderer/demo) instead of the preload. `npm run demo:build` writes
 * site/demo/, served by GitHub Pages at /citefox/demo/. Hash routing and a
 * relative base, so it works under any folder.
 *
 * DEMO_OUT changes the output folder; VITE_CITEFOX_DEMO_RECORD=1 makes the
 * recording build (tests/demo/record.e2e.ts).
 */

const version = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string })
  .version

/** The public site's address (scripts/site/config.mjs reads the same variable). */
function siteUrl(): string {
  const url = process.env.SITE_URL || 'https://spcaeo.github.io/citefox/'
  return url.endsWith('/') ? url : `${url}/`
}

function siteUrlPlugin(): Plugin {
  return {
    name: 'demo-site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl())
  }
}

export default defineConfig({
  root: resolve('src/renderer/demo'),
  base: './',
  publicDir: resolve('src/renderer/public'),
  plugins: [react(), siteUrlPlugin()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  define: {
    // DEMO_DEV=1: React's development build, for full error messages while debugging.
    ...(process.env.DEMO_DEV === '1' ? { 'process.env.NODE_ENV': '"development"' } : {}),
    __CITEFOX_DEMO_BUILD__: JSON.stringify({
      version,
      number: nextBuildNumber(),
      builtAt: new Date().toISOString()
    })
  },
  build: {
    outDir: resolve(process.env.DEMO_OUT ?? 'site/demo'),
    emptyOutDir: true,
    minify: true,
    chunkSizeWarningLimit: 4000
  }
})
