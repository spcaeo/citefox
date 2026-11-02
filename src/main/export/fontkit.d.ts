declare module 'fontkit' {
  export interface FontkitFont {
    characterSet: readonly number[]
  }

  export function openSync(filename: string): FontkitFont
}
