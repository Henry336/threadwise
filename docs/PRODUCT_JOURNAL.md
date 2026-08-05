# Threadwise Product Journal

Updated: 2026-08-05

This is the durable record of Threadwise's product decisions: the friction that was observed, why a change was chosen, what was implemented, and what should be checked next. It complements `CHANGELOG.md`, which remains the release-level inventory.

## Evidence and maintenance

- Entries dated before 22 July 2026 were reconstructed from Git history, the existing changelog, case study, architecture notes, and preserved product discussions. They describe the evidence available now; rationale marked **inferred** was not written contemporaneously.
- Entries from 22 July 2026 onward are contemporaneous unless explicitly labelled otherwise.
- Every meaningful product change should add a short entry with: **friction**, **decision**, **implementation**, **outcome/evidence**, and **follow-up**.
- Never put tokens, passwords, connection strings, private user content, or personally identifying test data in this journal.

## 5 August 2026 — A route query is not yet a commute workflow

**Friction discovered:** Study Mode could answer an explicit “How do I get to COM3?” request, and schedule blocks already contained dormant venue, stop, origin, buffer, and `CLASS_DEPARTURE` fields. But Travel was absent from Study home, class blocks could not configure those fields through the interfaces, and proactive reminders remained generic. The owner therefore had no dependable place to check upcoming routes and would not be told which bus to take before class.

**Decision:** Treat travel as a focused Study coordination aid rather than a separate transit product. Configure it on recurring class blocks, refresh live data only near departure, keep all calculation deterministic, and always retain a normal travel estimate when the external live provider is unavailable.

**Implementation:** Added a Travel home with current origin, upcoming destinations, saved origins, and live refresh; Telegram and dashboard block-level destination/origin/buffer controls; three-minute route caching; leave-by calculation; compact departure cards with Refresh, Change origin, I’m here, and Mute today; and an end-of-day mute. Live-route failure falls back to a 30-minute normal journey plus the configured buffer instead of dropping the reminder.

**Outcome/evidence:** Focused tests verify live-duration arithmetic, fallback timing, mute expiry, schedule creation with travel, and disabling travel without deleting the timetable block. Existing deterministic natural-language route queries remain available. Dashboard TypeScript and lint checks pass; targeted backend tests pass. Local full builds remain blocked by Windows locks held by already-running development processes, so clean CI/deployment builds must provide the final generated-client and production-bundle verification.

**Follow-up:** After deployment, configure one real class destination, verify a live route in Telegram and the dashboard, test Change origin, and observe one genuine pre-class reminder. Compare the suggested leave time with Improved NextBus and adjust the per-class buffer if needed.

## 5 August 2026 — A private dashboard still needs a visible front door

**Friction discovered:** The private Study dashboard was deployed and correctly isolated, but neither Telegram Study-home variant linked to it. The word `dashboard` was also classified as a request for the Telegram master sheet, so the owner could know the web workspace existed and still have no discoverable way to open it.

**Decision:** Treat the Telegram Study menu as the primary launch point. Keep the compact Telegram master sheet, label the web destination separately, and use the existing authenticated workspace-selection route rather than exposing a generic dashboard URL.

**Implementation:** Added `Study dashboard` URL actions to the command-led and natural-language Study menus and to the Telegram master sheet. Added a deterministic dashboard intent so `dashboard`, `study dashboard`, and `open study dashboard` return the same direct link. The selector targets the bound Study workspace, while existing dashboard authorization continues to enforce the configured owner, chat, and active binding.

**Outcome/evidence:** Parser coverage verifies the new intent. The link is generated from the workspace ID and enters through the same authenticated selection endpoint already used by shared dashboards; it does not embed credentials or bypass Study authorization.

**Follow-up:** Live-test the button inside the sealed group, confirm it selects the Study workspace on mobile Telegram, and confirm another Telegram account receives no Study access.

## 5 August 2026 — Deep work needed a first-class view, not a second source of truth

**Friction discovered:** Phase 1 made academic capture reliable inside Telegram, but concentrated study sessions still required reading compact chat cards, hopping between module fragments, and mentally combining Canvas work, notes, screenshots, mistakes, mastery, and weekly priorities. Reusing the personal or shared-group dashboard would expose irrelevant navigation and make Study Mode feel like a bolted-on theme. A client-only hidden menu would also be inadequate because direct URLs and forged API requests could still reveal the private surface.

**Decision:** Build a third, module-first dashboard architecture backed by the same Study records as Telegram. Reveal it only for the exact configured owner and exact actively bound Study group; repeat that authorization on every server request and return an opaque not-found response for every mismatch. Keep the dashboard deterministic and use AI for none of its core retrieval, ranking, editing, or synchronization paths.

