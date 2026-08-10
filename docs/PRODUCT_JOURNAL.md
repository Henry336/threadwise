# Threadwise Product Journal

Updated: 2026-08-11

This is the durable record of Threadwise's product decisions: the friction that was observed, why a change was chosen, what was implemented, and what should be checked next. It complements `CHANGELOG.md`, which remains the release-level inventory.

## Evidence and maintenance

- Entries dated before 22 July 2026 were reconstructed from Git history, the existing changelog, case study, architecture notes, and preserved product discussions. They describe the evidence available now; rationale marked **inferred** was not written contemporaneously.
- Entries from 22 July 2026 onward are contemporaneous unless explicitly labelled otherwise.
- Every meaningful product change should add a short entry with: **friction**, **decision**, **implementation**, **outcome/evidence**, and **follow-up**.
- Never put tokens, passwords, connection strings, private user content, or personally identifying test data in this journal.

## 11 August 2026 - Ari's loader needs registered motion, not pose swapping

**Friction discovered:** The loading sequence jumped between four illustrations whose subject scale and visual center differed. The knot-to-finished action therefore looked like Ari was moving around the card, and the finished pose snapped directly back to the opening knot instead of forming a convincing loop.

**Decision:** Keep one fixed 3:4 stage and register every frame to the same head center, body scale, and baseline. Add four meaningful in-between poses, then play the eight-frame action forward and backward so the loop returns through its own motion path.

**Implementation:** The dashboard now uses an eight-frame 543×724 Ari sprite with a 15-state forward/reverse sequence. Only the untangling action changes between frames; the loading-card size remains stable, and reduced-motion users see the completed frame without animation.

**Outcome/evidence:** Asset tests verify the exact eight-frame geometry and all playback positions. The generated motion asset was visually checked as one complete strip before integration.

**Follow-up:** Check the production loader at desktop and mobile sizes and tune only playback timing if real network waits make the loop feel too fast or too slow.

## 10 August 2026 - Timetable inspection needs context before controls

**Friction discovered:** Horizontal scrolling removed the day and deadline context just when the time axis needed the most space. Selecting a block opened an editing form immediately, so simple inspection felt unsafe. Short-duration blocks inherited full-card content and rendered misleading fragments such as detached meridiem labels.

**Decision:** Freeze the informational Day and Deadlines pane beneath a pinned time ruler; distinguish today from the current time with separate teal and orange semantics; open existing blocks in read-only details before editing; and adapt visible card content to duration-accurate width.

**Implementation:** The dashboard now keeps Day and Deadlines visible at every horizontal scroll position, marks the current day with an accessible teal row treatment, and uses a reducer-backed detail/edit sheet flow. Horizontal cards use deterministic narrow, compact, and full density tiers, preserve exact widths, assign overlap lanes, and retain complete accessible labels. No Study data contract or backend behavior changed.

**Outcome/evidence:** Focused tests cover density thresholds, 30-minute widths, overlap lanes, midnight bounds, and detail-to-edit transitions. Browser verification covered horizontal start/middle/end positions, 1024/1280/1440 desktop widths, light and dark themes, and the 390px mobile agenda and bottom sheet.

**Follow-up:** Confirm the production deployment at the same breakpoints with real recurring blocks and continue treating timetable inspection and mutation as separate interaction states.

## 10 August 2026 - Study capture context must be visible and expire

**Friction discovered:** Opening a module changed the active Study context, and later text or media without an explicit module was silently saved there. A screenshot about one module could therefore disappear into whichever module happened to be opened last, with no destination decision visible to the owner.

**Decision:** Preserve the speed of module-first capture without allowing stale context to become an invisible destination. Selecting a module creates a durable ten-minute capture context that is shown in Telegram and the dashboard. Switching modules restarts the window; ordinary captures do not extend it. Explicit module text and module-specific replies remain authoritative after the window expires.

**Implementation:** Added `activeModuleUntil`, expiry-aware context resolution, a five-per-page active-module picker, source sender/time preservation, and race-safe pending-capture consumption. Expired or pre-migration selections are cleared before routing. No AI is used to infer a destination.

**Outcome/evidence:** Persistence tests cover expiry, switching, restart restoration, non-extension on capture, and legacy null expiry. Module cards and dashboard entry links expose the remaining context instead of relying on memory.

