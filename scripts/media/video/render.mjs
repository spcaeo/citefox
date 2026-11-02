#!/usr/bin/env node
/**
 * Renders the product video with Revideo's headless renderer (Chrome headless shell
 * through Puppeteer, then ffmpeg). Run by scripts/media/make-video.mjs inside the
 * Docker container, from this folder, once public/ holds the footage and assets:
 *
 *   node render.mjs <out-dir> <download-url>
 *
 * Writes <out-dir>/film.mp4 (silent; make-video.mjs adds the music and encodes).
 */
import { renderVideo } from '@revideo/renderer'

const [outDir = 'output', downloadUrl = 'https://spcaeo.github.io/citefox/'] = process.argv.slice(2)
process.env.DISABLE_TELEMETRY = 'true'

const file = await renderVideo({
  projectFile: './src/project.ts',
  variables: { downloadUrl },
  settings: {
    outFile: 'film.mp4',
    outDir,
    logProgress: true,
    workers: 1,
    puppeteer: {
      headless: 'shell',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
    }
  }
})
console.log(`[video] rendered ${file}`)
