import {
  TOPIC_STAGES,
  TOPIC_TEMPLATE_KINDS as TOPIC_TEMPLATE_KIND_LIST,
  type TopicTemplateKind
} from '@shared/domain'
import { textboltTopicDraft, textboltTopicMetas } from '@shared/fixtures/textbolt-topic'

/**
 * Replies Claude would give to each topic template for the TextBolt topic.
 * Tests use them through a fake provider; `fixtures/<kind>.json` holds the
 * static ones for the e2e Claude stand-in (`tests/e2e/claude-shim.mjs`), which
 * builds `topic_page_match` and `topic_questions_cleanup` from the prompt the
 * same way {@link topicFixtureReply} does. Not imported by production code.
 */

const draft = textboltTopicDraft()

/**
 * `topic_journey_questions.<stage>` (one call per stage, Docs/PROMPT-AUDIT.md P3):
 * the TextBolt questions of that stage, in the per-stage reply shape.
 */
function journeyStageReplies(): Record<string, unknown> {
  const metas = textboltTopicMetas().filter((meta) => meta.kind === 'question')
  return Object.fromEntries(
    TOPIC_STAGES.map((stage) => [
      `topic_journey_questions.${stage}`,
      {
        questions: metas
          .filter((meta) => (meta.stage ?? 'problem') === stage)
          .map((meta) => ({ stage, text: meta.text, namedTool: null, competitorNamed: null }))
      }
    ])
  )
}