**Follow-up:** Verify one capture inside the ten-minute window, one after expiry, one explicit module reference, one module switch, Cancel, and a repeated stale callback in the live private Study group.

## 10 August 2026 - Images should be intentional captures, not automatic OCR jobs

**Friction discovered:** A Study photo was immediately OCR-processed and saved without asking what the owner wanted. Opening the resulting dashboard card navigated to a raw JSON error when Telegram could no longer serve the stored file path. The workflow mixed image storage, captioning, OCR, destination choice, and failure handling into one irreversible guess.

**Decision:** Stage image intake as one durable, resumable decision. Keep the original image, Telegram caption, sender, and timestamp; make OCR optional; let the owner edit a caption and choose a module before saving; and render saved images inside the dashboard instead of navigating to a transport endpoint.

**Implementation:** Added a single-message image workflow with Save image, Add/Edit caption, Extract text, Choose module, and Cancel. OCR results remain a preview until Save with text. Protected delivery now refreshes Telegram file metadata, retries one stale download, validates the upstream image MIME, and classifies expired, unauthorized, and temporary failures without exposing tokens.

**Outcome/evidence:** Focused bot, persistence, delivery, and dashboard-loader tests cover default no-OCR behavior, caption state, exact-once saving, authentication failure, permanent expiry, and retryable provider failure. Dashboard image cards open a keyboard-dismissable same-origin lightbox with context and retry/close actions.

**Follow-up:** Live-test a captioned photo, captionless photo, OCR preview, canceled capture, expired Telegram file, and dashboard session expiry.

## 10 August 2026 - A weekly timetable must represent the entire day honestly

**Friction discovered:** The Study timetable clipped planning outside its 8 AM–11 PM viewport, cut off the final hour, and placed the live-time label over nearby block text. Midnight-edge positions could also push the indicator outside its usable track.

**Decision:** Use one 00:00–24:00 schedule model in both orientations, keep it scrollable rather than compressing 24 hours, auto-position the initial viewport near the relevant work, and reserve a dedicated rail for the current-time label.

**Implementation:** Added full-day block bounds, cross-midnight clipping at the day boundary, preferred initial scroll, and clamped current-indicator offsets. Mobile keeps the existing day agenda; desktop Vertical and Horizontal remain alternate projections of the same records.

**Outcome/evidence:** Timetable unit tests cover exact midnight, end-of-day, cross-midnight, preferred scrolling, and indicator edge padding. The dashboard Impeccable detector reports no issues in the changed Study targets.

**Follow-up:** Verify midnight, early-morning, midday, and late-night blocks in both themes and orientations on desktop plus the mobile day agenda.

## 10 August 2026 - Canvas source truth must not override an owner's archive decision

**Friction discovered:** Canvas synchronization treated a seen course or assignment as permission to show it. Courses outside the current semester and repeatedly archived assignments could therefore return after every automatic sync, making cleanup feel ineffective.

**Decision:** Separate external source state from local visibility. Canvas may refresh metadata, but only the owner may activate or restore a module or item. New or uncertain Canvas courses wait inactive for review.

**Implementation:** Added durable archive timestamps for Study modules and Canvas assignments, stopped course refreshes from setting modules active, preserved locally closed assignment states, and filtered inactive modules from work, resources, mistakes, sessions, schedules, search, reminders, attention, reviews, timetable, travel lookahead, and exports. The dashboard exposes compact Restore or Activate actions.

**Outcome/evidence:** Migration backfill preserves existing inactive Canvas modules and skipped assignments. Focused Canvas persistence tests prove that archived courses stay inactive and newly discovered courses do not enter the semester automatically.

**Follow-up:** After deployment, archive one Canvas assignment and one module, run two manual syncs plus one scheduled sync, and confirm neither returns until explicitly restored.

## 10 August 2026 - Reminder testing needs production fidelity without production credentials

**Friction discovered:** Class-departure and study-block reminders depend on the live reminder worker, the active private Study workspace, academic-week bounds, saved origins, and Improved NextBus. Local configuration intentionally contains placeholder database credentials, while Render SSH is not authorized on the development machine. Manually inserting rows or copying the production database URL locally would weaken credential handling and could create recurring test reminders.

**Decision:** Add an explicit date-bounded production smoke seed rather than a permanent sample-data path. Require an exact local `YYYY-MM-DD` deployment flag, reuse the live workspace and route provider, label every row as test data, constrain both blocks to the current academic week and weekday, and make the operation idempotent and non-fatal.

