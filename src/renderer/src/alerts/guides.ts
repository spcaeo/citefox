import { SMTP_PRESETS, type SmtpProvider, type SmtpSecurity } from '@shared/domain'

/** FR-23.2 provider guides: server presets and the set-up steps for each provider. */

export const SECURITY_OPTIONS: readonly { value: SmtpSecurity; label: string }[] = [
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'none', label: 'None' }
]

export function securityLabel(security: SmtpSecurity): string {
  return SECURITY_OPTIONS.find((option) => option.value === security)?.label ?? 'STARTTLS'
}

export interface ProviderStep {
  text: string
  linkText: string | null
  url: string | null
  after: string
}

export interface ProviderGuide {
  provider: SmtpProvider
  name: string
  shortName: string
  sub: string
  userPlaceholder: string
  userHint: string
  passLabel: string
  passPlaceholder: string
  passHint: string
  hostHint: string | null
  /** Fixed username the provider requires. Null means the user types one. */
  fixedUsername: string | null
  steps: readonly ProviderStep[]
  note: string | null
  warn: string | null
}

const GUIDES: readonly ProviderGuide[] = [
  {
    provider: 'gmail',
    name: 'Gmail / Google Workspace',
    shortName: 'Gmail',
    sub: 'App Password',
    userPlaceholder: 'you@yourdomain.com',
    userHint: 'Your full Gmail or Workspace address.',
    passLabel: 'App Password',
    passPlaceholder: '16-character App Password',
    passHint: 'Not your normal Google password. Needs 2-Step Verification.',
    hostHint: null,
    fixedUsername: null,
    steps: [
      step('Turn on 2-Step Verification for the Google account you will send from.'),
      step('Create an App Password and name it "CiteFox":', {
        linkText: 'Google: Sign in with app passwords',
        url: 'https://support.google.com/accounts/answer/185833'
      }),
      step('Paste the 16-character password below, then send a test.')
    ],
    note: 'Google Workspace: your admin may have to allow App Passwords (or SMTP sign-in) for your account first.',
    warn: null
  },
  {
    provider: 'microsoft365',
    name: 'Outlook / Microsoft 365',
    shortName: 'Outlook',
    sub: 'SMTP AUTH',
    userPlaceholder: 'you@yourdomain.com',
    userHint: 'Your full Microsoft 365 address.',
    passLabel: 'Password or app password',
    passPlaceholder: 'Account password or app password',
    passHint: 'Use an app password if the account signs in with multi-factor authentication.',
    hostHint: null,
    fixedUsername: null,
    steps: [
      step(
        'Confirm SMTP AUTH is turned on for the mailbox you will send from (an admin setting):',
        {
          linkText: 'Microsoft Learn: Authenticated client SMTP submission',
          url: 'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission'
        }
      ),
      step(
        'Use the account password, or an app password if the account uses multi-factor sign-in.'
      ),
      step('Send a test below before you save.')
    ],
    note: null,
    warn: 'Microsoft is retiring basic-auth SMTP for Exchange Online. If sign-in fails, use a transactional service instead: Amazon SES, SendGrid, Postmark or Resend.'
  },
  {
    provider: 'ses',
    name: 'Amazon SES',
    shortName: 'Amazon SES',
    sub: 'SMTP credentials',
    userPlaceholder: 'SES SMTP username',
    userHint: 'From SES SMTP credentials. Not your AWS access keys.',
    passLabel: 'SMTP password',
    passPlaceholder: 'SES SMTP password',
    passHint: 'Shown once when you create the SMTP credentials.',
    hostHint:
      'Pattern: email-smtp.<region>.amazonaws.com. Use the region where you verified your domain.',
    fixedUsername: null,
    steps: [
      step('Verify your domain (or a single sender address) in SES.'),
      step(
        'Request production access to leave the sandbox, so you can send to anyone, not only verified addresses.'
      ),
      step('Create SMTP credentials:', {
        linkText: 'AWS: Send email through the Amazon SES SMTP interface',
        url: 'https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html',
        after: ' Paste the username and password below.'
      })
    ],
    note: null,
    warn: null
  },
  {
    provider: 'sendgrid',
    name: 'SendGrid',
    shortName: 'SendGrid',
    sub: 'API key',
    userPlaceholder: 'apikey',
    userHint: 'Type apikey exactly. It is the same for every SendGrid account.',
    passLabel: 'API key',
    passPlaceholder: 'SendGrid API key',
    passHint: 'An API key with Mail Send permission.',
    hostHint: null,
    fixedUsername: 'apikey',
    steps: [
      step('Verify a single sender or authenticate your domain in SendGrid.'),
      step('Create an API key with Mail Send permission:', {
        linkText: 'Twilio SendGrid: Integrate with the SMTP API',
        url: 'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api'
      }),
      step('Keep apikey as the username and paste the key as the password.')
    ],
    note: null,
    warn: null
  },
  {
    provider: 'mailgun',
    name: 'Mailgun',
    shortName: 'Mailgun',
    sub: 'SMTP user',
    userPlaceholder: 'postmaster@mg.example.com',
    userHint: 'The SMTP user from your Mailgun domain settings.',
    passLabel: 'SMTP password',
    passPlaceholder: 'Mailgun SMTP password',
    passHint: 'Set or reset it in the same domain settings.',
    hostHint: 'EU-region accounts use smtp.eu.mailgun.org.',
    fixedUsername: null,
    steps: [
      step('Add and verify your sending domain in Mailgun.'),
      step('Copy the SMTP user from the domain’s settings, or create a new one:', {
        linkText: 'Mailgun: Send via SMTP',
        url: 'https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-smtp'
      }),
      step('If your account is in the EU region, change the host to smtp.eu.mailgun.org.')
    ],
    note: null,
    warn: null
  },
  {
    provider: 'resend',
    name: 'Resend',
    shortName: 'Resend',
    sub: 'API key',
    userPlaceholder: 'resend',
    userHint: 'Type resend exactly.',
    passLabel: 'API key',
    passPlaceholder: 'Resend API key',
    passHint: 'Create it in Resend under API Keys.',
    hostHint: null,
    fixedUsername: 'resend',
    steps: [
      step('Add and verify your domain in Resend.'),
      step('Create an API key:', {
        linkText: 'Resend: Send with SMTP',
        url: 'https://resend.com/docs/send-with-smtp'
      }),
      step('Keep resend as the username and paste the API key as the password.')
    ],
    note: null,
    warn: null
  },
  {
    provider: 'postmark',
    name: 'Postmark',
    shortName: 'Postmark',
    sub: 'Server API token',
    userPlaceholder: 'Server API token',
    userHint: 'Your Server API token, the same value as the password.',
    passLabel: 'Server API token',
    passPlaceholder: 'Server API token',
    passHint: 'From your server’s API Tokens tab.',
    hostHint: null,
    fixedUsername: null,
    steps: [
      step('Verify a sender signature or your domain in Postmark.'),
      step('Copy the Server API token from your server’s API Tokens tab:', {
        linkText: 'Postmark: Send email with SMTP',
        url: 'https://postmarkapp.com/developer/user-guide/send-email-with-smtp'
      }),
      step('Paste the token as both the username and the password.')
    ],
    note: null,
    warn: null
  },
  {
    provider: 'other',
    name: 'Other SMTP',
    shortName: 'SMTP',
    sub: 'Any provider',
    userPlaceholder: 'Usually your full email address',
    userHint: 'Usually your full email address.',
    passLabel: 'Password',
    passPlaceholder: 'Password or app password',
    passHint: 'Some providers need an app password instead of your normal one.',
    hostHint: null,
    fixedUsername: null,
    steps: [
      step('Find the SMTP settings in your provider’s help pages: host, port and security.'),
      step('Most providers use port 587 with STARTTLS, or 465 with SSL/TLS.'),
      step('Fill in the fields below and send a test before you save.')
    ],
    note: null,
    warn: null
  }
]

function step(
  text: string,
  link?: { linkText: string; url: string; after?: string }
): ProviderStep {
  return {
    text,
    linkText: link?.linkText ?? null,
    url: link?.url ?? null,
    after: link?.after ?? ''
  }
}

export function providerGuides(): readonly ProviderGuide[] {
  return GUIDES
}

export function guideFor(provider: SmtpProvider): ProviderGuide {
  const found = GUIDES.find((guide) => guide.provider === provider)
  if (!found) throw new Error(`Unknown provider ${provider}`)
  return found
}

export function providerSummary(provider: SmtpProvider): string {
  const preset = SMTP_PRESETS.find((item) => item.provider === provider)
  if (!preset || preset.host.length === 0) return 'Settings from your provider'
  return [preset.host, String(preset.port), securityLabel(preset.security)].join(' · ')
}
