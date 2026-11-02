# GitHub settings for the public repository

Everything here is ready to paste. Nothing in this repository changes GitHub settings on its own:
the owner runs the commands below once, signed in with `gh auth login` as an admin of
`spcaeo/citefox`.

## Description (309 of 350 characters)

```text
Free, local alternative to Profound, Peec AI and Otterly.AI. Track whether Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini and Copilot cite your site, who wins instead and what to fix. Six client-ready reports. Bring your own API keys; data stays on your computer. MCP coming soon. Source-available.
```

## Website

```text
https://spcaeo.github.io/citefox/
```

If the site moves to a custom domain, change `SITE_URL` in `scripts/site/config.mjs`, run
`npm run site:build`, update the link block at the end of `README.md`, and set the new website
here.

## Topics (20, the most GitHub allows)

GitHub topics are lowercase letters, numbers and hyphens, at most 50 characters each, and at
most 20 per repository.

```text
geo
aeo
llm-seo
ai-seo
ai-overviews
google-ai-overviews
chatgpt
perplexity
gemini
ai-search
ai-visibility
citation-tracking
generative-engine-optimization
answer-engine-optimization
seo
seo-tools
rank-tracker
brand-monitoring
electron
desktop-app
```

## Commands

```bash
# Description, website, topics and features
gh repo edit spcaeo/citefox \
  --description "Free, local alternative to Profound, Peec AI and Otterly.AI. Track whether Google AI Overviews, AI Mode, ChatGPT, Perplexity, Gemini and Copilot cite your site, who wins instead and what to fix. Six client-ready reports. Bring your own API keys; data stays on your computer. MCP coming soon. Source-available." \
  --homepage "https://spcaeo.github.io/citefox/" \
  --add-topic geo,aeo,llm-seo,ai-seo,ai-overviews,google-ai-overviews,chatgpt,perplexity,gemini,ai-search \
  --add-topic ai-visibility,citation-tracking,generative-engine-optimization,answer-engine-optimization,seo,seo-tools,rank-tracker,brand-monitoring,electron,desktop-app \
  --enable-issues \
  --enable-discussions \
  --enable-wiki=false \
  --enable-projects=false \
  --delete-branch-on-merge

# GitHub Pages from the "Download page" workflow (.github/workflows/pages.yml).
# Use -X PUT instead of -X POST if Pages is already turned on.
gh api -X POST repos/spcaeo/citefox/pages -f build_type=workflow

# Labels the issue forms use (bug, enhancement and question exist by default)
gh label create triage --repo spcaeo/citefox --color FBCA04 --description "New, not looked at yet" --force

# Check the result
gh repo view spcaeo/citefox --json description,homepageUrl,repositoryTopics,hasDiscussionsEnabled
```

## Social preview image

GitHub has no API or `gh` command for this one. In **Settings › General › Social preview**, click
**Edit › Upload an image** and pick `.github/social-preview.png` (1280 × 640). Its source is
`.github/social-preview.svg`; `npm run site:og` redraws both share images. The image says "Free AI visibility
tracker", the six engines and "your data stays on your computer", which matches the description above;
re-upload it after any `npm run site:og`.

## Release names

Releases are created as drafts by `.github/workflows/release.yml` with the title
`CiteFox <version>`. Before publishing a draft, rename it to say what is new, so the release
page and search results carry a reason to click:

```text
CiteFox v<version>: <the headline change, in plain words>
```

For example `CiteFox v0.13.0: Share a report as a link`. Keep the first line of the notes as one
sentence a marketer would understand, and keep the "Which file do I need?" section the release
script writes.

## Discussions categories

When Discussions is on, keep or create these (Settings › General › Features › Discussions ›
Set up discussions, then the pencil next to Categories):

| Category      | Format            | What goes there                                          |
| ------------- | ----------------- | -------------------------------------------------------- |
| Announcements | Announcement      | New releases and important changes (owner only)          |
| Q&A           | Question / Answer | How do I…? questions, with an accepted answer            |
| Ideas         | Open-ended        | Feature ideas before they become issues                  |
| Show and tell | Open-ended        | Reports, results and GEO / AEO wins people want to share |
| General       | Open-ended        | Everything else                                          |

Delete **Polls** unless you plan to use it.

## Pinned issue

Open this issue once and pin it (the issue's ⋯ menu › Pin issue):

**Title:** `Roadmap and feedback: what should CiteFox do next?`

```markdown
CiteFox is a free, source-available AI visibility tracker. This issue collects what people want next.

**Coming soon** (no dates): a self-hosted server edition for teams and agencies, a subscription for
done-for-you optimization, and an MCP server so AI assistants can query your CiteFox data. Email
getcitifox@gmail.com for early access.

**Also planned:** signed and notarized builds for macOS and Windows, updates inside the app,
more report sections, and a smoother first run.

**Tell us:**

- What you use CiteFox for (clients, your company, your own sites)
- The one thing that would make it more useful
- Anything that got in your way

Bugs go in their own issue (use the bug form). Questions fit best in Discussions › Q&A.
```

## Funding

`.github/FUNDING.yml` is not added: there is no sponsor link (GitHub Sponsors, Open Collective)
yet. Sponsorship is described in `SPONSORS.md` and goes to getcitifox@gmail.com. When a link
exists, add `.github/FUNDING.yml` with, for example, `custom: ['https://example.com/sponsor']`.

## Other settings worth turning on

- **Settings › Code security:** Dependabot alerts and security updates on (`.github/dependabot.yml`
  sets the version updates), and private vulnerability reporting on (matches `SECURITY.md`).
- **About box (the gear next to About on the repo home):** tick "Use your GitHub Pages website",
  keep "Releases" on, and untick "Packages" and "Deployments" if unused.
