# Onboarding v2: backend notes

The design has 8 steps (Site, Claude, Read, Brand, Buyers,
Rivals, Engines, Questions). Every section on steps 4, 5, 6 and 8 is a card that the user
controls. These notes cover the main-process side. The contract is
`src/shared/ipc/onboarding.ts`.

## Channels

| Channel | What it does | Calls Claude |
| --- | --- | --- |
| `onboarding:sectionEstimate` | Says whether a ✦ run can go, and what it costs | No |
| `onboarding:sectionPrompt` | Returns the exact prompt one run would send, its CSV columns and `webSearch` | No |
| `onboarding:sectionRun` | ✦ Find more (`mode: 'more'`) or ✦ Redo (`mode: 'redo'`, with `instruction`) | 1 call |
| `onboarding:sectionRead` | Reads a chatbot answer pasted back, the same way as a run | No |
| `onboarding:finishSetup` | Step 8's "Finish and run the first check" | No |

Nothing in the section channels saves anything. The renderer merges the rows into its draft.

## Sections

There are ten sections. Each has a definition in `src/main/onboarding/sections/`:

- **Step 4** (`business.ts`): `summary` (text), `brands`, `products`.
- **Step 5** (`buyers.ts`): `buyers`, `triggers`.
- **Step 6** (`companies.ts`): `competitors` (web search on), `switchingFrom`, `integrations`.
- **Step 8** (`questions.ts`): `topic` (text), `questions`.

`registry.ts` maps each id to its definition. The definition holds the role line, the
context lines it uses, the task, the reply columns, and `toRow` (cleaning and guards).

The wording comes from the existing prompts:

- the site read (`engine/fill-from-website.ts`, `SITE_READ_SHAPE`) and the `project`
  help-fill kind;
- the per-product competitor question and `PRODUCT_COMPETITOR_RULES`;
- `SWITCHING_RULES`;
- the `buyers` help-fill kind and the `audience.triggers` assist;
- the `topic` and `questions` help-fill kinds. Questions never name the brand.

## Prompts

`prompt.ts` builds each prompt in two parts.

1. **The task.** The user can read and edit this part. In order:
   - the role line;
   - the context lines that have a value (empty lines are left out);
   - the section's instructions;
   - the rows the section holds now: "Already listed, don't repeat" for Find more, or
     "Keep these … the user chose them" for Redo;
   - the user's words on their own line: `The user asks for this: …`.
2. **The reply rules.** Main always adds these:
   - a list section gets `Reply with CSV only, this header:` and the columns;
   - a text section gets `Reply with the text only: …`.

The prompt that `sectionPrompt` returns is the task plus the reply rules. It is the prompt
the user copies for ChatGPT. An in-app run also puts the routing line
`Assist: setup.<section>` first. The prompt shown never has that line.

An edited prompt (`sectionRun({ prompt })`, saved by the renderer in
`draft.prompts[section]`) replaces only the task. Main cuts any routing line and reply
rules out of it, then adds its own. When the user's instruction is not already in the
edited text, main adds it on its own line.

Every prompt goes through `scrubPrivate`, so keys, email addresses and file paths are
taken out. The log gets `[prompt]` and counts only. It never gets the prompt, the reply or
a row.

## Reading the reply

`settle.ts` reads every reply, whether from Claude or pasted:

1. The help-fill reader (`helpfill/reader.ts`) finds the CSV, the markdown table or the
   list, with the chatbot's words around it.
2. The section's `toRow` tidies each row:
   - hosts become bare hosts (`cleanHost`);
   - paths become site paths;
   - stage words become stage ids;
   - the product a competitor names is matched to a kept product.
3. The help-fill merge (`helpfill/merge.ts`) drops near-duplicates. It compares each row
   with the rows in `current` and with the other rows in the answer.

A text section keeps the answer without the chatbot's words around it. The topic is cut to
one line.

**Competitor guards.** These rows are dropped:

- the brand's own names and domain;
- names listed as switch-from or integrations;
- carriers, review sites and community sites. This applies to competitors only, because
  buyers do switch from a carrier's gateway.

