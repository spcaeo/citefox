/**
 * A confetti burst on its own full-window canvas, in the app's own colours, with no
 * library and no network. As the card lands, paper bursts out from behind it in the
 * middle of the window and flies in from both sides (the bottom corners and the middle
 * of each edge), flutters, falls and fades; the canvas then removes itself.
 */

/** Brand and status tokens, read from the page so they follow the theme. */
const COLOR_TOKENS = [
  '--fox',
  '--fox-on-spruce',
  '--ok',
  '--info',
  '--mark-line',
  '--chart-3',
  '--chart-2',
  '--bad'
]

function tokenColors(doc: Document): string[] {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement)
  const colors = COLOR_TOKENS.map((name) => style?.getPropertyValue(name).trim() ?? '')
  const found = colors.filter((color) => color.length > 0)
  return found.length > 0 ? found : ['currentColor']
}

const LIFE_MS = 3900
/** The card's entry: the paper waits until it lands. */
export const CONFETTI_DELAY_MS = 420
const GRAVITY = 0.32
const DRAG = 0.986

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  spin: number
  turn: number
  wobble: number
  color: string
  round: boolean
  /** Starts moving this long after the burst begins. */
  delay: number
}

function launch(
  pieces: Piece[],
  colors: readonly string[],
  count: number,
  from: { x: number; y: number },
  angle: number,
  spread: number,
  speed: number,
  delay = CONFETTI_DELAY_MS
): void {
  for (let i = 0; i < count; i += 1) {
    const direction = ((angle + (Math.random() - 0.5) * spread) * Math.PI) / 180
    const velocity = speed * (0.55 + Math.random() * 0.45)
    pieces.push({
      x: from.x,
      y: from.y,
      vx: Math.cos(direction) * velocity,
      vy: -Math.sin(direction) * velocity,
      size: 9 + Math.random() * 7,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      wobble: Math.random() * 10,
      color: colors[i % colors.length] as string,
      round: Math.random() < 0.25,
      delay
    })
  }
}

/** Plays one burst over the window. Returns a stop that removes it early. */
export function fireConfetti(doc: Document = document): () => void {
  const view = doc.defaultView
  const canvas = doc.createElement('canvas')
  const context = canvas.getContext?.('2d') ?? null
  if (view === null || context === null) return () => undefined
  const ratio = view.devicePixelRatio || 1
  const width = view.innerWidth
  const height = view.innerHeight
  canvas.width = width * ratio
  canvas.height = height * ratio
  canvas.className = 'celebrate-confetti'
  canvas.setAttribute('aria-hidden', 'true')
  doc.body.appendChild(canvas)
  context.scale(ratio, ratio)

  const pieces: Piece[] = []
  const colors = tokenColors(doc)
  const reach = Math.min(1, height / 800)
  const across = Math.min(1, width / 1200)
  // From behind the card: a ring that opens out from the middle of the window.
  launch(pieces, colors, 150, { x: width / 2, y: height / 2 }, 90, 360, 16 * reach + 8)
  launch(pieces, colors, 120, { x: 0, y: height }, 62, 40, 30 * reach + 8)
  launch(pieces, colors, 120, { x: width, y: height }, 118, 40, 30 * reach + 8)
  launch(pieces, colors, 70, { x: 0, y: height * 0.55 }, 38, 36, 24 * across + 8)
  launch(pieces, colors, 70, { x: width, y: height * 0.55 }, 142, 36, 24 * across + 8)

  const start = view.performance.now()
  let frame = 0
  const draw = (now: number): void => {
    const age = now - start
    context.clearRect(0, 0, width, height)
    context.globalAlpha = Math.max(0, 1 - Math.max(0, age - LIFE_MS * 0.6) / (LIFE_MS * 0.4))
    for (const piece of pieces) {
      if (age < piece.delay) continue
      piece.vx *= DRAG
      piece.vy = piece.vy * DRAG + GRAVITY
      piece.wobble += 0.12
      piece.x += piece.vx + Math.sin(piece.wobble) * 0.6
      piece.y += piece.vy
      piece.spin += piece.turn
      context.save()
      context.translate(piece.x, piece.y)
      context.rotate(piece.spin)
      context.scale(1, Math.cos(piece.wobble))
      context.fillStyle = piece.color
      if (piece.round) {
        context.beginPath()
        context.arc(0, 0, piece.size / 2.6, 0, Math.PI * 2)
        context.fill()
      } else {
        context.fillRect(-piece.size / 2, -piece.size * 0.3, piece.size, piece.size * 0.6)
      }
      context.restore()
    }
    if (age < LIFE_MS) frame = view.requestAnimationFrame(draw)
    else canvas.remove()
  }
  frame = view.requestAnimationFrame(draw)
  return () => {
    view.cancelAnimationFrame(frame)
    canvas.remove()
  }
}
