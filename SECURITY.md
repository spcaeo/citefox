# Security policy

## Supported versions

CiteFox is pre-1.0. Security fixes go into the latest release only.

| Version          | Supported |
| ---------------- | --------- |
| 0.13.x (latest)  | Yes       |
| 0.12.x and older | No        |

## Reporting a vulnerability

Please report privately. Do not open a public issue.

- Use the repository's **Security → Report a vulnerability** form (GitHub private vulnerability reporting), or email **getcitifox@gmail.com**.
- Include the CiteFox version, your OS, steps to reproduce, and what an attacker gains.
- Do not include real API keys (cloro, SerpApi, Jina, Anthropic), SMTP passwords, or Slack webhook URLs. Redact them.

We aim to acknowledge a report within 3 working days and to agree on a fix and disclosure date with you. Please give us a reasonable window to ship a fix before you publish.

## Hardening model

CiteFox is an Electron desktop app. It reads web pages you point it at and sends their text to the AI you picked (Claude Code, Codex or the Anthropic API), so page content is treated as untrusted input throughout.

**Sandboxed renderer (NFR-16).** The window runs with `contextIsolation`, `sandbox`, no Node integration, no `<webview>`, and web security on. Remote content never loads in the app window: external links open in the system browser, redirects out of the app are cancelled, and permission requests and checks are denied. Every IPC call checks that the sending frame is the app's own renderer, and every argument is validated in the main process. A packaged build ignores `ELECTRON_RENDERER_URL` and has DevTools off.

**Keychain-only secrets (NFR-5).** API keys, SMTP passwords, and Slack webhook URLs are stored in the OS keychain. Settings, SQLite files, and exports hold a keychain reference only. Logs and error messages are redacted. A Claude Code child process never inherits an Anthropic key or OAuth token from the environment, and a Codex child never inherits an OpenAI key. For tests only, an unpackaged build can keep secrets in a plain file named by `CITEFOX_SECRETS_FILE`; a packaged app ignores that variable. SMTP security "None" is refused for a password login unless the server is on this computer (`localhost`, `127.0.0.1`, `::1`).

**Claude tool restrictions (SRS LLM-3).** Claude Code runs as `claude -p` with one turn and tools off (`--tools ""`, `--disallowedTools mcp__*`), plus `--strict-mcp-config`, an empty MCP config, `--safe-mode`, `--restricted`, and `--no-session-persistence` where the installed CLI accepts them. CiteFox never runs a CLI that rejects the tool-disabling flags. It asks you to update instead. The prompt goes on stdin, never in argv. The child runs without a shell, in a fresh empty temp folder, in its own process group, with a timeout that kills the whole group. Only an executable named `claude` (`claude.exe` or `claude.cmd` on Windows) is run.

**Codex lockdown.** Codex runs as one `codex exec --json --ephemeral` per call, with the user's Codex config and rules ignored, a read-only sandbox, no approvals, and the shell, exec, plugins, connectors and other tools turned off. CiteFox refuses a Codex version that cannot turn the shell off. The prompt goes on stdin, the run happens in a fresh empty temp folder, and CiteFox never reads `~/.codex/auth.json` or changes the sign-in. `Docs/AI-PROVIDERS.md` has the details.

**SSRF guard.** Direct page reads accept only public `http` and `https` URLs without credentials. Each host is resolved once. Every address must be public: loopback, private, link-local, CGNAT, benchmarking, multicast, reserved, unique-local, site-local, and IPv6 forms that embed a private IPv4 (mapped, NAT64, 6to4) are refused. The connection is pinned to the checked addresses, so DNS rebinding cannot reach an internal host. Every redirect hop is checked again, with at most 5 hops. Responses are capped at 5 MB and must be HTML, XML, or text. Slack alerts post only to `https://hooks.slack.com/services/…`.
