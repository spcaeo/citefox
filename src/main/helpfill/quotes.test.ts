import { describe, expect, test } from 'vitest'
import { straightenQuotes } from './quotes'

describe('straightenQuotes', () => {
  test('a field wrapped in typographic quotes becomes a CSV-quoted field', () => {
    expect(straightenQuotes('a,”b, c”,d', ',')).toBe('a,"b, c",d')
    expect(straightenQuotes('a,“b, c”,d', ',')).toBe('a,"b, c",d')
    expect(straightenQuotes('„b; c‟;d', ';')).toBe('"b; c";d')
    expect(straightenQuotes('a,″b, c″', ',')).toBe('a,"b, c"')
    expect(straightenQuotes('a, “b, c” ,d', ',')).toBe('a, "b, c",d')
  })

  test('plain quotes inside a straightened field are doubled', () => {
    expect(straightenQuotes('a,“say "hi", then go”', ',')).toBe('a,"say ""hi"", then go"')
  })

  test('curly quotes inside ordinary text, and plain-quoted fields, are left alone', () => {
    expect(straightenQuotes('a,called “easy” by staff,c', ',')).toBe('a,called “easy” by staff,c')
    expect(straightenQuotes('“Fast” delivery,b', ',')).toBe('“Fast” delivery,b')
    expect(straightenQuotes('"x, “y”",z', ',')).toBe('"x, “y”",z')
    expect(straightenQuotes('no quotes, here', ',')).toBe('no quotes, here')
  })

  test('a tab line keeps its tabs', () => {
    expect(straightenQuotes('a\t“b\tc”\td', '\t')).toBe('a\t"b\tc"\td')
  })
})