**Implementation:** Added `STUDY_SMOKE_TEST_DATE`. On the matching date, startup creates one near-term study block and one COM3 timetable block whose start time is derived from the current live route so its departure alert becomes eligible soon after deployment. The seed uses the current routable origin or creates a labelled PGP fallback, enables study-block reminders, logs exact credential-free timings, and archives expired smoke blocks on a later restart.

**Outcome/evidence:** TypeScript checking and focused Study scheduling/transit tests pass. The seed cannot recur in later academic weeks, cannot run on a non-matching date, and cannot prevent the main bot from starting if transit or database work fails.

**Follow-up:** Confirm the Telegram group receives both reminders, use Refresh on the class alert to verify live route recalculation, inspect the Timetable/Travel views, then remove the Render flag after the test date.

## 10 August 2026 - Fast iteration needs one current story across both repositories

**Friction discovered:** The latest Threadwise and Beacon behavior was recorded in the changelog and product journal, but the case study and architecture guide still identified v0.30.0, presented acceptance/blocking/handoff as active group workflows, and used the earlier test baseline. The backend README listed legacy commands beside active commands, while both dashboard references omitted the shipped Study Timetable and still described assignment-response state that had been removed. A contributor could therefore read individually accurate historical documents and assemble an inaccurate current product.

**Decision:** Treat current-behavior documentation as a cross-repository release surface. Preserve historical changelog, critique, and feature-verification snapshots; update only claims that describe the product now. Label compatibility commands and historical test/audit results explicitly, keep the root README and case study on the current release, and make each repository's `CLAUDE.md` the current handoff pointer.

**Implementation:** Reconciled the backend README, case study, architecture, Beacon guide, voice guide, private-Codex verification note, changelog, and contributor handoff with v0.32.0. Reconciled the dashboard README, architecture, product/design context, changelog, and contributor handoff with immediate assignment, progressive Telegram-to-dashboard continuation, and the current Study navigation. Feature-specific runbooks whose behavior did not change remain intact.

**Outcome/evidence:** Repository-wide Markdown scans now separate current claims from historical snapshots, local links resolve to tracked files, current version references match `package.json`, and diff whitespace checks pass. The latest code-verification evidence remains the completed v0.32.0 gate: 97 test files, 786 passing tests, 6 intentional skips, Prisma validation/generation, TypeScript checking, and an isolated production emit.

**Follow-up:** Include current-surface documentation and both contributor working logs in every cross-repository feature phase. Do not update a version/date alone; search for removed commands, permissions, navigation labels, validation counts, and future-work claims that changed meaning.

## 10 August 2026 - A Telegram control plane still needs information hierarchy

**Friction discovered:** Beacon deliberately has no dashboard, but its growing Telegram feature set had accumulated a flat wall of reports, triggers, scores, moderators, safety controls, audits, and enforcement actions. Ordinary members could encounter staff-oriented navigation, moderators could see buttons they were not authorized to use, and each report exposed every punishment before the reviewer had even chosen to act. The result was cognitively noisy and made sensitive policy boundaries harder to reason about.

**Decision:** Keep Beacon entirely Telegram-based while applying progressive disclosure: show the next likely decision, not every capability. Give ordinary members only Rules and How to report; give owner and moderators different private homes; place configuration under Policy, operational utilities under More, member mutations under Members & offences, and punishments behind Take action. Hide inaccessible controls when rendering and independently reject unauthorized callbacks, including stale or crafted callback data.

**Implementation:** Added role-adaptive public/private keyboards, review-queue counters, focused Policy and More submenus, a pending trigger-submission inbox, permission-filtered report actions, contextual Back navigation, and concise report cards retaining bounded evidence, topic, identity, numeric Telegram ID, offence score, and report count. Trigger values remain owner-only through menus, natural language, searches, legacy callbacks, approval paths, and audit summaries. Moderator submissions now require a granted permission and Beacon's private chat. Permanent report and score-threshold bans now use expiring confirmations bound to the actor, community, report/offence, target, and source context.

**Outcome/evidence:** Focused policy, authorization, and UI tests cover ordinary/owner/moderator menus, hidden actions, button budgets, crafted callback classification, private-only submissions, report context, and Back destinations. Prisma validation and generation pass, TypeScript is clean, the complete repository suite passes 97 files and 786 tests with 6 intentional skips, and an isolated production TypeScript emit succeeds without touching the running build output.