A missing domain never drops a row (`url: null`). Domains are not checked over DNS here.

**Warnings.** They are short and plain:

- `No table or list was found in the answer. Paste the whole reply, or ask the chatbot for CSV.`
- `Nothing new came back. Try other words, or edit the prompt.`
- `1 question named the brand and was left out.`
- `Only the first N were kept.`
- `The web search took too long, so no new competitors came back. Your list is unchanged. Try again, or use your own ChatGPT.`
  A competitor run that times out returns this warning with no rows, and no error. Any
  other failed call is an error with a next step.

## Estimate and no Claude

A run can go when one of these is true:

- an Anthropic API key is the connection;
- Claude Code is the connection and its last checkup got a reply.

Step 2's "No Claude? Skip" leaves neither, so the estimate comes back like this:

```json
{ "kind": "buyers", "available": false, "calls": 1, "costText": "1 Claude call",
  "reason": "Claude is not set up. Use your own ChatGPT for this section." }
```

When a run can go, `costText` is `1 Claude call · on your Claude plan`, or
`1 Claude call · about $0.01` with an API key. Competitors say
`1 Claude call with web search …` and cost about $0.10.

## Finish (`onboarding:finishSetup`)

`src/main/onboarding/finish-setup.ts`. The profile is already saved: the renderer calls
`onboarding:saveProfile` when the user leaves step 6. Finish then does this:

1. **Products and competitors by product.** They are saved with `saveFillCatalog`, the same
   way as Fill from my website. A competitor's `tag` names its product. A failure is logged
   and does not block finishing.
2. **The first topic.** It is made only when at least one question is kept.
   - It is built as a topic draft. Its questions carry stage tags. Its buyer profile has
     each buyer as a segment ("Name: situation") and each trigger event as a trigger.
   - The summary is saved as the topic's "About the business". That is where topic prompts
     read "what it does". The project has no other place for it today.
3. **Onboarding finished.** It is marked finished and the draft is cleared.
4. **The first check.** It starts when `runFirstCheck` is true and a cloro or SerpApi key is
   on. It runs `topics:start` with plan `all_now`, using the real job queue.
   - With no key, the topic is saved without a check. `checkStarted` is false and
     `message` says why.
   - With no questions, `topicId` is null.

A failure before step 3 leaves onboarding open, so the user can try again. A second call
after finishing is refused.

`onboarding:finish` (v1) accepts a cloro key as well as a SerpApi key. So does the
search-key step in `onboarding:getState`. `onboarding:saveProfile` accepts `userName: ''`
and keeps the saved name, or none.

## Draft

`storage/setup-draft.ts` checks `setupView` and `setup`:

- their shape and enum values;
- the item ids, which must not repeat;
- the caps: 100 items per list, 500 characters per name, 30,000 per edited prompt, a
  schedule of 1 to 365 days;
- engine ids, which must be known.

A v1 draft without these fields still parses. The draft file cap is 1 MB.

## Tests and fixtures

- **Unit tests:**
  - `onboarding/sections/prompt.test.ts`: one golden test per section prompt;
  - `settle.test.ts`: the reader, the merge and the guards;
  - `handlers/onboarding-setup.test.ts`: the channels and `finishSetup`;
  - `storage/setup-draft.test.ts`: the draft checks.
- **Fake Claude:** the recorded replies are `src/main/assist/fixtures/setup.<section>.json`.
  Each file holds the CSV or text reply as a JSON string. A Find more prompt reads
  `setup.<section>.more.json` first.
  - The e2e stand-in (`tests/e2e/claude-shim.mjs`) sends a string fixture as the plain
    `result`.
  - Unit tests use `sectionClaude()` from `handlers/test-harness.ts`, which reads the same
    files.
- **Renderer mock:** `createMockSectionClient({ pace })` in
  `src/renderer/src/onboarding/mockSections.ts`. It returns canned TextBolt rows after a
  short pace.
  - Claude counts as missing in the `checkup-missing`, `checkup-logged-out` and
    `checkup-fail` scenarios.
  - Its `finishSetup` finishes the last mock onboarding client.
