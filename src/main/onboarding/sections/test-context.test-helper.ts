import type { SetupContext, SetupRow } from '@shared/ipc'

/** Test-only: a TextBolt setup context, and one with nothing filled in but the site. */

export function row(name: string, extra: Partial<SetupRow> = {}): SetupRow {
  return { name, detail: '', url: null, tag: null, ...extra }
}

export function textboltContext(): SetupContext {
  return {
    domain: 'textbolt.com',
    country: 'US',
    language: 'en',
    summary: 'TextBolt sells an email-to-SMS gateway to small US businesses.',
    brands: ['TextBolt', 'Text Bolt'],
    products: [row('Email-to-SMS gateway', { detail: 'Turns emails into texts.', url: '/' })],
    buyers: [row('IT managers at small businesses', { detail: 'Their gateway shut down.' })],
    triggers: ['A carrier shuts down its email-to-text gateway'],
    competitors: [row('TXTImpact', { url: 'txtimpact.com', tag: 'Email-to-SMS gateway' })],
    switchingFrom: ['AT&T email-to-text'],
    integrations: ['Gmail'],
    topic: 'Replacing a shut-down email-to-text gateway'
  }
}

export function bareContext(): SetupContext {
  return {
    domain: 'textbolt.com',
    country: '',
    language: '',
    summary: '',
    brands: [],
    products: [],
    buyers: [],
    triggers: [],
    competitors: [],
    switchingFrom: [],
    integrations: [],
    topic: ''
  }
}
