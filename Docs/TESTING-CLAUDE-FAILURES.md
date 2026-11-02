# Testing what happens when Claude stops

CiteFox must behave well when Claude stops partway through a job: the weekly quota runs
out halfway through onboarding, Claude Code gets signed out during a check, the API key
runs out of credit. This page shows how to make each of these happen on purpose, and
what the person should see.

## The fake `claude`

`scripts/fake-claude.mjs` is a stand-in for Claude Code. It sends every call to the real
`claude` until a trigger you choose, then answers exactly the way Claude Code does for
one failure. Nothing it does costs quota after the trigger.

1. In CiteFox, open **Settings › Connections**, and in the Claude panel set **Claude binary
   path** to the full path of `scripts/fake-claude/claude` in this folder, for example
   `/Users/you/Desktop/Electron_CiteFox/scripts/fake-claude/claude`.
   (The path must end in `claude`; that small shell file runs the script with Node.)
2. Make `scripts/fake-claude.json` (it is not committed):

   ```json
   { "mode": "weekly_limit", "after": 3 }
   ```

   This passes 3 Claude calls through to the real `claude`, then answers every call
   after that with "You've hit your weekly limit · resets …".
3. Start counting from zero: `node scripts/fake-claude.mjs --fake-reset`.
   See the settings and the count: `node scripts/fake-claude.mjs --fake-status`.
4. Put the path back (or clear it) when you are done.

The file is read on every call, so you can change the mode while CiteFox is open.
Environment variables (`FAKE_CLAUDE_MODE`, `FAKE_CLAUDE_AFTER`, …) win over the file; they
only reach the fake when CiteFox itself was started with them (for example from
`sh scripts/try.sh` in the same Terminal).

| Setting (file key / variable)                  | What it does                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `mode` / `FAKE_CLAUDE_MODE`                    | One of the modes below. `pass` (the default) passes everything through.                                              |
| `after` / `FAKE_CLAUDE_AFTER`                  | How many Claude calls (`claude -p`) pass through before the failure. `0` fails at once.                              |
| `resetMinutes` / `FAKE_CLAUDE_RESET_MINUTES`   | Limit modes: the limit resets this many minutes after it first hits. After that the fake passes calls through again. |
| `zone` / `FAKE_CLAUDE_ZONE`                    | The zone named in "resets 7:30pm (America/Toronto)". Default: this Mac's zone.                                       |
| `real` / `FAKE_CLAUDE_REAL`                    | The real `claude`. Default: found on PATH, `~/.local/bin`, `~/.claude/local`, Homebrew.                              |
| `sleepMs` / `FAKE_CLAUDE_SLEEP_MS`             | `timeout` mode: how long to hang (default 15 minutes).                                                               |
| `text` / `FAKE_CLAUDE_TEXT`                    | Replace the failure sentence, to try another wording.                                                                |
| `FAKE_CLAUDE_NODE`                             | The Node program, when CiteFox cannot find one (opened from the Dock).                                               |

`--version` always answers (from the real `claude` when there is one). `auth status`
answers for the mode once the trigger is reached: signed out, API key, or a plan.

## Each scenario and what the person should see

"Work already done is kept" is true in every case: searches already made, pages already
read and answers already written stay saved. Claude is never asked again in a loop.