**Implementation:** Added sealed Study workspace discovery and API services; dedicated Overview, Module Shelf, Work, Library, Review, Search, Deep Work, and Settings views; module/work/resource CRUD; protected image/file delivery; OCR-backed live search; mastery and mistake controls; weekly planning/review; session timers; read-only Canvas sync and missing-assignment decisions; origins and schedule blocks; active-module synchronization; and server-sent event reconciliation. The interface has independent desktop/mobile composition, dark-mode parity, keyboard focus, minimum touch targets, reduced motion, explicit sync state, and the approved Ari loader.

**Outcome/evidence:** Focused tests verify exact owner/chat/binding access, non-owner workspace discovery, personal and ordinary-group isolation, inactive bindings, direct Study URL denial, and proxy method/path allowlists. The completed local gate passed 81 backend test files and 700 tests, Prisma validation, TypeScript checking and clean-directory emit; the dashboard passed all 29 tests, lint, standalone TypeScript checking, and an isolated production build. An Impeccable static scan is clean. Real-browser checks covered the desktop Overview, compact Work layout, long Settings form, Ari loading state, and light/dark parity; they exposed a narrow-layout constraint that was corrected before handoff. The final contract pass also caught and fixed new-module colour rejection, blank optional work fields being serialized as invalid nulls, an incorrect All-status filter, forms clearing after failed mutations, and mastery-signal changes erasing the existing rationale. PostgreSQL remains the sole source of truth, and no browser receives database, Telegram, Canvas, or provider credentials.

**Follow-up:** Before deployment, live-test the configured owner/group with one Telegram capture, Canvas sync, dashboard edit, protected image/file, focus session, workspace switch away and back, and reverse Telegram lookup. After deployment, repeat direct-URL denial with a non-owner account and monitor the first real weekly preview/review cycle.

## 4 August 2026 — Private academic control without a second productivity product

**Friction discovered:** Ordinary tasks could record coursework but could not represent academic weeks, processed material, explicit mastery, planned-versus-actual study time, mistake reattempts, or timed cumulative practice. Important module notes and screenshots became scattered across Telegram, while a spreadsheet-first or second-bot workflow would split capture from the place already being used. The original external discussion also assumed AI was central even though predictable academic operations need speed and auditability more than synthesis.

**Decision:** Add Study Mode as a dedicated deterministic domain inside the existing Threadwise bot, PostgreSQL database, and reminder loop. Restrict it to one configured owner and one configured two-member group, route every owner message in that sealed group to Study Mode, keep every query workspace-scoped, and exclude the records from ordinary search and the dashboard until a separately authorized Study interface is built. Completing local work must never submit to Canvas or silently claim mastery.

**Implementation:** Added academic workspace/module/week/item/session/mistake/review/schedule models; a compact master sheet; button-led onboarding; broad natural-language capture and navigation; explicit traffic-light mastery; planned and actual time; mistake reattempts; timed-practice checks; weekly planning/review; and six CSV exports. The first bare `/study` binds only after exact actor/chat and two-member verification. All later interactions repeat those checks, membership changes unbind the workspace, and proactive output fails closed.

**Outcome/evidence:** Authorization, binding, workspace scoping, lifecycle, review, mistake, week-boundary, attention, reminder, and export tests exercise the deterministic foundation. The complete backend gate passed 80 test files and 690 tests, Prisma schema validation, TypeScript typechecking, and a production TypeScript emit. The feature remains disabled unless both exact Study environment values are configured, so no ordinary user or group receives a partial surface.

**Follow-up:** After an approved migration and deployment, configure the exact owner/group values, run first-use onboarding, and verify the complete Telegram path before beginning the separate private dashboard phase.

### Canvas drift without turning Threadwise into an LMS client

**Friction discovered:** Manually copying assignments makes the Study list stale, but treating Threadwise as a Canvas replacement would create a dangerous second source of truth. Assignment titles and due dates may be deliberately corrected locally, submitted work should close automatically, and an assignment that disappears from an API response must not be silently deleted.

**Decision:** Mirror only active-course assignment state through a read-only Canvas token every 30 minutes by default. Preserve explicit local title and date overrides, let Canvas submissions close the linked local item, never submit from Threadwise, and flag disappeared assignments for a Keep local or Archive decision.

**Implementation:** Added paginated Canvas fetching, a single-flight sync guard, bounded retry/backoff for transient errors, stable course/assignment mappings, submitted-state rules, deduplication, local override flags, sync health, missing-item review controls, and a configurable cadence. Previously submitted history is not imported merely to inflate the work list.

