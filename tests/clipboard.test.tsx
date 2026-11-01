import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'clipboard',
  component: 'Pane',
  requestId: 'clipboard',
  props: {
    title: 'Clipboard',
    isFocused: true,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a chat selection is clipped and inserted into the prompt', async ($, on) => {
  const filled: string[] = []
  on('ui.selection', () => ({ value: { text: '  Ciao, come stai?  ' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })

  const note = await ui.find({ type: 'Input' })
  expect(note?.props.value).toBe('Ciao, come stai?')

  // The field's own button (and Enter) inserts the note.
  expect(note?.props.submitLabel).toBe('Insert all')
  await ui.input({ key: note!.key!, text: 'Ciao, come stai?' })
  expect(filled).toEqual(['Ciao, come stai?'])
  await ui.unmount()
})

test('nothing selected leaves the notepad empty', async ($, on) => {
  on('ui.selection', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'clip-selection' })

  expect((await ui.find({ type: 'Text', text: /Select text/ }))?.text).toContain(
    'Select text in the chat',
  )
  await ui.unmount()
})

const BAND = {
  plugin: 'clipboard',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

test('a selection shows Add to clip above the prompt until it is clipped', async ($, on) => {
  const clock = mock.clock(on)
  let selected: string | undefined = 'Dove si trova la stazione?'
  on('ui.selection', () => ({
    value: selected === undefined ? undefined : { text: selected },
  }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Stands for the engine's own band when the mod has nothing to offer.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(600)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Button', text: 'Add to clip' })).toBeTruthy()
  await band.press({ key: 'add-to-clip' })
  await clock.advance(600)
  expect(await band.find({ type: 'Button', text: 'Add to clip' })).toBeFalsy()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const note = await pane.find({ type: 'Input' })
  expect(note?.props.value).toBe('Dove si trova la stazione?')
  await pane.unmount()

  selected = undefined
  await clock.advance(600)
})

test('one short note fills the pane', async ($, on) => {
  on('ui.selection', () => ({ value: { text: 'Buongiorno' } }))
  on('ui.toast', () => ({ value: undefined }))

  // 30 body rows less the desktop's top bar (3) and the open card's chrome (6).
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(21)
  await ui.unmount()

  // The terminal draws its chrome a line each: bar 2, open card 5.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Input' }))?.props.rows).toBe(23)
  await term.unmount()
})

test('notes taller than the pane keep their own height', async ($, on) => {
  const tall = Array.from({ length: 40 }, (_, i) => `riga ${i}`).join('\n')
  on('ui.selection', () => ({ value: { text: tall } }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })
  expect((await ui.find({ type: 'Input' }))?.props.rows).toBe(40)
  await ui.unmount()
})

test('the mobile app shows notes as text', async ($, on) => {
  on('ui.selection', () => ({ value: { text: 'Grazie' } }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'clip-selection' })
  expect((await ui.find({ type: 'Text', text: /Grazie/ }))?.text).toBe('1. Grazie')
  await ui.unmount()
})

