/** A smoke failure. `reported` means the message was already printed. */
export class SmokeError extends Error {
  readonly reported: boolean

  constructor(message: string, reported = false) {
    super(message)
    this.name = 'SmokeError'
    this.reported = reported
  }
}
