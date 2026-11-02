/** The open project as the journey screens need it. */
export interface StartProject {
  id: string
  name: string
  domain: string
  /** Saved profile, for the examples on "How do you want to start?". */
  brandNames?: readonly string[]
  competitors?: readonly string[]
  switchingFrom?: readonly string[]
}
