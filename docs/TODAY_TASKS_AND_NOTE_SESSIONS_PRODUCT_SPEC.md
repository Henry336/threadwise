# Today planning, carryover, briefings, and Note sessions

Status: accepted product direction; **Phase 3 delivery and Note refinements implemented on guarded branches**.

Recorded: 28 August 2026 SGT.

This specification captures the owner's agreed direction for making Threadwise a calmer external
working memory across Individual, Group, and Study. Phase 1 now supplies additive planned dates,
durable cross-mode drafts, agenda composition, brief preferences/delivery idempotency, and owner-gated
API contracts. Phase 2 adds owner-gated Telegram batch review, focused corrections, atomic saving,
`/today`, carryover re-planning, exact draft links, and one responsive dashboard Today planner shared
by Individual, Group, and Study. Phase 3 adds opt-in private scheduled delivery, proactive expired-card
replacement, two-step carryover prompts, dashboard briefing consent, and a persistent one-hour private
Note session. Shared group digests and optional cleanup copies remain future work; nothing here implies
production migration, deployment, or enablement.

## Product promise

Tell Threadwise once. It remembers what the user intends to do, surfaces it at the right time, and
only interrupts when the user asks it to.

Do not introduce a competing `Todo` entity. A to-do is a view of an existing actionable record.
The shared concepts are:

- **Task/work item:** something actionable.
- **Planned day:** when the user intends to work on it; optional and independent of its deadline.
- **Deadline:** the latest acceptable completion time; optional and never inferred from a planned day.
- **Reminder:** explicit permission to interrupt at a time or condition; creating a task does not
  automatically create a reminder.
- **Note:** information to retain rather than an action to complete.
- **Timetable block:** reserved time, not a task or reminder.

The default natural-language task capture plans work for Today unless the user supplies another day
or explicitly asks for no day. Unscheduled tasks remain in All Tasks but do not carry over. Carryover
is derived from an open task whose planned day is before today; it is not a copied task and it retains
the original planning history. Briefings summarize state. Reminders interrupt only when explicitly
configured or when an existing, separately enabled deadline policy applies.

## Cross-mode interpretation

- **Individual:** the complete Today experience: personal planned work, carryover, due-soon context,
  morning brief, evening debrief, and private Note sessions.
- **Group:** the same task semantics plus ownership and collaboration. Personal briefings remain
  private; a shared group digest is separate and opt-in. Group carryover must never expose a member's
  unrelated personal work.
- **Study:** planning a Study work item adds an intended work day without changing its Canvas or local
  deadline. Existing matching Study work should be planned rather than duplicated. Today composes
  planned academic work, classes, and trustworthy deadline context.

## Interaction rules

- Preserve Threadwise's existing rule: one message, one decision.
- Use one primary action, one likely continuation, and one progressively disclosed route to
  secondary controls.
- A normal task-draft review exposes `Save N`, `Add more`, and `Edit details`; date/deadline/remove/
  discard controls live inside the focused edit flow.
- `Add more` starts a short-lived explicit batch-capture state. Incoming messages append to the
  pending draft until the user reviews it. Nothing is saved before approval.
- If one ambiguity blocks correct interpretation, replace the generic edit action with one focused
  clarification, such as `Plan for Friday` versus `Due Friday`.
- Abandoned drafts expire without creating partial tasks or reminders.
- Morning and evening messages are bounded digests, skip empty states, respect timezone and quiet
  hours, and remain independently configurable.
- Passive Note capture is private. It must not swallow a group's unrelated messages.
- Note-session storage preserves exact paragraphs by default. Optional cleanup creates a preview or
  derived copy; it never silently overwrites the source.

## Executable acceptance strategy

The behavioural conversation below is the source of truth, but prose review is not sufficient. Before
merge or rollout, every material outcome must be represented by a named automated test at the lowest
useful layer, with end-to-end coverage reserved for visible cross-layer behaviour.

### Level 1 — parser tests

- Distinguish a planned day from a deadline and from an explicit reminder; never infer one from
  another.
- Preserve the no-day/Unscheduled path and return a focused ambiguity warning for a bare date that
  cannot be classified safely.
