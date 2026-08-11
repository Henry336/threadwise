# Changelog

## Unreleased

### Study protected-image MIME recovery
- Hardened the authenticated Study media proxy for older Telegram uploads whose provider or stored metadata reports a generic binary MIME type.
- The proxy now identifies supported PNG, JPEG, GIF, WebP, and BMP payloads from bounded response bytes before returning them to the dashboard, while preserving owner/group authorization, fresh Telegram file resolution, defensive headers, and `no-store` delivery.
- Added a regression test proving that a historical PNG delivered as `application/octet-stream` is returned as an image without exposing its Telegram file identifier or bot credentials.

### Study capture context, intentional images, and protected media
- Replaced indefinite module selection with a durable, visible ten-minute capture context. Switching modules restarts the window; saving ordinary content does not silently extend it; expired and legacy selections are cleared before routing a capture.
- Changed Study image intake from automatic OCR and immediate saving to one durable pending card with Save image, Add/Edit caption, Extract text, Choose module, and Cancel. OCR is now an explicit preview action, and atomic consumption prevents duplicate saves from repeated callbacks.
- Preserved source sender and sent-time metadata through pending captures and saved resources so later audit and display work does not have to infer provenance from Telegram message ids.
- Reduced the Study home to six primary actions and moved secondary controls under More. Module and capture-destination lists now show five active modules per page.
- Hardened protected Telegram media delivery with a fresh file lookup, one retry for stale file metadata, upstream MIME validation, and distinct permanent-versus-temporary failure states without exposing bot credentials.

### Study capture, Canvas archive, and timetable reliability
- Stopped Study captures from silently inheriting a stale last-opened module. Explicit module text and replies to module-specific bot prompts still save directly; a recently selected module remains a visible ten-minute shortcut, and everything else asks the owner to choose from current modules.
- Added a paginated, active-module-only destination picker with cancel support and race-safe capture claiming, so stale or duplicate Telegram callbacks cannot create duplicate work or resources.
- Separated Canvas discovery from owner visibility. Newly discovered courses wait inactive for review, Canvas metadata refreshes no longer reactivate archived modules, and archived Canvas assignments remain locally closed until explicitly restored.
- Propagated module visibility through work, resources, mistakes, sessions, search, attention, reminders, reviews, timetable, travel lookahead, and Study exports.
- Added owner-visible restore/activate controls for inactive modules and persistence tests for Canvas course discovery, archived-module preservation, and duplicate pending-capture handling.

### Date-bounded Study reminder smoke seed
- Added an owner-operated `STUDY_SMOKE_TEST_DATE` deployment flag for validating the live Study reminder pipeline without copying production database credentials to a development machine.
- The seed creates one short study block and one routed COM3 class block using the current saved origin, real Improved NextBus estimates, the active academic week, and the exact local weekday. It is idempotent and cannot recur in later academic weeks.
- Study-block reminders are enabled when the smoke seed runs. Missing origins fall back to a clearly labelled PGP test origin, while failures remain isolated from normal bot startup and retain credential-free Render diagnostics.
- Expired smoke blocks are archived on a later service restart, and the flag is ignored unless it exactly matches the workspace's current local date.

### v0.32.0 documentation reconciliation
- Reconciled both Threadwise repositories' current-behavior documentation with immediate group assignment, unassigned claiming, creator/admin reassignment, progressive Telegram action budgets, exact dashboard deep links, Study Timetable/travel, and Beacon's Telegram-only role-adaptive control plane.
- Updated the case study, architecture guide, voice rules, contributor handoffs, dashboard product/design references, current release dates, and the complete 97-file/786-test backend verification baseline.
- Preserved historical release and verification entries while explicitly labelling old test/audit snapshots and legacy accept/decline/block/handoff commands so they cannot be mistaken for active workflows.

### Beacon progressive-disclosure control plane
- Replaced Beacon's flat private control wall with role-adaptive homes: the immutable owner sees Review queue, Members & offences, Policy, and More; moderators see only their granted operational destinations.
- Reduced the ordinary group surface to Rules and How to report. Authorized staff receive a private-controls deep link, while ordinary members never see policy, score, trigger, audit, safety, or moderator controls.
- Simplified initial report cards to Dismiss, Take action, and Offence history. Take action edits the same card and reveals only the current moderator's permitted warning, deletion, mute, score-proposal, or permanent-ban actions.
- Nested owner configuration under focused Policy and More screens, including an owner-only pending-trigger inbox and exact review-queue counters.
- Centralized callback authorization so current, stale, searched, and crafted trigger-library controls remain owner-only. Moderator trigger suggestions are accepted only in Beacon's private chat.
- Hardened permanent report and score-threshold bans with expiring actor-, group-, target-, report/offence-, and source-context-bound confirmations.
- Added focused rendering and authorization regression coverage for owner, moderator, and ordinary-member surfaces, action hiding, button budgets, Back navigation, evidence context, and private trigger submission.

### Progressive Telegram interaction hierarchy
- Reworked ordinary Telegram cards around one immediate decision, no more than three visible actions, and no more than two rows. Secondary editing, starring, archiving, assignment, and other management controls now live in exact dashboard deep links.
- Replaced default numbered list keypads with `Choose an item`, `View all`, and pagination. Choosing an item temporarily reveals numbered controls with a direct Back action, preserving complete Telegram browsing without showing every control at once.
- Simplified group assignments to immediate assignment, unassigned claiming, completion, snoozing, reassignment by the task creator or a verified current Telegram administrator, and read-only viewing for everyone else. Accept, decline, block, and handoff remain graceful legacy inputs but no longer mutate state.
- Added a permanent group-dashboard action to the compact group home and exact task, note, idea, image, and TODO-review links that select the correct workspace and open the intended record or batch.
- Condensed TODO review cards to three preview rows plus a remainder count and `Review & edit`, `Import`, and `Cancel`. Repeated imports remain idempotent through durable import-item keys and imported-state checks.
- Added a migration that normalizes legacy assignment states to accepted while retaining the historical activity audit, plus focused button-budget, authorization, deep-link, list-selection, legacy-compatibility, and import tests.

### Beacon offence ledger and owner-only topic purge
- Added an owner-confirmed offence ledger to every configured Beacon community. Report cards now preserve the flagged text, topic, member identity, numeric Telegram ID, current score, and recent offence history for moderator review.
- Added moderator proposals for offence severity and per-incident points. The immutable owner remains the only person who can confirm or reject a score, change the points assigned to each severity, or change warning, mute, and permanent-ban thresholds.
- Added owner-only score lookup, point reduction, single-offence pardon, and full-score clearing. Pardons stop points from counting without erasing the audit history.
- Added escalating score actions: warnings and temporary mutes can apply automatically at owner-configured thresholds, while a permanent ban always requires a separate owner confirmation. Confirmed permanent bans are restored if the same Telegram account rejoins and remain until the owner pardons the active offence.
- Kept the trigger library invisible to moderators, including through old callback buttons. Moderators may submit a trigger only through Beacon's private chat; the owner privately reviews it before it can enforce.
- Added immutable-owner `/purge` for non-General forum topics. Beacon confirms inside the originating topic, deletes and recreates that topic to remove its full history, retains known name/icon metadata, expires stale confirmations, and records the replacement topic in the audit log.

### Beacon private control plane
- Moved sensitive Beacon configuration into the bot's private chat. The owner and explicitly authorized moderators can select a manageable community, and Beacon remembers the selection while showing `Managing: …` before policy changes.
- Added an owner/moderator trigger library with live search, action and group filters, six-item pagination, creator and approval metadata, and Telegram-native add, move, severity-change, remove, and safe test flows.
- Split the former bundled policy permission into independent add-trigger, remove-trigger, change-severity, and manage-trigger-group grants. Only the immutable owner can manage moderators, while dangerous grants still require an additional confirmation and generate a private audit notification.
- Added a review-first contribution path: moderator-submitted triggers enter a non-enforcing Watchlist, notify the owner privately, and require explicit approval, action selection, or removal. Pending submissions cannot overwrite an active trigger or participate in live policy matching.
- Reduced the public group interface to rules, observe status, and a secure deep link to private controls. Sensitive trigger lists, moderator configuration, audits, safety settings, and reports no longer render into the moderated group.
- Added convenient exact invocations including `Beacon`, `Hey Beacon`, `Beacon menu`, and `menu`, without treating ordinary sentences containing the word Beacon as commands.
- Preserved forum-topic context on reports and moderation actions, returned warnings to the original topic, and included the source topic in private review and policy alerts. Policies remain group-wide by design; per-topic overrides are not introduced yet.

