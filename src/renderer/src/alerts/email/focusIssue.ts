import type { AccountIssues } from '../model'

/** Moves focus to the first field with a problem. */
export function focusIssue(issues: AccountIssues): void {
  const order: (keyof AccountIssues)[] = [
    'fromName',
    'fromAddress',
    'replyTo',
    'host',
    'port',
    'username',
    'password'
  ]
  const ids: Record<keyof AccountIssues, string> = {
    fromName: 'e-from-name',
    fromAddress: 'e-from',
    replyTo: 'e-reply',
    host: 'e-host',
    port: 'e-port',
    username: 'e-user',
    password: 'e-pass'
  }
  const first = order.find((key) => issues[key])
  if (first) document.getElementById(ids[first])?.focus()
}