/** Static replies by kind, or by `<kind>.<variant>` for a step with a `Variant:` line. */
const STATIC: Record<string, unknown> = {
  topic_seed_discover: {
    seeds: [
      {
        text: 'Monitoring alerts that never reach on-call phones',
        productId: null,
        evidence: '/use-cases/ IT alerts',
        caution: null
      },
      {
        text: 'Carrier email-to-text gateways shutting down',
        productId: null,
        evidence: 'FAQ: What happens when a carrier gateway shuts down?',
        caution: 'Check which carriers have announced a shutdown date'
      },
      {
        text: 'Getting alarm panel alerts as text messages',
        productId: null,
        evidence: '/features WIN-911 alarm software sends its alarms through TextBolt',
        caution: null
      },
      {
        text: 'Sending texts to staff from Outlook or Gmail',
        productId: null,
        evidence: 'Homepage heading: Send alerts from Gmail or Outlook',
        caution: null
      },
      {
        text: 'Text alerts for teams without a developer',
        productId: null,
        evidence: '/pricing No code, set up in minutes',
        caution: null
      }
    ],
    segments: [
      {
        name: 'Clinics and multi-site offices',
        reason: 'The multi-location use case page'
      },
      {
        name: 'Property maintenance crews',
        reason: 'After-hours alerts on the field service page'
      },
      {
        name: 'MSPs with client alerts',
        reason: 'The IT alerts use case page'
      }
    ],
    why: 'Your tracked pages and checks point most to teams whose monitoring alerts must reach phones.'
  },
  topic_buyer_profile: {
    points: (draft.profile?.versions[0]?.points ?? []).map((point) => ({
      section: point.section,
      text: point.text,
      foundIn: point.foundIn,
      verify: point.verify
    }))
  },
  topic_profile_discover_v2: {
    points: [
      {
        section: 'who',
        text: 'MSP owners routing client alerts',
        foundIn: '/use-cases',
        verify: null
      },
      {
        section: 'triggers',
        text: 'Told they need 10DLC just to text their own staff',
        foundIn: '/faq',
        verify: 'Check the 10DLC rule for internal alerts'
      }
    ],
    explanation: 'Each point names the page it came from. Two points have no source on the site.'
  },
  ...journeyStageReplies(),
  'topic_questions_discover.gaps': {
    questions: [],
    gaps: [
      { stage: 'fit', note: 'Fit has nothing for clinics' },
      { stage: 'decide', note: 'Decide has nothing on switching' }
    ]
  },
  topic_questions_discover: {
    questions: [
      {
        stage: 'fit',
        text: 'We run four dental clinics and front-desk staff miss closure emails. Can a texting service send them alerts from our shared Outlook inbox?',
        replaces: null,
        reason: 'Fit has nothing for clinics yet'
      },
      {
        stage: 'decide',
        text: 'We are moving off an old pager system next month. What should we set up first so on-call staff still get alerts as texts on day one?',
        replaces: null,
        reason: 'Decide has nothing on switching'
      }
    ],
    gaps: [
      { stage: 'fit', note: 'Fit has nothing for clinics' },
      { stage: 'decide', note: 'Decide has nothing on switching' }
    ]
  },
  topic_keyword_terms: {
    terms: draft.keywordTerms.map((term) => ({ term: term.term, synonyms: [...term.synonyms] })),
    patterns: ['{X} service', '{X} for business', 'free {X}', 'best {X}', '{X} for {segment}']
  },
  topic_keyword_expand: {
    groups: groupsFromFixture()
  },
  topic_keyword_competitor: {
    groups: [
      {
        name: 'Alternatives & vs',
        kind: 'intent',
        family: 'alternatives_vs',
        intent: 'commercial',
        funnel: 'bofu',
        pageType: 'comparison page',
        keywords: [
          'simpletexting alternative for staff alerts',
          'twilio alternative without a developer',
          'simpletexting alternatives'
        ]
      },
      {
        name: 'Competitor vs',
        kind: 'intent',
        family: 'competitor_vs',
        intent: 'commercial',
        funnel: 'bofu',
        pageType: 'comparison page',
        keywords: ['simpletexting vs twilio', 'twilio vs email to sms service']
      }
    ]
  },
  topic_page_brief: {
    summary: 'Answer first: two sentences in the buyer’s words, then the set-up from email.',
    outline: [
      'The situation, in the buyer’s words',
      'The short answer',
      'Set-up from your email tools',
      'What to watch out for',
      'FAQ: 3 related questions'
    ],
    text: 'Page brief for an office manager who sends staff alerts by email and needs them to reach phones. Open with the answer in two sentences: alerts sent from the shared Outlook or Gmail inbox arrive as normal texts, and replies come back to the same inbox, with no app for staff to install. Then show the set-up in three numbered steps from the tools they already use, with one screenshot per step. Add a short section on what to watch out for: carrier filtering of bulk messages, getting staff consent before the first alert, and keeping one sending number so staff recognise it. Name the sources the overview cites now and cover what they cover, in the page’s own words. Close with three related questions as an FAQ: cost per alert, whether staff can reply, and how fast a text arrives. Unconfirmed: [pricing per message] and [delivery time]; check both before publishing.'
  },
  competitor_page_questions: {
    questions: [
      {
        stage: 'problem',
        text: 'Our staff miss urgent schedule changes we send by email because they are on the floor all day. How do other teams get those to their phones?',
        section: 'What are SMS alerts?'
      },
      {
        stage: 'problem',
        text: 'Our outage notices go out by email and customers still call to ask what is happening. How can we send those as texts instead?',
        section: 'Types of business alerts'
      },
      {
        stage: 'options',
        text: 'What kinds of alerts can a small business send by text, and which ones do staff actually read first?',
        section: 'Types of business alerts you can send'
      },
      {
        stage: 'options',
        text: 'Can a text alert go out automatically when our booking system sends its confirmation email to a customer?',
        section: 'Send alerts from email and other tools'
      }
    ],
    claims: [
      {
        claim: 'Delivery reports show who got each alert',
        onYourSite: 'no',
        section: 'Delivery reports'
      },
      {
        claim: 'Works with thousands of apps via Zapier',
        onYourSite: 'partly',
        section: 'Integrations'
      }
    ]
  },
  competitor_page_questions_v2: {
    questions: [
      {
        stage: 'problem',
        text: 'Our staff miss urgent schedule changes we send by email because they are on the floor all day. How do other teams get those to their phones?',
        section: 'What are SMS alerts?'
      },
      {
        stage: 'options',
        text: 'What kinds of alerts can a small business send by text, and which ones do staff on the floor actually read first?',
        section: 'Types of business alerts you can send'
      },
      {
        stage: 'options',
        text: 'Can a text alert go out automatically when our booking system sends its confirmation email to a customer, without anyone copying it over by hand?',
        section: 'Send alerts from email and other tools'
      },
      {
        stage: 'doubts',
        text: 'If we send closure alerts by text, how would I know every person on the rota actually received the message before their shift starts?',
        section: 'Delivery reports'
      }
    ]
  },
  competitor_page_claims: {
    claims: [
      {
        claim: 'Delivery reports show who got each alert',
        section: 'Delivery reports',
        onYourSite: 'no',
        yourEvidence: null
      },
      {
        claim: 'Works with thousands of apps via Zapier',
        section: 'Integrations',
        onYourSite: 'partly',
        yourEvidence: '/'
      }
    ]
  },
  topic_summary: {
    line: 'Since Oct 5: Q3, Q18, Q22 and Q26 are newly cited; Compare is weakest at 1 of 5.',
    executive:
      'AI Overviews cite textbolt.com in 11 of the 26 buyer questions that show one (42%), below the 50–70% target; 2 more are needed to reach it. Problem and Decide are strong; Compare (1 of 5) and Fit (2 of 6) are weak. Keywords, measured apart: 18 of 77 (23%).'
  },
  topic_next_actions: {
    nextActions: [
      {
        text: 'Add an H2 to /blog/how-to-set-up-text-alerts-for-business/ that answers how a clinic texts closure alerts from Outlook, with the three set-up steps.',
        promptNumbers: [1, 2],
        verify: null
      },
      {
        text: 'Write a new page on replacing a carrier email-to-text gateway before it shuts down, for IT admins who send server alerts.',
        promptNumbers: [1, 3],
        verify: 'Check which carriers have announced a shutdown date'
      },
      {
        text: 'Add a comparison table to /pricing for teams weighing an email-to-text service against a texting app.',
        promptNumbers: [1],
        verify: 'Check competitor prices before publishing'
      }
    ]
  },
  topic_citation_diagnosis: {
    summary:
      'The overview leans on simpletexting.com for a step-by-step setup and on a forum thread for real-world experience. Your page is not among its sources for this question.',
    reasons: [
      {
        text: 'The cited guide answers the clinic case with numbered setup steps, and the target page has no heading for it.',
        evidence: null
      },
      {
        text: 'The overview lists what to send and when, which the target page does not cover.',
        evidence: null
      }
    ],
    citedInstead: [
      {
        source: 1,
        whyItWins: 'A step-by-step answer for this exact case, with the setup from email.'
      }
    ],
    facts: [
      'Recommends sending alerts from the inbox staff already use',
      'Lists consent as the first thing to check'
    ]
  },
  topic_fix_draft: {
    where: 'target',
    steps: [
      'Add an H2 "Send clinic closure alerts from Outlook" under "How it works".',
      'Answer the closure case in the first two sentences under it.',
      'Add the three set-up steps from the shared Outlook inbox as a numbered list.'
    ],
    draft:
      'How do we text staff when the clinic closes early?\nWrite the closure notice in your shared Outlook inbox and send it to the staff group address; every phone gets it as a normal text, and replies come back to the same inbox. No one installs an app. Set up the group once, then each alert takes a minute to send. [Check the per-message price before publishing.]'
  },
  topic_page_edit: {
    summary:
      'Answers the switch question in the first two sentences, then gives the set-up steps and the buyer questions as an FAQ.',
    changes: [
      {
        op: 'insert',
        block: 'b1',
        kind: 'p',
        text: 'Switch to an email-to-text service: staff keep writing from the inbox they use now, and each phone gets a normal text. No app and no new numbers. [check: the price per message]',
        why: 'Answers the best search in the first two sentences under the title.'
      },
      {
        op: 'insert',
        block: 'b1',
        kind: 'h2',
        text: 'Set it up in three steps',
        why: 'Gives the buyer the steps under a heading that matches what they ask.'
      },
      {
        op: 'replace',
        block: 'b2',
        kind: 'p',
        text: 'Pick the service, approve the inbox that sends, then replace the old address in your contact sheet.',
        why: 'Turns a general paragraph into the steps the buyer follows.'
      }
    ]
  },
  topic_owner_why: {
    verdict: 'target',
    reason:
      'Google quotes the compare page because it lines up the gateway options side by side, and the target page never does. The target page still fits the buyer replacing the AT&T gateway, so strengthen it.',
    answerNeeds: [
      'Name the main ways to send texts from email now that carrier gateways are closing',
      'Compare them on set-up, cost and whether staff need an app',
      'Say which option suits a team that sends alerts from a shared inbox'
    ],
    citedHas: [
      {
        section: 'Opening',
        point:
          'A side-by-side table of email-to-SMS services with set-up time and price per message.'
      }
    ],
    toChange: [
      {
        section: 'Opening',
        change:
          'Open with two sentences that name the best replacement for the AT&T gateway and who it suits. [check: the price per message]',
        why: 'Answers "email to sms gateway comparison" before the buyer scrolls.'
      },
      {
        section: 'New section after the opening',
        change:
          'Add a short comparison of the three ways to keep texting from email: another carrier gateway, an email-to-SMS service, an SMS app.',
        why: 'Gives the answer the side-by-side view it quotes from the compare page now.'
      }
    ],
    risk: 'Both pages answer the same comparison searches; add one line on the compare page that points AT&T users to the guide.'
  },
  topic_cluster_suggest: {
    ideas: [
      {
        name: '10DLC registration for small senders',
        situation:
          'A small business that texts customers from a local number is told its messages are blocked until it registers for 10DLC, and nobody on the team knows what that means.',
        example: 'how to register for 10DLC as a small business',
        questions: [
          {
            stage: 'problem',
            text: 'I run a five-person plumbing office and our appointment texts from a local number suddenly stopped arriving; the carrier says we must register for 10DLC first.'
          },
          {
            stage: 'options',
            text: 'As the office manager of a small dental practice that texts from Outlook today, what ways are there to get our business number registered for 10DLC?'
          },
          {
            stage: 'doubts',
            text: 'We are a small accounting firm sending about two hundred texts a month; how long does 10DLC brand and campaign approval take, and what does it cost us?'
          },
          {
            stage: 'fit',
            text: 'I am the only admin at a nonprofit with no developer and we send event reminders by text; can a service handle 10DLC registration for us end to end?'
          },
          {
            stage: 'compare',
            text: 'Our small clinic is choosing between Twilio and SimpleTexting for reminders; which one makes 10DLC registration easier for a team without anyone technical on staff?'
          },
          {
            stage: 'decide',
            text: 'We have picked a texting service for our salon and need to go live this week; what details do I need ready to finish 10DLC registration quickly?'
          },
          {
            stage: 'problem',
            text: 'Our landscaping company texts crews from a shared Gmail inbox, and since last month replies say our messages are filtered as unregistered; what is going wrong here?'
          },
          {
            stage: 'doubts',
            text: 'I manage IT for a small law office and worry that a 10DLC rejection will stop our client texts; what usually gets a small sender rejected, and how is it fixed?'
          }
        ],
        fitsUrl: null
      },
      {
        name: 'Text alerts from monitoring tools',
        situation:
          'An IT team gets server and alarm alerts by email from Datadog, Grafana or plant software, and the on-call person misses them at night because email is silent on the phone.',
        example: 'send Grafana alerts as text messages',
        questions: [
          {
            stage: 'problem',
            text: 'I am the on-call engineer at a small hosting company, and last night a Grafana disk alert sat in my email for three hours before anyone saw it.'
          },
          {
            stage: 'options',
            text: 'Our two-person IT team gets Datadog alerts by email; what are the ways to turn those emails into text messages on our phones without writing any code?'
          },
          {
            stage: 'doubts',
            text: 'We run a water treatment plant whose alarm software only sends email; will texts sent from those emails arrive reliably at night, or can carriers filter them?'
          },
          {
            stage: 'fit',
            text: 'I look after IT for three small factories with old alarm panels that only email; does an email-to-text service work when the panel cannot be changed at all?'
          },
          {
            stage: 'compare',
            text: 'For texting Datadog alerts to our on-call phones, how does Twilio compare with a simple email-to-SMS service for a team that has no developer to build integrations?'
          },
          {
            stage: 'decide',
            text: 'We have chosen to text our Grafana alerts to the on-call rota; what are the setup steps, and can we test with one alert before moving the whole team?'
          },
          {
            stage: 'problem',
            text: 'Our carrier shut down its free email-to-text gateway, and now the alerts from our monitoring server that used it never reach my phone at all.'
          },
          {
            stage: 'options',
            text: 'I run IT at a small school district and our network monitor emails alerts; is there a way to text a whole on-call group from one alert email?'
          }
        ],
        fitsUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
      },
      {
        name: 'Appointment reminders by text for small clinics',
        situation:
          'A small clinic loses money to no-shows because reminder calls take staff hours, and it wants reminders to go out by text from the tools it already uses.',
        example: 'appointment reminder texts for a small clinic',
        questions: [
          {
            stage: 'problem',
            text: 'Our two-doctor physiotherapy clinic had nine no-shows last week, and our receptionist spends every afternoon phoning patients to remind them about tomorrow.'
          },
          {
            stage: 'options',
            text: 'We book patients in Outlook calendars at our small chiropractic clinic; what ways exist to send appointment reminders by text without buying a whole new practice system?'
          },
          {
            stage: 'doubts',
            text: 'I manage a small dental office and worry about patient privacy; is it safe to send appointment reminders by text, and what should the message leave out?'
          },
          {
            stage: 'fit',
            text: 'Our counselling practice has three part-time staff and no IT person; can we send reminder texts from the shared email inbox we already use for bookings?'
          },
          {
            stage: 'compare',
            text: 'For reminder texts at a small vet clinic, how does SimpleTexting compare with sending texts straight from our email, on price and on handling patient replies?'
          },
          {
            stage: 'decide',
            text: 'We have decided to text reminders to patients at our clinic; how fast can we go live, and can patients reply to confirm or cancel by text?'
          },
          {
            stage: 'doubts',
            text: 'Our clinic reminder texts would go out from one number to hundreds of patients each week; will carriers block them, and how do we keep delivery reliable?'
          },
          {
            stage: 'fit',
            text: 'I run a small optician with two branches and one booking inbox; can reminder texts show which branch the appointment is at without extra software?'
          }
        ],
        fitsUrl: null
      },
      {
        name: 'Cheaper alternative to Twilio for alerts',
        situation:
          'A small team that wired alerts to Twilio years ago now pays a developer to keep it working, and wants something cheaper it can run itself.',
        example: 'cheaper alternative to Twilio for SMS alerts',
        questions: [
          {
            stage: 'problem',
            text: 'Our small logistics firm pays a contractor every month to maintain the Twilio script that texts delivery alerts, and the bill keeps growing for a few hundred messages.'
          },
          {
            stage: 'options',
            text: 'We send about five hundred alert texts a month through Twilio at our office; what simpler options exist that a non-developer could manage day to day?'
          },
          {
            stage: 'doubts',
            text: 'If we move our alert texts off Twilio at our small manufacturing company, will we lose our existing number, and what breaks for the people who get them?'
          },
          {
            stage: 'fit',
            text: 'I am the office manager at a property management company with no developer; is there an alerts service we can set up from email instead of code?'
          },
          {
            stage: 'compare',
            text: 'For low-volume business alerts, how do Twilio and SimpleTexting compare on monthly cost and setup effort for a team that cannot write or maintain code?'
          },
          {
            stage: 'decide',
            text: 'We are about to replace Twilio for our alert texts; how do we move our number and contact list, and is there a trial before we switch?'
          },
          {
            stage: 'problem',
            text: 'Our Twilio alert integration broke after an API change and our only developer has left; our facility alerts have not reached anyone by text for two days.'
          },
          {
            stage: 'compare',
            text: 'Our IT team is weighing Twilio against an email-to-SMS gateway for alarm texts; which is cheaper per month at around a thousand messages?'
          }
        ],
        fitsUrl: null
      }
    ]
  },
  topic_cluster_sort: {
    proposals: [
      {
        id: 'q1',
        topicId: 't1',
        newTopic: null,
        reason: 'The buyer is turning monitoring emails into texts.'
      }
    ]
  },
  topic_cluster_name: {
    name: 'Text alerts from monitoring tools',
    situation:
      'IT teams get alerts from monitoring and alarm software by email and miss them at night; they want those alerts to reach on-call phones as texts.'
  },
  topic_why_not_cited: {
    summary:
      'The overview leans on a forum thread and a competitor guide that answer the clinic case directly.',
    reasons: [
      {
        text: 'The target page never names clinics or closures in a heading.',
        evidence: 'Headings cover offices and branches only.'
      },
      {
        text: 'The cited sources give a step-by-step answer.',
        evidence: 'simpletexting.com lists setup steps.'
      }
    ],
    citedInstead: [
      {
        domain: 'simpletexting.com',
        url: 'https://simpletexting.com/alerts',
        whyItWins: 'A step-by-step answer for this exact case'
      }
    ],
    fix: {
      where: 'target',
      steps: [
        'Add an H2 for clinic closures',
        'Answer in the first two sentences',
        'Add a three-step setup from Outlook'
      ],
      draft:
        'Clinics can send closure alerts from the shared Outlook inbox: write the email, address it to the staff group, and every phone gets a normal text. Replies come back to the inbox. [Check the per-message price.]'
    }
  },
  topic_explain_citation: {
    text: 'The overview leans on simpletexting.com for setup steps and reddit.com for real-world experience. Your page is cited third for the Gmail setup. This is what the stored overview shows, not a cause.',
    facts: [
      'simpletexting.com is cited first',
      'textbolt.com is cited at position 3',
      'Two of the sources are forums'
    ]
  }
}

