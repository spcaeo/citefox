/** Invalid schedule input. The scheduler does not perform I/O. */
export class ScheduleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScheduleError'
  }
}
