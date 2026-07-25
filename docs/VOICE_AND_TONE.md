# Threadwise Voice and Tone

Updated: 2026-07-26

Threadwise should feel calm, capable, and quietly human. It helps without sounding like a corporate dashboard or an overexcited chatbot.

## Core Rules

- Lead with the outcome: `Task saved`, `Nothing matched yet`, `That reminder is already complete`.
- Give the next useful action when one exists.
- Prefer contractions and plain language: `I couldn't find` instead of `Unable to locate`.
- Acknowledge errors without blaming the user. Say what remains safe and how to recover.
- Keep group reminders especially restrained. Shared chats need clarity more than personality.
- Vary only harmless assistant lines. Never vary IDs, dates, warnings, privacy boundaries, or instructions.
- Treat routine capture like quiet infrastructure: briefly acknowledge a successful task, note, or idea, then remove that acknowledgement after roughly three seconds.
- Keep parsed dates, time zones, recurrence, and assignees visible. They confirm what Threadwise understood.
- Never auto-remove errors, warnings, item details, menus, destructive confirmations, or controls the user may still need.
- If an addressed group flow expects text, say **“Reply to this message with your answer.”** “Send the next message” is misleading because Threadwise intentionally ignores unaddressed group conversation.
- Never imply end-to-end encryption or operator-unreadable storage. Explain the actual application-level isolation clearly.

## Ari

Ari is Threadwise's supporting mascot, not a character who comments on every action.

- Use Ari for onboarding, loading, meaningful empty states, and recoverable errors.
- Let text carry the instruction; Ari provides recognition and warmth.
- Do not put Ari on routine lists, every acknowledgement, or dense work cards.
- Use the approved light/dark artwork rather than redrawing the character inconsistently.
- Ari's loading motion—untangling a thread into a check—should communicate progress, not delay access to content.

## Emoji

- Use at most one semantic emoji per heading or button.
- Keep visible text beside every emoji for accessibility.
- Do not sprinkle emoji through ordinary sentences.
- Keep meanings consistent: ✅ success, ⚠️ attention, ↩️ undo/restore, 🔎 search, ✏️ edit.
- Reserve celebration for meaningful milestones, not routine saves.

## Examples

- Empty: `Nothing saved here yet—send a note when something is worth keeping.`
- Error: `I couldn't find that task. Open Tasks and try its current number or Task ID.`
- Confirmation: `Ready to merge these notes? Nothing changes until you confirm.`
- Quiet success: `Note saved · Deployment notes` (self-cleaning).
- Interpreted success: `Saved · Submit the form`, followed only by `When`, `Repeats`, or `For` when present.
- Group input: `Reply to this message with the idea you want to capture.`
- Provider failure: `The task is safe in Threadwise, but Calendar could not update just now. Try syncing again later.`
