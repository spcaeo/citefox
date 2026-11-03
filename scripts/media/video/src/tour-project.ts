import { makeProject } from '@revideo/core'
import tour from './tour'

// The app's own fonts (OFL), copied to public/fonts by prepare.sh. Loaded before the
// first frame so no caption is drawn in a fallback face.
const faces: [string, string, string][] = [
  ['Inter Tight', 'inter-tight-latin-wght.woff2', '100 900'],
  ['Inter', 'inter-latin-wght.woff2', '100 900'],
  ['JetBrains Mono', 'jetbrains-mono-latin-wght.woff2', '100 800']
]
await Promise.all(
  faces.map(async ([family, file, weight]) => {
    const face = new FontFace(family, `url(/fonts/${file})`, { weight })
    document.fonts.add(await face.load())
  })
)

// The welcome tour: the same sepia ground as the product video (project.ts).
export default makeProject({
  scenes: [tour],
  settings: {
    shared: { size: { x: 1920, y: 1080 }, background: '#ece2cd' },
    rendering: { fps: 30, exporter: { name: '@revideo/core/ffmpeg', options: { format: 'mp4' } } }
  }
})