**Outcome/evidence:** Pure tests cover module mapping, submission classification, priority thresholds, and pagination links. Runtime errors retain bounded status rather than exposing tokens or silently losing tracked work.

**Follow-up:** Add `CANVAS_ACCESS_TOKEN` only as a Render secret, run a manual sync after deployment, compare active assignments against Canvas, then observe at least one real submission and one changed/deleted assignment before considering the integration validated.

### Fast prioritisation without an AI dependency

**Friction discovered:** A raw deadline list does not answer “what needs attention?”, but sending every request to an AI service adds latency, cost, and non-repeatable results. Old low-priority reminders could also consume a daily cap before urgent deadlines.

**Decision:** Score attention deterministically from due proximity, overdue age, explicit priority, module and item mastery, backlog age, planned effort, week position, and Canvas uncertainty. Prioritise proactive candidates by product urgency before scheduled age.

**Implementation:** Added a documented attention scorer, recommended next actions, Saturday 8:30 PM reviews, Sunday 7:00 PM previews, restart-safe delivery claims, quiet hours, a separate daily cap, and reminder-kind priority ordering.

**Outcome/evidence:** Tests show overdue/high-priority work in a red module outranks ordinary undated work and that deadline candidates precede housekeeping under the cap. The same inputs always produce the same explanation and score.

**Follow-up:** Compare the top three recommendations with real weekly decisions and tune weights only from observed false positives/negatives, not from a desire to make the score look sophisticated.

### Module knowledge was easy to capture but hard to retrieve

**Friction discovered:** A useful CS2100 note, screenshot, link, or question could be sent quickly but later disappear into generic history. Long Telegram notes exceeded presentation limits, and ordinary acknowledgements doubled chat growth during active note-taking.

**Decision:** Treat each module as a scoped capture and recall context. Support reply capture, searchable local OCR, silent durable note sessions, immediate ambiguity choices, and full-detail pagination without changing stored text.

**Implementation:** Added module resources for notes, questions, links, images, and files; an active-module hub; `save this to CS2100` reply handling; Task/Note/Question/Resource fallbacks; local image OCR; pinned/searchable resources; 30-minute durable note drafts; exact paragraph joining; and page sizing after HTML escaping with Unicode-safe boundaries.

**Outcome/evidence:** Parser, reply-language, title, long escaped text, emoji, and durable note-session tests pass. Resource records are isolated by Study workspace and module, and saved bodies remain complete even when Telegram needs several pages.

**Follow-up:** Live-test reply capture across text, URL, photo, and document messages and verify OCR results on real lecture screenshots before tuning search ranking.

### Travel uncertainty around a campus timetable

**Friction discovered:** Knowing a class start time is insufficient when the owner may leave from home, a temporary campus location, or another saved origin. Re-entering origins is tedious, but copying another app’s full transport feature set would broaden Study Mode unnecessarily.

**Decision:** Keep travel secondary and bounded: saved/default origins, temporary overrides, and a journey estimate through the existing public Improved NextBus service.

**Implementation:** Added natural-language add/use/rename/remove origin commands, location-message support, temporary active origins, and route estimates. The implementation was checked against the live project’s `/api/venues`, `/api/stops`, and `/api/directions` response contracts.

**Outcome/evidence:** Generic sentences beginning with “use” no longer get mistaken for origin changes, while explicit phrases such as `use origin Home for 3 hours` remain deterministic.

**Follow-up:** Measure live campus route accuracy and failure behavior after deployment; retain a clear “estimate unavailable” response rather than fabricating a departure time.

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

### 3 August 2026 — Quieter follow-ups for undated group work

**Friction discovered:** Group tasks without deadlines inherited the personal three-hour repeat cadence and each task produced its own reminder card. A few open tasks could therefore multiply into a noisy stream, while an ignored task continued at the same frequency forever. The reminder count was task-oriented even when several tasks could share one Telegram message, so a future digest would also consume the daily safety limit inaccurately.

**Decision:** Make undated group follow-ups a workspace-level coordination rhythm rather than a personal alarm. Use six hours by default, retain admin configuration through the existing group reminder settings, combine related work into one public follow-up, and slow an ignored task to daily only after three unanswered rounds. Any meaningful interaction restarts the configured cadence. Dated tasks and personal reminders keep their existing policies.

**Implemented:** New groups use a six-hour reminder interval, and the migration moves group settings that still match the previous three-hour default. The reminder pass batches up to eight simultaneously eligible undated tasks per group message, counts that Telegram message once against the safety limit, preserves per-task delivery history, and continues optional assignee DMs. `Task.undatedNudgeCount` tracks the unanswered streak independently from lifetime reminder totals. Edits, assignment responses, handoffs, snoozes, pins, due-date changes, restores, and settings changes reset the streak. Quiet hours defer the whole batch; after the third delivery, each untouched task moves to at least a 24-hour cadence.

