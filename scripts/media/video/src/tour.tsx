/** @jsxImportSource @revideo/2d/lib */
import { Circle, Img, Layout, Line, Node, Rect, Txt, makeScene2D } from '@revideo/2d'
import {
  all,
  createRef,
  createSignal,
  delay,
  map,
  sequence,
  tween,
  useThread,
  waitFor,
  type ThreadGenerator
} from '@revideo/core'
// footage.json: written by tests/media/tour.spec.ts, copied here by prepare.sh (not committed).
import film from './footage.json'
import tour from '../tour.json'
import * as ease from './ease'

const linear = (t: number): number => t
import { BAND_TOP, C, FONT, Stage, pad, toStage, union, type Box } from './stage'

/**
 * The CiteFox welcome tour (about 45 s): eight scenes of the real app on the TextBolt
 * sample data, on the beat grid in ../tour.json (96 BPM, a bar is 2.5 s). One caption
 * at a time is typed in over 0.5 s, held, and wiped out over 0.5 s, in dark ink under
 * the laptop. The captions are the ones in src/renderer/src/intro/captions.ts. No
 * speech, no provider names, no sponsor strip.
 */

const BEAT = 60 / tour.bpm
const SECONDS = Object.fromEntries(tour.scenes.map((s) => [s.id, s.beats * BEAT])) as Record<
  string,
  number
>

type Clips = typeof film.clips
type ClipName = keyof Clips
type Stills = typeof film.stills
type StillName = keyof Stills

const GREEN = '#1f7a4d'
/** The sample project's questions times the engines on show: the number the counter climbs to. */
const TOTAL = 60

const src = {
  clip: (name: string) => `/film/clips/${name}.mp4`,
  still: (name: string) => `/film/stills/${name}.jpg`
}

function stillBox(still: StillName, key: string): Box | null {
  const boxes = film.stills[still]?.boxes as Record<string, Box> | undefined
  const box = boxes?.[key]
  return box ? toStage(box) : null
}

function markBox(clip: ClipName, mark: string, key: string): Box | null {
  const marks = film.clips[clip]?.marks as
    Record<string, { at: number; boxes: Record<string, Box> }> | undefined
  const box = marks?.[mark]?.boxes[key]
  return box ? toStage(box) : null
}

function markAt(clip: ClipName, mark: string): number {
  const marks = film.clips[clip]?.marks as Record<string, { at: number }> | undefined
  return marks?.[mark]?.at ?? 0
}

const length = (clip: ClipName): number => film.clips[clip].seconds

/** The top half of a box: a tall drawer is shown from its top, not squeezed. */
function top(box: Box, share = 0.5): Box {
  return { x: box.x, y: box.y, w: box.w, h: box.h * share }
}

/**
 * Runs `body` and pads it out to exactly the scene's seconds, so the beat grid (and the
 * music) holds. A body that runs longer fails the render rather than drift off the beat.
 */
function* scene(id: string, body: ThreadGenerator): ThreadGenerator {
  const seconds = SECONDS[id]!
  const start = useThread().time()
  yield* all(waitFor(seconds), body)
  const took = useThread().time() - start
  if (took > seconds + 0.02) {
    throw new Error(`Scene ${id} runs ${took.toFixed(2)} s, over its ${seconds.toFixed(2)} s`)
  }
}

/** A step that runs only when its box exists (a missing box never stops the render). */
function* maybe(box: Box | null, run: (b: Box) => ThreadGenerator): ThreadGenerator {
  if (box) yield* run(box)
}

/** One caption: typed in over 0.5 s, held, wiped out over 0.5 s (right to left). */
function* caption(layer: Node, text: string, seconds: number): ThreadGenerator {
  const size = 66
  const chars = [...text]
  const refs = chars.map(() => createRef<Txt>())
  const row = createRef<Layout>()
  layer.add(
    <Layout ref={row} layout direction={'row'} alignItems={'center'} justifyContent={'center'}>
      {chars.map((ch, i) => (
        <Txt
          ref={refs[i]}
          text={ch === ' ' ? ' ' : ch}
          fontFamily={FONT.title}
          fontWeight={700}
          fontSize={size}
          letterSpacing={-0.6}
          fill={C.ink}
          opacity={0}
        />
      ))}
    </Layout>
  )
  const step = 0.5 / chars.length
  yield* sequence(step, ...refs.map((ref) => ref().opacity(1, step * 1.5)))
  yield* waitFor(Math.max(0, seconds - 1.0))
  yield* sequence(step, ...[...refs].reverse().map((ref) => ref().opacity(0, step * 1.5)))
  row().remove()
}

