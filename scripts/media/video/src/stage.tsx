/** @jsxImportSource @revideo/2d/lib */
import { Circle, Img, Layout, Node, Rect, Txt, Video } from '@revideo/2d'
import {
  all,
  createRef,
  sequence,
  waitFor,
  type Reference,
  type ThreadGenerator
} from '@revideo/core'
import * as ease from './ease'

/**
 * The stage of the product video: a laptop on a soft sepia ground, a camera that
 * flies in to what matters, highlight marks drawn in the app's own coordinates,
 * and karaoke captions in the band under the laptop.
 */

export const C = {
  ground: '#ece2cd',
  groundDeep: '#e2d4b8',
  surface: '#f7f0e1',
  ink: '#33281e',
  inkSoft: '#6a5644',
  inkFaint: '#c4b398',
  night: '#16181d',
  bezel: '#1c1a17',
  fox: '#c2410c',
  foxSoft: '#fdba74',
  white: '#ffffff'
}

export const FONT = { title: 'Inter Tight', text: 'Inter', mono: 'JetBrains Mono' }

/** The app screen inside the laptop: 1440×900 CSS px shown at SW×SH. */
export const SW = 1248
export const SH = 780
export const SCREEN_Y = -92
const K = SW / 1440
/** Captions live under this line; the camera is clipped above it. */
export const BAND_TOP = 352
/** Where a zoomed box lands: a little above the middle of the stage. */
const FOCUS = { x: 0, y: -94 }

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A CSS-px box on the app screen, in stage coordinates. */
export function toStage(box: Box): Box {
  return {
    x: -SW / 2 + box.x * K,
    y: SCREEN_Y - SH / 2 + box.y * K,
    w: box.w * K,
    h: box.h * K
  }
}

export function union(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const r = Math.max(...boxes.map((b) => b.x + b.w))
  const bottom = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: r - x, h: bottom - y }
}

export function pad(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + by * 2, h: box.h + by * 2 }
}

export class Stage {
  readonly camera = createRef<Node>()
  readonly laptop = createRef<Node>()
  readonly screen = createRef<Rect>()
  readonly marks = createRef<Node>()
  readonly band = createRef<Node>()
  readonly cover = createRef<Node>()
  private scaleNow = 1
  private media: Node | null = null
  private spot: { hole: Reference<Rect>; ring: Reference<Rect>; dim: Reference<Node> } | null = null

  build(): Node {
    return (
      <Node>
        <Rect width={1920} height={1080} fill={C.ground} />
        <Circle width={1700} height={1100} y={-160} fill={C.surface} opacity={0.55} />
        <Rect width={1920} height={BAND_TOP + 540} y={(BAND_TOP - 540) / 2} clip>
          <Node y={-(BAND_TOP - 540) / 2}>
            <Node ref={this.camera}>
              <Node ref={this.laptop}>
                <Rect
                  y={SCREEN_Y + 14}
                  width={SW + 60}
                  height={SH + 60}
                  radius={34}
                  fill={'#00000000'}
                  shadowColor={'#3a2a1a40'}
                  shadowBlur={60}
                  shadowOffsetY={26}
                />
                <Rect
                  y={SCREEN_Y}
                  width={SW + 36}
                  height={SH + 40}
                  radius={28}
                  fill={C.bezel}
                  stroke={'#3a3631'}
                  lineWidth={2}
                />
                <Circle y={SCREEN_Y - SH / 2 - 10} width={7} height={7} fill={'#3d3934'} />
                <Rect
                  ref={this.screen}
                  y={SCREEN_Y}
                  width={SW}
                  height={SH}
                  radius={6}
                  clip
                  fill={'#000'}
                />
                <Rect
                  y={SCREEN_Y + SH / 2 + 34}
                  width={SW + 250}
                  height={22}
                  radius={[4, 4, 20, 20]}
                  fill={'#cfc6b6'}
                  stroke={'#b4aa98'}
                  lineWidth={1.5}
                />
                <Rect
                  y={SCREEN_Y + SH / 2 + 27.5}
                  width={210}
                  height={9}
                  radius={[0, 0, 8, 8]}
                  fill={'#ada391'}
                />
              </Node>
              <Node ref={this.marks} />
            </Node>
          </Node>
        </Rect>
        <Node ref={this.band} />
        <Node ref={this.cover} />
      </Node>
    ) as Node
  }

