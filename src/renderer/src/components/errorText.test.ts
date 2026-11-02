// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest'
import {
  cleanErrorMessage,
  errorText,
  GENERIC_ERROR,
  NO_AI_TEXT,
  plainProviders
} from './errorText'

const wrapped = (channel: string, inner: string): Error =>
  new Error(`Error invoking remote method '${channel}': ${inner}`)

describe('errorText', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  test('strips the Electron wrapper, the error class and the channel prefix', () => {
    // Settings keeps provider names: it is where the connection is fixed.
    window.location.hash = '#/settings?tab=connections'
    expect(
      errorText(
        wrapped(
          'claudeCode:runCheckup',
          'IpcRequestError: claudeCode:runCheckup: The Claude Code path must point to the claude program.'
        ),
        'x'
      )
    ).toBe('The Claude Code path must point to the claude program.')
    expect(errorText(wrapped('fixes:create', 'Error: fixes:create: Pick a market'), 'x')).toBe(
      'Pick a market'
    )
    expect(errorText(wrapped('ask:question', 'Error: The reply did not match.'), 'x')).toBe(
      'The reply did not match.'
    )
    expect(errorText(wrapped('keys:test', 'ProviderError: SerpApi said no.'), 'x')).toBe(
      'SerpApi said no.'
    )
    expect(errorText(new Error('settings:update: Choose a country.'), 'x')).toBe(
      'Choose a country.'
    )
  })

  test('never names a provider outside Connections, Status, Permissions and Settings', () => {
    window.location.hash = '#/competitors'
    expect(errorText(wrapped('keys:test', 'ProviderError: SerpApi said no.'), 'x')).toBe(
      'the search service said no.'
    )
    expect(errorText(new Error('Claude Code is not logged in.'), 'x')).toBe(
      'CiteFox AI is not logged in.'
    )
    expect(errorText(new Error('Codex hit its usage limit.'), 'x')).toBe(
      'CiteFox AI hit its usage limit.'
    )
    expect(errorText(new Error('Add an Anthropic API key in Connections.'), 'x')).toBe(
      'Add an AI key in Connections.'
    )
  })

  test('a missing AI program reads as one calm line, on any screen but Connections', () => {
    expect(plainProviders('Claude Code was not found on this computer.', '#/competitors')).toBe(
      NO_AI_TEXT
    )
    expect(plainProviders('codex: command not found', '#/pages/p1/results')).toBe(NO_AI_TEXT)
    expect(plainProviders('Claude Code was not found.', '#/connections?tab=claude')).toBe(
      'Claude Code was not found.'
    )
  })

  test('maps fixed engine reasons and system codes to a next step', () => {
    expect(
      errorText(wrapped('keys:add', 'IpcRequestError: keys:add: Invalid request'), 'x')
    ).toMatch(/^CiteFox could not use what was sent\. Check the fields/)
    expect(errorText(new Error('connect ECONNREFUSED 127.0.0.1:443'), 'x')).toMatch(
      /Check your internet connection/
    )
    expect(errorText(new Error('Blocked IPC sender for pages:list'), 'x')).toMatch(
      /Restart CiteFox/
    )
  })

  test('keeps the fallback for empty or unknown values', () => {
    expect(errorText(wrapped('settings:update', 'Error: '), 'Could not save.')).toBe(
      'Could not save.'
    )
    expect(errorText(undefined, 'Could not load.')).toBe('Could not load.')
    expect(errorText(42)).toBe(GENERIC_ERROR)
  })

  test('reads { message } objects; a bare string is not an engine message', () => {
    expect(errorText('nope', 'Fallback')).toBe('Fallback')
    expect(errorText({ code: 'not_found', message: 'That page is gone.' }, 'x')).toBe(
      'That page is gone.'
    )
  })

  test('never echoes a secret the user just typed', () => {
    expect(errorText(new Error('Bad key sk-123 rejected'), 'x', { secret: 'sk-123' })).toBe(
      GENERIC_ERROR
    )
  })

  test('adds a full stop only when asked and missing', () => {
    expect(errorText(new Error('fixes:create: Pick a market'), 'x', { sentence: true })).toBe(
      'Pick a market.'
    )
    expect(errorText(new Error('Done!'), 'x', { sentence: true })).toBe('Done!')
  })

  test('cleanErrorMessage is idempotent and leaves plain text alone', () => {
    const once = cleanErrorMessage(
      "Error invoking remote method 'pages:get': Error: pages:get: That page was not found."
    )
    expect(once).toBe('That page was not found.')
    expect(cleanErrorMessage(once)).toBe(once)
    expect(cleanErrorMessage('Note: the time is 10:30.')).toBe('Note: the time is 10:30.')
  })
})
