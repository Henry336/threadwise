# Threadwise Product Journal

This is the durable record of Threadwise's product decisions: the friction that was observed, why a change was chosen, what was implemented, and what should be checked next. It complements `CHANGELOG.md`, which remains the release-level inventory.

## Evidence and maintenance

- Entries dated before 22 July 2026 were reconstructed from Git history, the existing changelog, case study, architecture notes, and preserved product discussions. They describe the evidence available now; rationale marked **inferred** was not written contemporaneously.
- Entries from 22 July 2026 onward are contemporaneous unless explicitly labelled otherwise.
- Every meaningful product change should add a short entry with: **friction**, **decision**, **implementation**, **outcome/evidence**, and **follow-up**.
- Never put tokens, passwords, connection strings, private user content, or personally identifying test data in this journal.

## Reconstructed product history

### 5–6 July 2026 — From chat messages to a dependable personal inbox

**Friction discovered (reconstructed):** Telegram is convenient for capture, but ordinary chat loses intentions, reminders, and useful fragments. Raw database-style replies and command memorization also make a capable bot feel technical.

**Decisions:** Make PostgreSQL the durable source of truth; make deterministic natural language the default path; keep AI for synthesis rather than basic operation; make destructive actions reversible; and organize tasks, notes, ideas, search, reminders, and review as one personal inbox.

**Implemented:** Initial grammY/Prisma service, scheduled reminders, timezone-aware settings, quiet hours, deduplicated webhook handling, inbox review, undo, pins, archives, filtered search, note merging, editing, implementation briefs, AI fallback/status, and reminder diagnostics.

**Evidence:** Git history from `98c6573` through `2066b65`.

**Outcome:** Threadwise became useful without requiring a paid AI call for every message. Stable public IDs and recoverable actions established the durability model still used by the bot and dashboard.

### 7–12 July 2026 — Natural language, groups, images, expenses, and first integrations

**Friction discovered (reconstructed):** Users phrase the same intention many ways; Telegram groups need address gating and assignees; long lists need pagination; images are normally hard to retrieve later; receipts and dated work often need to leave chat for Excel or Calendar.

**Decisions:** Expand local parsing before relying on AI; scope group data to the chat; support multiple assignees and private opt-in nudges; keep OCR local; make image captions and OCR text searchable; and treat Calendar/Excel as optional mirrors rather than the source of truth.

**Implemented:** Broad natural-language routing, recurring reminders, multi-assignee group tasks, Telegram privacy guidance, active-list pagination, bulk actions, local English/Burmese OCR, searchable saved images, regional expenses, `.xlsx` export, Google Calendar OAuth, and the first Microsoft Excel workflow.

**Evidence:** Git history from `a6924d6` through `825117d`.

**Outcome:** The bot expanded from a reminder utility into a multimodal life inbox and a shared chat workspace. Searchable image captions became a distinctive value proposition: users can retrieve a visual using words that Telegram itself does not reliably index.

### 14 July 2026 — Reduce Telegram clutter without sacrificing natural language

**Friction discovered (reconstructed):** A large permanent reply keyboard and new message for every button press made mobile chats noisy and pushed the active menu upward whenever reminders arrived.

**Decisions:** Keep one persistent `Menu` entry point; move modes and item actions into concise inline panels; edit the current bot message for navigation and pagination; retain natural language as a first-class path.

**Implemented:** Private menu and image-library workflows, expanded natural commands, in-place callback navigation, and a product-wide voice pass emphasizing short outcome-first copy.

**Evidence:** `1e75d43`, `df70833`, and `20f5d25`.

**Outcome:** Telegram became an interactive surface rather than a stream of duplicated status messages.

### 16–18 July 2026 — A secure web workspace on the same data

**Friction discovered (reconstructed):** Telegram is excellent for quick capture but poor for scanning, editing, comparing, and managing a growing archive. Early dashboard login loops, stale views, small type, inert capture, and sparse desktop layouts damaged trust.

**Decisions:** Build a separate responsive dashboard without exposing database credentials; authenticate with Telegram; keep the bot and web app on the same rows; add live reconciliation and optimistic revision checks; and design for mobile first while using desktop space intentionally.

**Implemented:** Signed dashboard API, Telegram Mini App/OIDC login fixes, universal capture, live change events, task/note/idea/image/expense collections, larger editorial cards, search-as-you-type, image favourites, Idea Briefs, right-click/mobile action sheets, consistent branding, Supabase migration tooling, and connection-pool hardening.

**Evidence:** Bot commits `06ab9e5` through `170eb64`; dashboard commits `e064001` through `fe9b7eb`.

**Outcome:** Telegram and the dashboard became two views of one workspace. The Supabase move from Seoul to Singapore removed roughly one to two seconds from common requests in the observed production setup.

### 19–22 July 2026 — Make group workspaces distinct and trustworthy