**Expected product effect:** Group reminders should remain useful without becoming another source of chat clutter. A task that is actively being discussed returns to the group's chosen rhythm, while abandoned work becomes a daily review item instead of interrupting the group every few hours.

**Follow-up:** Measure group follow-up opens, completion or reschedule actions after a nudge, batch size, and the share of tasks that reach daily slowdown. Reconsider the six-hour default only from real group behavior; do not increase frequency merely to create engagement.

### 3 August 2026 — Strict group activation and batch TODO capture

**Friction discovered:** A group member wanted Threadwise to recognize the conventional `TODO` marker and turn several action items into tasks naturally. The existing one-request-at-a-time flow made allocation repetitive, but loosening the entire group router would make ordinary multi-person conversation dangerous: a product-name reference or unrelated bot mention could accidentally trigger capture. Public menus also become chaotic when several members navigate at once, and immediate batch creation would give users no safe place to correct wrapped text, an ambiguous owner, or a misread date.

**Decision:** Treat `TODO:` and `ACTION ITEMS:` as explicit, narrow group syntax rather than general conversational intelligence. Keep every other non-command activation strict: exact deployed-bot mention, reply to Threadwise, or receiver-bound ephemeral reply. Parse the complete list locally and require one review before committing it. Give control to the original sender and currently verified group owners/admins; everyone else may inspect but not change it. Keep the feature inside the existing Coordinate pillar instead of adding a generic project-import product.

**Implemented:**

- The deterministic parser accepts bullets, numbered items, wrapped lines, checked/done markers, due phrases, Telegram usernames, known member display names, and plain-language team-owner labels. It caps each import at 25 rows and reports ambiguity beside the affected row.
- `PendingTaskImport` and `PendingTaskImportItem` preserve the review across restarts. Each row records inclusion, parsed metadata, status, failure detail, and its created task id.
- Telegram posts one compact review card with Review, Import/Retry, Cancel, and Work actions. Import and cancel callbacks are actor-gated. A successful import uses the normal self-cleaning acknowledgement instead of doubling group-chat noise.
- The group dashboard opens the exact review from Telegram, supports inline row correction on desktop and mobile, keeps the primary import action visible, and refreshes shared Work after completion. Imported team-owner labels remain visible beside normal task assignees.
- Import claims and row statuses make retries idempotent: the created task is linked to its source row inside the same transaction, an already imported row is never created again, and a process-interrupted claim becomes retryable after a bounded lease.
- Forum groups may optionally create one admin-controlled Threadwise topic to concentrate bot interaction. The topic does not change workspace scope or make existing group usage dependent on Telegram forums.

**Outcome/evidence:** Focused routing and parser suites cover strict non-activation, both import headings, list structure, dates, statuses, owners, assignees, sender/admin control, and abandoned-claim recovery. The complete release gate passed all 587 backend tests, backend typechecking and production build, all 12 dashboard contract tests, dashboard lint, and the dashboard production build.

**Privacy-mode caveat:** Telegram may withhold an unmentioned `TODO:` block while BotFather privacy is enabled. Threadwise cannot override delivery that never reaches its webhook, so exact mention/reply remains the documented reliable fallback.

**Follow-up:** Observe real group imports for false activations, correction frequency, average rows per import, retry rate, and whether the optional topic improves discoverability. Do not expand activation keywords until usage proves that another phrase is both common and sufficiently unambiguous.

#### Phase 1 hardening audit — 3 August 2026

**Friction discovered:** A post-implementation audit found that reviewed assignees were being converted into fake Telegram mentions at character zero. That reused a chat-text heuristic in a structured dashboard path, so a valid title containing words such as “for” could be shortened incorrectly. The parser also treated nearly every short final parenthetical as an owner, warnings did not clear after a reviewer fixed a row, skipped rows could silently return to Ready after an unrelated edit, and a copied callback identifier was not independently checked against the current Telegram group. Long imports refreshed no lease while processing, leaving a recovery race, and the dashboard continued to present terminal imports as editable.

**Decision:** Keep natural-text inference only at the capture boundary. Once a reviewer supplies structured fields, pass them directly to task creation. Prefer an unresolved warning over guessing ownership; only explicit owner syntax, Telegram usernames, unambiguous active-member names, or recognizable team labels may consume a final parenthetical. Treat the import row id as the durable idempotency key, refresh the import lease while processing, and enforce both actor and group scope on Telegram callbacks. Terminal review states must be visibly terminal.

**Implemented:**