test('Insert selection: the first word clicked anchors, later clicks move the end', async ($, on) => {
  const filled: string[] = []
  on('ui.selection', () => ({ value: { text: 'Vorrei un caffè,\nper favore.' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text }
  })

  let isClipped = false
  for (const surface of ['desktop', 'terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (!isClipped) {
      await ui.press({ key: 'clip-selection' })
      isClipped = true
    }
    const open = await ui.find({ type: 'Button', text: 'Insert selection' })
    await ui.press({ key: open!.key! })
    expect(await ui.find({ type: 'Input' })).toBeFalsy()

    const word = async (text: string) =>
      (await ui.findAll({ type: 'Button' })).find(button => button.text === text)!
    await ui.press({ key: (await word('per')).key! })
    expect(await ui.find({ type: 'Button', text: 'Insert "per"' })).toBeTruthy()
    // Later clicks move the end, before the anchor too; a repeat changes nothing.
    await ui.press({ key: (await word('un')).key! })
    await ui.press({ key: (await word('un')).key! })
    const insert = await ui.find({ type: 'Button', text: 'Insert "un caffè, per"' })
    await ui.press({ key: insert!.key! })
    expect(filled.at(-1)).toBe('un caffè,\nper')

    // The view closes; the note is a field again with its own text.
    expect((await ui.find({ type: 'Input' }))?.props.value).toBe('Vorrei un caffè,\nper favore.')
    await ui.unmount()
  }
  expect(filled.length).toBe(3)
})

test('Send under the note sends it; Enter inserts it; no Save anywhere', async ($, on) => {
  const sent: string[] = []
  const filled: string[] = []
  on('ui.selection', () => ({ value: { text: 'Sì, certo.' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true, text: e.text }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })
  const labels = (await ui.findAll({ type: 'Button' })).map(button => button.text)
  expect(labels).not.toContain('Save')

  const field = await ui.find({ type: 'Input' })
  await ui.input({ key: field!.key!, text: 'Sì, certo!' })
  expect(filled).toEqual(['Sì, certo!'])
  expect(sent).toEqual([])

  const send = (await ui.findAll({ type: 'Button' })).find(button =>
    button.key?.startsWith('send:'),
  )
  await ui.press({ key: send!.key! })
  expect(sent).toEqual(['Sì, certo!'])
  await ui.unmount()
})

test('notes are kept in the store and come back in a new session', async ($, on) => {
  let stored: unknown = [{ id: 'kept', text: 'Dalla sessione di ieri' }]
  on('store.get', () => ({ value: stored }))
  on('store.set', (_, e) => {
    stored = e.value

    return { value: undefined }
  })
  on('ui.selection', () => ({ value: { text: 'Nota nuova' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('Dalla sessione di ieri')

  // A new note and an edit reach the store.
  await ui.press({ key: 'clip-selection' })
  const fresh = await ui.find({ type: 'Input' })
  await ui.input({ key: fresh!.key!, text: 'Nota nuova, cambiata', kind: 'change' })
  expect(stored).toEqual([
    { id: 'kept', text: 'Dalla sessione di ieri' },
    { id: fresh!.key!.slice(5), text: 'Nota nuova, cambiata' },
  ])
  await ui.unmount()
})

test('the other notes fold to an excerpt; ▾ expands one', async ($, on) => {
  let selected = 'Prima nota, abbastanza lunga da tagliare'
  on('ui.selection', () => ({ value: { text: selected } }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })
  selected = 'Seconda nota'
  await ui.press({ key: 'clip-selection' })

  // Only the newest note is a field: 30 rows less the bar (3), its card (6)
  // and the folded card (3).
  const fields = await ui.findAll({ type: 'Input' })
  expect(fields.map(field => field.props.value)).toEqual(['Seconda nota'])
  expect(fields[0]?.props.rows).toBe(18)

  // The folded note: its excerpt and the ▾ alone, none of the note's buttons.
  // Cut to fit the 50-column pane on one line.
  expect((await ui.find({ type: 'Text', text: /^1\. Prima nota/ }))?.text).toBe(
    '1. Prima nota, abbastanza lunga da taglia...',
  )
  const buttons = (await ui.findAll({ type: 'Button' })).map(button => button.text)
  expect(buttons.filter(text => text === 'Send').length).toBe(1)
  expect(buttons.filter(text => text === '▾').length).toBe(1)

  const expand = await ui.find({ type: 'Button', text: '▾' })
  await ui.press({ key: expand!.key! })
  const after = await ui.findAll({ type: 'Input' })
  expect(after.map(field => field.props.value)).toEqual([
    'Prima nota, abbastanza lunga da tagliare',
  ])
  await ui.unmount()
})

test("a folded note's headline expands it, kept to one line", async ($, on) => {
  const long = 'parola '.repeat(60).trim()
  let selected = long
  on('ui.selection', () => ({ value: { text: selected } }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clip-selection' })
  selected = 'Seconda nota'
  await ui.press({ key: 'clip-selection' })

  const headline = (await ui.findAll({ type: 'Button' })).find(button =>
    button.key?.startsWith('headline:'),
  )
  // The pane is 50 columns: the headline keeps to one line, 38 characters.
  expect(headline?.text).toBe(`1. ${long.slice(0, 38)}...`)

  await ui.unmount()

  // A wide pane cuts at 250 characters.
  const wide = await $.ui.mount({
    ...PANE,
    props: { ...PANE.props, bodyColumns: 400 },
    surface: 'desktop',
  })
  const wideHeadline = (await wide.findAll({ type: 'Button' })).find(button =>
    button.key?.startsWith('headline:'),
  )
  expect(wideHeadline?.text).toBe(`1. ${long.slice(0, 250)}...`)

  await wide.press({ key: wideHeadline!.key! })
  const fields = await wide.findAll({ type: 'Input' })
  expect(fields.map(field => field.props.value)).toEqual([long])
  await wide.unmount()
})
