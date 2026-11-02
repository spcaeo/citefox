/**
 * The countries and languages every market picker offers (owner feedback
 * 2026-10-25: "all countries, most used on top, US and EN by default, all
 * flags"). Country names come from the system's own list (Intl.DisplayNames);
 * languages are the ones Google answers in, each with the flag of the country
 * most associated with it.
 */

/** ISO 3166-1 codes of inhabited places. The United Kingdom is GB. */
const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
  'BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ ' +
  'EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW ' +
  'GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ ' +
  'LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV ' +
  'MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD ' +
  'TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ' +
  'ZA ZM ZW'

/** Shown first, in this order: where most buyers are. */
export const TOP_COUNTRIES = [
  'US',
  'GB',
  'CA',
  'AU',
  'IN',
  'DE',
  'FR',
  'ES',
  'IT',
  'NL',
  'BR',
  'MX'
]

export const ALL_COUNTRY_CODES: readonly string[] = COUNTRY_CODES.split(' ')

/** 🇺🇸 for US: the two regional-indicator letters. UK shows the GB flag. */
export function flagFor(code: string): string {
  const upper = (code === 'UK' ? 'GB' : code).toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return ''
  return String.fromCodePoint(...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

let regionNames: Intl.DisplayNames | null = null

/** "United States" for US; the code itself when the system has no name. */
export function countryName(code: string): string {
  if (code === 'XK') return 'Kosovo'
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

export interface LanguageEntry {
  code: string
  name: string
  /** The country whose flag stands for the language. */
  flag: string
}

/** Shown first, in this order. */
export const TOP_LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'hi', 'ja', 'zh-CN']

export const LANGUAGES: readonly LanguageEntry[] = [
  { code: 'af', name: 'Afrikaans', flag: 'ZA' },
  { code: 'sq', name: 'Albanian', flag: 'AL' },
  { code: 'am', name: 'Amharic', flag: 'ET' },
  { code: 'ar', name: 'Arabic', flag: 'SA' },
  { code: 'hy', name: 'Armenian', flag: 'AM' },
  { code: 'az', name: 'Azerbaijani', flag: 'AZ' },
  { code: 'eu', name: 'Basque', flag: 'ES' },
  { code: 'be', name: 'Belarusian', flag: 'BY' },
  { code: 'bn', name: 'Bengali', flag: 'BD' },
  { code: 'bs', name: 'Bosnian', flag: 'BA' },
  { code: 'bg', name: 'Bulgarian', flag: 'BG' },
  { code: 'ca', name: 'Catalan', flag: 'AD' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', flag: 'CN' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', flag: 'TW' },
  { code: 'hr', name: 'Croatian', flag: 'HR' },
  { code: 'cs', name: 'Czech', flag: 'CZ' },
  { code: 'da', name: 'Danish', flag: 'DK' },
  { code: 'nl', name: 'Dutch', flag: 'NL' },
  { code: 'en', name: 'English', flag: 'US' },
  { code: 'et', name: 'Estonian', flag: 'EE' },
  { code: 'fil', name: 'Filipino', flag: 'PH' },
  { code: 'fi', name: 'Finnish', flag: 'FI' },
  { code: 'fr', name: 'French', flag: 'FR' },
  { code: 'gl', name: 'Galician', flag: 'ES' },
  { code: 'ka', name: 'Georgian', flag: 'GE' },
  { code: 'de', name: 'German', flag: 'DE' },
  { code: 'el', name: 'Greek', flag: 'GR' },
  { code: 'gu', name: 'Gujarati', flag: 'IN' },
  { code: 'he', name: 'Hebrew', flag: 'IL' },
  { code: 'hi', name: 'Hindi', flag: 'IN' },
  { code: 'hu', name: 'Hungarian', flag: 'HU' },
  { code: 'is', name: 'Icelandic', flag: 'IS' },
  { code: 'id', name: 'Indonesian', flag: 'ID' },
  { code: 'ga', name: 'Irish', flag: 'IE' },
  { code: 'it', name: 'Italian', flag: 'IT' },
  { code: 'ja', name: 'Japanese', flag: 'JP' },
  { code: 'kn', name: 'Kannada', flag: 'IN' },
  { code: 'kk', name: 'Kazakh', flag: 'KZ' },
  { code: 'km', name: 'Khmer', flag: 'KH' },
  { code: 'ko', name: 'Korean', flag: 'KR' },
  { code: 'lo', name: 'Lao', flag: 'LA' },
  { code: 'lv', name: 'Latvian', flag: 'LV' },
  { code: 'lt', name: 'Lithuanian', flag: 'LT' },
  { code: 'mk', name: 'Macedonian', flag: 'MK' },
  { code: 'ms', name: 'Malay', flag: 'MY' },
  { code: 'ml', name: 'Malayalam', flag: 'IN' },
  { code: 'mt', name: 'Maltese', flag: 'MT' },
  { code: 'mr', name: 'Marathi', flag: 'IN' },
  { code: 'mn', name: 'Mongolian', flag: 'MN' },
  { code: 'ne', name: 'Nepali', flag: 'NP' },
  { code: 'no', name: 'Norwegian', flag: 'NO' },
  { code: 'fa', name: 'Persian', flag: 'IR' },
  { code: 'pl', name: 'Polish', flag: 'PL' },
  { code: 'pt', name: 'Portuguese', flag: 'PT' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', flag: 'BR' },
  { code: 'pa', name: 'Punjabi', flag: 'IN' },
  { code: 'ro', name: 'Romanian', flag: 'RO' },
  { code: 'ru', name: 'Russian', flag: 'RU' },
  { code: 'sr', name: 'Serbian', flag: 'RS' },
  { code: 'si', name: 'Sinhala', flag: 'LK' },
  { code: 'sk', name: 'Slovak', flag: 'SK' },
  { code: 'sl', name: 'Slovenian', flag: 'SI' },
  { code: 'es', name: 'Spanish', flag: 'ES' },
  { code: 'sw', name: 'Swahili', flag: 'KE' },
  { code: 'sv', name: 'Swedish', flag: 'SE' },
  { code: 'ta', name: 'Tamil', flag: 'IN' },
  { code: 'te', name: 'Telugu', flag: 'IN' },
  { code: 'th', name: 'Thai', flag: 'TH' },
  { code: 'tr', name: 'Turkish', flag: 'TR' },
  { code: 'uk', name: 'Ukrainian', flag: 'UA' },
  { code: 'ur', name: 'Urdu', flag: 'PK' },
  { code: 'uz', name: 'Uzbek', flag: 'UZ' },
  { code: 'vi', name: 'Vietnamese', flag: 'VN' },
  { code: 'cy', name: 'Welsh', flag: 'GB' },
  { code: 'zu', name: 'Zulu', flag: 'ZA' }
]
