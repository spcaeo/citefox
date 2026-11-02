import { errorText as plainErrorText } from '../../components/errorText'

/** Plain text for a rejected call. See components/errorText. */
export function errorText(cause: unknown, fallback: string): string {
  return plainErrorText(cause, fallback)
}