### Beacon community moderator
- Added Beacon as an optional second Telegram bot identity in the existing Threadwise Render process. It has an independent token, webhook path, command list, group allowlist, and database domain; leaving Beacon unconfigured has no effect on the main Threadwise bot.
- Added an immutable environment-owned owner identity. Only that owner can add, edit, remove, or restore moderators; `Manage moderators` is deliberately not a grantable permission.
- Added a button-led moderator permission wizard with a safe recommended preset, granular warn/delete, mute, ban, policy, trusted-member, automatic-action, and lockdown capabilities, plus a second confirmation for sensitive grants.
- Added private owner DMs and durable audit rows for moderator additions, removals, permission changes, automatic-action changes, lockdown, safety thresholds, trusted-member exemptions, and automatic suspension when a moderator leaves the group.
- Added database-backed trigger groups and word, phrase, and domain triggers. Categories can be created, renamed, emptied, and removed in Telegram; triggers can be added, tested, moved, and deleted without a code change or redeploy.
- Added observe-first moderation, configurable automatic review/warn/delete/mute/ban actions, flood and duplicate protection, mass-mention limits, trusted-member exemptions, new-member posting pauses, and confirmed emergency lockdown.
- Added reply-based member reports with public-command cleanup, private acknowledgement, temporary evidence, duplicate aggregation, a compact private review card, granular action permissions, and undo for mute or ban.
- Added English and Burmese member-facing rules and warnings, including Zawgyi detection and Unicode normalization before policy matching.
- Added exact testing/production group allowlists, moderator membership suspension, service-message cleanup, processed-update idempotency, evidence expiry, and a dedicated Beacon deployment/setup guide.
- Replaced two vulnerable transitive production packages with compatible patched versions discovered during the release audit.

### Legacy group task controls
- Restored every action on older group reminder cards after a Telegram group-to-supergroup migration could leave the task attached to a preserved historical group identity while callback handling resolved the replacement identity.
- Added a chat-scoped compatibility resolver: a historical task owner is accepted only when that owner is a group identity whose current reminder destination exactly matches the chat where the button was pressed. No cross-chat or global task fallback is permitted.
- Applied the compatibility path to Done, Snooze, Star, Title, Details, View full, Cancel, Restore, and group assignment actions while preserving current callback formats.
- Made legacy multi-message edits durable by recording the task's actual owner separately from the group member's current pending interaction; included a database migration and focused ownership/isolation regression tests.

### Interactive Study timetable
- Added a dedicated private Study `Timetable` view to the dashboard and Telegram Study home, with deterministic natural-language access through requests such as `show my timetable`.
- Turned recurring module schedule blocks into a responsive weekly clock grid with week and day views, previous/current/next navigation, academic-week labels, module colour cues, a current-time marker, and a touch-first mobile agenda.
- Kept assignment deadlines in a separate `Work due` lane instead of placing them on the clock as if their due times were planned study sessions. Selecting a deadline opens its existing Study work editor, while `Focus` begins the established Deep Work flow.
- Added in-place creation, editing, and deletion for recurring blocks, including module, weekday, start/end time, block type, academic-week bounds, venue, destination stop, usual origin, and travel buffer.
- Reused the existing Study snapshot and server-sent-event reconciliation path, so Canvas imports, Telegram changes, and dashboard edits refresh the same timetable without maintaining a second client-side schedule.
- Added focused academic-week and timetable-projection tests plus dashboard, backend contract, parser, type, lint, and production-build verification.

### Telegram supergroup migration recovery
- Fixed the production TypeScript build regression caused by the new Study travel mute field being absent from a strict persistence fixture.
- Added first-class handling for Telegram's basic-group-to-supergroup service update before normal routing and allowlist middleware.
- Made reminder delivery recover from Telegram's `migrate_to_chat_id` response automatically: Threadwise updates stored reminder destinations and delivery history, preserves the existing group user/workspace identity when the replacement ID is unused, and retries the failed message once against the new chat.
- Added focused migration parsing, persistence, and retry tests; the exact clean Render build and all 742 backend tests pass.

### Study routing, Calendar health, and task lifecycle
- Replaced the misleading pre-semester `Week 0` state with an explicit pre-semester label in the private Study dashboard, including the local date on which Week 1 begins.
- Made travel-origin setup deterministic and discoverable. Questions such as `How do I add a travel origin?` now open guided setup instead of ambiguous capture, common aliases such as `PGPR` resolve to PGP, and origin search now combines campus venues with direct NUS bus-stop results.
- Added a selectable Telegram result picker before saving an origin, so a partial or ambiguous place name can be corrected without restarting the flow.
- Changed Google Calendar status from “stored connection exists” to a live authorization check. Expired or revoked grants now show `Reconnect required`, preserve a safe diagnostic in server logs, and expose a direct reconnect action instead of falsely claiming Calendar is connected.
- Completed Calendar lifecycle parity: archiving a linked task removes its Google event, while restoring the task recreates the event when automatic Calendar sync is enabled.
- Added focused regression coverage for origin-help recognition, campus aliases, direct week-state presentation, and the existing routing/Calendar/task surfaces.

### Live Study travel and class-departure reminders
- Closed the gap between on-demand Improved NextBus route queries and the recurring Study timetable. Study home now includes a dedicated Travel surface with the current origin, saved origins, upcoming configured destinations, and direct live-route refreshes.
- Connected the existing timetable venue, destination-stop, usual-origin, travel-buffer, and reminder fields to both Telegram and the private Study dashboard. Telegram offers a compact guided `Destination | Origin | Buffer` flow; the dashboard adds progressive inline travel controls to each recurring block.
- Added proactive `CLASS_DEPARTURE` reminders that calculate a leave-by time from live arrivals and route duration shortly before class, while caching live results for three minutes so the minute-level reminder loop remains efficient.
- Added compact `Refresh`, `Change origin`, `I’m here`, and `Mute today` actions. Origin changes update both the selected class and the temporary current origin; muting expires at the end of the Study timezone's day.
- Added a deterministic 30-minute normal-journey fallback when Improved NextBus times out or cannot return a route, so a provider outage degrades the reminder rather than suppressing it.
- Added a migration for per-day travel muting plus focused timing, fallback, mute-expiry, dashboard schema, and disable-travel tests.

### Private Study dashboard
- Added a secure `Study dashboard` button to every Telegram Study-home variant. Typing `dashboard` now returns the same direct workspace link instead of ambiguously reopening the Telegram master sheet.
- Added a dedicated Study workspace to the authenticated dashboard with Overview, Module Shelf, Work, Library, Review, live Search, Deep Work, and Settings. It is a separate information architecture rather than a recoloured personal or group dashboard.
- Kept the surface invisible everywhere except the exact configured Telegram owner inside the exact configured and actively bound Study group. Workspace discovery, direct URLs, every API request, live events, resource bytes, and mutations fail closed through the same owner/chat/binding gate.
- Added module-scoped work editing, completion and archival; complete note/link/question editing; pinned and searchable Telegram images/files with protected delivery; OCR recall; mastery controls; mistake reattempts; weekly plans/reviews; focus sessions; Canvas sync and missing-assignment decisions; saved origins; and recurring study blocks.
- Added server-sent event reconciliation so Telegram captures, Canvas changes, and dashboard mutations share PostgreSQL as one source of truth. Selecting a module in the dashboard also updates the active Telegram Study context.
- Added a responsive module-first interface for desktop and mobile, full dark-mode parity, 44-pixel minimum controls, keyboard focus states, reduced-motion handling, accessible sheets, an explicit sync state, and the approved Ari untangling loader.
- Added authorization and contract tests for workspace switching, non-owner discovery, direct Study routes, proxy methods, forged paths, and inactive bindings. The completed local gate passed all 700 backend tests, TypeScript checking, Prisma validation, clean-directory TypeScript emit, all 29 dashboard tests, lint, standalone TypeScript checking, an isolated production Next.js build, the Impeccable static scan, and real-browser desktop/mobile light/dark checks. No push or deployment was performed as part of this local Phase 2 implementation.
- Hardened the creation and review contracts discovered during final QA: module colours persist on first save, blank optional work fields are omitted on creation, the All filter includes every status, failed mutations keep their form data, and mastery changes preserve an existing written rationale.

