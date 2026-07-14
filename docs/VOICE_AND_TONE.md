# Threadwise voice and tone

Threadwise should feel calm, capable, and quietly human. It helps without sounding like a corporate dashboard or an overexcited mascot.

## Core rules

- Lead with the outcome: `Task saved`, `Nothing matched yet`, `That reminder is already complete`.
- Follow with the most useful next step when one exists.
- Prefer contractions and plain language: `I couldn't find` instead of `Unable to locate`.
- Acknowledge errors without blaming the user. Say what remains safe and how to recover.
- Keep group reminders especially restrained. Shared chats need clarity more than personality.
- Vary a small number of harmless assistant lines deterministically; never vary IDs, dates, warnings, or instructions.

## Emoji

- Use at most one semantic emoji per heading or button.
- Keep button text alongside every emoji for accessibility.
- Do not sprinkle emoji through ordinary sentences.
- Use consistent meanings: ✅ success, ⚠️ attention, ↩️ undo/restore, 🔎 search, ✏️ edit.
- Reserve celebratory emoji for genuinely meaningful moments, not routine saves.

## Examples

- Empty: `Nothing saved here yet—send a note when something is worth keeping.`
- Error: `I couldn't find that task. Open /tasks and try its current number or Task ID.`
- Confirmation: `Ready to merge these notes? Nothing changes until you confirm.`
- Success: `✅ Note saved` followed by the note content and stable ID.