- Added an explicit assignee path to task creation and removed synthetic mention offsets from batch import.
- Added unambiguous active-member alias resolution, conservative team-label detection, duplicate-first-name protection, and support for plain `[ ]`, `[x]`, `☐`, `☑`, and `✅` checklist rows.
- Centralized warning derivation so assignee, team-owner, and completion corrections immediately update the review; unrelated edits now preserve a skipped row.
- Added a unique task-side source-row key, per-row import heartbeat, and recovery lookup before and after task creation.
- Bound Telegram callbacks to the originating workspace chat, made preview-message id persistence non-fatal after successful delivery, and guarded optional topic creation against common double taps.
- Updated the dashboard review with explicit terminal states, manual refresh, removable unmatched assignees, URL-correct post-import navigation, keyboard focus parity for selects, and 44 px mobile targets.
- A second error audit kept same-name members distinct when they have different Telegram identities, accepted the variation-selector form of emoji checkboxes copied from Telegram, made the SQL warnings column match Prisma's non-null contract, and stabilized the dashboard grid regardless of how many notices are visible. It also limited review counts to selected rows, removed duplicated terminal copy, and restored a visible title-field keyboard focus ring.

**Expected product effect:** The feature remains a focused bridge from a conventional group `TODO:` block into existing shared Work. The hardening removes hidden interpretation and concurrency risks without adding another workflow or expanding Threadwise into a general project-import tool.

**Verification evidence:** All 595 backend tests passed with one worker, including the new structured-assignee, conservative-owner, duplicate-name, stable-identity, checklist-encoding, warning, and chat-scope regressions. Backend typechecking, Prisma validation, and the production build passed. The coordinated dashboard passed all 12 contract tests, lint, and its production build.

**Follow-up:** Measure which rows users correct, not merely how often they import. A high rate of owner correction should lead to narrower parsing rules, not more AI inference. Keep terminal-state refresh manual while edits are local so live reconciliation never overwrites an unfinished correction.

### 23 July 2026 — Find a time without leaving the group

**Friction discovered:** Agreeing on a meeting time inside Telegram fragments one decision across many replies. Members miss earlier messages, the organiser manually compares answers, and an external polling link loses the group context. Ordinary inline buttons are suitable for a few actions but not a two-dimensional availability grid. A new bot message for every response would recreate the chat-clutter problem Threadwise already reduced elsewhere.

**Decision:** Add **Find a time** as a focused Coordinate capability, not a calendar replacement. Keep one compact status card in the Telegram group and move the touch-heavy grid into the shared Mini App/dashboard. Let every active member submit only their own availability; reserve creation, nudging, finalization, and closure for freshly verified Telegram owners/admins. Show aggregate overlaps and response progress without revealing another member's raw selected cells. Calendar remains an optional per-person destination after a time is finalized.

**Implemented:**

- `/findtime`, `/schedule`, the group menu, and focused natural-language requests create or open availability polls.
- Polls support a bounded date range, meeting duration, organiser time zone, daily window, 30-minute availability cells, response count, pending members, ranked contiguous overlaps, and one finalized time.
- Telegram posts one compact card and edits it as the shared state changes. Buttons open the correct group workspace and poll through a signed Telegram Mini App start parameter.
- The dashboard adds a responsive Find a time view, touch-safe availability grid, organiser controls, active-poll overview card, and confirmed meetings in Group Work.
- The service handles duplicate saves, stale revision conflicts, closed polls, removed members, concurrent finalization, reminder cooldowns, and recoverable Telegram reminder delivery.
- Finalized meetings can be added to each participant's own Google Calendar. OAuth tokens and event URLs remain personal; shared cards never expose them.

**Outcome/evidence:** Pure service tests cover slot generation, same-local-day contiguous-duration overlap ranking, parsing, intent boundaries, and input limits. Bot tests protect compact-card behavior, direct-link fallback routing, and Calendar-link privacy. Dashboard contract tests reject malformed windows and preserve only the viewer's raw response. Mini App redirect tests prove that valid start parameters select the intended opaque group workspace and poll while invalid parameters fall back safely. The release gate passed all 528 backend tests in one worker, backend typechecking and production build, all 10 dashboard tests, dashboard lint and TypeScript checks, and the dashboard production build. Desktop and 500 px mobile browser checks covered the complete scheduling layout; the mobile pass caught and corrected a clipped create action before release.

**Scope intentionally excluded:** appointment-booking pages, video calls, rooms/resources, recurring polls, a full calendar replacement, and automatic reading of participants' calendars.

**Follow-up:** Validate with real study, project, club, and friend groups. Measure invited-member response rate, time to finalization, whether the organiser confirms a slot, and repeat use before expanding the feature or monetizing advanced scheduling controls.

