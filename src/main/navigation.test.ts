import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  classifyUrl,
  devServerUrlFrom,
  isTrustedIpcSender,
  navigationAction,
  redirectAction,
  type UrlPolicy
} from './navigation'

const root = path.resolve('renderer-root')
const policy: UrlPolicy = {
  devServerOrigin: 'http://localhost:5173',
  appRoot: root
}

function fileUrl(...parts: string[]): string {
  return pathToFileURL(path.resolve(...parts)).href
}

describe('renderer URL policy', () => {
  test('allows the dev server, its socket, and files inside the app root', () => {
    expect(classifyUrl('http://localhost:5173/index.html', policy)).toBe('app')
    expect(classifyUrl('ws://localhost:5173/', policy)).toBe('app')
    expect(classifyUrl(fileUrl(root, 'index.html'), policy)).toBe('app')
    expect(classifyUrl('about:blank', policy)).toBe('app')
    expect(classifyUrl('devtools://devtools/bundled/inspector.html', policy)).toBe('app')
  })

  test('sends http(s) outside the dev server to the system browser', () => {
    expect(classifyUrl('https://foxcue.com/', policy)).toBe('external')
    expect(classifyUrl('http://127.0.0.1:5173/', policy)).toBe('external')
    expect(classifyUrl('https://example.com/', { devServerOrigin: null, appRoot: root })).toBe(
      'external'
    )
  })

  test('blocks other schemes, escapes, and remote sockets', () => {
    expect(classifyUrl('javascript:alert(1)', policy)).toBe('blocked')
    expect(classifyUrl('data:text/html,hi', policy)).toBe('blocked')
    expect(classifyUrl('file:///etc/passwd', policy)).toBe('blocked')
    expect(classifyUrl(fileUrl(root, '..', 'secret.txt'), policy)).toBe('blocked')
    expect(classifyUrl(fileUrl(`${root}-evil`, 'index.html'), policy)).toBe('blocked')
    expect(classifyUrl('ws://localhost:11434/', policy)).toBe('blocked')
    expect(classifyUrl('not a url', policy)).toBe('blocked')
    expect(classifyUrl(fileUrl(root, 'index.html'), { devServerOrigin: null, appRoot: null })).toBe(
      'blocked'
    )
  })

  test('navigation opens external links and redirects stay inside the app', () => {
    expect(navigationAction('app')).toBe('allow')
    expect(navigationAction('external')).toBe('open-external')
    expect(navigationAction('blocked')).toBe('cancel')
    expect(redirectAction('app')).toBe('allow')
    expect(redirectAction('external')).toBe('cancel')
    expect(redirectAction('blocked')).toBe('cancel')
  })
})

describe('dev server URL', () => {
  test('is honored only in an unpackaged build', () => {
    const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' }
    expect(devServerUrlFrom(env, false)).toBe('http://localhost:5173')
    expect(devServerUrlFrom(env, true)).toBeNull()
    expect(devServerUrlFrom({ ELECTRON_RENDERER_URL: '' }, false)).toBeNull()
    expect(devServerUrlFrom({}, false)).toBeNull()
  })

  test('a production policy treats a planted dev URL as external, not app content', () => {
    const packaged: UrlPolicy = {
      devServerOrigin: devServerUrlFrom({ ELECTRON_RENDERER_URL: 'https://evil.example' }, true),
      appRoot: root
    }
    expect(classifyUrl('https://evil.example/', packaged)).toBe('external')
  })
})

describe('IPC sender', () => {
  test('accepts only the app renderer: its files or the dev server', () => {
    expect(isTrustedIpcSender(fileUrl(root, 'renderer', 'index.html'), policy)).toBe(true)
    expect(isTrustedIpcSender('http://localhost:5173/', policy)).toBe(true)
    expect(isTrustedIpcSender('http://localhost:5173/#/settings', policy)).toBe(true)
  })

  test.each([
    ['about:blank'],
    ['devtools://devtools/bundled/inspector.html'],
    ['https://example.com/'],
    ['http://127.0.0.1:5173/'],
    ['file:///etc/passwd'],
    ['data:text/html,hi'],
    ['']
  ])('rejects %s', (url) => {
    expect(isTrustedIpcSender(url, policy)).toBe(false)
  })

  test('rejects a missing frame', () => {
    expect(isTrustedIpcSender(null, policy)).toBe(false)
    expect(isTrustedIpcSender(undefined, policy)).toBe(false)
  })
})
