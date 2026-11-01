import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Clip, Pick } from '../types'

const PANE = 'clipboard'
const TITLE = 'Clipboard'
// Change the tag when a clip's fields change: it declines what an earlier
// version stored, which outlives a reload.
const clips = atom({ plugin: 'clipboard', key: 'clips' } as const, [], {
  shape: 'clips-1',
})

// The selection not yet clipped; the band above the prompt offers it.
const pending = atom(
  { plugin: 'clipboard', key: 'pending' } as const,
  null as string | null,
)
const WATCH_MS = 500
// The note Insert selection is open on. The desktop lets no one highlight a
// pane's text, a field's highlight never reaches $.ui.selection, and the
// desktop runs no Client (11-01): the part is chosen by clicking its words.
const picking = atom(
  { plugin: 'clipboard', key: 'picking' } as const,
  null as Pick | null,
  { shape: 'pick-8' },
)

// A note's words with where each starts and ends, so the selection keeps the
// note's own spacing and line breaks.
const wordsOf = (text: string) =>
  [...text.matchAll(/\S+/g)].map(match => ({
    word: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))

// The selected words, first to last whichever was clicked first.
const pickedRange = (pick: Pick | null) => {
  if (pick?.from == null) {
    return undefined
  }
  const to = pick.to ?? pick.from

  return { lo: Math.min(pick.from, to), hi: Math.max(pick.from, to) }
}

const pickedText = (text: string, pick: Pick | null) => {
  const range = pickedRange(pick)
  const words = wordsOf(text)
  const first = range && words[range.lo]
  const last = range && words[range.hi]

  return first && last ? text.slice(first.start, last.end) : undefined
}

// The first click anchors the selection; every later click moves its other
// end, either way, so a press the surface delivers twice changes nothing.
const clickWord = (pick: Pick | null, id: string, index: number): Pick =>
  pick?.id === id && pick.from !== null
    ? { id, from: pick.from, to: index }
    : { id, from: index, to: null }

// The note that is expanded: the one last focused, typed in, added or
// expanded; the others are folded to a one-line excerpt.
const active = atom(
  { plugin: 'clipboard', key: 'active' } as const,
  null as string | null,
)
const MIN_ROWS = 2

// Rows a text takes at `columns` cells wide, each line wrapped.
const wrappedRows = (text: string, columns: number) =>
  text
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / columns)), 0)

// Rows the pane spends besides the expanded note's field, in text lines: the
// bar on top, the expanded card's border, gap and action row, and each folded
// card with the gap after it. The desktop draws buttons, borders and padding
// taller than a line (measured from its screenshots), the terminal a line each.
const CHROME = {
  terminal: { bar: 2, open: 5, folded: 4 },
  drawn: { bar: 3, open: 6, folded: 3 },
}

