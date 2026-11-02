/** @jsxImportSource @revideo/2d/lib */
import { Img, Layout, Node, Rect, Txt, makeScene2D } from '@revideo/2d'
import {
  all,
  createRef,
  delay,
  sequence,
  useScene,
  useThread,
  waitFor,
  type ThreadGenerator
} from '@revideo/core'
// footage.json: written by tests/media/video.spec.ts, copied here by prepare.sh (not committed).
import film from './footage.json'
import timeline from '../timeline.json'
import * as ease from './ease'
import { C, FONT, Stage, pad, toStage, union, type Box } from './stage'

/**
 * CiteFox product video (v2): eight outcome-led scenes on the beat grid in
 * ../timeline.json. Every number on screen is the app's own, from the TextBolt demo
 * project; the captions say what you get, not which button to press.
 */

const BEAT = 60 / timeline.bpm
const SECONDS = Object.fromEntries(timeline.scenes.map((s) => [s.id, s.beats * BEAT])) as Record<
  string,
  number
>

type Clip = (typeof film.clips)[keyof typeof film.clips]
type StillName = keyof typeof film.stills

function clipOf(name: keyof typeof film.clips): Clip {
  return film.clips[name]
}

function boxOf(still: StillName, key: string): Box {
  const boxes = film.stills[still].boxes as Record<string, Box>
  const box = boxes[key]
  if (!box) throw new Error(`No box ${still}.${key}`)
  return toStage(box)
}

function markBox(clip: keyof typeof film.clips, mark: string, key: string): Box {
  const marks = clipOf(clip).marks as Record<string, { at: number; boxes: Record<string, Box> }>
  const box = marks[mark]?.boxes[key]
  if (!box) throw new Error(`No box ${clip}.${mark}.${key}`)
  return toStage(box)
}

function markAt(clip: keyof typeof film.clips, mark: string): number {
  const marks = clipOf(clip).marks as Record<string, { at: number }>
  const at = marks[mark]?.at
  if (at === undefined) throw new Error(`No mark ${clip}.${mark}`)
  return at
}

const src = {
  clip: (name: string) => `/film/clips/${name}.mp4`,
  still: (name: string) => `/film/stills/${name}.jpg`
}

/**
 * Runs `body` and pads it out to exactly `seconds`, so the beat grid (and the music)
 * holds. A body that runs longer fails the render rather than drift off the beat.
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

/** Words that rise into place one after another (snap-cn text-reveal, per word). */
function words(
  text: string,
  size: number,
  strong: string[],
  weight = 800
): {
  node: Node
  reveal: (stagger?: number) => ThreadGenerator
} {
  const parts = text.split(' ')
  const refs = parts.map(() => createRef<Txt>())
  const node = (
    <Layout
      layout
      direction={'row'}
      wrap={'wrap'}
      justifyContent={'center'}
      columnGap={size * 0.26}
      width={1700}
    >
      {parts.map((w, i) => (
        <Txt
          ref={refs[i]}
          text={w}
          fontFamily={FONT.title}
          fontWeight={weight}
          fontSize={size}
          lineHeight={size * 1.12}
          letterSpacing={-size * 0.025}
          fill={strong.includes(w) ? C.fox : C.ink}
          opacity={0}
          y={size * 0.5}
        />
      ))}
    </Layout>
  ) as Node
  return {
    node,
    reveal: (stagger = 0.09) =>
      sequence(
        stagger,
        ...refs.map((ref) => all(ref().opacity(1, 0.5, ease.smooth), ref().y(0, 0.7, ease.word)))
      )
  }
}