### Private Study Mode
- Fixed long-running Canvas button syncs leaving the private `Syncing Canvas` card behind. The delivered ephemeral message is now retained and replaced by either the completed import summary or a retryable failure card; a sealed-group fallback ensures the operation always reaches a terminal message.
- Added an owner-only Study domain for one explicitly configured and database-bound two-member Telegram group. Every interaction verifies the exact owner, exact chat, active binding, and current member count; membership changes lock the workspace, and proactive output fails closed when privacy cannot be reverified.
- Added dedicated Prisma models for the Study workspace, modules, weeks, work items, Canvas mappings/sync state, resources, silent note-session drafts, pending captures, sessions, mistakes, reviews, travel origins, schedule blocks, guided conversations, and idempotent reminder deliveries. Study records remain outside ordinary Threadwise search and dashboard routes.
- Added deterministic natural-language handling for work capture, module switching, notes, questions, resources, attention, weekly previews, Canvas status/sync, sessions, mastery, search, travel origins, and routes. Ambiguous text immediately offers Task, Note, Question, or Resource instead of waiting for AI.
- Added reply capture such as `save this to CS2100`, including replied text, links, photos, and documents. Module-scoped images retain their Telegram media reference and receive local OCR indexing for later search.
- Added durable, silent module note sessions. Each Telegram message is stored immediately as one paragraph; Save joins the exact text with blank lines, and 30 minutes of inactivity auto-saves without depending on process memory.
- Added complete long-note pagination based on post-HTML-escape length and Unicode code points, preventing Telegram truncation and broken emoji while leaving stored note bodies unchanged.
- Added read-only NUS Canvas synchronization every 30 minutes by default, with bounded retries and pagination, deduplication, local title/due-date overrides, automatic closure after a real Canvas submission, and explicit review when an assignment disappears. Local completion never submits to Canvas.
- Added a deterministic attention engine that ranks deadlines, overdue work, explicit priority, module/item mastery, backlog age, planned effort, and Canvas uncertainty without an AI service.
- Added Saturday-evening weekly reviews and Sunday-evening previews, separate quiet hours and daily caps, restart-safe delivery claims, and urgency ordering so housekeeping cannot crowd out overdue or near-due work.
- Added configurable saved and temporary travel origins plus journey estimates through the existing Improved NextBus public API. The implementation was checked against the current `improved-nextbus` route contract.
- Added first-use `/study` onboarding, button-led controls, natural-language-first help, clearer reply instructions, module resources, editable preliminary schedule, planned-versus-actual sessions, mistake reattempts, timed-practice tracking, explicit mastery, and six UTF-8 CSV exports.
- Added focused authorization, persistence, Canvas mapping, parser, attention, reminder ordering, pagination, Unicode, and durable note-session tests. No production migration, secret change, push, or deployment was performed as part of Phase 1.

### Complete Telegram TODO review
- Replaced the seven-row TODO preview cutoff with six-task pages that edit the existing Telegram message, so every parsed task can be inspected without opening the dashboard.
- Added previous/next navigation, preserved original task numbering and import-wide counts, and made `Import N` explicitly apply to the complete reviewed list rather than only the visible page.
- Renamed the dashboard action from `Review` to `Edit details`; the dashboard remains available for correcting titles, assignees, dates, status, and inclusion but is no longer presented as required for inspection.
- Added page clamping for rows omitted during review and focused coverage for multi-page and stale-page behavior.

### Quieter undated group reminders
- Changed new and previously-defaulted group workspaces from three-hour to six-hour follow-ups for tasks without due dates; personal reminder defaults remain unchanged.
- Combined simultaneously due undated group tasks into one compact public follow-up with direct task controls instead of sending one reminder card per task.
- Added an ignored-follow-up guardrail: after three unanswered group nudges, an undated task slows to daily reminders until someone edits, assigns, accepts, blocks, pins, snoozes, or reschedules it.
- Preserved group-admin configurability through the existing reminder interval controls, quiet hours, and message-based daily safety limit.
- Added migration, scheduler, formatting, activity-reset, and regression coverage for the new cadence.

### Voice Note Capture
- Added restart-safe Telegram voice transcription with exact raw-transcript preservation, conservative light cleanup, verbatim fallback, normal Note creation, and paginated raw-text viewing.
- Added Open/Edit/Undo/Keep verbatim result controls plus per-workspace cleanup, transcription model, language-hint, and ordinary-audio settings.
- Added durable leased/idempotent transcription jobs, group scope enforcement, OpenAI/Telegram size and format validation, retryable result delivery, environment documentation, a Prisma migration, and regression coverage.

### Owner file courier
- Added the owner-only `/files` laptop courier with explicit roots, Windows-index-friendly search, result previews, Send confirmation, path revalidation, streamed Telegram delivery, cancellation, audits, and restart recovery.

### Trusted Codex publishing
- Added owner-only Telegram publishing requests that hand completed Codex diffs to the trusted laptop worker.
- Added pre-turn Git snapshots, unrelated-change preservation, sensitive-diff blocking, local validation, `agent/*`-only pushes, PR creation against `main`, GitHub check gating, and post-check auto-merge.
- Added durable commit/push/PR/check/merge audit events and full publishing outcomes in Telegram reports.
- Added the repository's PR CI workflow for tests, typechecking, production build, and Prisma validation.

### Focused group TODO import
- Added strict group activation: ordinary conversation stays silent unless it is a slash command, an exact mention of the deployed bot, a reply to Threadwise, or an explicit `TODO:` / `ACTION ITEMS:` block.
- Added batch task extraction for pasted group lists, including wrapped bullets, completion markers, due dates, Telegram assignees, plain-language team owners, and row-level warnings.
- Added one durable review before import. The sender or a currently verified group owner/admin can edit titles, dates, status, assignees, inclusion, and team-owner labels in the group dashboard; other members receive a read-only view.
- Added idempotent import/retry behavior so duplicate taps cannot duplicate already imported rows and partial failures remain recoverable.
- Added an optional admin-created Threadwise forum topic for groups that want a dedicated bot lane without forcing every group into a separate topic.
- Kept successful delivery quiet: imported tasks enter the existing shared Work, assignment, editing, completion, and reminder flows, and the Telegram success acknowledgement removes itself.
- Added parser, routing, authorization, snapshot, migration, and dashboard-contract coverage plus the decision record explaining the false-activation and one-task-at-a-time friction.
- Hardened retries against process interruption: each created task is linked to its source row in the same database transaction, and an abandoned import claim becomes recoverable after a bounded lease.
- Corrected reviewed-assignee handling so dashboard selections are passed as explicit task data rather than synthetic Telegram entities; words such as “for” can no longer cause an imported title to be reinterpreted or stripped.
- Made parenthetical owner detection conservative. Known active members and recognizable team labels still resolve, while ordinary details such as `(include metrics)` remain part of the task. Ambiguous duplicate first names are left for review instead of guessed.
- Recompute row warnings after every correction, preserve skipped state while editing, accept plain Telegram-style checklist rows, and bind callback controls to the exact originating group.
- Added a durable per-row task idempotency key and an active-import heartbeat so process recovery and long imports cannot create duplicate tasks.
- Made preview-message bookkeeping best-effort after Telegram delivery and serialized optional topic creation within the running bot process, preventing misleading failures and common double-tap duplicates.
- Kept distinct Telegram members who share a display name, accepted emoji checklist markers with presentation selectors, and aligned the migration's warnings column with Prisma's non-null contract.
- Merged duplicate discoveries of the same assignee across plain `@username` parsing, Telegram mention entities, and group membership lookup, including incomplete parenthetical input, so one person appears only once in review.
- Corrected the dashboard review grid so optional notices cannot displace the scrollable rows or footer; selected-row summaries now exclude omitted work and terminal status copy appears only once.
- Passed all 595 backend tests, TypeScript typechecking, Prisma validation, and the production build; the coordinated dashboard passed all 12 tests, lint, and its production build.

