# Live smoke

`npm run smoke:live` runs one check through the existing engine on your computer:

1. Read the page with Jina Reader.
2. Write a buyer profile with `claude -p`.
3. Write buyer prompts with `claude -p`.
4. Run one SerpApi Google search, then the AI Overview `page_token` follow-up on the same key.
5. Classify and score that search.

It does not run in CI, `npm test`, `npm run test:unit`, or `npm run test:e2e`. The npm script sets `CITEFOX_SMOKE_LIVE=1`. Any other value, including an unset variable, refuses before it reads a file or opens a network connection.

## Env file

The env file lives outside the repo, in the parent project folder. Copy `.env.example` there and fill in values. Do not commit that copy.

`SERPAPI_API_KEY` is required. `SERPAPI_API_KEY_2` and `SERPAPI_API_KEY_3` are optional. They are printed as `set` or `missing`, then stored in that order as in-memory keys. Nothing is written to the system keychain, and the values are not copied into the process environment. The search uses the first key that is still under its cap. The page-token follow-up uses the same key as the search that returned it. `JINA_API_KEY` is optional: Reader works without a key. `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, each `SMTP_*` name in the file, and `SLACK_WEBHOOK_URL` are printed as `set` or `missing` and are not used.

The file is parsed into a private map. It is not loaded into the environment. The `claude` child does not receive those names, so Claude Code stays on the CLI login on this computer and does not switch to API billing.

Quote a path that contains spaces. A relative path is resolved from the current directory. On macOS:

```bash
cp .env.example "../Parent Folder/.env"
npm run smoke:live -- --env "../Parent Folder/.env"
```

## What you get

The default page is `https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/`. The default market is `US:en:desktop`. `--prompts` (alias `--query`) defaults to 1, which is one Google search plus its `page_token` follow-up.

Claude still writes at least 3 prompts. A saved set has to include a title, a trigger, and an objection, and one prompt cannot carry all three. `--prompts` chooses how many of those prompts are searched.

Each step prints `ok` or `fail` and a duration in milliseconds. The summary then prints the classification, the score, the SerpApi search count (`follow-up=same-key` or `follow-up=none`), the temp data directory, and the report path. Databases are new files under that temp directory (`os.tmpdir()` unless you are testing). The app database is not opened. `smoke-report.json` is written there with secrets removed.

`claude` must be on `PATH` and logged in on this computer. That connection is for running CiteFox yourself, under your own plan. Extra SerpApi keys must be ones you are entitled to use. See the Terms section in the README.
