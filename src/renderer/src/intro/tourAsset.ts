/**
 * The tour film, when one is bundled (src/renderer/src/assets/intro/tour.mp4). No film, no
 * tour: the app never waits for it and never shows an empty player.
 */
const found = import.meta.glob('../assets/intro/tour.mp4', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

export const TOUR_SRC: string | null = Object.values(found)[0] ?? null