### Telegram intelligence worker
- Added owner-only Gemini Ideas Intelligence actions for saved ideas: Develop, Challenge, Next steps, and a suggested Now/Next/Later task plan.
- Kept Gemini scoped to individual Idea-mode actions with no general `/gemini` command; `/codex` remains exclusively for Codex work.
- Routed Gemini analysis through the official locally authenticated Gemini CLI in read-only plan mode, with durable jobs, leases, retry delivery, paginated Telegram reports, and no cloud-side credential storage.
- Added worker freshness/capability diagnostics to `/codex status` and clearer task-sync empty states.
- Added Windows sign-in startup installation with Scheduled Task and current-user Run-key fallback; the runner restarts after failures and one process serves both Codex and Gemini.
- Added local Codex project/task discovery sync so Telegram can select pre-existing Codex tasks by project and resume the exact thread.
- Simplified Codex Telegram acknowledgements and reports so the task and answer lead, repeated prompts and folder paths are removed, defaults stay hidden, and pagination/model details appear only when useful.

### Documentation
- Reconciled README, case study, architecture, project handoff, product journal, voice guide, and Supabase migration runbook with the v0.26.0 implementation.
- Added a repository reading path, current module/data maps, dashboard authentication and scope flow, Note-session and ephemeral-group architecture, accurate deployment guidance, and the current 547-test baseline.
- Corrected stale product claims: Gmail is retired; Expenses/Excel are frozen and hidden; Google Calendar is secondary; personal/group dashboards and Find a time are implemented; the Seoul-to-Singapore cutover is complete.
- Documented the actual privacy boundary: normal users and groups are application-scoped, OAuth tokens are encrypted, and stored content is not end-to-end encrypted from the service operator.
- Replaced obsolete roadmap items that had already shipped with current measurement, scale, Intelligence, monetization, privacy, OCR, and localization follow-ups.

## v0.26.0 - 2026-07-23

### Quiet note capture
- Added private Note sessions: each message is durably stored as one exact paragraph, intermediate bot replies stay silent, and persistent Save note/Cancel controls remain beside the composer.
- Added restart-safe 30-minute inactivity handling. Non-empty sessions auto-save; empty sessions close; both restore the normal Menu/Dashboard keyboard with a short self-cleaning acknowledgement.
- Added long-note detail pagination that edits one Telegram card, splits at paragraph and sentence boundaries, preserves Unicode, and covers active and archived notes without truncating the stored body.

### Immediate capture choices
- Removed AI classification from the ambiguous-message critical path. Unclear text now immediately offers Task, Note, Idea, and Ignore actions.
- Bound pending capture choices to the Telegram actor so one group member cannot apply another member's choice.
- Kept routine save results ephemeral while leaving errors, parsed dates, recurrence, time zones, assignees, and useful item controls visible.

### Per-member group interfaces
- Adopted Telegram's receiver-bound ephemeral message flow for nested group menus, lists, pagination, prompts, and capture choices while preserving one public shared anchor and public shared-work cards.
- Added receiver validation, private ForceReply prompts, explicit “Reply to this message…” wording, ephemeral edits/deletion, and a no-public-fallback rule if private delivery fails.
- Recognized incoming ephemeral replies as explicitly addressed to Threadwise even when group privacy mode would otherwise ignore ordinary conversation.

### Dashboard loading
- Added the exact approved four-frame Ari untangling artwork as a route-loading sprite, including a static completed frame for reduced-motion users.
- Kept the artwork at its native four equal 3:4 frames rather than redrawing or approximating it.

### Quality and records
- Added the durable note-capture schema and guarded migration, pagination/Unicode tests, actor-isolation checks, ephemeral transport tests, group-routing coverage, loader-asset assertions, and safe ephemeral error recovery.
- Updated help, command references, README behavior notes, and the product journal with the observed friction, decisions, safeguards, and intended product effect.
- Passed all 547 backend tests in one worker, backend typechecking, production build, and Prisma schema validation; the coordinated dashboard gate passed all 12 tests, lint, and its production build, with a mobile Chromium visual check of the approved loader sequence.

## v0.25.0 - 2026-07-23

### Find a time
- Added focused group availability polls through `/findtime`, `/schedule`, the group menu, and natural requests such as “find a time for rehearsal next week for 90 minutes.”
- Added a shared, touch-friendly Mini App grid with date range, duration, time-zone handling, response progress, ranked overlaps, and explicit availability saving.
- Kept Telegram compact: one poll card is edited as responses arrive, managers can remind pending members or finalize a suggested slot, and the full grid stays in the Mini App/dashboard.
- Added active polls to Group Overview and confirmed meetings to Group Work without introducing a generic calendar or booking product.

### Permissions, privacy, and reliability
- Restricted poll creation, reminders, finalization, and closure to freshly verified Telegram owners/admins; active members can submit or revise only their own availability.
- Exposed aggregate overlaps and respondent names without returning another member's raw selected cells.
- Added optimistic revision checks, idempotent response updates, active-member filtering, local-day boundary protection, reminder cooldowns with recoverable delivery reservations, and graceful stale/closed-poll failures.
- Added optional per-member Google Calendar sync after finalization while keeping private event links out of the shared Telegram card.

### Quality
- Added the availability data model, migration, live dashboard revision tracking, authenticated scheduling API, safe Telegram Mini App deep links, and regression coverage for parsing, overlap ranking, card privacy, and snapshot validation.
- Avoided per-card Calendar lookups in poll lists and duplicate Telegram role checks in privileged callback paths.
- Passed 528 backend tests in one worker, backend typechecking and production build, 10 dashboard tests, dashboard lint and TypeScript checks, and the dashboard production build.
- Updated help, architecture, handoff notes, and the product journal with the Telegram coordination friction and deliberately limited scope.

## v0.24.0 - 2026-07-22

### Product focus
- Established **Capture, Coordinate, Recall** as Threadwise's product hierarchy and adopted: “Threadwise turns Telegram messages into things people can find, remember, and finish.”
- Removed Expenses and Excel from active menus, help, settings, image actions, status, and dashboard navigation while preserving their implementation and stored data for later evaluation.
- Kept Google Calendar available as a secondary task integration rather than a headline product category.

### Quiet capture
- Replaced routine task, note, and idea result cards with compact acknowledgements that remove themselves after about 3.5 seconds.
- Kept parsed dates, time zones, recurrence, and assignees visible when confirming tasks so users can still catch an incorrect interpretation.
- Limited self-cleaning behavior to successful capture acknowledgements; errors, warnings, item details, menus, and actionable controls remain visible.

### Identity
- Introduced the faceless threaded-path product mark and Ari, the related Threadwise mascot, as a two-part identity system.
- Reserved Ari for onboarding, empty states, and friendly recovery moments; normal product chrome uses the quieter corporate mark.
- Added scalable light/dark/full mascot artwork and a Telegram-ready 512×512 avatar asset in the dashboard repository.

