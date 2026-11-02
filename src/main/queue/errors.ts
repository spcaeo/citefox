/** Invalid queue input. The queue does not perform I/O. */
export class QueueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueueError'
  }
}