### 22 July 2026 — Focus, quiet capture, and the Ari identity

**Friction discovered:**

- Threadwise had accumulated capable but equally prominent features. Expenses and Excel weakened the product story because they did not reinforce the strongest Telegram-native behavior as clearly as capture, coordination, and recall.
- A user described note capture as something that should feel closer to a terminal: after every saved message, a second full response pushed the actual notes upward and made Threadwise feel like a chatbot commenting on the work.
- Removing all confirmation would be unsafe for interpreted inputs. Dates, recurrence, time zones, and group assignees still need to be visible long enough for someone to catch a parsing mistake.
- The previous dark circular compass avatar felt detached from the light dashboard and did not provide a flexible, memorable identity across serious product surfaces and warmer human moments.

**Decision:**

- Define Threadwise through three pillars: **Capture, Coordinate, Recall**.
- Use one positioning sentence everywhere: “Threadwise turns Telegram messages into things people can find, remember, and finish.”
- Make Tasks, Notes, searchable Images, Search, and group coordination the core. Keep Ideas, Calendar, the dashboard, and future Intelligence core-adjacent.
- Freeze Expenses and Excel: remove them from active user-facing navigation and discovery without deleting code, schema, or user data.
- Make routine successful capture quiet. Show a compact acknowledgement, preserve important interpretations, then remove only that acknowledgement after roughly three seconds.
- Use a two-part identity: a faceless threaded-path product mark for navigation and system chrome, plus Ari—a related friendly thread character—for onboarding, empty states, and recoverable failures.

**Implemented:**

- Private and group menus, help topics, settings, image choices, public product copy, dashboard navigation, command palette, search results, Today, and provider management now follow the focused hierarchy.
- Legacy expense and Excel services, routes, schema, and data remain intact but no active interface advertises or links to them.
- Task, note, and idea creation paths across commands, natural language, callback capture, and OCR now use one self-cleaning acknowledgement helper. Callback saves edit and retire the current capture card instead of creating another message.
- Task acknowledgements show only the interpreted due time, recurrence, and assignee fields when present. Error messages, warnings, details, menus, and action keyboards still use persistent reply/edit helpers.
- The dashboard now ships an adaptive faceless mark, Ari light and dark avatars, a full Ari illustration, an app favicon, and a 512×512 Telegram avatar derived from deterministic SVG source.

**Outcome/evidence:** Direct timer/callback tests cover message cleanup; formatter assertions protect parsed dates, recurrence, time zones, and assignees; and navigation/copy assertions prevent frozen features from resurfacing. The final release gate passed all 520 backend tests in one worker, backend typechecking and production build, dashboard lint, all six dashboard contract tests, and the dashboard production build. Chromium checks covered the landing page, authenticated Today and Settings views, and 390 px mobile layout with no application console errors.

**Follow-up:** Validate whether capture feels quiet enough in real private and group chats. If 3.5 seconds is too short for date checking, adjust the single acknowledgement TTL rather than reintroducing full cards. Build **Find a time** separately as the next focused Coordinate capability; monetization and Threadwise Intelligence remain later phases.

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

### 23 July 2026 — Quiet writing, complete notes, and private group interaction

**Friction discovered:**

- A long-form note is not naturally one Telegram message. Saving every paragraph separately forces the writer to reassemble it later, while acknowledging every paragraph doubles chat volume and makes a capture tool feel as if it is talking over the person using it.
- A temporary session held only in process memory would lose text during a deploy or restart. A persistent inline Save card would also move upward as ordinary chat continued, making it easy to forget.
- The stored note body could be complete while the Telegram detail view truncated it. Near Telegram's message limit, headings and controls made the presentation exceed the limit even when the user's original message fit.
- Ambiguous text waited for AI classification and a low-confidence private branch deliberately returned without a reply. The visible result was either latency or silence at exactly the moment a user needed a fast choice.
- Group prompts said “Send your answer as the next message,” although privacy-mode groups only reliably route mentions and replies to the bot. Shared inline menus also let several people overwrite the same interface, making simultaneous use chaotic.
- Generic loading feedback missed an opportunity to make Ari useful as a product character. The approved four-frame untangling sequence already communicates Threadwise's purpose more clearly than a standard spinner.

**Decision:**

- Treat multi-message writing as a private, temporary **Note session**, not a permanent global mode.
- Store each paragraph before producing no response. Keep Save note and Cancel as a persistent reply keyboard; auto-save non-empty sessions after 30 minutes of inactivity; retain slash fallbacks.
- Preserve full note bodies in storage and paginate only the Telegram presentation. Edit one detail card in place and split at natural boundaries.
- Keep AI off the ambiguity response-critical path. Deterministic intent remains first; otherwise show immediate Task, Note, Idea, and Ignore choices.
- Keep one public group anchor and public shared-work results, but make each member's nested interface receiver-bound and ephemeral. Word prompts as explicit replies. Never fall back from a failed private journey to editing the shared card.
- Use the supplied Ari frame sheet exactly as the dashboard loading sequence and show its completed frame when reduced motion is requested.