export default makeScene2D('film', function* (view) {
  const downloadUrl = useScene().variables.get('downloadUrl', 'https://spcaeo.github.io/citefox/')()
  const stage = new Stage()
  view.add(stage.build())
  stage.laptop().y(980)

  // 1. Hook: the question every marketer now has, then the AI answer itself.
  const title = createRef<Node>()
  const line1 = words('Buyers ask AI.', 136, [])
  const line2 = words('Does AI cite you?', 136, ['cite', 'you?'])
  view.add(
    <Node ref={title} y={-40}>
      <Node y={-90}>{line1.node}</Node>
      <Node y={80}>{line2.node}</Node>
    </Node>
  )
  stage.still(src.still('question'))
  const aio = boxOf('question', 'answer')
  yield* scene(
    'hook',
    (function* (): ThreadGenerator {
      yield* waitFor(0.15)
      yield* line1.reveal()
      yield* waitFor(0.25)
      yield* line2.reveal()
      yield* waitFor(1.0)
      yield* all(
        title().y(-760, 1.0, ease.zoom),
        title().opacity(0, 0.8, ease.exit),
        stage.laptop().y(0, 1.1, ease.camera),
        delay(
          0.5,
          stage.caption(
            'This is the AI answer your buyers read, and who it cites.',
            ['cites.'],
            3.0,
            0.22
          )
        ),
        delay(1.2, stage.focus(pad(aio, 18), 1.32, 1.4))
      )
    })()
  )
  title().remove()

  // 2. Know where you stand.
  const sum = clipOf('summary')
  const cited = boxOf('summary', 'cited')
  const trend = boxOf('summary', 'trend')
  yield* scene(
    'summary',
    all(
      stage.caption(
        'See in seconds how often AI cites you, and the trend.',
        ['often', 'trend.'],
        8.6
      ),
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('summary'), sum.seconds, 2.2, src.still('summary'))
        )
        yield* stage.focus(pad(cited, 30), 2.35, 1.1)
        yield* stage.spotlight(cited)
        yield* stage.chip(cited, '51 of 147 AI answers cite you', 'below', 0.3)
        yield* waitFor(1.4)
        yield* stage.moveSpot(pad(trend, 6), 0.6)
        yield* stage.chip(trend, '+25 since the last check', 'above', 0.5)
        yield* waitFor(1.6)
        yield* stage.unspot()
      })()
    )
  )

  // 3. See exactly which page wins.
  const q = clipOf('question')
  const qSlot = 4.6
  const own = boxOf('question', 'own')
  yield* scene(
    'question',
    all(
      stage.caption(
        'Know if AI cites the right page, and where you rank among sources.',
        ['right', 'page,', 'rank'],
        8.6,
        0.26
      ),
      (function* (): ThreadGenerator {
        const search = markBox('question', 'search', 'search')
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('question'), q.seconds, qSlot, src.still('question')),
          delay(
            Stage.at(markAt('question', 'search'), q.seconds, qSlot) + 0.4,
            stage.focus(pad(search, 60), 1.7, 0.8)
          ),
          delay(Stage.at(markAt('question', 'open'), q.seconds, qSlot), stage.rest(0.8))
        )
        yield* stage.focus(pad(own, 90), 2.1, 0.9)
        yield* stage.spotlight(own)
        yield* stage.chip(own, 'Right page cited · #3 of 5 sources', 'above', 0.5)
        yield* waitFor(1.6)
        yield* stage.unspot()
      })()
    )
  )

  // 4. Find who AI cites instead.
  const cmp = clipOf('competitors')
  const row = boxOf('competitors', 'row')
  yield* scene(
    'competitors',
    all(
      stage.caption(
        'Spot the competitors AI prefers, question by question.',
        ['competitors', 'prefers,'],
        6.2
      ),
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('competitors'), cmp.seconds, 2.6, src.still('competitors'))
        )
        yield* stage.focus(pad(row, 40), 1.7, 0.9)
        yield* stage.spotlight(row)
        yield* stage.chip(row, 'twilio.com is cited 48 times where you are not', 'above', 0.62)
        yield* waitFor(1.6)
        yield* stage.unspot()
      })()
    )
  )

  // 5. Fix the right page.
  const fx = clipOf('fixes')
  const fSlot = 4.3
  const brief = boxOf('fix', 'brief')
  const searches = boxOf('fix', 'searches')
  const fixTitle = boxOf('fix', 'title')
  yield* scene(
    'fixes',
    all(
      stage.caption(
        'Get the page to fix and a ready brief, in plain words.',
        ['page', 'brief,'],
        7.4
      ),
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('fixes'), fx.seconds, fSlot, src.still('fix'))
        )
        yield* stage.focus(pad(union(fixTitle, brief, searches), 20), 1.3, 0.9)
        yield* stage.spotlight(union(fixTitle, brief))
        yield* stage.chip(brief, '15 searches this page can win', 'below', 0.5)
        yield* waitFor(1.2)
        yield* stage.unspot(0.35)
      })()
    )
  )

  // Ask CiteFox: type a question, the answer streams in.
  const ask = clipOf('ask')
  const aSlot = 7.4
  const find = markBox('ask', 'results', 'find')
  const list = markBox('ask', 'results', 'list')
  const answer = boxOf('ask', 'answer')
  yield* scene(
    'ask',
    all(
      stage.caption(
        'Ask anything in plain words. Answers come from your own checks.',
        ['plain', 'own'],
        8.6,
        0.26
      ),
      (function* (): ThreadGenerator {
        const at = (mark: string): number => Stage.at(markAt('ask', mark), ask.seconds, aSlot)
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('ask'), ask.seconds, aSlot, src.still('ask')),
          delay(at('typing') - 0.2, stage.focus(pad(union(find, list), 30), 1.9, 0.8)),
          delay(at('drawer') - 0.5, stage.rest(0.7)),
          delay(at('answer') - 0.1, stage.focus(pad(answer, 40), 1.45, 0.8))
        )
        yield* stage.spotlight(answer, 0.4)
        yield* waitFor(0.9)
        yield* stage.unspot(0.3)
      })()
    )
  )

  // 6. Prove results.
  const rp = clipOf('reports')
  const op = clipOf('opportunity')
  const dr = clipOf('drill')
  const stand = boxOf('reports', 'stand')
  const panel = boxOf('opportunity', 'panel')
  const invisible = boxOf('opportunity', 'invisible')
  const drawer = boxOf('drill', 'drawer')
  yield* scene(
    'reports',
    all(
      stage.caption(
        "Client-ready reports: what's working, what to fix next.",
        ['Client-ready', 'working,', 'next.'],
        12.4
      ),
      (function* (): ThreadGenerator {
        yield* all(
          stage.rest(0.8),
          stage.clip(src.clip('reports'), rp.seconds, 2.6, src.still('reports'))
        )
        yield* stage.focus(pad(stand, 50), 2.0, 0.8)
        yield* stage.spotlight(stand, 0.4)
        yield* stage.chip(stand, 'Ready after every check', 'below', 0.5)
        yield* waitFor(0.3)
        yield* stage.unspot(0.25)
        yield* all(
          stage.rest(0.7),
          stage.clip(src.clip('opportunity'), op.seconds, 3.0, src.still('opportunity'), 0.01)
        )
        yield* stage.focus(pad(panel, 16), 1.65, 0.8)
        yield* stage.spotlight(invisible, 0.4)
        yield* stage.chip(invisible, '39 answers ignore you: start here', 'below', 0.3)
        yield* waitFor(0.6)
        yield* all(stage.unspot(0.25), stage.rest(0.6))
        yield* stage.clip(src.clip('drill'), dr.seconds, 1.6, src.still('drill'), 0.01)
        yield* stage.focus({ x: drawer.x, y: drawer.y, w: drawer.w, h: drawer.h * 0.5 }, 1.5, 0.6)
      })()
    )
  )

  // 7. Every AI answer engine, in one place.
  const engines = [
    ['google_aio.png', 'Google AI Overviews'],
    ['google_ai_mode.png', 'AI Mode'],
    ['chatgpt.png', 'ChatGPT'],
    ['perplexity.png', 'Perplexity'],
    ['gemini.png', 'Gemini'],
    ['copilot.svg', 'Copilot']
  ] as const
  const card = createRef<Rect>()
  const cards = engines.map(() => createRef<Node>())
  const strip = words('One place for every AI answer engine.', 84, ['every'])
  stage.cover().add(
    <Rect ref={card} width={1920} height={1080} fill={C.ground} opacity={0}>
      <Node y={-170}>{strip.node}</Node>
      <Layout layout direction={'row'} gap={28} y={110}>
        {engines.map(([file, name], i) => (
          <Node ref={cards[i]} opacity={0} scale={0.7}>
            <Rect
              layout
              direction={'column'}
              alignItems={'center'}
              justifyContent={'center'}
              gap={22}
              width={272}
              height={272}
              radius={30}
              fill={C.surface}
              stroke={'#e2d6bd'}
              lineWidth={2}
              shadowColor={'#3a2a1a22'}
              shadowBlur={30}
              shadowOffsetY={10}
            >
              <Img src={`/assets/engines/${file}`} width={116} height={116} />
              <Txt
                text={name}
                fontFamily={FONT.text}
                fontWeight={650}
                fontSize={name.length > 12 ? 27 : 33}
                fill={C.ink}
              />
            </Rect>
          </Node>
        ))}
      </Layout>
    </Rect>
  )
  yield* scene(
    'engines',
    (function* (): ThreadGenerator {
      yield* card().opacity(1, 0.45, ease.inOut)
      yield* all(
        strip.reveal(0.07),
        delay(
          0.5,
          sequence(
            0.09,
            ...cards.map((ref) =>
              all(ref().opacity(1, 0.35, ease.smooth), ref().scale(1, 0.7, ease.spring))
            )
          )
        )
      )
    })()
  )

  // 8. End card: the fox, the promise, where to get it.
  const end = createRef<Rect>()
  const logo = createRef<Img>()
  const name = createRef<Txt>()
  const promise = createRef<Txt>()
  const by = createRef<Txt>()
  const url = createRef<Rect>()
  const underline = createRef<Rect>()
  stage.cover().add(
    <Rect ref={end} width={1920} height={1080} fill={C.ground} opacity={0}>
      <Img
        ref={logo}
        src={'/assets/icon.svg'}
        width={250}
        height={250}
        y={-250}
        scale={0.4}
        rotation={-14}
        opacity={0}
      />
      <Txt
        ref={name}
        text={''}
        y={-58}
        fontFamily={FONT.title}
        fontWeight={800}
        fontSize={112}
        letterSpacing={-3}
        fill={C.ink}
      />
      <Txt
        ref={promise}
        text={'Free AI visibility tracker for Mac, Windows & Linux'}
        y={46}
        fontFamily={FONT.title}
        fontWeight={650}
        fontSize={52}
        fill={C.ink}
        opacity={0}
      />
      <Txt
        ref={by}
        text={'Source-available · by Space-O Technologies'}
        y={126}
        fontFamily={FONT.text}
        fontWeight={500}
        fontSize={38}
        fill={C.inkSoft}
        opacity={0}
      />
      <Rect
        ref={url}
        layout
        y={250}
        padding={[22, 40]}
        radius={999}
        fill={C.night}
        opacity={0}
        scale={0.92}
      >
        <Txt
          text={downloadUrl}
          fontFamily={FONT.mono}
          fontWeight={600}
          fontSize={40}
          fill={C.foxSoft}
        />
      </Rect>
      <Rect ref={underline} y={312} width={0} height={4} radius={2} fill={C.fox} />
    </Rect>
  )
  yield* scene(
    'end',
    (function* (): ThreadGenerator {
      yield* end().opacity(1, 0.4, ease.inOut)
      yield* all(
        logo().opacity(1, 0.3),
        logo().scale(1, 1.0, ease.spring),
        logo().rotation(0, 1.0, ease.spring),
        delay(
          0.35,
          (function* (): ThreadGenerator {
            const word = 'CiteFox'
            for (let i = 1; i <= word.length; i += 1) {
              name().text(word.slice(0, i))
              yield* waitFor(0.055)
            }
          })()
        ),
        delay(0.8, all(promise().opacity(1, 0.5, ease.smooth), promise().y(58, 0.6, ease.word))),
        delay(1.1, all(by().opacity(1, 0.5, ease.smooth))),
        delay(1.45, all(url().opacity(1, 0.5, ease.smooth), url().scale(1, 0.7, ease.spring))),
        delay(2.0, underline().width(420, 0.7, ease.smooth))
      )
    })()
  )
})
