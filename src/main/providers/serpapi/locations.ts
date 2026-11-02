import type { LocationMatch } from '../../locations'

/**
 * FR-9.5. Bundled slice of SerpApi's location list (`/locations.json`), so a city
 * typed for a market is matched to SerpApi's canonical name offline and without
 * a search. Each city answers to its name and to "City, Region". UK cities are
 * listed under both `UK` and `GB`, the two codes a market can store.
 * A city outside this list stays unmatched and is sent as typed.
 */
const CITIES: ReadonlyArray<{ countries: readonly string[]; canonical: string }> = [
  ...inCountry(['US'], 'United States', [
    ['New York', 'New York'],
    ['Los Angeles', 'California'],
    ['San Francisco', 'California'],
    ['San Diego', 'California'],
    ['San Jose', 'California'],
    ['Chicago', 'Illinois'],
    ['Houston', 'Texas'],
    ['Austin', 'Texas'],
    ['Dallas', 'Texas'],
    ['San Antonio', 'Texas'],
    ['Phoenix', 'Arizona'],
    ['Philadelphia', 'Pennsylvania'],
    ['Seattle', 'Washington'],
    ['Boston', 'Massachusetts'],
    ['Miami', 'Florida'],
    ['Orlando', 'Florida'],
    ['Tampa', 'Florida'],
    ['Atlanta', 'Georgia'],
    ['Denver', 'Colorado'],
    ['Portland', 'Oregon'],
    ['Las Vegas', 'Nevada'],
    ['Nashville', 'Tennessee'],
    ['Charlotte', 'North Carolina'],
    ['Minneapolis', 'Minnesota'],
    ['Detroit', 'Michigan'],
    ['Columbus', 'Ohio'],
    ['Salt Lake City', 'Utah'],
    ['Washington', 'District of Columbia']
  ]),
  ...inCountry(['UK', 'GB'], 'United Kingdom', [
    ['London', 'England'],
    ['Manchester', 'England'],
    ['Birmingham', 'England'],
    ['Leeds', 'England'],
    ['Liverpool', 'England'],
    ['Bristol', 'England'],
    ['Sheffield', 'England'],
    ['Newcastle upon Tyne', 'England'],
    ['Nottingham', 'England'],
    ['Edinburgh', 'Scotland'],
    ['Glasgow', 'Scotland'],
    ['Cardiff', 'Wales'],
    ['Belfast', 'Northern Ireland']
  ]),
  ...inCountry(['CA'], 'Canada', [
    ['Toronto', 'Ontario'],
    ['Ottawa', 'Ontario'],
    ['Vancouver', 'British Columbia'],
    ['Montreal', 'Quebec'],
    ['Calgary', 'Alberta'],
    ['Edmonton', 'Alberta'],
    ['Winnipeg', 'Manitoba']
  ]),
  ...inCountry(['AU'], 'Australia', [
    ['Sydney', 'New South Wales'],
    ['Melbourne', 'Victoria'],
    ['Brisbane', 'Queensland'],
    ['Perth', 'Western Australia'],
    ['Adelaide', 'South Australia'],
    ['Canberra', 'Australian Capital Territory']
  ]),
  ...inCountry(['IN'], 'India', [
    ['Mumbai', 'Maharashtra'],
    ['Pune', 'Maharashtra'],
    ['New Delhi', 'Delhi'],
    ['Bengaluru', 'Karnataka'],
    ['Chennai', 'Tamil Nadu'],
    ['Hyderabad', 'Telangana'],
    ['Kolkata', 'West Bengal'],
    ['Ahmedabad', 'Gujarat']
  ]),
  ...inCountry(['MX'], 'Mexico', [
    ['Mexico City', 'Mexico City'],
    ['Guadalajara', 'Jalisco'],
    ['Monterrey', 'Nuevo Leon']
  ])
]

export const SERPAPI_LOCATIONS: readonly LocationMatch[] = CITIES.flatMap((city) => {
  const [name = '', region = ''] = city.canonical.split(',')
  const queries = name === region ? [name] : [name, `${name}, ${region}`]
  return city.countries.flatMap((country) =>
    queries.map((query) => ({ country, query, canonicalName: city.canonical }))
  )
})

function inCountry(
  countries: readonly string[],
  countryName: string,
  cities: ReadonlyArray<readonly [string, string]>
): Array<{ countries: readonly string[]; canonical: string }> {
  return cities.map(([city, region]) => ({
    countries,
    canonical: `${city},${region},${countryName}`
  }))
}
