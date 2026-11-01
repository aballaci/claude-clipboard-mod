export type Clip = { id: string; text: string }
// The note Insert selection is open on: the word clicked first, which anchors
// the selection, and the word clicked last, where it ends.
export type Pick = { id: string; from: number | null; to: number | null }

declare module 'claude-code' {
  interface PluginState {
    clipboard: {
      clips: Shaped<Clip[]>
      pending: string | null
      picking: Shaped<Pick | null>
      active: string | null
    }
  }
}