- Exercise local-day boundaries immediately before and after midnight, a runtime timezone change,
  and at least one DST-observing IANA zone across both the spring-forward gap and fall-back overlap.

### Level 2 — service tests

- Prove batch approval is all-or-nothing, including one invalid item among otherwise valid items.
- Prove an `Add more` draft survives a bot/process restart and resumes from durable state.
- Prove Carryover is derived without duplication and retains both the original and current plan.
- Prove morning/evening delivery is idempotent under repeated polling, duplicate Telegram updates,
  and callback replay.
- Prove disabled briefing settings and quiet hours produce no delivery, including quiet hours that
  cross midnight.
- Prove members without a private bot relationship do not receive private briefs or leaked private
  content.
- Prove Canvas matching plans the existing Study item, avoids a duplicate, and preserves the Canvas
  deadline exactly.
- Prove actor and workspace authorization rejects cross-workspace reads, edits, approvals, agenda
  access, and carryover actions for drafts/items the principal does not own.

### Level 3 — Telegram and dashboard tests

- Replay the visible dialogue below and assert the one-message/one-decision rule and the normal
  three-button budget: `Save N`, `Add more`, and `Edit details`.
- Assert stale or replayed callbacks remain harmless and display an understandable expired/already
  handled state rather than duplicating data.
- Assert Telegram and dashboard deep links open the exact authorized draft, task, or note and fail
  closed for another workspace or principal.
- Assert briefing controls are accessible, remain private to Personal settings, default disabled,
  use the branded time picker, and remain usable at mobile and laptop breakpoints.
- Assert Today/Carryover/Deadline-watch cards and focused editors remain keyboard accessible and do
  not overflow or hide required actions at supported responsive widths.

### Required edge-case matrix

The merge/release gate is incomplete until executable tests cover all of the following: midnight;
timezone changes; DST gap and overlap; restart during `Add more`; duplicate update and callback replay;
one invalid batch item; no private bot relationship; Canvas matching with deadline preservation;
quiet hours; disabled briefings; and cross-workspace draft/agenda access attempts. Existing unrelated
coverage does not count unless its assertions exercise this Phase 1–3 path directly.

## Behavioural acceptance run

Assume it is Monday in Singapore and Individual mode is active unless a scenario says otherwise.
Button labels describe expected controls; exact typography may adapt to the established design system.

### 1. Capture several tasks

**User:**

> Start CS2103T IP Week 3 increments, Prepare for CS2102 Tutorial 1, Buy veg and bacon from NTUC Fairprice

**Bot:**

```text
Add 3 tasks to Today?

□ Start CS2103T IP Week 3 increments
  Plan: Today · No deadline

□ Prepare for CS2102 Tutorial 1
  Plan: Today · No deadline

□ Buy veg and bacon from NTUC Fairprice
  Plan: Today · No deadline

[Save 3] [＋ Add more] [Edit details]
```

Expected: nothing is saved yet; all three default to Today; no deadline or reminder is created.

### 2. Continue adding before saving

**User:** taps `＋ Add more`.

**Bot:**

```text
Adding to this list · 3 tasks waiting

Send more tasks in one or several messages.
Nothing will be saved until you review and approve it.

[Review list]
```

**User:**

> Email the project group

**Bot:** silently appends it and edits the existing status to `4 tasks waiting`.

**User:**

> Return library book tomorrow, Submit CFG reflection by Wednesday at 6 PM

**Bot:** silently appends both and edits the existing status to `6 tasks waiting`.

**User:** taps `Review list`.

**Bot:**

```text
Review 6 tasks

TODAY

□ Start CS2103T IP Week 3 increments
□ Prepare for CS2102 Tutorial 1
□ Buy veg and bacon from NTUC Fairprice
□ Email the project group
□ Submit CFG reflection
  Deadline: Wed, 6:00 PM

TOMORROW

□ Return library book
  No deadline

[Save 6] [＋ Add more] [Edit details]
```

Expected: `by Wednesday` is a deadline; `tomorrow` is a planned day; the preview distinguishes them.

### 3. Edit one task without presenting every control

**User:** taps `Edit details`.