**Follow-up:** Live-test the owner and one limited moderator side by side. Confirm that an ordinary group invocation has only two actions, the moderator cannot discover trigger values through any old card, report actions edit one card, and every submenu returns to one predictable parent. Tune wording if needed; do not restore the flat control wall.

## 9 August 2026 - Shared work needs progressive disclosure, not a wall of controls

**Friction discovered:** A tester found Threadwise's task and TODO interfaces overstimulating because Telegram exposed assignment states, editing tools, list selectors, navigation, and secondary actions simultaneously. Accepting or blocking an assignment added ceremony without changing who owned the work; member-to-member handoff also weakened creator/admin control. Generic dashboard links then made the escape hatch less useful because people still had to find the relevant record again.

**Decision:** Adopt `One message, one decision`. Keep ordinary cards to three immediate actions and two rows, expose numbered controls only after an explicit choice, and use exact dashboard links for secondary management. Treat assignment as immediate. Preserve claiming for unassigned work, but reserve reassignment for the task creator or a currently verified Telegram group administrator. Retain old callbacks and language as graceful compatibility paths without preserving obsolete state transitions.

**Implementation:** Added contextual personal/group task keyboards, collapsed list controls, compact group-home navigation, exact record and TODO-review deep links, creator/assignee/admin authorization shared by Telegram and dashboard mutations, claim race protection, immediate accepted assignments, legacy-state normalization, and a three-row TODO preview with an idempotent import path. The group dashboard removed acceptance, blocking, and handoff controls while retaining live data and in-place editing for authorized actors.

**Outcome/evidence:** Backend typechecking, focused authorization/navigation/import tests, and the dashboard production build pass. The new tests explicitly verify button budgets, selection expansion and Back, group task audiences, role restrictions, and exact deep-link targets.

**Follow-up:** Live-test one private task, one unassigned group claim, one creator reassignment, one unauthorized member attempt, one legacy task card, and one repeated TODO import. Use feedback to tune labels, not to restore simultaneous secondary controls.

## 6 August 2026 - Moderation history needs accountable escalation, not an opaque blacklist

**Friction discovered:** A report queue could preserve a message and offer an immediate moderation action, but it did not answer whether a member had repeatedly offended, why a later punishment was justified, or how a pardon should affect future enforcement. Exposing the trigger pool to every moderator would also leak enforcement policy, while hard-coded severity values would force redeployments. Telegram offers no safe single call to erase one forum topic's full history, making a requested purge deceptively complex.

**Decision:** Keep reports and offence history separate but linked. Moderators may preserve evidence and propose an incident score; only the immutable owner confirms scores, configures severity values and thresholds, reduces or pardons records, and confirms permanent bans. Keep the trigger pool owner-only, accept moderator trigger suggestions only in private, and implement purge by deleting/recreating only the originating non-General topic after an expiring owner confirmation.

**Implementation:** Added report-linked offence records, severity policy, ordered warning/mute/ban thresholds, active-score aggregation, owner approval/rejection, history lookup, reductions and pardons, threshold warnings/mutes, second-step permanent bans, and re-ban-on-rejoin. Report cards now show bounded evidence, topic, target user ID, score, and recent history. Added owner-only private score controls and stale-callback guards for the hidden trigger library. Added forum-topic metadata capture plus `/purge` confirmation, topic identity validation, delete/recreate, replacement tracking, and private audit delivery.

**Outcome/evidence:** Prisma generation, no-output TypeScript checking, and all 754 repository tests pass. Focused policy coverage verifies safe moderator defaults and bounded incident-score proposals. The ordinary build output remains locked by an already-running local Node process, so compilation was also checked through no-output typechecking rather than disturbing the live process.

**Follow-up:** Deploy to the testing group first. Report a disposable message, verify that a moderator can propose but not confirm a score, confirm it as owner, test reduction/pardon, and only then test a permanent ban with a disposable account. Test `/purge` exclusively in a disposable non-General topic after granting Beacon **Manage topics**.

## 6 August 2026 - Moderation configuration belongs in a private Telegram control plane

**Friction discovered:** Beacon's first release proved that policy could be changed without touching the repository, but exposing deep configuration through a group message was awkward and could reveal trigger values, report context, or moderator capabilities to ordinary members. A single `canEditRules`-style grant was also too broad: a helpful moderator who should propose a trigger should not automatically be able to remove it, reduce its severity, or rewrite enforcement. Forum topics added another context risk because an action could be correct yet appear detached from the conversation where it originated.

