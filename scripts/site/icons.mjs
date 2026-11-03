// Inline SVG icons for the download section. Drawn for this site (simple
// geometric glyphs, not official artwork). Each uses currentColor, so it takes
// the colour of the text around it, and is hidden from screen readers: the
// text next to it says the same thing.

const svg = (body, { viewBox = '0 0 24 24', cls = '' } = {}) =>
  `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`

/** An apple with a bite and a leaf. */
export const APPLE = svg(
  '<path fill="currentColor" d="M15.6 7.4c-1.3 0-2.3.8-3.6.8s-2.2-.8-3.5-.8C6.2 7.4 4.4 9.4 4.4 12.6c0 3.9 2.5 8.6 4.6 8.6 1.1 0 1.6-.7 3-.7s1.8.7 3 .7c1.5 0 2.8-2.1 3.7-4.4-1.6-.7-2.6-2.2-2.6-4 0-1.5.8-2.9 2-3.6-.7-1.1-1.6-1.8-2.5-1.8z"/><path fill="currentColor" d="M12.3 6.4c-.2-2 1.2-3.9 3.3-4.2.2 2-1.2 3.9-3.3 4.2z"/>'
)

/** Four panes, the window mark. */
export const WINDOWS = svg(
  '<path fill="currentColor" d="M3 5.2l7.6-1v7.3H3zM11.6 4.1L21 2.8v8.7h-9.4zM3 12.5h7.6v7.3L3 18.8zM11.6 12.5H21v8.7l-9.4-1.3z"/>'
)

/** A penguin (Tux): body with a belly, eyes and beak cut out, and two feet. */
export const LINUX = svg(
  '<path fill="currentColor" fill-rule="evenodd" d="M12 2.2c-2.6 0-4.1 2.1-4.1 4.8 0 1.4.3 2.2-.5 3.5C6.3 12.4 5 14.6 5 17c0 2.6 2.9 4.3 7 4.3s7-1.7 7-4.3c0-2.4-1.3-4.6-2.4-6.5-.8-1.3-.5-2.1-.5-3.5 0-2.7-1.5-4.8-4.1-4.8zM12 11.3c-2 0-3.5 2.1-3.5 4.6 0 2.3 1.5 3.9 3.5 3.9s3.5-1.6 3.5-3.9c0-2.5-1.5-4.6-3.5-4.6zM10.5 5.6a.9 1.1 0 1 0 0 2.2.9 1.1 0 1 0 0-2.2zM13.5 5.6a.9 1.1 0 1 0 0 2.2.9 1.1 0 1 0 0-2.2zM10.7 8.6h2.6L12 10.2z"/><path fill="currentColor" d="M4.6 20.6c-.2-1.2 1.2-2.2 2.8-1.9l1.6 2.1c-.8 1.1-4.2 1-4.4-.2zM19.4 20.6c.2-1.2-1.2-2.2-2.8-1.9L15 20.8c.8 1.1 4.2 1 4.4-.2z"/>'
)

const line = (d) =>
  `<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`

/** An arrow into a tray. */
export const DOWNLOAD = svg(
  line('M12 3.5v11M7 10l5 5 5-5M4.5 16.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5')
)

/** A window with a pointer: open the app. */
export const OPEN = svg(
  line(
    'M4.5 5.5h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM3.5 9h17M10 13l2 2 3.5-3.5'
  )
)

/** A key: add your keys and run a check. */
export const KEY = svg(
  line('M8 11a4 4 0 1 0 0 8 4 4 0 1 0 0-8zM10.9 12.1L19.5 3.5M16.5 6.5l2.2 2.2M14 9l1.6 1.6')
)

/** Notes, history and a shield, for the release row. */
export const NOTES = svg(line('M6 3.5h8.5l3.5 3.5v13.5H6zM14.5 3.5V7H18M9 11.5h6M9 15h6'))
export const HISTORY = svg(line('M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 8v4.5l3 2'))
export const SHIELD = svg(line('M12 3l7 3v5.5c0 4.5-3 7.7-7 9.5-4-1.8-7-5-7-9.5V6zM9 12l2 2 4-4'))

/** A browser window with a pointer: the live demo. */
export const BROWSER = svg(
  line(
    'M4.5 4.5h15a1 1 0 0 1 1 1v8M3.5 13.5v-8a1 1 0 0 1 1-1M3.5 8.5h17M3.5 13.5v4a1 1 0 0 0 1 1h6M14 13l6.5 2.4-2.8 1.2-1.2 2.8z'
  )
)

/** A play triangle in a circle: the video. */
export const PLAY = svg(
  `${line('M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z')}<path fill="currentColor" d="M10 8.3v7.4l6-3.7z"/>`
)

/** A report page with a chart: sample reports. */
export const REPORT = svg(
  line('M6 3.5h8.5l3.5 3.5v13.5H6zM14.5 3.5V7H18M9 17v-3M12 17v-6M15 17v-4.5')
)

/** Two columns side by side: compare. */
export const COMPARE = svg(
  line('M4 5.5h6.5v13H4zM13.5 5.5H20v13h-6.5zM6 9h2.5M6 12h2.5M15.5 9H18M15.5 12H18')
)

/** An arrow to the right, for text links. */
/** Angle brackets with a slash: the source code. */
export const CODE = svg(line('M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14'))
/** An open book: the help docs. */
export const BOOK = svg(
  line(
    'M12 6.5c-1.8-1.3-4.3-2-7.5-2v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2zM12 6.5v13'
  )
)
/** A speech bubble: discussions and issues. */
export const CHAT = svg(line('M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z'))

export const ARROW = svg(line('M5 12h14M13 6l6 6-6 6'))

/** The OS glyph for `mac`, `win` or `linux`. */
export const OS_ICON = { mac: APPLE, win: WINDOWS, linux: LINUX }
