# Threadwise docs

The docs are grouped by what you want to do with them. If you are new, start with the tutorial.
The current review and plan of work is [REVIEW_2026-11-01.md](REVIEW_2026-11-01.md).

## Tutorial: learn the codebase

- [DEVELOPER_ONBOARDING.md](DEVELOPER_ONBOARDING.md): the new-developer map. Where to start reading and how a feature flows.

## How-to: runbooks and setup guides

- [CONTENT_ENCRYPTION.md](CONTENT_ENCRYPTION.md): turning on content encryption safely.
- [PHASE3_PRIVACY_RUNBOOK.md](PHASE3_PRIVACY_RUNBOOK.md): the privacy backfill and retention tooling. Not yet run in production.
- [PHASE4_STUDY_SCALE_RUNBOOK.md](PHASE4_STUDY_SCALE_RUNBOOK.md): activating the Study scale migration.
- [STUDY_TIMETABLE_SYNC_OPERATIONS.md](STUDY_TIMETABLE_SYNC_OPERATIONS.md): operating the Study Calendar mirror and timetable reminders.
- [SUPABASE_REGION_MIGRATION.md](SUPABASE_REGION_MIGRATION.md): moving the database to another region. Completed once in July 2026; kept as a reusable runbook.

Side projects (not part of the product):

- [STUDY_MODE.md](STUDY_MODE.md): using the owner's private Study mode.
- [BEACON.md](BEACON.md): setting up and operating the Beacon moderation bot.
- [PRIVATE_CODEX_MODE.md](PRIVATE_CODEX_MODE.md): setting up and using Telegram Codex mode and its laptop worker.
- [TELEGRAM_REMOTE_OPERATOR.md](TELEGRAM_REMOTE_OPERATOR.md): Codex mode access profiles, publishing and repair.
- [OWNER_FILE_COURIER.md](OWNER_FILE_COURIER.md): the owner-only `/files` laptop file courier.

## Explanation: how it works and why

- [ARCHITECTURE.md](ARCHITECTURE.md): the system top-down, with diagrams.
- [PRODUCT_JOURNAL.md](PRODUCT_JOURNAL.md): product decisions, the friction behind them, and their outcome.
- [TODAY_TASKS_AND_NOTE_SESSIONS_PRODUCT_SPEC.md](TODAY_TASKS_AND_NOTE_SESSIONS_PRODUCT_SPEC.md): the Today planning and Note session design.
- [VOICE_NOTE_CAPTURE.md](VOICE_NOTE_CAPTURE.md): how voice messages become notes.
- [SECURITY_REMEDIATION_ROADMAP.md](SECURITY_REMEDIATION_ROADMAP.md): the staged security plan and its gates.
- [PUBLIC_STUDY_ARCHITECTURE.md](PUBLIC_STUDY_ARCHITECTURE.md), [PUBLIC_STUDY_THREAT_MODEL.md](PUBLIC_STUDY_THREAT_MODEL.md) and [PUBLIC_STUDY_ROLLOUT.md](PUBLIC_STUDY_ROLLOUT.md): the approved, not yet built, design for a public Study bot.
- [PRIVATE_CODEX_IMPLEMENTATION_NOTES.md](PRIVATE_CODEX_IMPLEMENTATION_NOTES.md): how Telegram Codex mode was built and audited.
- [../CASE_STUDY.md](../CASE_STUDY.md): the product problem, decisions and outcomes.

## Reference: facts to look up

- [../CHANGELOG.md](../CHANGELOG.md): what changed in each release.
- [../prisma/schema.prisma](../prisma/schema.prisma): the database schema, the source of truth for fields.
- [../.env.example](../.env.example): every environment variable and its shape. [../render.yaml](../render.yaml) shows what Render sets.
- [VOICE_AND_TONE.md](VOICE_AND_TONE.md): copy and tone rules for Telegram and the dashboard.
- [../README.md](../README.md): commands, setup and deployment.

## Archive: finished work, kept for history

These describe work that is done. They are kept for evidence and are not kept up to date.

- [archive/WORKING_LOG_2026.md](archive/WORKING_LOG_2026.md): the working log and past implementation checkpoints. New log entries go at its top.
- Audits: [archive/POST_PHASE7_CODEBASE_AUDIT.md](archive/POST_PHASE7_CODEBASE_AUDIT.md), [archive/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md](archive/POST_RELEASE_CODE_UI_SECURITY_AUDIT_2026-08-31.md).
- Security evidence: [archive/SECURITY_PHASE2_PRIVACY_INSPECTION.md](archive/SECURITY_PHASE2_PRIVACY_INSPECTION.md), [archive/SECURITY_PHASE6_ASSURANCE.md](archive/SECURITY_PHASE6_ASSURANCE.md), [archive/GATE3A_RECOVERY_EVIDENCE.md](archive/GATE3A_RECOVERY_EVIDENCE.md).
- Bandwidth incident: [archive/BANDWIDTH_REPAIR_2026-09-12.md](archive/BANDWIDTH_REPAIR_2026-09-12.md), [archive/BANDWIDTH_REPAIR_2026-09-15.md](archive/BANDWIDTH_REPAIR_2026-09-15.md).
- Phase reports: [archive/PHASE1_3_TODAY_MORNING_UPDATE.md](archive/PHASE1_3_TODAY_MORNING_UPDATE.md), [archive/PHASE2_CROSS_MODE_EXPERIENCE.md](archive/PHASE2_CROSS_MODE_EXPERIENCE.md), [archive/PHASE2_TODAY_INTERACTIONS_IMPLEMENTATION_REPORT.md](archive/PHASE2_TODAY_INTERACTIONS_IMPLEMENTATION_REPORT.md), [archive/PHASE3_TODAY_DELIVERY_NOTES_IMPLEMENTATION_REPORT.md](archive/PHASE3_TODAY_DELIVERY_NOTES_IMPLEMENTATION_REPORT.md).
- Research and plans: [archive/COURSEMOLOGY_INTEGRATION_RESEARCH.md](archive/COURSEMOLOGY_INTEGRATION_RESEARCH.md), [archive/CASE_STUDY_PREPRODUCTION_PLAN.md](archive/CASE_STUDY_PREPRODUCTION_PLAN.md).

Paths inside archived documents are as they were when written. A `docs/NAME.md` path that no longer
exists has usually moved to `docs/archive/NAME.md`.