function groupsFromFixture(): unknown[] {
  const keywords = draft.prompts.filter(
    (prompt) => prompt.kind === 'keyword' && prompt.kwGroupKind === 'intent'
  )
  const groups = new Map<string, typeof keywords>()
  for (const prompt of keywords)
    groups.set(prompt.kwGroup ?? '', [...(groups.get(prompt.kwGroup ?? '') ?? []), prompt])
  return [...groups.values()].map((list) => {
    const first = list[0]
    return {
      name: first?.kwGroup ?? '',
      kind: 'intent',
      family: first?.kwFamily ?? null,
      intent: first?.intent ?? 'commercial',
      funnel: first?.funnel ?? 'mofu',
      pageType: first?.pageType ?? 'landing page',
      keywords: list.map((prompt) => prompt.text)
    }
  })
}

/** Ids and texts from "id · text" lines of a rendered prompt. */
export function promptLines(prompt: string): { id: string; text: string }[] {
  return prompt
    .split('\n')
    .map((line) => /^([A-Za-z0-9][\w-]*) · (.+)$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ id: match[1] ?? '', text: match[2] ?? '' }))
}

/** The kind named by a rendered prompt's first line ("Template: topic_page_match.md"). */
export function kindOfPrompt(prompt: string): TopicTemplateKind | null {
  const match = /^Template: ([a-z0-9_]+)\.md/u.exec(prompt)
  const kind = match?.[1]
  return kind !== undefined && (TOPIC_TEMPLATE_KIND_LIST as readonly string[]).includes(kind)
    ? (kind as TopicTemplateKind)
    : null
}