**Implemented:**

- Added `NoteCaptureSession` and `NoteCaptureSegment` rows with cascading ownership, message-id idempotency, rolling expiry, exact paragraph text, and a restart-safe expiry loop.
- Added Notes → Note session, `/note_session`, `/save_note`, and `/cancel_note`; start/save/cancel/auto-save acknowledgements remove themselves after a short visibility window.
- Added HTML-budgeted, grapheme-safe note pagination for active and archived notes with in-place previous/page/next controls.
- Replaced awaited ambiguity classification with immediate actor-scoped pending captures. A second group member cannot consume or ignore the first person's pending choice.
- Added Telegram Bot API receiver/callback-scoped ephemeral send, edit, ForceReply, ownership validation, deletion, and incoming-reply routing. Errors prefer a private direct-message recovery and never expose the failed private action to the group.
- Added the exact 2,172×724 Ari artwork as four native 543×724 frames, stepped through in the dashboard loading route without regenerating the art.

**Outcome/evidence:** Focused regression coverage exercises durable paragraph writes, exact combined bodies, Unicode-safe title and page boundaries, archived pagination controls, actor ownership, receiver validation, private failure handling, incoming ephemeral routing, and the source dimensions/frame positions of the Ari loader. The release gate passed all 547 backend tests in one worker, backend typechecking, the production build, Prisma schema validation, all 12 dashboard tests, dashboard lint, and the dashboard production build. A mobile Chromium visual check confirmed the approved 3:4 crop and a later untangling frame without distortion.

**Follow-up:** Observe Telegram's best-effort ephemeral delivery in real groups, especially members who are offline or using older clients. Track abandoned Note sessions and auto-save frequency to decide whether 30 minutes is the right timeout. Verify whether the 3.5-second acknowledgement window is long enough to inspect parsed dates without making capture noisy.

### 26 July 2026 — Make the repository teach the product that actually exists

**Friction discovered:** The owner wanted to learn Threadwise by reading its repository, but the case study still described the early personal bot, advertised retired Gmail and frozen Expenses/Excel, omitted the synchronized dashboards and group scheduling, and claimed that a full dashboard did not exist. The handoff called v0.25.0 current while the package was v0.26.0, the validation baseline was from v0.17.1, the deployment instructions duplicated migration work now handled by Render pre-deploy, and the migration guide still read as a future task after the successful Singapore cutover.

**Decision:** Treat documentation as an executable product surface with clear ownership: README for current behavior and learning order, CASE_STUDY for the product narrative and honest limitations, ARCHITECTURE for technical invariants, PRODUCT_JOURNAL for rationale, CHANGELOG for release inventory, PROJECT_CONTEXT for handoff state, VOICE_AND_TONE for copy rules, and the migration document as a completed operational record. Preserve historical release entries rather than rewriting history.

**Implemented:** Reconciled all repository-owned Markdown documents with package v0.26.0, the Prisma schema, current routes/commands, recent feature commits, and the 547-test suite. Added a code-reading path, current module map, dashboard authentication/scope flow, Note-session and ephemeral-delivery architecture, accurate privacy language, current deployment variables, completed Singapore migration status, current limitations, and the Ari/group-reply copy rules.

**Outcome/evidence:** The documentation now distinguishes implemented behavior, frozen/inert code, and future work; records that Threadwise is application-isolated but not end-to-end encrypted; and removes already-shipped dashboard/privacy features from the roadmap. Validation for the documentation refresh uses the same v0.26.0 baseline: 58 test files and 547 tests, followed by typecheck, production build, link/reference checks, and diff whitespace checks.

**Follow-up:** Update the relevant documents in the same commit as every future product release. Add a lightweight documentation consistency check if package versions, route lists, or validation counts become stale repeatedly.

### 3 August 2026 — Treat one Telegram identity as one assignee

**Friction discovered:** A group TODO containing `@username` could discover the same person through both the visible text and Telegram's structured mention entity. When the text pass knew only the username but the entity pass also knew the Telegram ID, the two representations used different deduplication keys and appeared twice in the review. An incomplete closing parenthesis did not prevent the duplicate.

**Decision:** Deduplicate on overlapping stable identity rather than on one preferred key. Telegram ID remains strongest, username provides a safe bridge when one discovery has not resolved the ID yet, and display-name matching is used only when neither record has a stable identity so distinct members with the same name remain distinct.