| Mode             | Claude Code says                                                  | What the person sees                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_limit`  | You've hit your session limit · resets 10am (America/Toronto)     | "You've reached your 5-hour Claude usage limit. It resets today at 10:00 AM. Work already done is kept. You can wait, add an Anthropic API key in Connections and keys, or carry on with the steps that don't need AI."                                                                                            |
| `weekly_limit`   | You've hit your weekly limit · resets Nov 1, 7am (America/Toronto) | The same, with the day: "… weekly Claude usage limit. It resets Sunday, Nov 1 at 7:00 AM. …"                                                                                                                                                                                                                       |
| `legacy_limit`   | Claude AI usage limit reached\|1761901200                         | The same as above, with the time read from the number.                                                                                                                                                                                                                                                              |
| `signed_out`     | Not logged in · Please run /login                                  | "Claude Code is signed out, so CiteFox cannot use it. Open Terminal, run claude, type /login and sign in, then try again." Never called a limit.                                                                                                                                                                    |
| `plan_inactive`  | Your Claude subscription has expired. …                            | "Your Claude subscription is not active, so Claude Code cannot answer. Renew it at claude.ai (Settings › Billing), or add an Anthropic API key in Connections and keys."                                                                                                                                         |
| `api_credit_low` | Credit balance is too low                                          | "The API key Claude Code uses has run out of credit. Add credit at platform.claude.com …". With an Anthropic API key in CiteFox: "Your Anthropic API key has run out of credit. …"                                                                                                                                  |
| `overloaded`     | API Error: 529 … overloaded_error                                  | "Claude is busy right now (overloaded). Work already done is kept. Try again in a few minutes."                                                                                                                                                                                                                    |
| `timeout`        | (nothing; it hangs)                                                | After CiteFox's time limit (3 minutes for a call): "Claude Code timed out …". A web search is not tried again; other calls get one more try.                                                                                                                                                                         |
| `malformed`      | Half a JSON reply                                                   | "Claude Code exited …" or "did not return JSON" and Try again. One call, no loop.                                                                                                                                                                                                                                   |

Where the words appear:

- **Onboarding** (Find more, Redo, Read my website, the prompt writer): the step shows the
  message in place of a result, at once, with no spinner left running. A step opened
  while Claude Code is paused shows the same words on its ✦ buttons, which turn into
  "use your own ChatGPT". Every step that does not need AI (typing, pasting, markets,
  schedule) keeps working.
- **Help me fill this** and the **assistant**: the same message in their panel.
- **Check reports**: the searches are saved and scored. The report waits: with the
  project rule "wait" it is written after the reset time Claude gave (plus two minutes),
  and Activity says "Claude Code hit its weekly usage limit for <project>. It resets
  Sunday, Nov 1 at 7:00 AM, and CiteFox will finish the analysis then; searches already
  made are kept." The rule "try again later" also waits for the reset instead of trying
  every 15 minutes; "ask me" leaves a notice with the reset time.
- **Setup of new pages**: the page shows "waiting" with the same sentence and starts
  again by itself after the reset.
- **Connections and keys › Claude Code › Run checkup** (and Check again in onboarding): runs the test call even while paused, so it
  shows "Plan limit" with the reset time, or "OK" once the limit has lifted (which also
  lifts the pause at once).

### No retry storm

When one call hits the limit, CiteFox pauses Claude Code for the whole app until the reset
time (plus two minutes; one hour when Claude gave no time). Every Claude call in that time,
from any screen, fails at once with the same words and never starts `claude`. The pause
ends early when a call succeeds (Run checkup), and it does not apply to an Anthropic API
key or to a different `claude` program path.

To see it: `{"mode":"session_limit","after":2,"resetMinutes":3}`, run something that makes
several Claude calls (Read my website), then `--fake-status`. The count stops one past
`after` however many calls CiteFox wanted, and after about five minutes calls go through
again.

## Notes on Claude Code's wording

Read from Claude Code 2.1.312 itself. A limit is "You've hit your <name> · resets <when>",
where <name> is "session limit", "5-hour limit", "weekly limit", "Opus limit", "Sonnet
limit" or "usage limit", and <when> is "3pm (Zone/City)" today or "Nov 2, 9am (Zone/City)"
further out. Older builds wrote "Claude AI usage limit reached|<epoch seconds>" and
"Weekly limit reached ∙ resets 3pm". Signed out is "Not logged in · Please run /login",
"Login expired · Please run /login" or "OAuth token revoked · Please run /login". A bad
key is "Invalid API key · …". No credit is "Credit balance is too low".

2.1.312 has no single sentence for an expired subscription. CiteFox treats these as
"subscription not active": "subscription has expired / ended / is not active", "account is
on hold", "organization has been disabled", "does not have access to Claude Code",
"subscription required". To try another wording, set `text` in the file.

The detection lives in `src/main/providers/claude/limits.ts`; the words in
`src/main/providers/claude/problems.ts`; the pause in
`src/main/providers/claude/shared-gate.ts`.
