import type { AioReference } from '@shared/domain'

/**
 * The sources of one real TextBolt check ("email to SMS alerts stopped", cloro, Oct 2026),
 * as stored: twilio.com and clicksend.com were stored as `other` because they were saved
 * as competitors after the check.
 */
export const REAL_REFERENCES: readonly AioReference[] = [
  ref(
    1,
    'https://textbolt.com/migration/verizon/',
    'own',
    true,
    'web',
    'Verizon Email to Text (vtext & vzwpix) Not Working? Fix It - TextBolt'
  ),
  ref(
    2,
    'https://www.twilio.com/en-us/blog/developers/tutorials/integrations/smtp-to-sms-programmable-messaging',
    'other',
    false,
    'web',
    'Email to SMS Gateways Are Going Away. How to Keep Your Alerts ...'
  ),
  ref(
    3,
    'https://textbolt.com/blog/email-to-sms-gateway/',
    'target',
    false,
    'web',
    'Email-to-SMS Gateway: How It Works and How to Pick One'
  ),
  ref(
    4,
    'https://www.clicksend.com/us/sms/email-to-sms/',
    'other',
    false,
    'web',
    'Email to SMS Gateway Service | Send SMS From Email - ClickSend'
  ),
  ref(
    5,
    'https://www.att.com/support/article/wireless/KM1061254/',
    'other',
    false,
    'web',
    'Say Goodbye to Email-to-Text and Text-to-Email - AT&T'
  ),
  ref(
    6,
    'https://email2phone.net/verizon-vtext-shutdown/',
    'other',
    false,
    'web',
    'Verizon Email to Text Shutdown: What Breaks, What to Use'
  ),
  ref(
    7,
    'https://www.reddit.com/r/msp/comments/1nhtfd5/emailtosms_gateway_service_recommendations/',
    'other',
    false,
    'reddit',
    'Email-to-SMS Gateway Service Recommendations? - Reddit'
  )
]

/** The answer's own links to those sources, as cloro stored them (shortened). */
export const REAL_MARKDOWN = [
  'Your alerts are indeed being dropped. [AT&T](https://www.att.com/support/article/wireless/KM1061254/)',
  '[Email to SMS Gateways](https://www.twilio.com/en-us/blog/developers/tutorials/integrations/smtp-to-sms-programmable-messaging)',
  '[Verizon](https://textbolt.com/migration/verizon/)[Shutdown](https://email2phone.net/verizon-vtext-shutdown/)',
  '',
  'Use a 10DLC gateway. [Gateway guide](https://textbolt.com/blog/email-to-sms-gateway/)',
  '[Verizon again](https://textbolt.com/migration/verizon)'
].join('\n')

function ref(
  position: number,
  url: string,
  classification: AioReference['classification'],
  untracked: boolean,
  sourceType: AioReference['sourceType'],
  title: string
): AioReference {
  const domain = new URL(url).hostname.replace(/^www\./, '')
  return {
    id: `ref-${position}`,
    position,
    url,
    normalizedUrl: url,
    domain,
    title,
    classification,
    untracked,
    sourceType
  }
}