**Implemented:** Task-import assignee collection now merges matching discoveries and enriches the retained record with the Telegram ID, username, and human display name. Added regression coverage for both complete and incomplete parenthetical `@username` forms.

**Outcome/evidence:** The exact reported two-row import now produces one structured assignee per row. The focused 20-test task-import/assignee suite and TypeScript typecheck pass after regenerating the production Prisma client.

**Follow-up:** Confirm the corrected preview against a real Telegram group after deployment and watch for historical reviews that were created before the fix; existing pending rows are not rewritten automatically.

### 4 August 2026 — Keep complete TODO inspection inside Telegram

**Friction discovered:** The group TODO preview displayed only the first seven parsed rows followed by `+N more`. A user could import the entire batch but could not inspect every row without opening the dashboard, making an optional rich editor feel mandatory and weakening confidence immediately before a multi-task write.

**Decision:** Separate compactness from completeness. Keep the shared Telegram card small by paging six tasks at a time and editing that same message. Retain the dashboard only for rich field corrections; do not require it for reading or approving a correctly parsed list.

**Implemented:** Added bounded previous/next page callbacks, a page indicator, page clamping after rows are omitted, complete global numbering and counts on every page, an explicit `Import N` action for the whole review, and renamed `Review` to `Edit details`. All members in the originating group can browse the shared pages; existing sender/admin authorization still protects edits, cancellation, and import.

**Outcome/evidence:** An eight-row TODO now renders as six items on page one and two on page two without a hidden `+N more` remainder. Focused formatter/service coverage and TypeScript typechecking pass.

**Follow-up:** Verify page editing and callback behavior in a live Telegram group after Render deploy, especially when two members browse the shared card concurrently.

### 5 August 2026 — Error-check and harden both Study Mode phases

**Friction discovered:** Phase 1 and Phase 2 worked in focused tests, but an independent Impeccable review found that the dashboard still treated eight destinations as equal choices, could remain on an indefinite loader after startup failure, styled errors too much like success, advertised keyboard shortcuts that did not work, and lost a Deep Work target after refresh. Sheets did not consistently trap and restore focus or protect drafts, weekly planning could silently discard priorities after the third, and operational text was too small or low-contrast in several desktop and mobile states. The final React 19 lint pass also caught synchronous effect hydration and render-time ref access that TypeScript alone did not detect.

**Decision:** Keep the deterministic Study backend and its private owner/group gate, but rebuild the dashboard around academic decisions rather than data categories. Adapt the strongest relevant 21st.dev patterns—grouped navigation, a mobile action dock, command-palette shortcuts, progressive settings, and a stepwise review wizard—without importing a generic component aesthetic. Treat accessibility, error recovery, and interruption safety as functional requirements rather than visual polish.

**Implemented:** Grouped the workspace into Today, Organize, Reflect, and Manage; added a four-action mobile dock with progressive disclosure; made Ctrl/Cmd+K, G-chords, and `?` functional; added a concise keyboard guide; separated loading, live, reconnecting, offline, success, and error states; added a recoverable startup error; retained Deep Work targets across refreshes and connected session completion to task completion or mistake capture; rebuilt weekly review as an autosaved four-step flow with three explicit priority fields; rebuilt settings as four focused panels; made modal focus, Escape, restoration, backdrop close, and dirty-draft protection consistent; replaced hard-coded owner identity; and raised operational type, contrast, and touch targets across both themes and mobile layouts. The backend snapshot now returns the item linked to an open focus session.

**Outcome/evidence:** The dual-agent critique moved from 24/40 to 38/40. The final Impeccable static detector reports no findings in either the Study component or stylesheet. Dashboard TypeScript, lint, all 29 contract tests, and an isolated production build pass. Backend TypeScript and all 39 Study-focused tests pass. A parallel full-backend run reached 699/700 because the unrelated Windows temporary-directory publisher test timed out under contention; that complete seven-test file passes in isolation, so no Study regression was found.

**Follow-up:** Perform one authenticated production visual pass in the exact private Study group on desktop/mobile and light/dark themes, including a screen-reader spot check. Keep contextual first-use help for Canvas and Review as a small later polish item; do not add bulk controls or another navigation destination until actual semester usage proves the need.

## Journal entry template

```markdown
### YYYY-MM-DD — Decision title

**Friction discovered:** What the user experienced; include context, not private data.

**Decision:** What was chosen and which alternatives were rejected.

**Implemented:** Product and technical changes.

**Outcome/evidence:** Tests, measurements, observations, and relevant commits.

**Follow-up:** What still needs production observation or a later decision.
```