/** The reply for a rendered topic prompt, or null when it is not a topic template. */
export function topicFixtureReply(prompt: string): unknown {
  const kind = kindOfPrompt(prompt)
  if (kind === null) return null
  if (kind === 'topic_page_match') {
    const pages = prompt
      .split('\n')
      .map((line) => /^(https?:\/\/\S+) · /u.exec(line)?.[1])
      .filter((url): url is string => url !== undefined)
    const ids = promptLines(prompt).filter((line) => !line.id.startsWith('http'))
    return {
      matches: ids.map((line, index) => ({
        id: line.id,
        url: index % 4 === 3 || pages.length === 0 ? null : (pages[index % pages.length] ?? null),
        confidence: index % 4 === 3 ? 0 : 60 + ((index * 7) % 35),
        reason:
          index % 4 === 3
            ? 'No page answers this yet.'
            : 'A heading on the page answers this situation.'
      }))
    }
  }
  if (kind === 'topic_questions_cleanup') {
    return {
      items: promptLines(prompt)
        .filter((line) => line.text.split(/\s+/u).length < 8)
        .map((line) => ({
          id: line.id,
          after: `${line.text.replace(/[?.!]+$/u, '')}: how do we handle this for our team without a developer?`,
          stage: 'problem',
          change: 'Made it a full question'
        }))
    }
  }
  if (kind === 'topic_profile_rewrite') {
    // Each "id · [Section] text" line comes back rewritten, naming the id it replaces.
    return {
      points: promptLines(prompt).map((line) => ({
        section: 'who',
        text: `${line.text.replace(/^\[[^\]]*\]\s*/u, '').replace(/[.]+$/u, '')}, in plain words`,
        replaces: line.id
      }))
    }
  }
  if (kind === 'topic_cluster_sort') return sortReply(promptLines(prompt))
  if (kind === 'topic_target_suggest') return targetReply(prompt)
  const variant = variantOfPrompt(prompt)
  return (variant === null ? undefined : STATIC[`${kind}.${variant}`]) ?? STATIC[kind] ?? null
}