**Bot:**

```text
What should I change?

You can reply naturally, for example:
• Move task 3 to Saturday
• Give task 2 a Friday deadline
• Remove task 4

[Back to review]
```

**User:**

> Move task 3 to Saturday

**Bot:**

```text
Updated:

Buy veg and bacon from NTUC Fairprice
Plan: Saturday · No deadline
```

Expected: the consolidated review returns; no new stack of equal-priority buttons appears.

### 4. Save the complete draft

**User:** taps `Save 6`.

**Bot:**

```text
Saved 6 tasks

Today: 4
Tomorrow: 1
Saturday: 1
Deadlines added: 1

No reminders were created.

[View Today]
```

Expected: all writes occur atomically enough to avoid an unexplained partial batch; the draft closes.

### 5. View Today

**User:** `/today`

**Bot:**

```text
Today's To-Do List

□ Start CS2103T IP Week 3 increments
□ Prepare for CS2102 Tutorial 1
□ Email the project group
□ Submit CFG reflection

Carryover

None

Deadline watch

• Submit CFG reflection
  Due Wednesday at 6:00 PM

[Plan my day] [All tasks]
```

Expected: deadline context is visible without creating another alert.

### 6. Create an intentionally unscheduled task

**User:**

> Add “Replace worn-out charger”, but don't assign it to a day

**Bot:**

```text
Add this task?

□ Replace worn-out charger
  Plan: Unscheduled · No deadline

[Save task] [＋ Add more] [Edit details]
```

**User:** taps `Save task`.

**Bot:**

```text
Saved under Unscheduled.

It will remain in All Tasks, but it will not appear in Today,
carry over, or produce reminders.
```

### 7. Resolve an ambiguous date

**User:**

> Finish database lab Friday

**Bot:**

```text
What does Friday mean?

Finish database lab

[Plan for Friday] [Due Friday]
```

Expected: Threadwise asks one material question rather than silently interpreting a planned day as a
deadline.

### 8. Morning brief with carryover

Assume Tuesday arrives and `Prepare for CS2102 Tutorial 1` remains open.

**Bot:**

```text
Good morning

TODAY

□ Return library book

CARRYOVER

□ Prepare for CS2102 Tutorial 1
  Originally planned Monday · Carried for 1 day

DEADLINE WATCH

• Submit CFG reflection
  Due tomorrow at 6:00 PM

Nothing else needs your attention.

[Open Today] [Plan carryover]
```

**User:** taps `Plan carryover`.

**Bot:**

```text
Prepare for CS2102 Tutorial 1

Do you want to work on it today?

[Do today] [Choose another day]
```

**User:** taps `Do today`.

**Bot:**

```text
Moved to Today.

Its original Monday plan remains in the task history.
```

Expected: carryover is derived from the same unfinished task; no duplicate is created.

### 9. Create a real reminder for an existing task

**User:**

> Remind me tomorrow at 5 PM to return the library book

**Bot:**

```text
Reminder set

Return library book
Tomorrow at 5:00 PM

Plan: Tuesday
Deadline: None
```

At the requested time:

**Bot:**

```text
Return library book

You asked me to remind you now.

[Complete] [Later]
```

**User:** taps `Later`.

**Bot:**

```text
What should happen next?

[In 1 hour] [Choose time] [Dismiss reminder]
```

Expected: the reminder attaches to the existing task. Secondary reminder controls appear only after
the focused `Later` decision.

### 10. Evening debrief

**Bot:**

```text
Evening check-in

Completed today: 3

Still open

□ Prepare for CS2102 Tutorial 1
□ Submit CFG reflection

Deadline watch

• Submit CFG reflection
  Due tomorrow at 6:00 PM

Nothing will be moved automatically.

[Plan remaining] [Close]
```

**User:** taps `Plan remaining`.

**Bot:**

```text
Tell me what to do with the remaining tasks.

For example:
“Move task 1 to tomorrow and leave task 2 carried.”
```

**User:**

> Move task 1 to tomorrow and leave task 2 carried

**Bot:**

```text
Updated

• Prepare for CS2102 Tutorial 1 → Tomorrow
• Submit CFG reflection → Remains in Carryover

The Wednesday deadline is unchanged.
```