**Friction discovered (reconstructed):** The private-chat revamp temporarily broke group help/buttons; a personal-dashboard clone did not use the collaboration-specific value of assignees; group managers and ordinary members required different capabilities; verbose headings and uneven cards obscured the actual work.

**Decisions:** Treat a group as its own workspace, not a larger personal account. Keep expenses and personal integrations private. Revalidate current Telegram membership and owner/admin status for privileged actions. Focus the group UI on Overview, Work, People, Progress, Activity, and Resources.

**Implemented:** Secure group workspace selection, live membership checks, assignee acknowledgements and handoffs, workload without ranking, progress/activity/resource views, concise group copy, role-aware actions, and explicit group/private integration boundaries.

**Evidence:** Bot commits `661c78d` through `7be7149`; dashboard commits `89a817b` through `3dd24f0`.

**Outcome:** Group mode now has a collaboration purpose of its own while personal mode remains a private life inbox.

## Contemporary decisions

### 22 July 2026 — Calendar and Excel integration lifecycle revamp

**Friction discovered:**

- OAuth success looked like feature completion, so it was reasonable to expect dated reminders to appear in Google Calendar immediately. In reality, connection only granted permission.
- Commands such as `/calendar TASK-77`, `/excel create`, and `/excel sync` exposed implementation steps instead of the user's goal.
- Task cards had actions for editing and completion but no contextual Calendar action.
- The dashboard's Connections area told people to return to Telegram, even though the dashboard is the natural place to manage connected services.
- Excel required a connect → create workbook → import/sync sequence that was easy to miss.
- Gmail was advertised despite not being part of the intended product direction, adding setup and maintenance surface without enough value.

**Decision:** Treat each provider as a complete lifecycle—connect, initialize, use, keep in sync, open, recover, and disconnect—available from both Telegram and the personal dashboard. Keep Threadwise as the source of truth and external providers as user-controlled mirrors. Retire Gmail from the active product. Preserve legacy Gmail database tables temporarily so retirement is non-destructive; a later audited migration may remove them.

**Implemented:**

- Calendar and Excel now have concise button-first Telegram panels. Slash subcommands remain compatibility fallbacks, not the primary instructions.
- Dated private task cards expose Calendar actions. A disconnected user can connect from that exact task; the OAuth state preserves the task intent and syncs it after return.
- Calendar can add/update one durable event per task, remove it, open it, backfill eligible dated tasks, and enable automatic sync. Task title/detail/date/recurrence changes patch the same event. Canceling a linked task asks whether the event should also be removed.
- Excel connection creates a recommended workbook and imports existing expenses. Users can open, sync, recreate/select, enable automatic sync, or disconnect. New expenses can mirror automatically.
- Natural language covers goals such as “put this reminder on my calendar”, “automatically sync my dated tasks”, “remove this from my calendar”, “connect Excel”, “open my expense workbook”, and “sync my expenses”.
- The personal dashboard now manages both providers directly, shows connected identity and sync coverage, exposes auto-sync controls, and returns from OAuth to Connections with a clear result.
- Personal integrations remain unavailable in group workspaces.
- Gmail commands, routes, scans, provider code, status, menus, environment variables, and user-facing documentation were removed. Legacy schema objects remain inert for safe staged cleanup.

**Reliability choices:** A Calendar or Microsoft outage never rolls back or deletes the Threadwise task/expense. Provider failures return concise recovery guidance. OAuth state is short-lived, single-user, encrypted-token storage remains server-side, and dashboard actions are still scoped from the signed Telegram identity.

**Expected outcome:** Connecting a service now leads directly to a useful initialized state; routine use is contextual or automatic; and users no longer need to understand provider-specific command sequences.

**Verification evidence before release:** Prisma schema validation passed; bot typecheck and production build passed; all 517 bot tests passed with one worker; dashboard lint and production build passed; all six dashboard contract tests passed with one worker. Regression coverage includes recurrence payloads, private-only contextual Calendar buttons, dashboard provider snapshots, selected-task OAuth authorization, disconnect settings, and live revision behavior.

**Production checks after deployment:** confirm migration application and production health version/commit, then exercise Calendar selected-task OAuth, Calendar auto-sync/edit/remove, Excel workbook bootstrap/import/open/auto-sync, and the Connections layout on mobile and desktop. These checks require the live provider accounts and are intentionally not represented as locally verified.

**Follow-up:** Observe real OAuth failure rates and sync latency before adding more providers. If Gmail tables are later removed, first confirm no production runtime references or retained user data requirement remains, then ship a separate reviewed migration and retention note.

## Journal entry template

```markdown
### YYYY-MM-DD — Decision title

**Friction discovered:** What the user experienced; include context, not private data.

**Decision:** What was chosen and which alternatives were rejected.

**Implemented:** Product and technical changes.

**Outcome/evidence:** Tests, measurements, observations, and relevant commits.

**Follow-up:** What still needs production observation or a later decision.
```
