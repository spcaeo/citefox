import type { CompanyIdeas, ReadPage } from './competitor-guard'

/**
 * A TextBolt-like site (Docs/FEEDBACK.md row 3): a compare page naming two live
 * rivals, two carrier "alternative" pages about gateways that shut down, and an
 * integration page. Used by the guard, the fill-from-website and the seed-discover
 * tests. Not imported by production code.
 */
export const TEXTBOLT_GUARD_PAGES: readonly ReadPage[] = [
  {
    path: '/',
    text: 'TextBolt · Email to text for business alerts. Send texts from Gmail or Outlook. No app for staff to install.'
  },
  {
    path: '/compare',
    text: 'TextBolt vs Text-Em-All and SimpleTexting. Compare pricing: Text-Em-All charges per call credit, SimpleTexting starts with a monthly plan. Teams choose TextBolt instead of Text-Em-All when they send alerts from email.',
    links: ['https://www.text-em-all.com/pricing', 'https://textbolt.com/pricing']
  },
  {
    path: '/att-email-to-text-alternative',
    text: 'AT&T email-to-text alternative. AT&T shut down its email-to-text gateway (txt.att.net) in June 2025. T-Mobile also turned off its gateway. Move your alerts to TextBolt in minutes.'
  },
  {
    path: '/verizon-vtext-alternative',
    text: 'Verizon vText alternative. Verizon discontinued vtext.com email to SMS for business senders. Keep sending alerts by email with TextBolt.'
  },
  {
    path: '/win-911',
    text: 'WIN-911 integration. Send WIN-911 alarm notifications as text messages through TextBolt. WIN-911 works with TextBolt over email, so operators get alarms on their phones.'
  }
]

/** What the live run did: carriers and an integration listed as competitors. */
export const TEXTBOLT_BAD_REPLY: CompanyIdeas = {
  competitors: [
    {
      name: 'AT&T',
      domain: 'att.com',
      reason: 'The site has an AT&T email-to-text alternative page.',
      evidence: {
        path: '/att-email-to-text-alternative',
        quote: 'AT&T shut down its email-to-text gateway (txt.att.net) in June 2025.'
      }
    },
    {
      name: 'Verizon',
      domain: 'verizon.com',
      reason: 'The site has a Verizon vText alternative page.',
      evidence: { path: '/verizon-vtext-alternative', quote: 'Verizon vText alternative.' }
    },
    {
      name: 'T-Mobile',
      domain: 't-mobile.com',
      reason: 'Named on the AT&T page.',
      evidence: {
        path: '/att-email-to-text-alternative',
        quote: 'T-Mobile also turned off its gateway.'
      }
    },
    {
      name: 'WIN-911',
      domain: 'win911.com',
      reason: 'The site has a WIN-911 page.',
      evidence: {
        path: '/win-911',
        quote: 'Send WIN-911 alarm notifications as text messages through TextBolt.'
      }
    },
    {
      name: 'Text-Em-All',
      domain: 'textemall.com',
      reason: 'Mass texting and calls a buyer could pick instead.',
      evidence: { path: '/compare', quote: 'TextBolt vs Text-Em-All and SimpleTexting.' }
    },
    {
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      reason: 'Business texting with monthly plans.',
      evidence: {
        path: '/compare/',
        quote: 'SimpleTexting starts with a monthly plan.'
      }
    },
    {
      name: 'Twilio',
      domain: 'twilio.com',
      reason: 'A texting API.',
      evidence: { path: '/compare', quote: 'Developers use Twilio.' }
    },
    {
      name: 'TextBolt',
      domain: 'textbolt.com',
      reason: 'The site name.',
      evidence: { path: '/', quote: 'TextBolt · Email to text for business alerts.' }
    }
  ],
  switchingFrom: [],
  integrations: []
}
