// Renders the installer-window artwork with Electron's own Chromium. Run: npm run dmg:background
// - build/dmg-background.svg -> build/dmg-background.png (660x400, 72 dpi) and
//   build/dmg-background@2x.png (1320x800, 144 dpi). electron-builder joins the pair into one
//   Retina-aware image for the .dmg window (electron-builder.config.ts, dmg.background).
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WIDTH = 660
const HEIGHT = 400

/** Adds a pHYs chunk (pixels per metre) so Finder knows the image's dpi. */
function withDpi(png, dpi) {
  const perMetre = Math.round(dpi / 0.0254)
  const data = Buffer.alloc(9)
  data.writeUInt32BE(perMetre, 0)
  data.writeUInt32BE(perMetre, 4)
  data.writeUInt8(1, 8)
  const type = Buffer.from('pHYs')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 0)
  const chunk = Buffer.concat([length, type, data, crc])
  const ihdrEnd = 8 + 8 + 13 + 4 // signature + IHDR length/type + IHDR data + IHDR crc
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)])
}

app.disableHardwareAcceleration()
app.dock?.hide() // no Dock icon flash while it renders
app.on('window-all-closed', () => undefined)
void app.whenReady().then(async () => {
  const svg = readFileSync(join(root, 'build/dmg-background.svg'), 'utf8')
  for (const scale of [1, 2]) {
    const html = `<!doctype html><html><body style="margin:0;background:#fff"><div style="width:${WIDTH * scale}px;height:${HEIGHT * scale}px">${svg.replace(/width="660" height="400"/, `width="${WIDTH * scale}" height="${HEIGHT * scale}"`)}</div></body></html>`
    const win = new BrowserWindow({
      show: false,
      width: WIDTH * scale,
      height: HEIGHT * scale,
      useContentSize: true,
      webPreferences: { offscreen: true }
    })
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
    const image = await win.webContents.capturePage()
    const size = image.getSize()
    const exact =
      size.width === WIDTH * scale
        ? image
        : image.resize({ width: WIDTH * scale, height: HEIGHT * scale, quality: 'best' })
    const file = scale === 1 ? 'build/dmg-background.png' : 'build/dmg-background@2x.png'
    writeFileSync(join(root, file), withDpi(exact.toPNG(), 72 * scale))
    win.destroy()
  }
  app.quit()
})