**Decision:** Keep Telegram—not a dashboard—as Beacon's complete control plane, but move sensitive operations to private chat. Preserve a deliberately small group menu. Split trigger permissions by capability, require owner approval before a moderator contribution can enforce, and keep policies group-wide while preserving topic context on every report/action.

**Implementation:** Added authorized community selection and saved private control sessions; a searchable, filterable, six-item trigger library; exact natural calls such as `Beacon`, `Hey Beacon`, and `menu`; independent add/remove/reclassify/manage-group permissions; an owner-only approval inbox with review, action-selection, and removal controls; pending-trigger enforcement exclusion and duplicate protection; group-to-private deep links; and topic IDs on evidence, actions, warnings, and private alerts. The public group surface now contains only non-sensitive status/rules and the private-controls link.

**Outcome/evidence:** TypeScript checking and Prisma client generation pass during implementation. Focused policy coverage verifies the safe permission preset, strict explicit invocation matching, multilingual normalization, boundary-safe words, domain matching, and severity ordering. Pending contributions are structurally unable to enter the enforcement query before approval.

**Follow-up:** Deploy to the testing group in Observe mode. Test one owner-created trigger and one moderator submission; verify the latter does not match before approval, then approve it and confirm the same message begins producing an Observe alert. Test a report inside a forum topic and confirm its private card retains the topic while no evidence appears publicly.

## 6 August 2026 - A separate identity can reuse infrastructure without confusing the product

**Friction discovered:** Threadwise's paid Render service already provided the reliable always-on process needed by a scholarship community, but Threadwise's public identity and Capture/Coordinate/Recall product promise did not describe moderation. Reusing the same Telegram identity would confuse both products. A generic off-the-shelf moderator was available but required a separate paid plan, and hard-coded keyword changes would create repeated deployments and bot downtime. The group is currently small, so a deep multi-role hierarchy would add operational burden before it added safety.

**Decision:** Run a second Telegram identity, Beacon, inside the existing Threadwise process while keeping its behavior, token, webhook, group allowlist, commands, and data separate. Use only Owner and Moderator roles. The owner ID is immutable deployment configuration; `Manage moderators` is never grantable. Moderators receive only explicitly selected capabilities. Policies must be editable from Telegram and begin in observe or review-only states.

**Implementation:** Added an optional dual-bot startup path and second webhook; exact testing and production group bindings; database-backed moderators, policy categories, triggers, trusted members, membership state, reports, actions, audits, conversations, and update claims; a sequential permission wizard with a safe preset and second confirmation for ban, automatic-action, or lockdown access; private owner audit DMs; automatic moderator suspension after leaving; configurable word, phrase, and domain policy matching; Zawgyi-to-Unicode normalization; policy testing; report deduplication and temporary evidence; flood, duplicate, mention, new-member, and lockdown controls; and reversible mute/ban actions. Trigger categories themselves can be created, renamed, and safely removed without a redeploy.

**Outcome/evidence:** Prisma validation and TypeScript checking pass. Focused policy tests cover Myanmar normalization, boundary-safe word matching, domain matching, severity ordering, and the non-destructive recommended permission preset. A focused runtime test exposed that the initially selected Myanmar package omitted its compiled Node files; it was replaced before deployment. A production dependency audit then found two unrelated transitive advisories, and compatible patch upgrades reduced the audit result to zero known vulnerabilities.

**Follow-up:** Create the Beacon identity in BotFather, disable privacy mode, add it as an administrator only to the private testing group, set the Render secrets, start Beacon once in the owner's private chat, and exercise the live safety checklist in `docs/BEACON.md`. Keep observe mode on until real messages show that the trigger set has an acceptable false-positive rate. Add the production group ID only after testing.

## 5 August 2026 - Reminder delivery and callback ownership diverged

**Friction discovered:** Older group reminders continued arriving after Telegram upgraded a basic group to a supergroup, but every button on those cards failed with a missing-record message. Migration recovery had correctly repaired the historical task owner's reminder destination while deliberately preserving both database identities; callback handlers still searched only the replacement group identity. Delivery and interaction therefore referred to the same Telegram group but different preserved owners.