### Quality and records
- Added timer and callback regression coverage for self-cleaning acknowledgements plus focused-copy, hidden-feature, and interpretation-preservation assertions.
- Recorded the observed capture friction, scope decisions, brand rationale, safeguards, and follow-up in the product journal.
- Verified the release with all 520 backend tests in a single worker, TypeScript typechecking, and a clean production build.

## v0.23.0 - 2026-07-22

### Integration lifecycle
- Replaced command-sequence onboarding with concise button-first Calendar and Excel panels in Telegram and direct provider management in the personal dashboard.
- Added contextual Calendar actions to dated task cards, including connect-and-sync intent preservation through OAuth, durable update/remove/open actions, recurrence-aware events, eligible-task backfill, and optional automatic synchronization.
- Made linked task edits patch the same Google event and made task cancellation ask whether to remove the linked event.
- Made first-time Excel connection create a recommended OneDrive workbook and import existing expenses, with open, retry sync, workbook setup, disconnect, and optional automatic synchronization for new expenses.
- Added deterministic natural-language actions for common Calendar and Excel goals without requiring command memorization.

### Product scope
- Retired Gmail from commands, menus, routing, callbacks, scheduled work, status, environment configuration, and active provider code.
- Kept legacy Gmail schema objects inert for a later separately reviewed retention migration instead of coupling product retirement to destructive data removal.
- Kept Calendar and Excel personal-only; group workspaces continue to expose only shared collaboration data.

### Reliability and records
- Kept Threadwise as the source of truth: external provider failures cannot discard a task or expense that was already saved.
- Expanded authenticated dashboard snapshots and routes with provider identity, sync coverage, auto-sync settings, task-level Calendar actions, and Excel workbook lifecycle controls.
- Added `docs/PRODUCT_JOURNAL.md`, reconstructed the major product phases from repository evidence, recorded the integration friction and rationale contemporaneously, and established a maintenance template for future decisions.

### Quality
- Added migration coverage for Calendar/Excel auto-sync preferences and OAuth return intent.
- Added regression coverage for dashboard integration state, selected-task OAuth authorization, disconnect settings, and live revision behavior.

## v0.22.1 - 2026-07-22

### Reminder navigation
- Added a `View full` button to scheduled reminder cards. It expands the current Telegram message in place and returns to the compact reminder with one tap.
- Reused the preserved capture text when older reminders do not have a separate description, so expanded reminders still show their full context.

### Quality
- Added regression coverage for the reminder-only expand action and the preserved-text fallback.

## v0.22.0 - 2026-07-22

### Group workspace boundaries
- Revalidated Telegram owner and administrator status at the moment a privileged dashboard action is attempted, so a recently demoted manager immediately loses access instead of inheriting a cached role.
- Restricted assigning or reassigning other people to Telegram group owners and administrators while preserving each member's ability to accept, decline, block, unblock, remove, or hand off their own assignment.
- Kept Expenses and personal integrations out of group dashboard snapshots, search, capture, and mutation routes; they remain private-workspace features.

### Quality
- Added regression coverage for live role demotion and unauthorized assignment creation, and verified the dashboard collaboration boundary against the shared Telegram records.

## v0.21.2 - 2026-07-21

### Fixed
- Prevented Prisma, provider, connection, stack-trace, and configuration details from leaking into Telegram replies; failures now use short recovery guidance appropriate to the error category.
- Added a final bot-wide error boundary so previously unguarded message handlers receive a normal failure reply and callback handlers receive a Telegram alert instead of silently dying.
- Stopped “Give me a reminder…” from being misread as “give task … to …”; task assignment through “give” now requires an actual task number or `TASK-…` reference.
- Preserved useful validation messages such as missing current list numbers while still hiding unexpected implementation failures.

### Quality
- Added regression coverage for the exact reported reminder phrase, task-assignment disambiguation, Prisma errors, database outages, unknown runtime failures, callback alerts, and message fallbacks.
- Verified all 513 tests and the production TypeScript build with one worker at a time.

## v0.21.1 - 2026-07-20

### Fixed
- Restored numbered Telegram note buttons: new list pages use short public note IDs, while note lookup also accepts the row UUIDs embedded in already-sent list messages.
- Added regression coverage for both newly generated and already-delivered note callbacks so opening a note remains backward-compatible across deployments.

## v0.21.0 - 2026-07-19

### Shared group work
- Added acknowledgement states for every task assignee: awaiting reply, accepted, declined, and blocked, including optional blocker or decline context.
- Added task handoffs, assignment activity history, compact `my tasks`, unassigned, and blocked views, plus natural-language equivalents for the same group workflows.
- Added group task buttons for accepting work and reporting a blocker without turning Telegram into a wall of controls.

### Group dashboard API
- Added member workload, attention, weekly movement, handoff, and activity snapshots backed by the same shared task records used by Telegram.
- Added authenticated assign, unassign, accept, decline, block, unblock, and handoff actions with role-aware permissions.
- Mirrored dashboard task and assignment changes back to the Telegram group quietly, while live dashboard events keep open browsers current.

### Quality
- Added a guarded Prisma migration for collaboration state and activity history.
- Verified all 502 bot tests, TypeScript typechecking, and the production build with a single-worker, low-load release pass.

## v0.20.0 - 2026-07-19

### Group workspaces
- Rebuilt `/start`, `/menu`, `/help`, `/commands`, `/privacy`, and settings around compact group-specific copy and controls instead of reusing the private-chat interface.
- Restored topic-specific `/help <topic>` guidance in groups and uses Telegram-compatible URL buttons for shared dashboards, since inline Mini App buttons are private-chat-only.
- Added durable group workspace and membership records while preserving the existing chat-scoped task, note, idea, image, expense, setting, and reminder ownership.
- Added Telegram role refreshes, membership lifecycle updates, admin-only group settings, and explicit separation from personal Gmail, Calendar, and Excel connections.

### Shared dashboard
- Added signed-human-to-shared-workspace authorization with opaque workspace selection and live Telegram membership verification.
- Added shared dashboard CRUD, capture, search, saved images, expenses, Idea Briefs, settings, and live update streams without allowing a group URL to address a private workspace.
- Kept personal integrations and destructive personal account controls unavailable in group scope.

### Quality
- Added regression coverage for compact group menus and help, personal/group owner validation, and live membership-gated dashboard resolution.
- Made group-safe keyboards unconditional: a missing workspace lookup now omits the dashboard URL instead of ever falling back to a private-only Mini App button.

## Unreleased - Database Connection Hardening

### Fixed
- Bounded the long-running Prisma pool to three connections and automatically use Supabase transaction pooling for runtime traffic, preventing a small session pool from being monopolized during Render deploys.
- Separated Prisma migration traffic through optional `DIRECT_URL`, limited migrations to one connection, and rejected accidental transaction-pooler migration URLs with a clear error.
- Added a read-only migration gate that skips the dedicated migration session only when every checked-in migration name is recorded as successfully applied and no migration is unfinished or rolled back.
- Moved database migrations into Render's pre-deploy command so the web process starts only after schema checks complete.

### Verified
- Retained Threadwise's existing singleton Prisma client and graceful `SIGTERM` disconnect path; Telegram users share the server pool rather than opening one permanent connection each.

## Unreleased - Dashboard Revamp Phase 3

### Changed
- Reworked Telegram task, note, and idea lists into three-item pages with compact summaries, a single numbered button row, and shorter pagination controls for mobile chats.
- Rebuilt opened task, note, and idea cards around a clear type, title, content, and essential context hierarchy; repeated titles, database IDs, captured-source blocks, and verbose settings metadata are no longer shown.
- Consolidated item actions into fewer rows and removed duplicate back buttons while preserving edit, pin, snooze, complete, archive, cancel, and Idea Brief controls.
- Updated post-edit and post-action cards in place with the same clean item layout and a single contextual return path.

### Quality
- Added regression coverage for compact page controls, de-duplicated task details, clean note and idea views, and the revised mobile button layout.

## Unreleased - Dashboard Revamp Phase 2

