# AI providers

CiteFox does its AI work (buyer profiles, prompts, gap analysis, reports, the
assistant and the "Help me fill this" helpers) with one of three connections:

| Connection      | What it uses                                   | Who pays                 |
| --------------- | ---------------------------------------------- | ------------------------ |
| Claude Code     | The `claude` program on this computer          | The user's Claude plan   |
| Codex           | The OpenAI `codex` program on this computer    | The user's ChatGPT plan  |
| Anthropic API   | A saved Anthropic API key                      | That key                 |

Every AI feature works with any of them. They share one interface
(`ClaudeProvider` in `src/main/providers/claude/claude-code.ts`): a text reply or a
JSON reply checked against a schema, optional web search, a timeout, and
plain-English errors (`ProviderError` codes).

## The search data service (checks)

Checks are not AI calls: they go to a search data API on the user's own key.

| Service | Engines | Price the app uses (`src/shared/domain/engines.ts`) |
| ------- | ------- | --------------------------------------------------- |
| cloro (default) | All six | Lite: $30 for 37,500 credits; 6 or 7 credits per question per engine |
| SerpApi | Google AI Overviews only | $0 (250 searches) to $275 (30,000 searches) a month; 1 search per question, sometimes 2 |

So ten questions on all six engines are about 390 cloro credits, about $0.31 on Lite. The app
shows credits and dollars before each check (Settings › Track, setup step 7, Check now), records
each check's cost in history, and stops at the monthly budget.

## How to switch

- **Onboarding, step 2 ("AI")**: pick Claude Code or Codex. CiteFox saves the
  choice and checks the program at once: is it installed, is it signed in, and
  does a test reply come back. The Anthropic API key option is still there.
- **Settings → Connections → AI**: the same choice, plus the Codex program path
  and the Codex models.

The choice is stored as `settings.claudeProvider` (`claude-code`, `codex` or
`anthropic-api`). Projects on "App default" follow it. A project set to Claude
Code or to an API key keeps that connection.

## How Codex is used

Each call runs one locked-down `codex exec` (`src/main/providers/codex/args.ts`):

- `--json`: CiteFox reads only the JSONL events on stdout.
- `--ephemeral`: no session files, so page text is not written to disk.
- `--ignore-user-config` and `--ignore-rules`: the user's `~/.codex/config.toml`
  (its MCP servers, profiles and model) is not loaded. The ChatGPT sign-in still works.
- `--sandbox read-only` and `approval_policy="never"`: nothing can be written.
- The shell, exec, plugins, connectors, sub-agents, browser, image tools, hooks,
  memories and skills are all turned off (`--disable …`). If a Codex version cannot
  turn off the shell, CiteFox refuses to use it and asks for an update.
- The prompt goes in on stdin. The run happens in a fresh empty temp folder.
- `OPENAI_API_KEY` and other OpenAI or Codex keys are removed from the environment,
  so a call is never billed to an API key by accident.
- CiteFox never reads `~/.codex/auth.json` and never signs in or out. The checks
  run `codex --version` and `codex login status` only.

**Models.** Quick jobs (form helpers, the test call) use `gpt-5.6-luna` with low
reasoning. Heavy jobs (the check pipeline, reports, the assistant, web search,
long prompts) use `gpt-5.6-terra` with medium reasoning. Both can be changed in
Settings. A Claude model name set on a project is ignored for Codex.

**JSON replies.** Codex sends schemas to OpenAI in strict mode, which needs every
field listed as required. CiteFox converts each schema: optional fields become
"may be null", and those nulls are removed before the reply is checked against
the original schema. A schema that cannot be converted is put in the prompt instead.

**Web search** (the competitor step) works. It runs through Codex's code-mode
tool host, so that host stays on for web-search calls only. With the shell,
files and connectors off, the host can only search.

**Limits and errors.** A ChatGPT usage limit is a `plan_limit` error, with the reset
time when Codex gives one. Signed out, rate limited, busy, timed out and bad replies
map to the same codes as Claude Code. Messages always say "Codex", never "Claude".
The project fallback rules (wait, retry later, ask, switch to an API key) work the
same way for Codex.

**Logging.** Every call is logged in `llm_calls` with connection `codex` and its
tokens. Codex does not say which model answered, so the requested model is logged.

## What Codex cannot do that Claude Code can

- No cost in US dollars per call: Codex reports tokens only.
- No "which model answered" in its output.
- The fast default on some machines (`gpt-5.6-sol`) is not available with a
  ChatGPT sign-in, which is why CiteFox sets its own models.
- Each call carries about 5,000 to 14,000 tokens of Codex's own instructions.
- A project cannot pick Codex on its own yet: it follows "App default".

## Terms of the services you connect

CiteFox is for running on your own computer.

The `claude-code` connection (the `claude` CLI, already installed and logged in) is for ordinary individual use under your own Claude plan. CiteFox does not log you in, does not read Claude Code's credentials, and does not rotate subscription accounts. Client projects, shared computers, and any use on behalf of someone else need an Anthropic API key.

Extra SerpApi keys must be ones you are entitled to use: your own plan, or a client's. Opening extra free accounts to get past a free limit is against SerpApi's terms.

You are responsible for the terms of the services you connect. Limits change. These are the source pages:

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [SerpApi terms](https://serpapi.com/terms)
- [Jina AI legal](https://jina.ai/legal/)
- [YouTube API Services terms](https://developers.google.com/youtube/terms/api-services-terms-of-service)
- [Anthropic commercial terms](https://www.anthropic.com/legal/commercial-terms)