**Decision:** Preserve old callback formats and records rather than invalidating sent cards or merging two workspaces implicitly. Resolve a historical owner only from the stable task row ID and only when that owner's current reminder destination exactly matches the chat where the callback occurs. Never fall back to an unrestricted cross-user lookup.

**Implementation:** Added a chat-scoped legacy-task owner resolver and routed all task-card actions through it, including completion, snoozing, starring, editing, detail views, cancellation, restoration, and assignment status. Pending title/detail edits remain attached to the current interaction while persisting the actual task owner, so the following text message updates the intended historical task even after a restart. Legacy-owner actions omit the current-identity undo shortcut because applying it to another preserved owner would be misleading.

**Outcome/evidence:** Focused tests verify same-chat recovery, foreign-chat isolation, archived-task rejection, and historical-owner edit continuation. Existing callback data remains valid, reminder cards need not be regenerated, and no personal or different-group task becomes reachable through the compatibility path.

**Follow-up:** After deployment, press View full, Snooze, Star, edit Title, and Done on one pre-migration group card. If the group contains intentionally separate old and new workspaces, plan an explicit reviewed merge rather than silently combining records.

## 5 August 2026 - A study schedule needs a spatial view

**Friction discovered:** Study Mode already stored recurring module blocks, class venues, travel configuration, academic-week bounds, and assignment deadlines, but exposed the schedule mainly through settings and compact Telegram commands. This made it difficult to answer the ordinary planning questions “What does my week look like?”, “Where is the free space?”, and “What is due around my classes?” The absence of a Timetable destination also made the Study dashboard feel incomplete despite having the required data.

**Decision:** Add Timetable as a first-class private Study view backed by the existing schedule and work records. Recurring classes and planned blocks belong on a clock grid; assignment due dates belong in a distinct deadline lane because a deadline is not evidence that study time was scheduled. Desktop should optimize for week scanning, while mobile should default to a focused day agenda rather than compressing seven unusable columns.

**Implementation:** Added week/day switching, academic-week navigation, a current-time marker, module colour cues, a separate `Work due` lane, and an automatically selected mobile agenda. Schedule blocks can be created, opened, edited, or deleted in place, including module, weekday, time, type, active week range, venue, destination, origin, and travel buffer. Due work opens the existing Study item editor and can enter Deep Work directly. Telegram now links to the same view and recognizes deterministic timetable requests. Existing snapshot and server-sent-event reconciliation refresh the view after Telegram, Canvas, or dashboard mutations, keeping PostgreSQL as the single source of truth.

**Outcome/evidence:** Academic-week projection tests cover pre-semester Week 1 selection, recurring-block visibility, deadline separation, and week arithmetic. Dashboard tests, lint, TypeScript, and production build pass; backend parser and dashboard contract tests, the full backend suite, typecheck, Prisma generation, and production build pass. A local Impeccable review identified side-tab-like module borders that visually resembled generic generated-dashboard accents; those were replaced with restrained uniform module-tinted borders. The authenticated Study route could not be visually automated without borrowing a live Telegram session, so final live responsive verification remains intentionally manual.

**Follow-up:** Live-test one desktop week, one mobile day, one block edit, one Telegram-created block, one Canvas deadline update, and one pre-class travel configuration. If users later need drag-to-reschedule, add it only with keyboard and explicit-save parity rather than making pointer interaction the sole editing path.

## 5 August 2026 - Telegram group IDs are lifecycle state

**Friction discovered:** Two releases failed to deploy because a strict Study fixture did not include the newly required travel mute field. Meanwhile, the live reminder worker repeatedly sent to a retired basic-group ID after Telegram upgraded that chat to a supergroup, producing a new 400 error every 15 minutes. A Telegram group ID had been treated as permanent even though Telegram explicitly replaces it during an upgrade.

**Decision:** Reproduce deployment from a clean checkout, keep strict fixtures aligned with the Prisma contract, and treat a group-to-supergroup upgrade as an identity migration rather than an ordinary delivery failure. Repair should be automatic and non-destructive.

**Implementation:** Added the missing fixture field; processed Telegram migration service messages before normal bot routing; parsed `migrate_to_chat_id` from grammY API errors; updated stored reminder destinations and delivery history; moved the existing group user/workspace identifiers when no replacement record conflicts; and retried the original reminder exactly once against the replacement ID. If both old and new identities already contain data, Threadwise repairs delivery but deliberately avoids silently merging or deleting either workspace.