### Added
- Added saved AI Idea Briefs to the authenticated dashboard, using the bot's configured server-side AI provider to score buildability, usefulness, novelty, portfolio value, monetization, difficulty, and risk.
- Added durable image favourites with a guarded database migration, optimistic revision protection, and favourite-first ordering in both the dashboard gallery and Telegram image queries.
- Added right-click and ellipsis action menus for notes, ideas, and images, including edit, pin or favourite, convert, archive, and confirmed deletion flows.

### Changed
- Dashboard note and idea snapshots now preserve pinned ordering and saved idea analysis across refreshes and Telegram-driven updates.
- Image updates now support caption and favourite changes together without weakening the existing caption undo trail.
- Idea analysis is scoped exclusively from the signed Telegram subject; AI credentials remain server-side and are never exposed to the browser.

### Quality
- Added regression coverage for authenticated Idea Brief generation and persistence, image favourite revision guards, the idea-analysis route, and the expanded dashboard snapshot contract.

## Unreleased - Dashboard Revamp Phase 1

### Added
- Added one universal dashboard capture pipeline that reuses Threadwise's deterministic natural-language parser and AI structuring for tasks, notes, ideas, and expenses, including dotted clocks such as `1.30pm`.
- Added authenticated server-sent dashboard change events backed by lightweight revision fingerprints across tasks, notes, ideas, images, expenses, settings, and integrations.
- Added optimistic revision checks for dashboard task, note, and idea edits so a stale browser tab cannot silently overwrite a newer Telegram or dashboard change.
- Added first-class dashboard task snoozing and exposed snooze and reminder schedule state in dashboard snapshots.

### Changed
- Dashboard task collections now default to newest-first ordering while retaining pin priority.
- The dashboard API now exposes an explicit snapshot refresh route, capture preview route, and live event stream.

### Quality
- Added regression coverage for dotted-time capture, explicit capture modes, expense capture, live revision changes, and stale-edit conflict rejection.

## v0.19.4 - 2026-07-17

### Fixed
- Normalized legacy and new quiet-hour settings to canonical `HH:mm` values so one-digit hours cannot break the authenticated dashboard snapshot.
- Added a guarded database backfill and constraints for existing quiet-hour values.
- Made dashboard API serializers tolerate legacy clock values during rolling deployments.

## v0.19.3 - 2026-07-17

### Added
- Added an AI-powered Idea Brief button to Ideas mode and every saved idea card.
- Added a guarded Supabase Seoul-to-Singapore migration workflow with preflight, exact verification, retry safety, and rollback documentation.

### Changed
- Replaced the long settings manual with compact button-first reminder, region, language, integration, and privacy panels.

## v0.19.2 - 2026-07-17

### Fixed
- Open dashboard and gallery links as identity-bearing inline Telegram Mini Apps instead of unauthenticated simple keyboard Web Apps.
- Rotated the first-party dashboard signing key and prevented a stale multiline Render variable from shadowing the reviewed bundled public key.

## v0.19.1 - 2026-07-17

### Fixed
- Removed the legacy long-form onboarding response from `/start`; private chats now receive only a one-line shortcut confirmation followed by the compact interactive menu.

## v0.19.0 - 2026-07-17

### Added
- Replaced the crowded Telegram reply keyboard with one persistent `Menu` control and one direct `Dashboard` Web App control.
- Added compact, edit-in-place modes for tasks, notes, ideas, images, expenses, search, settings, help, and privacy, with five-item pagination and parent-aware navigation.
- Added a fresh bottom-anchored control card whenever the persistent Menu button is pressed, while retiring the previous menu card's buttons when Telegram permits it.
- Added `/dashboard`, `/privacy`, natural dashboard/privacy requests, production dashboard deep links, and plain-language privacy disclosures during onboarding.
- Added a subject-scoped dashboard API for collection pagination, CRUD actions, settings, search, idea-to-task conversion, Excel synchronization, integration disconnects, data export, and confirmed account deletion.
- Added an authenticated Telegram image proxy with bounded downloads, timeouts, safe raster MIME types, and defensive browser headers.

### Changed
- Tasks are now presented as the underlying object and reminders as their optional schedule, removing the previous task/reminder duplication from primary navigation.
- Typed edits return a fresh, complete item card with contextual actions. Button-driven edits keep updating the current card in place.
- Task IDs and reminder-delivery counts are hidden from normal cards and lists; durable IDs remain available to advanced slash-command workflows.
- Public IDs advance from the highest existing suffix so deleting an image or expense cannot cause an older identifier to be reused.

### Security
- Dashboard mutations derive the canonical user only from a short-lived signed Telegram subject; browser requests never supply a database user ID or receive database, bot, file, or OAuth credentials.
- Privacy exports omit provider tokens, Telegram file identifiers, embeddings, and raw provider credentials. Permanent deletion requires an exact confirmation phrase.

## v0.18.0 - 2026-07-17

### Added
- Expanded deterministic natural-language coverage for conversational list, reminder, task, note, idea, search, completion, snooze, reschedule, cancellation, importance, undo, and settings requests.
- Added dotted clocks such as `1.30pm` and `13.30`, spoken clocks such as `quarter past one`, parts of day, numeric day-first dates, weekday shorthand, `EOD`, `next week`, and `next month` without requiring an AI token.
- Added persistent Main menu and back routes across nested inline task, note, idea, image, expense, search, archive, settings, and help cards.

### Changed
- Telegram inline-button actions now update the current message card in place whenever Telegram permits it, instead of adding a new bot message for each step.

### Fixed
- Fixed dotted times such as `1.30pm` being reduced to `1:00 AM`; the exact minute and meridiem are now preserved.

## v0.17.1 - 2026-07-14

### Changed
- Completed the full Threadwise personality pass across tasks, notes, ideas, reminders, images, expenses, search, settings, archives, integrations, confirmations, empty states, errors, and undo flows.
- Added consistent semantic emoji to headings and buttons while keeping normal sentences and group reminders restrained.
- Reworked routine copy to lead with the outcome, use warmer plain language, and always explain the safest next step after an error or reversible change.
- Added a durable voice-and-tone guide for future features so new wording stays recognizably Threadwise.

## v0.17.0 - 2026-07-14

### Added
- Added a persistent private-chat menu beneath Telegram's reply box, with `/menu` to restore it and a `Hide menu` control. Group navigation remains inline and mention/reply-gated.
- Added editable image captions, caption prompts, duplicate-caption updates, and undo for caption changes.
- Added saved-image search across captions, local OCR text, and filenames through `/images <query>`, `/search images <query>`, and broad natural-language requests.
- Added `Save + extract`, which preserves the original image and saves searchable OCR text without an API key even when no note, task, reminder, or expense is created.
- Added confirmed image deletion and edit/delete controls beneath reopened images.

### Changed
- Refreshed primary menus, image flows, onboarding, and help with restrained semantic emoji and warmer wording while keeping button text explicit.
- Expanded image natural language for phrases such as `save this as Mum's passport scan`, `keep this image with caption July electricity bill`, `caption image 2 as July bill`, and `find images captioned passport`.
- Expanded image help with recurring reminder examples, caption/search/delete examples, and API-key-free OCR behavior.

## v0.16.0 - 2026-07-14

### Added
- Added optional original-image storage through Telegram file references. Uncaptioned images now offer Save image, Extract text, Read as receipt, and Discard buttons; saved images can be browsed 10 per page with `/images` and reopened with `/image IMG-1`.
- Added calendar-aware monthly recurring reminders, including natural phrasing such as `remind me to pay rent on the 1st of every month at 9am`.
- Added compact inline navigation menus to `/start` and `/help` for tasks, reminders, notes, ideas, images, expenses, integrations, settings, search, and cleanup.

### Changed
- Expanded local natural-language routing with polite wrappers, more verbs and list phrases, informal task/idea/note capture, completion/snooze/reschedule/cancel variants, and common shorthand cleanup.
- Expanded relative-time parsing to support hedged compound durations such as `in about 1 hour 15 mins`, `in roughly 2 hours and 30 minutes`, and `90 minutes from now` without an API token.
- Image help now explains original-image storage, local OCR, receipt extraction, saved-image browsing, and English/Burmese settings.

