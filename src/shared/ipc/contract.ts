/**
 * Building blocks for the IPC contract.
 * Each area module declares its channels once, in a spec record built with
 * `invoke`, `invokeWith`, and `push`. `index.ts` merges the records and derives
 * the type maps, the allow-list, the arity table, the preload API, and main's dispatch.
 */

/**
 * One renderer-to-main invoke. `arity` is the argument count main accepts.
 * `types` carries the argument and result types for the compiler. It is never set.
 */
export interface InvokeSpec<Args extends readonly unknown[], Result> {
  readonly arity: Args['length']
  readonly types?: { readonly args: Args; readonly result: Result }
}

/** One main-to-renderer push event. `payload` is a type carrier and is never set. */
export interface PushSpec<Payload> {
  readonly push: true
  readonly payload?: Payload
}

export type InvokeChannelSpecs = Readonly<Record<string, InvokeSpec<[] | [unknown], unknown>>>
export type PushChannelSpecs = Readonly<Record<string, PushSpec<unknown>>>

/** An invoke the renderer calls with no arguments. */
export function invoke<Result>(): InvokeSpec<[], Result> {
  return { arity: 0 }
}

/** An invoke the renderer calls with exactly one argument. */
export function invokeWith<Arg, Result>(): InvokeSpec<[Arg], Result> {
  return { arity: 1 }
}

/** A push event main sends and the renderer subscribes to. */
export function push<Payload>(): PushSpec<Payload> {
  return { push: true }
}

/** `{ channel: { args, result } }` for a merged invoke spec record. */
export type InvokeMapOf<S> = {
  -readonly [C in keyof S]: S[C] extends InvokeSpec<infer Args extends readonly unknown[], infer R>
    ? { args: Args; result: R }
    : never
}

/** `{ channel: payload }` for a merged push spec record. */
export type PushMapOf<S> = {
  -readonly [E in keyof S]: S[E] extends PushSpec<infer P> ? P : never
}

/**
 * The spec records in `groups` as one record type. Tail-recursive (the result rides
 * in `Merged`), so the list of areas can grow past TypeScript's depth limit.
 */
export type MergedSpecs<T extends readonly object[], Merged = unknown> = T extends readonly [
  infer Head,
  ...infer Rest extends readonly object[]
]
  ? MergedSpecs<Rest, Merged & Head>
  : Merged

/** Channel names declared by more than one record in `groups`. `never` when there are none. */
export type DuplicateChannels<
  T extends readonly object[],
  Seen = never,
  Found = never
> = T extends readonly [infer Head, ...infer Rest extends readonly object[]]
  ? DuplicateChannels<Rest, Seen | keyof Head, Found | Extract<keyof Head, Seen>>
  : Found

/** Merges the per-area spec records. Typecheck guards duplicates (`DuplicateChannels`). */
export function mergeSpecs<const T extends readonly object[]>(groups: T): MergedSpecs<T> {
  const merged: Record<string, unknown> = {}
  for (const group of groups) {
    for (const [channel, spec] of Object.entries(group)) merged[channel] = spec
  }
  return merged as MergedSpecs<T>
}

/** The record's own keys. A spec record is a plain object literal, so these are its channels. */
export function channelNames<S extends object>(specs: S): Extract<keyof S, string>[] {
  return Object.keys(specs) as Extract<keyof S, string>[]
}
