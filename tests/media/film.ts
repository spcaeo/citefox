import type { CDPSession, Locator, Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Frame-by-frame capture of the real app for the product video (video.spec.ts).
 *
 * A live screencast of a 2× window in Xvfb gives about 15 frames a second, so
 * scrolls and pointer moves stutter. Here every frame is set up first (the scroll
 * position, the pointer, the typed letter) and then captured at 2×, so motion is
 * smooth at 30 fps whatever the machine. Real clicks and real key presses still
 * drive the app; only the timing is ours. Each clip is a folder of JPEG frames
 * plus an ffconcat list with each frame's duration, encoded by make-video.mjs.
 */

export const FPS = 30
const FRAME = 1 / FPS

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Mark {
  at: number
  boxes: Record<string, Box>
}

export interface FilmManifest {
  clips: Record<string, { seconds: number; frames: number; marks: Record<string, Mark> }>
  stills: Record<string, { file: string; boxes: Record<string, Box> }>
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** An arrow pointer drawn in the page: the screencast has no system cursor. */
const POINTER_CSS = `
  #media-pointer { position: fixed; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none;
    z-index: 2147483647; transform-origin: 3px 2px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.28)); }
  #media-pointer.down { scale: .86; }
  #media-ring { position: fixed; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px;
    border-radius: 50%; border: 3px solid rgba(194, 65, 12, .85); pointer-events: none; opacity: 0;
    z-index: 2147483646; }
  .wc { display: none !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }`

const POINTER_SVG = `<svg viewBox="0 0 26 26" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
  <path d="M3 2 L3 21 L8 16.5 L11.4 24 L14.6 22.6 L11.3 15.3 L18 15.3 Z" fill="#16181d"
    stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`

export class Film {
  private readonly cdp: CDPSession
  private readonly page: Page
  private readonly root: string
  private clip: {
    name: string
    dir: string
    lines: string[]
    frames: number
    seconds: number
    marks: Record<string, Mark>
  } | null = null
  private last: Buffer | null = null
  readonly manifest: FilmManifest = { clips: {}, stills: {} }
  pointer = { x: 1100, y: 640 }

  constructor(page: Page, cdp: CDPSession, root: string) {
    this.page = page
    this.cdp = cdp
    this.root = root
  }

  async installPointer(): Promise<void> {
    await this.page.evaluate(
      ({ css, svg, x, y }) => {
        if (document.getElementById('media-pointer')) return
        const style = document.createElement('style')
        style.id = 'media-style'
        style.textContent = css
        document.head.appendChild(style)
        const dot = document.createElement('div')
        dot.id = 'media-pointer'
        dot.innerHTML = svg
        dot.style.translate = `${x - 3}px ${y - 2}px`
        document.body.appendChild(dot)
        const ring = document.createElement('div')
        ring.id = 'media-ring'
        document.body.appendChild(ring)
      },
      { css: POINTER_CSS, svg: POINTER_SVG, x: this.pointer.x, y: this.pointer.y }
    )
  }

  private async setPointer(x: number, y: number): Promise<void> {
    this.pointer = { x, y }
    await this.page.evaluate(
      ({ left, top }) => {
        const dot = document.getElementById('media-pointer')
        if (dot) dot.style.translate = `${left - 3}px ${top - 2}px`
      },
      { left: x, top: y }
    )
  }

  private async raf(): Promise<void> {
    await this.page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    )
  }

  private async grab(): Promise<Buffer> {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 })
    return Buffer.from(data, 'base64')
  }

  async start(name: string): Promise<void> {
    const dir = path.join(this.root, 'clips', name)
    await mkdir(dir, { recursive: true })
    await this.installPointer()
    this.clip = { name, dir, lines: ['ffconcat version 1.0'], frames: 0, seconds: 0, marks: {} }
  }

  /** Captures the page now and shows it for `seconds`. */
  async frame(seconds = FRAME): Promise<void> {
    const clip = this.clip
    if (!clip) throw new Error('No clip started')
    const file = `f${String(clip.frames).padStart(5, '0')}.jpg`
    this.last = await this.grab()
    await writeFile(path.join(clip.dir, file), this.last)
    clip.lines.push(`file '${clip.name}/${file}'`, `duration ${seconds.toFixed(4)}`)
    clip.frames += 1
    clip.seconds += seconds
  }

  async hold(seconds: number): Promise<void> {
    await this.raf()
    await this.frame(seconds)
  }

  /** Real-time frames for `ms` (an app transition we cannot step), each held as long as it took. */
  async live(ms: number): Promise<void> {
    const end = Date.now() + ms
    let before = Date.now()
    while (Date.now() < end) {
      const clip = this.clip
      if (!clip) throw new Error('No clip started')
      const file = `f${String(clip.frames).padStart(5, '0')}.jpg`
      this.last = await this.grab()
      await writeFile(path.join(clip.dir, file), this.last)
      const now = Date.now()
      const took = Math.max(FRAME, (now - before) / 1000)
      before = now
      clip.lines.push(`file '${clip.name}/${file}'`, `duration ${took.toFixed(4)}`)
      clip.frames += 1
      clip.seconds += took
    }
  }

  /** Notes the clip time now (and boxes on screen), so the video can zoom in step with it. */
  async mark(name: string, targets: Record<string, Locator | Box> = {}): Promise<void> {
    const clip = this.clip
    if (!clip) throw new Error('No clip started')
    clip.marks[name] = { at: clip.seconds, boxes: await this.boxes(name, targets) }
  }

  async stop(): Promise<void> {
    const clip = this.clip
    if (!clip) return
    const lastFile = `f${String(clip.frames - 1).padStart(5, '0')}.jpg`
    clip.lines.push(`file '${clip.name}/${lastFile}'`)
    await writeFile(
      path.join(this.root, 'clips', `${clip.name}.ffconcat`),
      clip.lines.join('\n') + '\n'
    )
    this.manifest.clips[clip.name] = {
      seconds: clip.seconds,
      frames: clip.frames,
      marks: clip.marks
    }
    this.clip = null
  }

  private async boxes(
    name: string,
    targets: Record<string, Locator | Box>
  ): Promise<Record<string, Box>> {
    const boxes: Record<string, Box> = {}
    for (const [key, target] of Object.entries(targets)) {
      if ('x' in target && 'w' in target) {
        boxes[key] = target
        continue
      }
      const box = await target.first().boundingBox()
      if (!box) throw new Error(`No box for ${name}.${key}`)
      boxes[key] = { x: box.x, y: box.y, w: box.width, h: box.height }
    }
    return boxes
  }

  /** The current screen as a 2× still with the boxes of `targets` (CSS px). */
  async still(name: string, targets: Record<string, Locator | Box>): Promise<void> {
    await this.raf()
    const boxes = await this.boxes(name, targets)
    await mkdir(path.join(this.root, 'stills'), { recursive: true })
    const file = `stills/${name}.jpg`
    await writeFile(path.join(this.root, file), await this.grab())
    this.manifest.stills[name] = { file, boxes }
  }

  /** Glides the pointer to the middle of `target` (or a point) over `seconds`. */
  async moveTo(target: Locator | { x: number; y: number }, seconds = 0.7): Promise<void> {
    let to: { x: number; y: number }
    if ('x' in target) to = target
    else {
      const box = await target.first().boundingBox()
      if (!box) throw new Error('Nothing to point at')
      to = { x: box.x + Math.min(box.width / 2, 70), y: box.y + box.height / 2 }
    }
    const from = { ...this.pointer }
    const steps = Math.max(1, Math.round(seconds * FPS))
    for (let i = 1; i <= steps; i += 1) {
      const t = ease(i / steps)
      // A slight arc, as a hand moves.
      const lift = Math.sin(Math.PI * t) * Math.min(40, Math.abs(to.x - from.x) * 0.08)
      await this.setPointer(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t - lift)
      await this.frame()
    }
    await this.page.mouse.move(to.x, to.y)
  }

  /** Moves to `target`, presses (pointer dips, an orange ring grows) and really clicks. */
  async click(target: Locator, seconds = 0.7): Promise<void> {
    await this.moveTo(target, seconds)
    const { x, y } = this.pointer
    await this.page.evaluate(() => document.getElementById('media-pointer')?.classList.add('down'))
    for (let i = 0; i < 4; i += 1) {
      await this.page.evaluate(
        ({ left, top, k }) => {
          const ring = document.getElementById('media-ring')
          if (!ring) return
          ring.style.translate = `${left}px ${top}px`
          ring.style.opacity = String(0.9 - k * 0.2)
          ring.style.scale = String(0.5 + k * 0.25)
        },
        { left: x, top: y, k: i }
      )
      await this.frame()
    }
    await this.page.evaluate(() => {
      document.getElementById('media-pointer')?.classList.remove('down')
      const ring = document.getElementById('media-ring')
      if (ring) ring.style.opacity = '0'
    })
    await this.page.mouse.click(x, y)
  }

  /** Smoothly scrolls the box that scrolls `target` so it sits `offset` px below the box top. */
  async scrollTo(target: Locator, offset: number, seconds = 1.2): Promise<void> {
    const plan = await target.first().evaluate((node, gap) => {
      const scrolls = (box: HTMLElement): boolean =>
        box.scrollHeight > box.clientHeight + 4 &&
        ['auto', 'scroll'].includes(getComputedStyle(box).overflowY)
      let scroller: HTMLElement | null = node.parentElement
      while (scroller && !scrolls(scroller)) scroller = scroller.parentElement
      if (!scroller) return null
      scroller.setAttribute('data-media-scroller', '1')
      const delta =
        node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - Number(gap)
      const max = scroller.scrollHeight - scroller.clientHeight
      return {
        from: scroller.scrollTop,
        to: Math.max(0, Math.min(max, scroller.scrollTop + delta))
      }
    }, offset)
    if (!plan) return
    const steps = Math.max(1, Math.round(seconds * FPS))
    for (let i = 1; i <= steps; i += 1) {
      const top = plan.from + (plan.to - plan.from) * ease(i / steps)
      await this.page.evaluate((value) => {
        const box = document.querySelector<HTMLElement>('[data-media-scroller="1"]')
        if (box) box.scrollTop = value
      }, top)
      await this.raf()
      await this.frame()
    }
    await this.page.evaluate(() =>
      document.querySelector('[data-media-scroller="1"]')?.removeAttribute('data-media-scroller')
    )
  }

  /** Types `text` key by key, a frame after each key, at about `cps` letters a second. */
  async type(text: string, cps = 14): Promise<void> {
    for (const char of text) {
      await this.page.keyboard.type(char)
      await this.raf()
      await this.frame(1 / cps)
    }
  }

  /**
   * Shows an answer the way a streaming reply arrives: the text of `target` grows a
   * word at a time (its own words, set back in full at the end) while what follows
   * it in the card waits, then appears.
   */
  async stream(target: Locator, wordsPerSecond = 26, after?: Locator): Promise<void> {
    const handle = await target.first().elementHandle()
    if (!handle) throw new Error('Nothing to stream')
    const full = await handle.evaluate((node) => node.textContent ?? '')
    const words = full.split(/(\s+)/)
    if (after)
      await after.evaluateAll((nodes) =>
        nodes.forEach((n) => ((n as HTMLElement).style.visibility = 'hidden'))
      )
    const perFrame = Math.max(1, Math.round(wordsPerSecond / FPS))
    let count = 0
    const total = words.filter((word) => word.trim()).length
    while (count < total) {
      count = Math.min(total, count + perFrame)
      await handle.evaluate(
        (node, [all, n]) => {
          const parts = String(all).split(/(\s+)/)
          let seen = 0
          let out = ''
          for (const part of parts) {
            if (part.trim()) {
              if (seen >= Number(n)) break
              seen += 1
            }
            out += part
          }
          node.textContent = out + ' ▍'
        },
        [full, count]
      )
      await this.raf()
      await this.frame()
    }
    await handle.evaluate((node, all) => (node.textContent = String(all)), full)
    if (after)
      await after.evaluateAll((nodes) =>
        nodes.forEach((n) => ((n as HTMLElement).style.visibility = ''))
      )
    await this.raf()
  }

  async save(): Promise<void> {
    await writeFile(path.join(this.root, 'film.json'), JSON.stringify(this.manifest, null, 2))
  }
}