### Fixed
- New reminder nudges now replace the bot's previous reminder message for the same task when Telegram permits deletion, reducing repeated-message clutter without risking delivery.
- Compound duration parsing now ignores unrelated earlier uses of words such as `in`, so phrasing such as `buy groceries in town in 2 hours` remains schedulable.

## v0.15.1 - 2026-07-12

### Fixed
- Restored 10-row pagination with Prev/Next buttons for active tasks, saved notes, and saved ideas across both slash commands and natural-language list requests.
- Later pages now retain global list numbers, so the displayed number and commands such as `/task 11`, `/note 11`, or `/ideas 11` refer to the same item.
- Removed the old 15-item notes/ideas and 50-item tasks retrieval ceilings so older active items remain reachable through pagination.

## v0.15.0 - 2026-07-12

### Added
- Added several assignees per shared task through both natural language and slash commands, with backward-compatible migration of existing single assignments.
- Added optional private deadline nudges for assignees who have opened Threadwise privately and enabled `/settings dm on`.
- Added selective unassignment such as `remove @alex from task 2` and `/unassign 2 @alex`; omitting the person still clears all assignees.

### Changed
- Group reminders render every Telegram assignee as a clickable mention, while plain names remain available as display-only assignees.
- Assigned-task confirmations explain Telegram's one-time private-chat opt-in requirement.
- Expanded deterministic reminder parsing for phrases such as `remind Dad and @alex to check the bot at 10 pm`.

### Reliability
- Private nudge delivery is isolated from the group reminder: an unavailable or non-opted-in recipient is skipped without failing the shared reminder.
- Reminder diagnostics now report private nudges sent, skipped, and failed.

## v0.14.0 - 2026-07-12

### Added
- Added bulk task completion through natural phrases such as `complete tasks 1, 2 and 3` and slash syntax such as `/done 1 2 3`.
- Added bulk removal for tasks, notes, and ideas, including numeric ranges and stable public IDs.
- Added durable 15-minute bulk-action previews with itemized Confirm/Cancel buttons; only the requesting Telegram user can act on the preview.

### Changed
- Bulk “delete” stays recoverable by archiving tasks, notes, and ideas for `/restore`.
- Added a centralized group-update gate so disabling BotFather privacy does not expose ambient group conversation to capture, OCR, edits, or natural-language routing.

### Security
- Unaddressed group text, photos, image documents, and captions are discarded before feature handlers; slash commands, replies, and actual bot mentions remain allowed.

## v0.13.1 - 2026-07-12

### Fixed
- Corrected the group setup guidance: Telegram privacy-enabled bots receive commands and replies, but Telegram does not deliver ordinary sentences merely containing the bot's `@username`.
- `/groupcheck` now reports Telegram group privacy from the live bot identity and gives the exact BotFather `/setprivacy` instructions when it is enabled.
- Documented that Threadwise continues ignoring unaddressed group conversation after BotFather privacy is disabled.

## v0.13.0 - 2026-07-12

### Added
- Added per-user expense currency preferences with regional defaults, broad ISO-code support, common currency names/symbols, and natural settings such as `set my expense currency to MMK`.
- Added best-effort receipt currency detection with the user's saved currency as a fallback, including kyat/MMK markers and Myanmar digits.
- Added post-save expense corrections through `/expense edit EXP-2 currency USD` and natural phrases such as `change currency of EXP-2 to USD`.
- Added bundled Burmese Tesseract data for local, API-key-free English, Burmese, or mixed OCR, with saved preferences and per-image caption overrides.
- Added `/groupcheck` for deployed version, bot username, group ID, sender ID, and allowlist diagnostics.
- Added release version and Render commit metadata to `/health`.
- Finished the existing compact reminder mode with natural settings such as `use compact reminders` and `/settings mode compact`.

### Changed
- Changing timezone also changes the regional currency default when the user has not explicitly selected a custom currency.
- Telegram webhook registration now explicitly requests message, callback-query, and membership updates.

### Fixed
- Initialized the Telegram bot identity before webhook registration so the first group mention has the exact runtime username available to mention routing.
- Avoided duplicate Excel rows after correcting an expense that was already synchronized; Threadwise preserves the sync marker and explains that the old workbook row needs manual correction.
- Fixed natural `change currency of EXP-2 to MMK` wording so the value is applied to the currency field instead of being treated as an incomplete edit.

## v0.12.0 - 2026-07-12

### Added
- Added calendar-aware yearly recurrence and natural phrases such as `every Friday`, `on Fridays`, `every year`, `yearly`, and `annually`, alongside expanded daily wording such as `nightly`.
- Added deterministic recurring-reminder coverage for `remind me to sleep at 12 am daily`, `remind me to take out the trash every Friday at 7 pm`, and `remind me of my mom's birthday on 26 July every year`.
- Added addressed group examples for daily, weekday-weekly, and yearly recurrence, using the same natural-language parser as private chats.

### Fixed
- Fixed bot mentions beside punctuation by stripping the actual Telegram mention entity instead of relying only on surrounding whitespace.
- Addressed group greetings and unclear requests now receive a useful response instead of silently disappearing.
- Fixed recurring tasks advancing once on reminder delivery and again on completion; delivery now keeps the current occurrence active, and completion alone advances the schedule.
- Recurring schedules now advance by local calendar day, week, or year instead of fixed day counts, preserving the intended local time through calendar changes.
- Fixed same-day weekday reminders unnecessarily jumping to the following week when the requested time was still ahead.

## v0.11.2 - 2026-07-12

### Fixed
- Repeated completion presses are now idempotent: an already-completed task is not updated again and does not create another completion undo entry.
- Stale Complete buttons now respond with `Task already completed` and a dedicated Restore task button.
- Restoring a completed task reopens it, clears its completion timestamp, safely schedules its next reminder, and supports undo.
- Slash and natural-language completion requests use the same already-completed response instead of reporting a false new completion.

## v0.11.1 - 2026-07-12

### Fixed
- Fixed explicit reminders such as `remind me to finish all tasks by 9 pm` falling through to an undated ordinary task.
- Added deterministic clock parsing for `by`, `before`, `around`, `no later than`, and bare meridiem phrases such as `9pm`.
- Added more reminder starters including `notify me`, `I need a reminder`, `make sure I remember`, `don't forget`, and `reminder:`.
- Explicit reminder requests with a missing or unrecognized future time now ask for clarification instead of silently saving the wrong item type.
- Deadline wording is removed from the visible task title while remaining stored in the reminder details.

## v0.11.0 - 2026-07-12

### Added
- Added local image and receipt text extraction with Sharp preprocessing, bundled English Tesseract data, a 60-second timeout, safety limits, and no OCR or OpenAI API key requirement.
- Added image action previews for saving extracted text as a note, task, reminder, or expense, including caption-driven natural actions.
- Added durable Threadwise expenses with manual and receipt parsing, confirmation/edit/discard flows, duplicate receipt protection, and stable `EXP-*` IDs.
- Added newest-first expense retrieval with all/day/month/year filtering, 10-row pages, and Prev/Next buttons.
- Added broad natural expense capture and retrieval phrases such as `spent`, `paid`, `bought`, `record an expense`, and `what did I spend this month`.
- Added standalone `.xlsx` expense exports that require no Microsoft account.
- Added Microsoft OAuth and optional OneDrive Excel synchronization, automatic timestamped workbook creation, existing workbook selection, exact column validation, token refresh, and encrypted per-user tokens.
- Added focused `/help images`, `/help expenses`, and `/help excel` guidance plus `/expense`, `/expenses`, and `/excel` commands.
- Added database migrations and tests for image routing, expense parsing/filtering, Excel configuration, and real workbook generation.