  /** Puts a still on the screen at once (it matches the clip's last frame). */
  still(src: string): Img {
    const img = (<Img src={src} width={SW} height={SH} />) as Img
    this.swap(img)
    return img
  }

  private swap(node: Node): void {
    const old = this.media
    this.screen().add(node)
    this.media = node
    if (old) old.remove()
  }

  /** Fades a clip or still in over what the screen shows now. */
  *fadeIn(node: Node, seconds = 0.4): ThreadGenerator {
    node.opacity(0)
    const old = this.media
    this.screen().add(node)
    this.media = node
    yield* node.opacity(1, seconds, ease.inOut)
    if (old) old.remove()
  }

  /**
   * Plays a clip at a rate that fits it in `slot` seconds (never slower than 1×),
   * then leaves its last frame as the still `still`. Returns the rate used.
   */
  *clip(src: string, seconds: number, slot: number, still: string, fade = 0.4): ThreadGenerator {
    const rate = Math.max(1, seconds / slot)
    const video = (<Video src={src} width={SW} height={SH} playbackRate={rate} />) as Video
    video.play()
    yield* this.fadeIn(video, fade)
    yield* waitFor(Math.max(0, seconds / rate - fade - 0.04))
    video.pause()
    this.still(still)
  }

  /** The time a clip mark lands on screen, at the rate `clip` chose. */
  static at(mark: number, seconds: number, slot: number): number {
    return mark / Math.max(1, seconds / slot)
  }

  /** Flies the camera so `box` (stage coords) fills about `fill` of the stage width, or `scale`. */
  *focus(box: Box, scale: number, seconds = 1.1, curve: ease.Ease = ease.camera): ThreadGenerator {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    this.scaleNow = scale
    yield* all(
      this.camera().scale(scale, seconds, curve),
      this.camera().position([FOCUS.x - cx * scale, FOCUS.y - cy * scale], seconds, curve)
    )
  }

  *rest(seconds = 0.9): ThreadGenerator {
    this.scaleNow = 1
    yield* all(
      this.camera().scale(1, seconds, ease.camera),
      this.camera().position([0, 0], seconds, ease.camera)
    )
  }

  get scale(): number {
    return this.scaleNow
  }

  clearMarks(): void {
    this.marks().removeChildren()
  }

  /**
   * Dims the screen around `box` (stage coords) and draws an orange ring on it.
   * Returns the parts so a later step can move them to another box.
   */
  *spotlight(box: Box, seconds = 0.5): ThreadGenerator {
    const s = this.scaleNow
    const hole = createRef<Rect>()
    const ring = createRef<Rect>()
    const dim = createRef<Node>()
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    this.marks().add(
      <Node ref={dim} opacity={0} cache>
        <Rect y={SCREEN_Y} width={SW} height={SH} radius={6} fill={C.night} opacity={0.52} />
        <Rect
          ref={hole}
          x={cx}
          y={cy}
          width={box.w + 60}
          height={box.h + 60}
          radius={14 / s}
          fill={'#fff'}
          compositeOperation={'destination-out'}
        />
      </Node>
    )
    this.marks().add(
      <Rect
        ref={ring}
        x={cx}
        y={cy}
        width={box.w + 40}
        height={box.h + 40}
        radius={14 / s}
        stroke={C.fox}
        lineWidth={4 / s}
        opacity={0}
      />
    )
    yield* all(
      dim().opacity(1, seconds, ease.smooth),
      hole().size([box.w, box.h], seconds, ease.smooth),
      ring().opacity(1, seconds, ease.smooth),
      ring().size([box.w + 8 / s, box.h + 8 / s], seconds, ease.smooth)
    )
    this.spot = { hole, ring, dim }
  }

