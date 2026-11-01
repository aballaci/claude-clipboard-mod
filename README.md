# Clipboard

A notepad pane for Claude Code that sits beside the chat. Clip text you
highlight in the conversation into notes, edit them, and put a note, or just
part of it, back into your message.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clipboard --marketplace aballaci/claude-clipboard-mod
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```bash
claude plugin install clipboard --marketplace aballaci/claude-clipboard-mod
```

## Use

- **Clip selection** (`c`), the **Add to clip** button above the prompt, or
  `/clip`: turn text highlighted in the chat into a new note.
- **New note** (`n`): an empty note to write in.
- The open note is a text box that saves as you type. Its **Insert all**
  button (or Enter) puts the whole note into your message box.
- **Insert selection**: click the word where your part starts, then the word
  where it ends (each later click moves the end), and press **Insert "…"**.
- **Send** sends the note as your message; **Delete** removes it.
- Other notes fold to a one-line headline; click it or **▾** to expand.
- `/clipboard` opens the pane.

Notes are kept in the mod's own store, so they carry over between sessions.

## Limits

The desktop app does not let a mod read what you highlight inside its pane or
a text box, so part of a note is picked by clicking words. On the phone app
notes are read-only.

## License

MIT