### Changed
- Made the Threadwise database the expense source of truth; Excel synchronization is an optional mirror and a failed sync does not discard a confirmed expense.
- Made the main `/help` response compact and topic-based so the growing natural-language guide stays readable in Telegram.
- Updated the app description, Render blueprint, environment example, release status, and setup documentation for OCR, expenses, and Excel.

### Security
- Pinned ExcelJS's transitive UUID dependency to a non-vulnerable release; `npm audit` reports no known vulnerabilities.
- Microsoft access and refresh tokens are encrypted at rest with AES-256-GCM.

## v0.10.0 - 2026-07-12

### Added
- Added Google Calendar OAuth with encrypted per-user tokens, connection status/disconnect commands, and idempotent task event creation/update in the user's primary calendar.
- Added automatic fallback from Calendar API sync to the existing no-login template link and `.ics` export.
- Expanded deterministic natural-language coverage across the full command surface, including status/version, Gmail, calendar, search, lists, task actions, pins, archives, restore, edits, settings, ideas, and note analysis.
- Added natural capture phrases such as `write this down`, `remember that`, `I need to`, and `I have an idea for`, keeping common captures useful without an OpenAI token.
- Added polite and indirect reminder phrasing such as `could you remind me`, `don't let me forget`, `nudge me`, and `send me a reminder`.
- Added reminder parsing for word-based durations, half-hours, day-after-tomorrow, noon/midnight, month-first dates, and ordinal dates.
- Added first-class group task assignees with stored Telegram usernames/ids where available, visible `Assigned To` metadata, and `/assign`/`/unassign` plus natural assignment commands.
- Added daily and weekly recurring reminders from natural phrases like `remind me to have dinner at 7pm every day`; recurring tasks advance to the next occurrence after delivery.
- Added first-pass group chat support: group data is scoped to the chat, slash commands work in groups, natural-language messages require a bot mention or reply, and reminders are delivered back into the group.
- Added a natural-language `/help` capability guide and moved the compact slash-command list to `/commands`.
- Added deterministic help-question routing for phrases like `how do I set reminders?`, `help me with notes`, and `how do I view the command list?`.
- Added friendlier natural settings phrases such as `remind me again every 3 hours`, `warn me 10 mins before due tasks`, and `allow up to 200 reminders per day`.
- Added `/googlecal` plus natural phrases like `give me the google calendar link for TASK-1` to retrieve calendar links only when needed.
- Added natural-language list/detail/settings handling for parent-friendly phrases like `show me the notes`, `show me the tasks`, `change timezone to Myanmar`, `set reminder interval to 3 hours`, and `quiet hours off`.
- Added best-effort timezone defaults from Telegram language codes for new users where Telegram exposes a clear language signal.
- Added inline undo and cancel buttons to more task, capture, and edit flows.
- Added note archiving from note list/detail buttons, `/archive note 1`, `/remove NOTE-1`, and natural phrases like `delete note 1`, with undo support.
- Added deterministic-first capture helpers for clear reminders, tasks, notes, and ideas so common Telegram messages do not need OpenAI.
- Added weighted deterministic intent scoring with structured classification reasons in logs.
- Added bounded in-memory AI synthesis caching keyed by content hash.
- Added architecture documentation for deterministic-path time complexity, concurrent request behavior, and likely scaling bottlenecks.
- Added Gmail deterministic importance gating so ordinary unread mail does not spend AI quota.
- Added protected admin reminder run and status endpoints for cron or uptime fallback checks.
- Added `/important` as a friendlier task alias for `/pin`.
- Added `/version` with app version, deploy/start time, AI/Gmail status, and reminder delivery diagnostics.
- Added a tiny `/start` onboarding checklist for timezone, first task, and first note setup.
- Added in-memory reminder diagnostics for last run, due tasks found, reminders sent, quiet-hour deferrals, daily-cap skips, and delivery failures.

### Fixed
- Fixed addressed group messages with bot-mention punctuation so group mode can pass the same natural-language commands into the private-mode parser.
- Fixed group reminder wording like `@threadwise_1_bot remind us to...` and `@threadwise_1_bot remind @user to...` being routed as generic captures instead of scheduled reminders.
- Fixed group-chat bot mentions such as `@threadwise_1_bot remind @user to...` not reliably reaching natural-language reminder handling.
- Raised the default daily reminder safety limit from 5 to 200 so normal reminder-bot usage is not capped too aggressively.
- Improved task, note, idea, pin, review, archive, and reminder message formatting so content appears before IDs/dates and long Google Calendar URLs stay out of normal task cards.
- Fixed saved/archived/detail timestamps using the server timezone instead of the user's configured Threadwise timezone.
- Fixed `after 5 mins` reminder phrasing so it is treated like `in 5 mins`.
- Fixed `/note 1` so numeric note references open note details instead of saving a note titled `1`.
- Fixed reminder target cleanup for phrases like `remind me about the meeting after 5 mins` and `set a reminder for school at 9 am`.
- Renamed task action buttons from `Done` to `Complete task`/`Complete N` to reduce confusion with finishing the save flow.
- Fixed natural minute abbreviations such as `in 60 mins` not being treated as scheduled reminders.
- Fixed additional reminder phrasings such as `remind me about`, `please remind me to`, and `set a reminder for`.
- Fixed AI-backed captures going silent when OpenAI classification, structuring, or embedding calls fail; Threadwise now falls back to deterministic local heuristics.
- Fixed natural reminder text like `remind me to go out in 15 mins` and compact `/remind do this at 4 pm` parsing.
- Fixed OpenAI fallback rotation so rate-limited chat models cool down instead of being retried first on every request.
- Fixed duplicate Telegram update claims so expected duplicates no longer emit Prisma unique-constraint errors.

### Removed
- Removed the unused `OPENAI_EMBEDDING_MODEL` setting; embeddings are intentionally local and deterministic, so capture and search never spend embedding API quota.
- Removed the discontinued reflection feature from active AI classification, provider contracts, public ID generation, and service code.

## v0.9.0 - 2026-07-06

### Added
- Added paginated search results with Prev/Next buttons.
- Added `/search done <query>` and natural-language done-task search.
- Added `/reschedule` and natural-language task rescheduling.
- Added configurable due nudges with `/settings due-nudge <minutes>`.
- Added field editing for task details, note bodies, and idea concepts.
- Added timezone validation, aliases, and onboarding examples for non-Singapore users.
- Added optional Gmail read-only OAuth integration with unread scans, summaries, and follow-up tasks for important messages.
- Added paginated `/help` with Prev/Next buttons.
- Started tracking app release versions in package metadata and this changelog.

### Changed
- Dated reminders now start at `dueAt - dueNudgeMinutes` and repeat on that cadence until the task is done, snoozed, canceled, or rescheduled.
- Default search now shows open tasks only; completed tasks require an explicit done search.
- Hidden inferred tags from freshly saved note/idea cards and recent note/idea lists.
- `/start` now shows first-run onboarding with timezone setup, command examples, and natural-language usage.
- Timezone changes now recheck open tasks and update their display timezone without moving existing due instants.
- Removed the misleading digest setting from public settings help.
- Starred tasks now display as important and receive louder reminder messages with ❗ indicators.
- Paginated `/help` now lists commands alphabetically.

### Removed
- Removed the relationship/reflect command surface from help, commands, natural-language handling, and capture buttons.
- Removed legacy reflections from active search, review, archive, restore, and pin views.

### Fixed
- Fixed completed tasks appearing in normal search results.
- Fixed inline star/unstar buttons for notes and ideas.

## 2026-07-07

### Added
- Added inline star/edit controls for tasks, notes, and ideas.
- Added `/ideas` and idea detail views.
- Added private AI status endpoint and model fallback handling.
- Added note merge previews with retry, confirmation, archive metadata, and undo support.
- Added archived item browsing and restore commands.

### Changed
- Improved fallback note merge quality when OpenAI is unavailable.
- Improved task, note, and idea pinning workflows.

### Fixed
- Fixed reminder interval rescheduling.
- Fixed duplicate Telegram update handling.
- Fixed accidental `bot` tag inference from words like `both`.
