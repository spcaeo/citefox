/**
 * The one place that turns a rejected IPC call into words a person can act on.
 *
 * Electron rejects `ipcRenderer.invoke` with
 *   "Error invoking remote method 'claudeCode:runCheckup': IpcRequestError: claudeCode:runCheckup: <reason>"
 * The wrapper, the error class name and the `area:verb:` channel prefix are
 * internal. The engine's own sentence after them is kept. A few fixed engine
 * reasons and system codes are mapped to a sentence that says what to do.
 */

const REMOTE_INVOKE = /^Error invoking remote method '[^']*':\s*/
/** "Error: ", "IpcRequestError: ", "ProviderError: " … */
const ERROR_CLASS = /^(?:[A-Z][A-Za-z]*)?Error:\s*/
/** "claudeCode:runCheckup: ", "settings:update: ". Two segments, no spaces. */
const CHANNEL = /^[a-z][A-Za-z0-9]*:[a-z][A-Za-z0-9]*:\s*/

export const GENERIC_ERROR = 'Something went wrong. Try again.'

/** Fixed reasons that mean nothing to a reader, with what to do instead. */
const KNOWN: readonly (readonly [RegExp, string])[] = [
  [
    /^Invalid request\.?$/i,
    'CiteFox could not use what was sent. Check the fields and try again; if it keeps happening, restart CiteFox.'
  ],
  [
    /unexpected arguments/i,
    'CiteFox sent that request the wrong way. Restart CiteFox and try again.'
  ],
  [
    /^Blocked IPC (?:channel|sender)/,
    'CiteFox blocked that request from this window. Restart CiteFox and try again.'
  ],
  [/^No handler registered for/, 'CiteFox is still starting. Wait a moment and try again.'],
  [
    /^The (?:reply|filters) did not match the schema\.?$/,
    'The AI’s reply was not in the shape CiteFox needs. Try again.'
  ],
  [
    /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNRESET)\b/,
    'CiteFox could not reach the service. Check your internet connection and try again.'
  ],
  [/\bETIMEDOUT\b/, 'The request timed out. Check your internet connection and try again.'],
  [/\bSQLITE_BUSY\b/, 'CiteFox is saving something else. Try again in a moment.'],
  [/\b(?:SQLITE_FULL|ENOSPC)\b/, 'The disk is full. Free some space and try again.'],
  [
    /\b(?:EACCES|EPERM)\b/,
    'CiteFox was not allowed to open a file it needs. Check the folder permissions and try again.'
  ]
]

/** Screens where provider names may show: where you connect and check them. */
const PROVIDER_SCREENS = /^#\/(?:connections|status|permissions|settings)(?:[/?]|$)/

/** No AI program on this computer: one calm line instead of the program's own error. */
const NO_AI =
  /\b(?:Claude Code|Codex|claude|codex)\b[^.]*\b(?:not found|not installed|could not be found|ENOENT)\b/i

/** Provider names in an engine message, and the words users see instead. */
const PROVIDER_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\bAnthropic API keys?\b/g, 'AI key'],
  [/\b(?:Claude Code|Claude|Codex)\b/g, 'CiteFox AI'],
  [/\bAnthropic\b/g, 'the AI service'],
  [/\b(?:SerpApi|cloro)\b/g, 'the search service'],
  [/\bJina(?: Reader)?\b/g, 'the backup reader']
]

/**
 * Users never see Claude, Codex, SerpApi, cloro or Jina outside Connections,
 * Status, Permissions and Settings (R12). Those screens keep the names, since
 * that is where a person fixes the connection. A missing AI program reads as
 * one calm line that says where to connect one.
 */
export function plainProviders(text: string, hash = currentHash()): string {
  if (PROVIDER_SCREENS.test(hash)) return text
  if (NO_AI.test(text)) return NO_AI_TEXT
  let out = text
  for (const [pattern, plain] of PROVIDER_WORDS) out = out.replace(pattern, plain)
  return out
}

export const NO_AI_TEXT = 'No AI is connected yet. Connect one in Connections to use this.'

function currentHash(): string {
  return typeof window === 'undefined' ? '' : (window.location?.hash ?? '')
}

/**
 * The raw text of a thrown Error or a `{ message }` object. Anything else
 * (a bare string, null) is not an engine message and uses the fallback.
 */
function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/**
 * Strips Electron's wrapper, error class names and the channel prefix, then
 * maps known codes. Returns '' when nothing readable is left. Idempotent.
 */
export function cleanErrorMessage(raw: string, keepProviders = false): string {
  let text = raw.trim().replace(REMOTE_INVOKE, '')
  for (let pass = 0; pass < 4; pass += 1) {
    const next = text.replace(ERROR_CLASS, '').replace(CHANNEL, '')
    if (next === text) break
    text = next
  }
  text = text.trim()
  for (const [pattern, plain] of KNOWN) {
    if (pattern.test(text)) return plain
  }
  return keepProviders ? text : plainProviders(text)
}

export interface ErrorTextOptions {
  /** A secret the user just typed. A message that echoes it is replaced. */
  secret?: string
  /** End the text with a full stop when it has no closing punctuation. */
  sentence?: boolean
  /** Keep Claude, SerpApi and the rest: the message shows where those are set up. */
  keepProviders?: boolean
}

/** Plain words for a rejected IPC call (or any thrown value), else `fallback`. */
export function errorText(
  error: unknown,
  fallback: string = GENERIC_ERROR,
  options: ErrorTextOptions = {}
): string {
  const raw = rawMessage(error)
  const secret = options.secret ?? ''
  if (secret.length > 0 && raw.includes(secret)) return GENERIC_ERROR
  const text = cleanErrorMessage(raw, options.keepProviders) || fallback
  if (!options.sentence) return text
  return /[.!?…)]$/.test(text) ? text : `${text}.`
}