  /** Slides the current spotlight to another box. */
  *moveSpot(box: Box, seconds = 0.7): ThreadGenerator {
    if (!this.spot) return yield* this.spotlight(box)
    const { hole, ring } = this.spot
    const s = this.scaleNow
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    yield* all(
      hole().position([cx, cy], seconds, ease.smooth),
      hole().size([box.w, box.h], seconds, ease.smooth),
      ring().position([cx, cy], seconds, ease.smooth),
      ring().size([box.w + 8 / s, box.h + 8 / s], seconds, ease.smooth),
      ring().lineWidth(4 / s, seconds, ease.smooth),
      hole().radius(14 / s, seconds, ease.smooth),
      ring().radius(14 / s, seconds, ease.smooth)
    )
  }

  *unspot(seconds = 0.4): ThreadGenerator {
    const marks = this.marks()
    yield* all(...marks.children().map((child) => child.opacity(0, seconds, ease.inOut)))
    this.clearMarks()
    this.spot = null
  }

  /**
   * A callout chip beside `box`: a dark pill with an orange dot, joined to the box by
   * a short stem. `side` puts it above or below. Constant size whatever the zoom.
   */
  *chip(box: Box, text: string, side: 'above' | 'below' = 'below', align = 0.5): ThreadGenerator {
    const s = this.scaleNow
    const node = createRef<Node>()
    const stem = 34 / s
    const ax = box.x + box.w * align
    const ay = side === 'below' ? box.y + box.h + 6 / s : box.y - 6 / s
    const pill = createRef<Rect>()
    this.marks().add(
      <Node ref={node} x={ax} y={ay} opacity={0}>
        <Rect
          width={3 / s}
          height={stem}
          y={side === 'below' ? stem / 2 : -stem / 2}
          fill={C.fox}
          radius={2 / s}
        />
        <Rect
          ref={pill}
          layout
          y={side === 'below' ? stem : -stem}
          offsetY={side === 'below' ? -1 : 1}
          scale={1 / s}
          fill={C.night}
          radius={999}
          padding={[18, 30, 18, 26]}
          gap={16}
          alignItems={'center'}
          shadowColor={'#00000040'}
          shadowBlur={24}
          shadowOffsetY={8}
        >
          <Circle width={16} height={16} fill={C.fox} />
          <Txt text={text} fill={C.white} fontFamily={FONT.text} fontWeight={650} fontSize={36} />
        </Rect>
      </Node>
    )
    const from = side === 'below' ? -18 / s : 18 / s
    node().y(ay + from)
    yield* all(node().opacity(1, 0.45, ease.smooth), node().y(ay, 0.55, ease.smooth))
  }

  /**
   * A karaoke caption in the band: every word starts faint and fills to ink on the
   * beat (one word per `step` s), words in `strong` fill to fox orange. It holds
   * until `hold` s after it starts, then fades.
   */
  *caption(text: string, strong: string[], hold: number, step = 0.3): ThreadGenerator {
    const words = text.split(' ')
    const row = createRef<Layout>()
    const refs = words.map(() => createRef<Txt>())
    const keep = new Set(strong.map((w) => w.toLowerCase()))
    this.band().add(
      <Layout
        ref={row}
        layout
        width={1800}
        wrap={'wrap'}
        justifyContent={'center'}
        columnGap={17}
        rowGap={4}
        opacity={0}
      >
        {words.map((w, i) => (
          <Txt
            ref={refs[i]}
            text={w}
            fontFamily={FONT.title}
            fontWeight={700}
            fontSize={text.length > 58 ? 54 : 60}
            lineHeight={text.length > 58 ? 68 : 74}
            letterSpacing={-0.6}
            fill={C.inkFaint}
          />
        ))}
      </Layout>
    )
    const strongOf = (w: string): boolean => keep.has(w.toLowerCase())
    const restY = (BAND_TOP + 540) / 2 - 4
    row().y(restY + 14)
    yield* all(
      row().opacity(1, 0.3, ease.smooth),
      row().y(restY, 0.45, ease.smooth),
      sequence(
        step,
        ...words.map((w, i) =>
          refs[i]!().fill(strongOf(w) ? C.fox : C.ink, step * 1.2, ease.smooth)
        )
      ),
      waitFor(hold)
    )
    yield* row().opacity(0, 0.3, ease.exit)
    row().remove()
  }
}
