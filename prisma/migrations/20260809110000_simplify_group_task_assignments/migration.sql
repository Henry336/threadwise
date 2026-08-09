-- Assignments now take effect immediately. Keep legacy activity rows as audit history,
-- but normalize the current assignment projection used by reminders and dashboards.
UPDATE "TaskAssignee"
SET
  "status" = 'ACCEPTED',
  "statusReason" = NULL,
  "respondedAt" = COALESCE("respondedAt", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" <> 'ACCEPTED';
