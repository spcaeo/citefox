/**
 * The welcome tour's captions (Arc A, "From question to proof"), also shown as a hidden
 * text transcript so the tour makes sense without sound or sight. Plain words only: no
 * provider names (the guard test checks this). Times are seconds into the film.
 */
export interface TourCaption {
  start: number
  end: number
  text: string
}

export const TOUR_CAPTIONS: readonly TourCaption[] = [
  { start: 1.5, end: 5, text: 'Your buyers now ask AI, not Google.' },
  { start: 5.5, end: 10, text: 'Add the questions your buyers ask.' },
  { start: 10.5, end: 17.5, text: 'It checks the main AI engines for you.' },
  { start: 18, end: 22.5, text: 'See if your page is cited.' },
  { start: 23, end: 27.5, text: 'See who is cited instead.' },
  { start: 28, end: 35, text: 'Get a fix. Check it after 14 days.' },
  { start: 35.5, end: 40, text: 'Send a client-ready report.' },
  { start: 40.5, end: 45, text: 'Free. Runs on your computer.' }
]
