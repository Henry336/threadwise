# Private Study Mode

Study mode is the owner's private study tool. It is not part of the product other people use.
It runs inside the same bot, process and database as Threadwise. This document was moved out of the
README on 2026-11-09. The technical design is in [ARCHITECTURE.md](ARCHITECTURE.md), section 15.

Study Mode runs in one separately configured two-member group. It combines deterministic natural-language capture, module-scoped work/notes/questions/images/files, silent note sessions, searchable local OCR, read-only Canvas sync, explainable attention ranking, weekly previews/reviews, complete campus route plans with live NextBus arrivals and walking legs, traffic-light mastery, sessions, mistake reattempts, timed practice, restrained reminders, and a dedicated live Study dashboard without requiring AI.

Study Mode treats the selected module as navigation context, never as implicit permission to file
new content. Text or media without one unambiguous, explicit module is held as a pending capture
until the owner chooses a current module. Canvas synchronization likewise refreshes source metadata
without undoing local archives; newly discovered courses wait for explicit activation.

Study Mode is a private academic operating system inside the existing Threadwise bot. It uses the same PostgreSQL database and reminder loop, but its records live in dedicated, workspace-scoped study tables and are excluded from ordinary Threadwise search.

The authenticated web dashboard exposes Study Mode only while this exact group workspace is selected. Its dedicated navigation is **Overview, Timetable, Work, Deep Work, Modules, Library, Search, Review, and Settings**. Timetable combines recurring module blocks, planned study work, deadlines, and class-travel configuration; saved travel origins remain under Settings. Personal workspaces and every other group keep their existing interface and cannot discover the Study routes. Direct URLs and API calls return the same opaque not-found response unless the signed Telegram principal, configured owner, configured chat, current Telegram membership, and active database binding all agree.

Telegram and the Study dashboard share the same records rather than synchronizing two copies. Captures and Canvas changes appear through server-sent event reconciliation; dashboard edits are immediately visible when the bot next queries the item. Module selection, mastery, work status, notes, pinned images, mistake records, weekly plans, sessions, Canvas review decisions, origins, and schedule blocks all use the same domain services.

From Timetable, the owner may explicitly enable a one-way mirror into their primary Google Calendar.
Threadwise remains authoritative: repeat synchronization patches the same deterministic event, weekly
recurrence and exclusions are preserved, and Google-side edits/deletions are corrected on reconciliation.
The consent screen states the data boundary before OAuth. Only title, module, time/recurrence, venue,
and a Threadwise block reference leave the service; travel origins, coordinates, routes, buffers, and
preparation notes do not. Stopping synchronization leaves existing Google events intact.

Timetable reminders are occurrence sequences, distinct from casual reminders. With the existing master
setting enabled, the first alert is at least 45 minutes early or earlier when the live journey requires
it, followed by no more than three five-minute prompts until acknowledged. `Got it`, `I'm here`, the
matching Study session, or a day mute closes the occurrence. One sequence consumes one daily Study
reminder slot and never backfills after the block starts. See
[`docs/STUDY_TIMETABLE_SYNC_OPERATIONS.md`](STUDY_TIMETABLE_SYNC_OPERATIONS.md) for API, privacy,
failure, migration, and rollback details.

Deep Work is a persistent Study companion rather than a route that hides the rest of the workspace. An active session keeps its timer and controls available while the owner opens Timetable, Work, Modules, Library, or Search. Sessions may record a focus structure, one or more techniques, a custom topic, linked notes/images/files, exact start and end times, and a written outcome. Completed records can be corrected or archived without deleting the underlying evidence. AI-generated study analysis is intentionally outside this phase and is not required for capture, timing, or recall.

Study notes use portable Markdown in the existing canonical resource body. The dashboard supports GitHub-Flavored Markdown, strict Mermaid diagrams, Mermaid-native class/sequence/state UML with searchable syntax help, Tab-indented lists and diagram/code source, `[[wiki links]]`, backlinks, selection-safe encrypted cross-device draft recovery, bounded version history, and `.md` import/export. New Study drafts autosave to an owner/workspace-scoped `StudyNoteDraft` for seven days, use optimistic revisions to reject stale devices, and become ordinary searchable Library resources only after the learner files them with a title and module. Telegram shows a readable text fallback for the same saved note instead of executing formatting or diagram source. Threadwise does not execute imported HTML, scripts, PlantUML, Obsidian plugins, or vault automation. User-facing note and idea tags are retired across modes; historical tag columns remain dormant for backward compatibility rather than being destructively migrated.

It is disabled unless both exact numeric identifiers are configured on Render:

```text
STUDY_OWNER_TELEGRAM_ID=YOUR_NUMERIC_TELEGRAM_USER_ID
STUDY_ALLOWED_CHAT_ID=YOUR_PRIVATE_GROUP_CHAT_ID
CANVAS_ACCESS_TOKEN=YOUR_CANVAS_ACCESS_TOKEN
CANVAS_BASE_URL=https://canvas.nus.edu.sg/api/v1
STUDY_CANVAS_SYNC_INTERVAL_MINUTES=30
STUDY_TRANSIT_BASE_URL=https://improved-nextbus.vercel.app
```

Only the two Study identifiers are required to activate the private surface. Canvas remains unavailable until its token is configured; Threadwise uses that credential only for read operations. The transit integration uses the public Improved NextBus API and needs no key. Never paste the Canvas token into Telegram or commit it to this repository.