// The expanded note's field rows: what its text needs, or the rest of the
// pane, whichever is more, so the pane scrolls only when that text alone is
// taller than the room left.
const fieldRows = (
  text: string,
  notes: number,
  bodyRows: number,
  columns: number,
  chrome: { bar: number; open: number; folded: number },
) => {
  const room = bodyRows - chrome.bar - chrome.open - (notes - 1) * chrome.folded

  return Math.max(MIN_ROWS, wrappedRows(text, columns), room)
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

const preview = (text: string, length: number, ellipsis = '…') => {
  const flat = squash(text)

  return flat.length > length ? `${flat.slice(0, length)}${ellipsis}` : flat
}

const HEADLINE_CHARS = 250

// The notes are drawn from `clips` (session state redraws the pane) and kept
// in the mod's store, a JSON file under the Claude Code config folder, so
// they outlast the session. Every write goes through here to keep both.
const STORE_KEY = 'clips'

const writeClips = async ($: EngineInterface, change: (list: Clip[]) => Clip[]) => {
  await update($, clips, list => change([...list]))
  // A store that cannot be written loses nothing drawn: the session keeps it.
  await $.store.set(STORE_KEY, await read($, clips)).catch(() => undefined)
}

const isClips = (value: unknown): value is Clip[] =>
  Array.isArray(value) &&
  value.every(
    one =>
      typeof one === 'object' &&
      one !== null &&
      typeof (one as Clip).id === 'string' &&
      typeof (one as Clip).text === 'string',
  )

const setClipText = async ($: EngineInterface, id: string, text: string) => {
  await writeClips($, all =>
    all.map(one => (one.id === id ? { ...one, text } : one)),
  )
  if ((await read($, active)) !== id) {
    await update($, active, () => id)
  }
}

const newId = () => Math.random().toString(36).slice(2, 10)

const addClip = async ($: EngineInterface, text: string) => {
  const clip: Clip = { id: newId(), text }
  await writeClips($, list => [...list, clip])
  await update($, active, () => clip.id)

  return clip
}

// The text the person last selected anywhere on screen: a chat row, the
// prompt, or this pane's own notes.
const selectedText = async ($: EngineInterface) => {
  const selected = await $.ui.selection()
  const text = selected?.text.trim()

  return text ? text : undefined
}

// The selection stays reported after it is clipped, until the person selects
// again; this keeps the band from offering it twice.
let lastClipped: string | undefined

const clipSelection = async ($: EngineInterface) => {
  const text = await selectedText($)
  if (!text) {
    $.ui.toast('Select some text in the chat first')

    return false
  }
  await addClip($, text)
  lastClipped = text
  await update($, pending, () => null)
  $.ui.toast('Clipped')

  return true
}

const insertIntoPrompt = async ($: EngineInterface, text: string) => {
  const filled = await $.prompt.fill({ text, mode: 'insert' })
  if (!filled.isFilled) {
    $.ui.toast('The prompt box is not available right now')
  }
}

export const register: Register = on => {
  let watch: Timer | undefined

  on('session.start', async ($, e, next) => {
    // A new session starts from the notes kept in the store; a reload keeps
    // the session's own, which the store already holds.
    const kept = await $.store.get(STORE_KEY).catch(() => undefined)
    const current = await read($, clips)
    if (isClips(kept) && current.length === 0 && kept.length > 0) {
      await update($, clips, () => kept)
    } else if (current.length > 0 && !(isClips(kept) && kept.length > 0)) {
      // Notes made before the store was used: keep them from now on too.
      await $.store.set(STORE_KEY, current).catch(() => undefined)
    }
    watch?.cancel()
    watch = $.clock.every(WATCH_MS, async () => {
      const text = await selectedText($)
      const offer = text && text !== lastClipped ? text : null
      if ((await read($, pending)) !== offer) {
        await update($, pending, () => offer)
      }
    })
    await $.command.register({
      name: 'clipboard',
      description: 'Open the clipboard notepad beside the chat',
    })
    await $.command.register({
      name: 'clip',
      description: 'Add the text you selected to the clipboard notepad',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'clipboard' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Clipboard opened.' }
  })

  on('command.run', { command: 'clip' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const isClipped = await clipSelection($)

    return { text: isClipped ? 'Selection clipped.' : 'Nothing selected.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const offer = await read($, pending)
    if (e.props.hasSurvey || offer === null) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Button
          key="add-to-clip"
          label="Add to clip"
          onPress={() => void clipSelection($)}
        />
        <Text dimColor>{preview(offer, 40)}</Text>
      </Box>
    )
  })

  // The ring landing on a note's field, by Tab or a click, expands that note.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const id = e.element?.startsWith('edit:') ? e.element.slice(5) : undefined
    // Expanding is a nicety: a failed write never holds the focus back.
    if (id) {
      await update($, active, () => id).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // The mobile app draws no text field yet: notes are read-only there.
    const Input = 'Input' in ui && e.surface !== 'mobile' ? ui.Input : undefined
    const list = await read($, clips)
    const pick = await read($, picking)
    const activeId = await read($, active)
    // No note focused yet, or it was deleted: the newest one is expanded.
    const found = list.findIndex(clip => clip.id === activeId)
    const expanded = found === -1 ? list.length - 1 : found
    const rows = fieldRows(
      list[expanded]?.text ?? '',
      list.length,
      e.props.scroll.bodyRows,
      // The card's border and padding.
      Math.max(10, e.props.bodyColumns - 6),
      e.surface === 'terminal' ? CHROME.terminal : CHROME.drawn,
    )

    const endPick = () => update($, picking, () => null)

    const remove = (id: string) =>
      writeClips($, all => all.filter(one => one.id !== id))

    // A headline fits one line: at most HEADLINE_CHARS, and no more than the
    // card has room for (its border, padding, the ▾ and the number), so every
    // folded card is one line tall whatever the note holds.
    const headlineChars = Math.max(
      10,
      Math.min(HEADLINE_CHARS, e.props.bodyColumns - 12),
    )

    const folded = (clip: Clip, index: number) => (
      <Box
        key={`clip:${clip.id}`}
        flexDirection="row"
        alignItems="center"
        borderStyle="round"
        borderDimColor
        paddingX={1}
        gap={1}
      >
        <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
          <Button
            key={`headline:${clip.id}`}
            plain
            onPress={() => update($, active, () => clip.id)}
          >
            <Text dimColor wrap="truncate-end">
              {`${index + 1}. ${preview(clip.text, headlineChars, '...') || '(empty)'}`}
            </Text>
          </Button>
        </Box>
        <Button
          key={`expand:${clip.id}`}
          label="▾"
          plain
          onPress={() => update($, active, () => clip.id)}
        />
      </Box>
    )

    const picker = (clip: Clip, current: Pick) => {
      const range = pickedRange(current)
      const picked = pickedText(clip.text, current)

      return (
        <Box flexDirection="column">
          <Box flexDirection="column" minHeight={rows}>
            <Box flexDirection="row" flexWrap="wrap">
              {wordsOf(clip.text).map(({ word }, i) => {
                const isIn = range !== undefined && i >= range.lo && i <= range.hi

                return (
                  <Button
                    key={`word:${clip.id}:${i}`}
                    plain
                    dimColor={range !== undefined && !isIn}
                    onPress={() =>
                      update($, picking, pick => clickWord(pick, clip.id, i))
                    }
                  >
                    <Text bold={isIn} underline={isIn}>
                      {word}
                    </Text>
                  </Button>
                )
              })}
            </Box>
          </Box>
          <Box
            flexDirection="row"
            justifyContent="space-between"
            alignItems="center"
            marginTop={1}
          >
            <Box flexDirection="row" gap={1} flexShrink={1}>
              {picked === undefined ? (
                <Text dimColor>Click where it starts, then where it ends</Text>
              ) : (
                <Button
                  key={`insert-picked:${clip.id}`}
                  label={`Insert "${preview(picked, 40)}"`}
                  variant="primary"
                  onPress={async () => {
                    await insertIntoPrompt($, picked)
                    await endPick()
                  }}
                />
              )}
            </Box>
            <Box flexDirection="row" gap={1}>
              {range !== undefined && (
                <Button
                  key={`clear:${clip.id}`}
                  label="Clear"
                  onPress={() =>
                    update($, picking, () => ({ id: clip.id, from: null, to: null }))
                  }
                />
              )}
              <Button key={`pick:${clip.id}`} label="Cancel" onPress={() => void endPick()} />
            </Box>
          </Box>
        </Box>
      )
    }

    const open = (clip: Clip, index: number) => (
      <Box
        key={`clip:${clip.id}`}
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
      >
        {pick?.id === clip.id ? (
          picker(clip, pick)
        ) : (
          <Box flexDirection="column">
            {Input ? (
              <Input
                key={`edit:${clip.id}`}
                rows={rows}
                value={clip.text}
                placeholder="Write a note"
                submitLabel="Insert all"
                onInput={(value: string) => void setClipText($, clip.id, value)}
                onSubmit={(value: string) => {
                  void setClipText($, clip.id, value)
                  void insertIntoPrompt($, value)
                }}
              />
            ) : (
              <Box minHeight={rows}>
                <Text>
                  <Text dimColor>{index + 1}. </Text>
                  {clip.text || '(empty)'}
                </Text>
              </Box>
            )}
            <Box
              flexDirection="row"
              justifyContent="space-between"
              alignItems="center"
              marginTop={1}
            >
              <Box flexDirection="row" gap={1}>
                {!Input && (
                  <Button
                    key={`insert:${clip.id}`}
                    label="Insert"
                    variant="primary"
                    onPress={() => void insertIntoPrompt($, clip.text)}
                  />
                )}
                {Input && (
                  <Button
                    key={`pick:${clip.id}`}
                    label="Insert selection"
                    onPress={() =>
                      update($, picking, () => ({ id: clip.id, from: null, to: null }))
                    }
                  />
                )}
              </Box>
              <Box flexDirection="row" gap={2} alignItems="center">
                <Button
                  key={`delete:${clip.id}`}
                  label="Delete"
                  plain
                  dimColor
                  onPress={() => void remove(clip.id)}
                />
                <Button
                  key={`send:${clip.id}`}
                  label="Send"
                  onPress={() =>
                    void (clip.text.trim()
                      ? $.prompt.submit({ text: clip.text, asUser: true })
                      : $.ui.toast('This note is empty'))
                  }
                />
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Box flexDirection="row" gap={1}>
            <Button
              key="clip-selection"
              label="Clip selection"
              hotkey="c"
              variant="primary"
              onPress={() => void clipSelection($)}
            />
            <Button
              key="new-note"
              label="New note"
              hotkey="n"
              onPress={() => void addClip($, '')}
            />
          </Box>
          <Text dimColor>
            {list.length === 1 ? '1 note' : `${list.length} notes`}
          </Text>
        </Box>

        {list.length === 0 && (
          <Text dimColor>
            Select text in the chat, then press Clip selection (or run /clip).
          </Text>
        )}

        {list.map((clip, index) =>
          index === expanded ? open(clip, index) : folded(clip, index),
        )}
      </Box>
    )
  })
}