### 11. Private Note session

**User:** `/note_session`

**Bot:**

```text
Note session started

Send as many text messages as you need.
Each message becomes one paragraph.

I will stay quiet while you write.
The note auto-saves after 1 hour of inactivity.

[Save & finish] [Cancel session]
```

**User:**

> The distinction between planning dates and deadlines is important.

**Bot:** no chat reply; the persistent session indicator becomes `1 paragraph captured`.

**User:**

> A task can be planned for today without being due today.

**Bot:** no chat reply; the indicator becomes `2 paragraphs captured`.

**User:**

> Remember to explain this clearly during testing.

**Bot:** captures the sentence as note text; it does not create a task.

**User:** taps `Save & finish`.

**Bot:**

```text
Note saved · 3 paragraphs

Stored exactly as written.

[Open note]
```

Expected: optional cleanup is a later preview or derived copy, never a silent rewrite.

### 12. Study-mode behaviour

**User:**

> Prepare for CS2102 Tutorial 2 tomorrow

**Bot:**

```text
Add Study work?

Prepare for CS2102 Tutorial 2

Module: CS2102
Plan: Tomorrow
Deadline: None

[Save] [＋ Add more] [Edit details]
```

If matching work already exists:

**User:**

> Plan Combinational Circuits Quiz 1/2 for today

**Bot:**

```text
Added the existing Canvas task to Today.

Combinational Circuits Quiz 1/2
Plan: Today
Canvas deadline: 13 October at 11:59 PM

No duplicate was created.
The Canvas deadline was not changed.
```

### 13. Group-mode behaviour

**User:**

> @Maya prepare the presentation slides tomorrow

**Bot:**

```text
Add shared task?

Prepare the presentation slides

Assigned to: Maya
Plan: Tomorrow
Deadline: None

[Save] [＋ Add more] [Edit details]
```

**User:** taps `Save`.

**Bot:**

```text
Shared task added for tomorrow.
Maya will see it in her personal brief.

No reminder was created.
```

Expected: a member's personal carryover remains private. A shared group digest is a separate opt-in
workspace setting.

### 14. Abandoned draft

**User:**

> Buy shampoo, fix the loose cupboard hinge

**Bot:** shows the two-task review card. The user leaves without saving.

After the draft timeout, the existing card is quietly edited:

```text
Draft expired · Nothing was saved.
```

Expected: no task, reminder, or partial batch is created.

## Acceptance invariants

- Planned days never masquerade as deadlines or overdue states.
- Task capture never creates an implicit reminder.
- Batch drafts are durable enough to survive process restarts, scoped to their actor/workspace, and
  write their approved tasks in one database transaction.
- One failed row returns the draft for correction instead of silently saving a partial list.
- Carryover is derived without task duplication and preserves auditable planning history.
- Brief and debrief deliveries are idempotent per user, local date, and briefing kind.
- Exact task links and actions remain authorized at use time.
- Group visibility and assignee notifications cannot leak Individual work.
- Study planning cannot overwrite provider-owned deadlines or create duplicate Canvas work.
- Note sessions keep exact source text and preserve the existing private ownership boundary.
- Straightforward capture, planning, briefing, and reminder behaviour remains deterministic and fully
  usable without a paid AI provider.

## Decisions finalized across Phases 1–3

- Morning and evening preferences default disabled; stored defaults are 08:00 and 21:00 local time.
  A later client must obtain explicit consent before enabling either delivery.
- Batch-draft inactivity duration is 10 minutes, refreshed by explicit Add more/review/edit activity.
- Private Note-session inactivity is one hour. A single persistent status card shows its paragraph
  count and becomes the final Save, Cancel, or auto-save state.
- Carryover appears immediately. A two-step decision is always available, and work carried for three
  days receives stronger re-planning copy without more frequent notifications.

## Decisions still open for later phases

- Whether shared Group digests should receive their own explicit workspace opt-in after private briefs
  have been tested with real users.
- Whether Note cleanup is valuable enough to justify a previewed derived-copy flow. Exact source text
  must remain untouched either way.
