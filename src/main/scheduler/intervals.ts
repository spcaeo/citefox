import {
  DEFAULT_INTERVAL_DAYS,
  INTERVAL_DAYS,
  isIntervalDays,
  QUICK_INTERVAL_DAYS
} from '@shared/domain'
import type { IntervalDays } from '@shared/domain'
import { ScheduleError } from './errors'

/**
 * One day as a fixed duration.
 * FR-1.4 stores the interval in days. This module adds `intervalDays` of these,
 * not a local calendar date, so a day is always 86_400_000 ms (NFR-15 real time).
 */
export const MS_PER_DAY = 86_400_000

/**
 * FR-1.4. Add page offers every day, 7, 14 or 30 days.
 * The app-wide default for a new page is {@link DEFAULT_INTERVAL_DAYS} (7).
 */
export const ADD_PAGE_INTERVAL_DAYS = QUICK_INTERVAL_DAYS
export type AddPageIntervalDays = (typeof ADD_PAGE_INTERVAL_DAYS)[number]

/**
 * FR-1.4. Import pages offers every interval: 1, 7, 14, 30, 60 and 90 days.
 * 60 and 90 are not Add page choices.
 */
export const IMPORT_PAGE_INTERVAL_DAYS = INTERVAL_DAYS

/**
 * Section 6.3. A large import is recommended at 30 days (and 5 prompts).
 * That recommendation is not the app default and not the Add page default.
 */
export const LARGE_IMPORT_RECOMMENDED_INTERVAL_DAYS = 30 as const satisfies IntervalDays

/** FR-14.5. Days after go-live when the fix form offers a follow-up. */
export const FIX_FOLLOW_UP_DAY_OPTIONS = [3, 7] as const

/** SCH-12. First checks for a large import can be spread across this many days. */
export const STAGGER_WINDOW_DAYS = 7

/** SCH-9. Due pages run in batches of this size when `spreadAcrossDay` is on. */
export const SPREAD_BATCH_SIZE = 5

/** SCH-9. Gap between spread batches. */
export const SPREAD_BATCH_GAP_MS = 15 * 60 * 1000

export { DEFAULT_INTERVAL_DAYS }

export function isAddPageIntervalDays(value: number): value is AddPageIntervalDays {
  return ADD_PAGE_INTERVAL_DAYS.some((item) => item === value)
}

/**
 * SCH-9. A page keeps its own interval. The project default applies only when
 * the page has not stored one yet. The app default is 7 when the project has
 * not stored one either; the caller passes that in as `projectDefault`.
 */
export function resolveIntervalDays(
  pageInterval: IntervalDays | null,
  projectDefault: IntervalDays
): IntervalDays {
  if (!isIntervalDays(projectDefault)) {
    throw new ScheduleError('Invalid project default interval')
  }
  if (pageInterval === null) return projectDefault
  if (!isIntervalDays(pageInterval)) throw new ScheduleError('Invalid page interval')
  return pageInterval
}