**Outcome/evidence:** The exact isolated Render build passes. The complete backend suite passes all 742 tests, including focused migration extraction, persistence, and retry coverage. The next failed delivery from an already-upgraded group can self-heal the stale destination instead of maintaining the recurring error loop.

**Follow-up:** Confirm the next Render deploy succeeds and watch one reminder cycle. If logs report an identity conflict, reconcile the two preserved group records explicitly rather than guessing which data to discard.

## 5 August 2026 — Stored integration state is not operational health

**Friction discovered:** Three separate interfaces appeared configured while failing at the moment of use. The Study dashboard rendered a computed pre-semester week as `—`; travel-origin setup promised venues and stops but only performed a single venue lookup and sent instructions questions into ambiguous capture; and Google Calendar treated the presence of an OAuth row as proof that its token was still usable. Archiving also left an already-created Calendar event behind, so Threadwise and Google could disagree about whether work was active.

**Decision:** Describe lifecycle states honestly and validate them at the boundary where the user depends on them. Pre-semester is a named academic state, origin setup is a search-and-confirm workflow across both venues and stops, Calendar connection status requires a usable token, and a linked event follows its task through archive and restore.

**Implementation:** Added an explicit pre-semester week label with the Week 1 start date; deterministic origin-help intent; common NUS aliases; combined venue and bus-stop ranking; a Telegram candidate picker; live Calendar token validation with safe logging and a reconnect action; and automatic event removal/recreation on task archive/restore when Calendar auto-sync applies.

**Outcome/evidence:** Focused backend tests cover origin instructions and alias normalization, the existing routing/Calendar/task suites pass, and the dashboard has a dedicated pre-semester regression test. Dashboard TypeScript, lint, and its complete test suite pass. The backend no-output typecheck reports no errors in the changed files; a full local emit remains obstructed by an unrelated running Node process that holds both `dist` and the generated Prisma client open.

**Follow-up:** Live-test one ambiguous origin, one direct stop, one forced Calendar reconnect, and one archive/restore cycle after deployment. If Google deletion is temporarily unavailable, keep the failure explicit rather than silently allowing task and Calendar state to diverge.

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

### 11 August 2026 — Make the dashboard installable without caching private work

**Friction discovered:** Threadwise still behaved like an ordinary browser tab, making a frequently used Telegram companion slower to reach from a desktop taskbar or phone home screen. At the same time, a conventional offline-first service worker would be inappropriate for private tasks, notes, images, and group records. The dashboard also repeated obvious page meanings with subtitles such as “Things to do, reminders when they matter,” making simple collection views feel generated rather than direct.

**Decision:** Treat installation and offline data as separate concerns. Add a standards-based standalone app shell with approved Ari launcher assets and a generic offline recovery page, but cache only versioned framework and brand assets. Keep authenticated navigation and API responses network-only. Across personal, group, Study, and demo views, use one direct operational title and no subtitle that merely restates it. Preserve one short, deterministic daily line on personal Overview, where personality helps orientation without adding persistent filler.

**Implemented:** Added the dashboard manifest, 192px and 512px icons, a maskable safe-zone icon, Apple touch metadata, production service-worker registration, and a static-only service worker that explicitly excludes `/api/*` and dashboard navigation responses. Reconciled page headings through the shared dashboard renderer so the live product and demo use the same copy rules. Search now names tasks, notes, ideas, and images in one heading and reports actual result state without a decorative `LIVE` badge.

**Outcome/evidence:** Focused manifest, copy-rotation, service-worker policy, and Ari loader tests pass with TypeScript checking. The production build and changed-file lint validate the installable shell without widening the browser trust boundary. The service worker contains no private-data cache path, and the Overview line is stable for a complete Singapore calendar day.

**Follow-up:** Verify the install prompt and standalone launch on production Chrome, Edge, Android, and iOS Safari. Do not add offline workspace data unless Threadwise first adopts an explicit encrypted-device storage and revocation design.

## Journal entry template

```markdown
### YYYY-MM-DD — Decision title

**Friction discovered:** What the user experienced; include context, not private data.

**Decision:** What was chosen and which alternatives were rejected.

**Implemented:** Product and technical changes.

**Outcome/evidence:** Tests, measurements, observations, and relevant commits.

**Follow-up:** What still needs production observation or a later decision.
```
