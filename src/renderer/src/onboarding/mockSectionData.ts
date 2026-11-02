import type { SetupListId, SetupRow, SetupSectionId } from '@shared/ipc'

/**
 * Canned TextBolt-like answers for the mock section client (mockSections.ts), the same
 * rows the e2e Claude stand-in returns (`src/main/assist/fixtures/setup.*.json`).
 * `redo` is a fresh list; `more` holds rows a ✦ Find more adds.
 */

function r(
  name: string,
  detail = '',
  url: string | null = null,
  tag: string | null = null
): SetupRow {
  return { name, detail, url, tag }
}

function rival(
  name: string,
  url: string | null,
  tier: 'direct' | 'partial',
  detail: string,
  tag: string | null = 'Email-to-SMS gateway'
): SetupRow {
  return { name, detail, url, tag, tier }
}

export const MOCK_TEXT: Readonly<Record<'summary' | 'topic', string>> = {
  summary:
    'TextBolt sells an email-to-SMS gateway to small US and Canadian businesses. An email sent to a phone number goes out as a text, and replies come back to the inbox, with no app or code.',
  topic: 'Replacing a shut-down email-to-text gateway'
}

export const MOCK_ROWS: Readonly<Record<SetupListId, { redo: SetupRow[]; more: SetupRow[] }>> = {
  brands: {
    redo: [r('TextBolt'), r('Text Bolt'), r('TextBolt.com')],
    more: [r('Textbolt SMS'), r('Text-Bolt')]
  },
  products: {
    redo: [
      r(
        'Email-to-SMS gateway',
        'Turns emails into text messages and sends replies back to the inbox.',
        '/'
      ),
      r('Bulk SMS alerts', 'Sends one alert by text to a whole team at once.', '/bulk-sms/')
    ],
    more: [
      r('SMS API', 'Sends texts from your own software with a short API call.', '/api/'),
      r('Shared team inbox', 'Lets a team answer text replies together from one inbox.', '/inbox/')
    ]
  },
  buyers: {
    redo: [
      r(
        'IT managers at small businesses',
        "Their carrier's email-to-text gateway shut down and alerts stopped reaching phones."
      ),
      r(
        'Office managers at clinics',
        'Patients miss emailed reminders and they need texts that reach every phone.'
      ),
      r(
        'Operations leads at field service companies',
        'Crews are away from desks and miss emailed job changes.'
      )
    ],
    more: [
      r(
        'Facility managers at manufacturing plants',
        'Alarm emails sit unread overnight and they need texts that wake someone up.'
      ),
      r(
        'School administrators',
        'Parents miss emailed closure notices and they need a fast text alert.'
      )
    ]
  },
  triggers: {
    redo: [
      r('A carrier announces its email-to-text gateway shutdown'),
      r('An alarm email sits unread overnight'),
      r('A schedule change goes out by email and staff miss it before a shift')
    ],
    more: [
      r('A new 10DLC registration rule starts blocking messages'),
      r('An on-call engineer misses a server alert sent by email')
    ]
  },
  competitors: {
    redo: [
      rival(
        'TXTImpact',
        'txtimpact.com',
        'direct',
        'Sends texts from email with replies back to the inbox for small teams.'
      ),
      rival(
        'Notifyre',
        'notifyre.com',
        'direct',
        'An email-to-SMS service that sells to the same small business buyers.'
      ),
      rival(
        'Textmagic',
        'textmagic.com',
        'direct',
        'Offers email to SMS alongside a web app for business texting.'
      ),
      rival(
        'Twilio',
        'twilio.com',
        'partial',
        'A developer SMS API: it can do the job but only with code.'
      )
    ],
    more: [
      rival(
        'EZ Texting',
        'eztexting.com',
        'partial',
        'An SMS marketing platform that can also send alerts by text.'
      ),
      rival(
        'SlickText',
        null,
        'partial',
        'Built for SMS marketing campaigns; some teams use it for alerts.',
        null
      )
    ]
  },
  switchingFrom: {
    redo: [
      r(
        'AT&T email-to-text',
        'The gateway shut down so emails to txt.att.net no longer arrive.',
        'att.com'
      ),
      r('Verizon email-to-text', 'Verizon is ending its email-to-text gateway.', 'verizon.com')
    ],
    more: [
      r(
        'T-Mobile email-to-text',
        "T-Mobile's gateway now blocks many business emails.",
        't-mobile.com'
      )
    ]
  },
  integrations: {
    redo: [
      r('Gmail', 'Users write a normal email in Gmail and it goes out as a text.', 'gmail.com'),
      r('Outlook', 'Users send texts from Outlook the same way as an email.', 'outlook.com')
    ],
    more: [
      r('WIN-911', 'Alarm software that sends its alerts by email to TextBolt.', 'win911.com'),
      r('Zapier', 'Workflows send texts through TextBolt by email.', 'zapier.com')
    ]
  },
  examples: {
    redo: [
      r(
        'email to text service',
        'See whether Google’s AI Overview quotes your home page or a rival’s list.',
        '/',
        'search'
      ),
      r(
        'what replaced the AT&T email-to-text gateway?',
        'See whether AI names TextBolt when buyers ask what to use instead.',
        '/',
        'question'
      ),
      r(
        'Our carrier shut down email-to-text and our alarm alerts stopped. We are a 30-person plant. What should we use?',
        'See whether ChatGPT recommends you or a rival to a buyer in a hurry.',
        '/pricing/',
        'situation'
      )
    ],
    more: []
  },
  questions: {
    redo: [
      r(
        'Our carrier shut down its email-to-text gateway. How do we keep sending alerts to staff phones?',
        'situation',
        '/',
        'problem'
      ),
      r('email to sms without an app', 'search', '/', 'options'),
      r(
        'Is an email-to-SMS service reliable enough for urgent alerts?',
        'question',
        null,
        'doubts'
      ),
      r(
        'Which email-to-SMS gateway works best for a small IT team?',
        'question',
        '/pricing/',
        'compare'
      ),
      r('email to text service price', 'search', '/pricing/', 'decide')
    ],
    more: [
      r('Can replies to a text come back to our shared inbox?', 'question', '/', 'fit'),
      r('att email to text replacement', 'search', '/', 'problem')
    ]
  }
}

/** The reply header per section, as main sends it (`SetupSectionPrompt.columns`). */
export const MOCK_COLUMNS: Readonly<Record<SetupSectionId, readonly string[]>> = {
  summary: ['text'],
  topic: ['text'],
  brands: ['name'],
  products: ['name', 'job', 'url'],
  buyers: ['who', 'situation'],
  triggers: ['trigger'],
  competitors: ['name', 'domain', 'product', 'tier', 'why'],
  switchingFrom: ['name', 'domain', 'why'],
  integrations: ['name', 'domain', 'why'],
  examples: ['shape', 'prompt', 'outcome', 'page'],
  questions: ['question', 'stage', 'shape', 'page']
}