/** The captions, each at its own second, one on screen at a time. */
function* captions(layer: Node): ThreadGenerator {
  let now = 0
  for (const item of tour.captions) {
    yield* waitFor(Math.max(0, item.start - now))
    yield* caption(layer, item.text, item.end - item.start)
    now = item.end
  }
}

/** A ring that grows from the fox and fades out (the end card's small bloom). */
function* ring(
  ref: ReturnType<typeof createRef<Circle>>,
  size: number,
  alpha: number
): ThreadGenerator {
  yield* all(
    ref().size(size, 1.5, ease.smooth),
    (function* (): ThreadGenerator {
      yield* ref().opacity(alpha, 0.15)
      yield* ref().opacity(0, 1.3, ease.smooth)
    })()
  )
}

const ENGINES = [
  ['google_aio.png', 'AI Overviews'],
  ['google_ai_mode.png', 'AI Mode'],
  ['chatgpt.png', 'ChatGPT'],
  ['perplexity.png', 'Perplexity'],
  ['gemini.png', 'Gemini'],
  ['copilot.svg', 'Copilot']
] as const

export default makeScene2D('tour', function* (view) {
  const stage = new Stage()
  view.add(stage.build())
  stage.laptop().y(0)
  // Captions sit above everything, in the band under the laptop.
  const layer = createRef<Node>()
  view.add(<Node ref={layer} y={(BAND_TOP + 540) / 2 - 4} />)

  // Covers fill the picture above the caption band only, so a caption is never hidden.
  const COVER_Y = (BAND_TOP - 540) / 2

  // ---- Prepared overlays (added before the scenes run) ----
  // Scene 1: the fox mark opener (covers the whole picture until the caption lands).
  const opener = createRef<Rect>()
  const foxMark = createRef<Img>()
  const openerName = createRef<Txt>()
  stage.cover().add(
    <Rect ref={opener} width={1920} height={1080} fill={C.ground}>
      <Img
        ref={foxMark}
        src={'/assets/icon.svg'}
        width={280}
        height={280}
        y={-40}
        scale={0.55}
        rotation={-14}
      />
      <Txt
        ref={openerName}
        text={'CiteFox'}
        y={170}
        fontFamily={FONT.title}
        fontWeight={800}
        fontSize={96}
        letterSpacing={-2.5}
        fill={C.ink}
        opacity={0}
      />
    </Rect>
  )

  // Scene 3: the check across the engines, with a counter and a quiet middle.
  const checked = createSignal(0)
  const counter = createRef<Txt>()
  /** The counter climbs from where it is to `to`: the number, the words and the bar move together. */
  function* count(to: number, seconds: number, curve: (t: number) => number): ThreadGenerator {
    const from = checked()
    yield* tween(seconds, (value) => {
      const n = map(from, to, curve(value))
      checked(n)
      counter().text(`${Math.round(n)} of ${TOTAL} answers checked`)
    })
  }
  const checkCard = createRef<Rect>()
  const tiles = ENGINES.map(() => createRef<Rect>())
  const ticks = ENGINES.map(() => createRef<Line>())
  const dots = ENGINES.map(() => createRef<Circle>())
  const barFill = createRef<Rect>()
  stage.cover().add(
    <Rect ref={checkCard} width={1920} height={1080} fill={C.ground} opacity={0}>
      <Node y={COVER_Y}>
        <Layout layout direction={'row'} gap={26} y={-120}>
          {ENGINES.map(([file, name], i) => (
            <Rect
              ref={tiles[i]}
              layout
              direction={'column'}
              alignItems={'center'}
              justifyContent={'center'}
              gap={20}
              width={248}
              height={248}
              radius={30}
              fill={C.surface}
              stroke={'#e2d6bd'}
              lineWidth={4}
              opacity={0}
              scale={0.7}
              shadowColor={'#3a2a1a22'}
              shadowBlur={30}
              shadowOffsetY={10}
            >
              <Img src={`/assets/engines/${file}`} width={104} height={104} />
              <Txt text={name} fontFamily={FONT.text} fontWeight={650} fontSize={30} fill={C.ink} />
            </Rect>
          ))}
        </Layout>
        {/* The green mark on each tile's top-right corner (tiles are 248 wide, 274 apart). */}
        {ENGINES.map((_, i) => (
          <Node x={-685 + 274 * i + 90} y={-120 - 90}>
            <Circle ref={dots[i]} width={0} height={0} fill={GREEN} />
            <Line
              ref={ticks[i]}
              points={[
                [-11, 1],
                [-3, 10],
                [12, -9]
              ]}
              stroke={'#ffffff'}
              lineWidth={6}
              lineCap={'round'}
              lineJoin={'round'}
              end={0}
            />
          </Node>
        ))}
        <Txt
          y={96}
          ref={counter}
          text={`0 of ${TOTAL} answers checked`}
          fontFamily={FONT.title}
          fontWeight={750}
          fontSize={70}
          letterSpacing={-1}
          fill={C.ink}
        />
        <Rect y={196} width={1000} height={20} radius={10} fill={'#e2d6bd'}>
          <Rect
            ref={barFill}
            width={() => (1000 * checked()) / TOTAL}
            height={20}
            radius={10}
            offsetX={-1}
            x={-500}
            fill={C.fox}
          />
        </Rect>
      </Node>
    </Rect>
  )

  // Scene 8: the fox end card.
  const endCard = createRef<Rect>()
  const endFox = createRef<Img>()
  const endName = createRef<Txt>()
  const bloom = createRef<Circle>()
  const bloom2 = createRef<Circle>()
  stage.cover().add(
    <Rect ref={endCard} width={1920} height={1080} fill={C.ground} opacity={0}>
      <Node y={COVER_Y}>
        <Circle
          ref={bloom}
          width={300}
          height={300}
          y={-30}
          stroke={C.fox}
          lineWidth={5}
          opacity={0}
        />
        <Circle
          ref={bloom2}
          width={300}
          height={300}
          y={-30}
          stroke={C.foxSoft}
          lineWidth={4}
          opacity={0}
        />
        <Img
          ref={endFox}
          src={'/assets/icon.svg'}
          width={300}
          height={300}
          y={-30}
          scale={0.4}
          rotation={-14}
          opacity={0}
        />
        <Txt
          ref={endName}
          text={''}
          y={200}
          fontFamily={FONT.title}
          fontWeight={800}
          fontSize={104}
          letterSpacing={-3}
          fill={C.ink}
        />
      </Node>
    </Rect>
  )

  // ---- The scenes, in order ----
  function* scenes(): ThreadGenerator {
    // 1. Fox mark, then the AI answer your buyers read.
    const aio = stillBox('answer', 'answer')
    const own = stillBox('answer', 'own')
    stage.still(src.still('answer'))
    yield* scene(
      'hook',
      all(
        (function* (): ThreadGenerator {
          yield* all(
            foxMark().scale(1, 0.9, ease.spring),
            foxMark().rotation(0, 0.9, ease.spring),
            delay(0.35, openerName().opacity(1, 0.4, ease.smooth))
          )
          yield* waitFor(0.15)
          yield* all(opener().opacity(0, 0.55, ease.inOut), foxMark().scale(0.8, 0.55, ease.inOut))
          opener().remove()
        })(),
        (function* (): ThreadGenerator {
          yield* waitFor(1.2)
          yield* maybe(aio, (box) => stage.focus(pad(box, 18), 1.3, 1.5))
          yield* maybe(own, (box) => stage.spotlight(box, 0.5))
        })()
      )
    )
    stage.clearMarks()

    // 2. Add the questions buyers ask.
    const add = length('add')
    const addSlot = 4.4
    const typedAt = Stage.at(markAt('add', 'typed'), add, addSlot)
    const drawer = markBox('add', 'typed', 'drawer')
    yield* scene(
      'add',
      all(
        (function* (): ThreadGenerator {
          yield* all(
            stage.rest(0.6),
            stage.clip(src.clip('add'), add, addSlot, src.still('add'), 0.3)
          )
        })(),
        delay(
          Math.max(0.6, typedAt - 1.5),
          (function* (): ThreadGenerator {
            yield* maybe(drawer, (box) => stage.focus(pad(top(box, 0.45), 16), 1.5, 1.0))
          })()
        )
      )
    )

    // 3. The check: engine logos, a counter, and a quiet beat in the middle.
    const chk = length('check')
    const chkSlot = 1.9
    yield* scene(
      'check',
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.4),
          stage.clip(src.clip('check'), chk, chkSlot, src.still('check'), 0.3)
        )
        yield* waitFor(0.1)
        yield* checkCard().opacity(1, 0.4, ease.inOut)
        // t = 2.4 s: the engines pop in one by one and the counter starts.
        yield* all(
          sequence(
            0.13,
            ...tiles.map((ref) =>
              all(ref().opacity(1, 0.3, ease.smooth), ref().scale(1, 0.5, ease.spring))
            )
          ),
          count(12, 1.2, linear)
        )
        // t = 3.6 s to 7.3 s: the quiet beat (music dips from 3.5 s to 6.5 s). The counter
        // creeps, and the engines finish one by one, each with a green tick.
        yield* all(
          (function* (): ThreadGenerator {
            yield* count(48, 3.0, linear)
            yield* count(TOTAL, 0.7, ease.smooth)
          })(),
          sequence(
            0.45,
            ...tiles.map((tile, i) =>
              (function* (): ThreadGenerator {
                yield* all(tile().stroke(C.fox, 0.25), tile().scale(1.04, 0.25, ease.smooth))
                yield* waitFor(0.25)
                yield* all(
                  tile().stroke(GREEN, 0.25),
                  tile().scale(1, 0.25, ease.smooth),
                  dots[i]!().size(46, 0.3, ease.spring),
                  delay(0.1, ticks[i]!().end(1, 0.25, ease.smooth))
                )
              })()
            )
          )
        )
      })()
    )

    // 4. The result: cited in green, not cited in orange.
    const res = length('result')
    const resSlot = Math.min(res, 1.8)
    const cited = stillBox('result', 'cited')
    const notCited = stillBox('result', 'notCited')
    const focusRows = cited && notCited ? union(cited, notCited) : cited
    yield* scene(
      'result',
      (function* (): ThreadGenerator {
        yield* all(
          checkCard().opacity(0, 0.4, ease.inOut),
          stage.clip(src.clip('result'), res, resSlot, src.still('result'), 0.3),
          delay(
            0.5,
            maybe(focusRows, (box) => stage.focus(pad(box, 24), 1.25, 0.9))
          )
        )
        yield* maybe(cited, (box) => stage.spotlight(pad(box, 6), 0.4))
        yield* waitFor(1.2)
        yield* maybe(notCited, (box) => stage.moveSpot(pad(box, 6), 0.5))
        yield* waitFor(0.5)
      })()
    )
    stage.clearMarks()

    // 5. Who is cited instead.
    const riv = length('rivals')
    const rivSlot = 3.0
    const row = stillBox('rivals', 'row')
    yield* scene(
      'rivals',
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.5),
          stage.clip(src.clip('rivals'), riv, rivSlot, src.still('rivals'), 0.3)
        )
        yield* maybe(row, (box) => stage.focus(pad(box, 40), 1.7, 0.8))
        yield* maybe(row, (box) => stage.spotlight(box, 0.4))
      })()
    )
    stage.clearMarks()

    // 6. A fix, then the 14-day verdict.
    const fx = length('fix')
    const fxSlot = 3.7
    const brief = stillBox('fix', 'brief')
    const fixTitle = stillBox('fix', 'title')
    const fixTop = brief && fixTitle ? union(fixTitle, brief) : brief
    const ledger = stillBox('verdict', 'ledger')
    const vd = length('verdict')
    yield* scene(
      'fix',
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.5),
          stage.clip(src.clip('fix'), fx, fxSlot, src.still('fix'), 0.3),
          delay(
            2.2,
            maybe(fixTop, (box) => stage.focus(pad(box, 30), 1.4, 1.2))
          )
        )
        yield* maybe(brief, (box) => stage.spotlight(box, 0.3))
        yield* all(stage.unspot(0.25), stage.rest(0.5))
        yield* stage.clip(src.clip('verdict'), vd, 1.8, src.still('verdict'), 0.3)
        yield* maybe(ledger, (box) => stage.focus(pad(top(box, 0.6), 24), 1.45, 0.9))
      })()
    )
    stage.clearMarks()

    // 7. A client report.
    const rep = length('report')
    const opp = length('opportunity')
    const stand = stillBox('report', 'stand')
    yield* scene(
      'report',
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.5),
          stage.clip(src.clip('report'), rep, 1.9, src.still('report'), 0.3)
        )
        yield* maybe(stand, (box) => stage.focus(pad(box, 50), 1.7, 0.6))
        yield* all(
          stage.rest(0.4),
          stage.clip(src.clip('opportunity'), opp, 1.7, src.still('opportunity'), 0.3)
        )
      })()
    )

    // 8. The fox end card.
    yield* scene(
      'end',
      (function* (): ThreadGenerator {
        yield* endCard().opacity(1, 0.4, ease.inOut)
        yield* all(
          endFox().opacity(1, 0.3),
          endFox().scale(1, 0.9, ease.spring),
          endFox().rotation(0, 0.9, ease.spring),
          delay(
            0.3,
            (function* (): ThreadGenerator {
              const word = 'CiteFox'
              for (let i = 1; i <= word.length; i += 1) {
                endName().text(word.slice(0, i))
                yield* waitFor(0.055)
              }
            })()
          ),
          // A small bloom: two rings ripple out from the fox and fade.
          delay(0.5, ring(bloom, 760, 0.55)),
          delay(0.7, ring(bloom2, 980, 0.45))
        )
      })()
    )
  }

  yield* all(scenes(), captions(layer()))
})