If `BOT_ALLOWED_TELEGRAM_IDS` is in use, its existing rules must also allow the owner in that group. Study Mode then applies its stricter independent gate on every command, callback, guided reply, and proactive delivery:

1. The actor must be the configured owner.
2. The chat must be the configured group or supergroup.
3. The database workspace must be actively bound to that exact chat.
4. Telegram must report that the group contains only the owner and Threadwise.

If another account joins, Study Mode unbinds when Telegram delivers the membership update. Every interactive request and reminder also rechecks the member count and fails closed if privacy cannot be verified. Keep Telegram history hidden from new members as an additional precaution because Telegram, not Threadwise, controls visibility of already-sent group messages.

After the schema migration and environment configuration have been deployed, send `/study` in the exact configured group. Threadwise verifies the sealed group, binds it, and opens button-led onboarding. `/study bind` remains an explicit fallback.

Study Mode is natural-language first. Examples include:

```text
todo: finish tutorial for CS2100 Friday 6pm
CS2100 note: cache misses stall the pipeline
question: why is sign extension needed? for CS2100
open CS2102
start note session
what needs attention?
what is coming up this week?
sync my Canvas assignments
add origin Home at Kent Ridge MRT
when should I leave to COM3 from Home?
```

Reply to an existing Telegram text, link, photo, or document with `save this to CS2100`; add `as a task`, `as a note`, or `as a question` when the type is not obvious. If an ordinary message is ambiguous, Threadwise immediately offers Task, Note, Question, and Resource buttons rather than waiting for AI. Selecting a module creates a visible ten-minute capture context. Switching modules restarts the window, while saving content does not extend it; after expiry, Threadwise asks for a module unless the message or reply already identifies one.

Photos enter a durable pending card instead of being OCR-processed automatically. Save the original image, add or edit its caption, optionally extract searchable text, choose another module, or cancel. Repeated or stale callbacks cannot create duplicate resources.

A Study note session stores every message immediately as one durable paragraph and otherwise remains silent. Save note joins the exact paragraphs with blank lines. After roughly 30 minutes of inactivity, a non-empty session auto-saves and an empty session closes. Long notes are paginated at safe paragraph, sentence, or Unicode boundaries for Telegram; the stored body is not truncated.

Canvas is a read-only mirror, not an LMS replacement. Automatic sync runs every `STUDY_CANVAS_SYNC_INTERVAL_MINUTES`; a manual sync is available in onboarding and through `sync Canvas`. Active, overdue, upcoming, and undated unsubmitted assignments are deduplicated. A Canvas submission closes the linked Study item, while local completion never submits. Local title and due-date overrides are preserved, and assignments that disappear are flagged for Keep local or Archive instead of being deleted.

`What needs attention?` uses an explainable local score based on deadline proximity, overdue age, priority, explicit mastery, backlog age, planned effort, week position, and Canvas uncertainty. It does not call an AI service. Weekly review defaults to Saturday at 8:30 PM and the next-week preview to Sunday at 7:00 PM. Urgent deadlines take precedence over housekeeping when the separate Study daily cap is reached.

`/study setup` asks for the semester name, the Monday that begins Week 1, and the IANA timezone. It seeds the current modules, preliminary timetable, and editable weekly study structure. Saved travel origins can be made default, renamed, or removed; a privately shared current location can temporarily override them for four hours and is deleted when it expires or when the owner presses **I'm here**. Threadwise does not continuously track location.

Study routing resolves NUS venues and bus stops through one canonical catalogue shared by Telegram, timetable destinations, reminders, and dashboard autocomplete. It accepts aliases, asks the owner to choose when a name is ambiguous, and plans the complete trip: initial walk, boarding stop, live bus arrivals, service and transfer legs, alighting stop, final walk, total duration, arrival, and leave time. Provider failure produces a clearly labelled conservative fallback rather than invented live data. Natural examples include `Take me to COM3`, `Navigate to VCR Room`, and `How do I get from PGP to COM3?`.

The main commands are:

```text
/study                  master-sheet dashboard
/study help             concise command reference
/study week             current academic week
/study plan             guided weekly planning
/study add              guided study-item creation
/study done STUDY-1     complete an item without changing mastery
/study processed STUDY-1
/study mastery CS2100 amber optional reason
/study start            start a module/item-linked session
/study stop             stop the active session and record a result
/study mistake          guided mistake record
/study mistakes         unresolved and due reattempts
/study review           guided weekly review
/study upcoming         deadlines and open planned work
/study modules          add, edit, or archive modules
/study schedule         inspect or edit schedule blocks
/study export           send six CSV files
/study unbind           explicit inline-confirmed unbinding
```

Slash commands above are compatibility and precision fallbacks; the button interface and natural phrases are the primary interaction. Core behavior is deterministic and does not require `OPENAI_API_KEY`. Mastery changes only when the owner explicitly records it; completing an item never silently declares a topic mastered. Study reminders share the normal database-backed polling loop but use separate daily caps, quiet hours, durable dedupe rows, and conservative rules for reviews, reattempts, red modules, Canvas uncertainty, important deadlines, optional study blocks, and missing timed practice.

`/study export` sends UTF-8 CSV files for the weekly dashboard, items, sessions, module mastery, mistakes, and weekly reviews. In Excel, use **Data → From Text/CSV**, choose UTF-8 if prompted, and load each file as its own worksheet. PostgreSQL remains the source of truth; re-import is not part of the MVP.
