# Codex CLI fixtures

Output of `codex exec --json` (codex-cli 0.149.0, macOS, Oct 2026), with thread ids,
cf-ray values, request ids and web-search ids replaced.

- `exec-*.jsonl`, `version.txt`, `login-*.txt`: recorded from live runs.
- `constructed-*.jsonl`: written by hand in the same event shape, because a usage
  limit, a rate limit and an overload cannot be triggered on demand. The wording
  follows Codex's own messages for those cases.
