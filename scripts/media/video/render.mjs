#!/usr/bin/env node
/**
 * Renders the product video with Revideo's headless renderer (Chrome headless shell
 * through Puppeteer, then ffmpeg). Run by scripts/media/make-video.mjs inside the
 * Docker container, from this folder, once public/ holds the footage and assets:
 *
 *   node render.mjs <out-dir> <download-url> [project file]
 *
 * The project file is ./src/project.ts (the product video) or ./src/tour-project.ts (the
 * welcome tour, make-tour.mjs).
 *
 * Writes <out-dir>/film.mp4 (silent; make-video.mjs adds the music and encodes).
 */
import { renderVideo } from '@revideo/renderer'

const [
  outDir = 'output',
  downloadUrl = 'https://spcaeo.github.io/citefox/',
  projectFile = './src/project.ts'
] = process.argv.slice(2)
process.env.DISABLE_TELEMETRY = 'true'

const file = await renderVideo({
  projectFile,
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