/**
 * `topic_cluster_sort` from the prompt: each `t<n> · ` line is a topic, every other
 * `id · text` line a question. Each question goes to the first topic listed, or to a
 * new topic when none is listed.
 */
function sortReply(lines: readonly { id: string; text: string }[]): unknown {
  const isTopic = (id: string): boolean => /^t\d+$/u.test(id)
  const topic = lines.find((line) => isTopic(line.id))
  return {
    proposals: lines
      .filter((line) => !isTopic(line.id))
      .map((line) => ({
        id: line.id,
        topicId: topic?.id ?? null,
        newTopic: topic === undefined ? 'Text alerts from monitoring tools' : null,
        reason:
          topic === undefined
            ? 'No listed topic fits; the buyer wants monitoring alerts as texts.'
            : 'The buyer is in the same situation as this topic.'
      }))
  }
}

/**
 * `topic_target_suggest` from the prompt: the first two listed pages, best first, and
 * a new page idea when the list is empty.
 */
function targetReply(prompt: string): unknown {
  const pages = prompt
    .split('\n')
    .map((line) => /^(https?:\/\/\S+) · /u.exec(line)?.[1])
    .filter((url): url is string => url !== undefined)
  return {
    picks: pages.slice(0, 2).map((url, index) => ({
      url,
      reason:
        index === 0
          ? 'Its title names this exact buyer problem, and answers already cite it most.'
          : 'A section on this page answers part of the topic.'
    })),
    newPage:
      pages.length === 0
        ? {
            title: 'Replacing a carrier email-to-text gateway',
            path: '/email-to-text-gateway-replacement',
            about: 'What to switch to when a carrier gateway shuts down, and how to move alerts.'
          }
        : null
  }
}

/** The `Variant: <x>` second line of a rendered prompt, or null. */
export function variantOfPrompt(prompt: string): string | null {
  return /^Variant: ([A-Za-z0-9_-]+)$/mu.exec(prompt.split('\n', 2)[1] ?? '')?.[1] ?? null
}

/** The static replies keyed by kind (or `<kind>.<variant>`), for writing `fixtures/<key>.json`. */
export function staticTopicReplies(): Record<string, unknown> {
  return STATIC
}
