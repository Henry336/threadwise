-- Normalize legacy one-digit hours before enforcing the dashboard contract.
UPDATE "UserSettings"
SET "quietHoursStart" = lpad(split_part("quietHoursStart", ':', 1), 2, '0') || ':' || split_part("quietHoursStart", ':', 2)
WHERE "quietHoursStart" ~ '^[0-9]{1,2}:[0-9]{2}$'
  AND "quietHoursStart" !~ '^[0-9]{2}:[0-9]{2}$';

UPDATE "UserSettings"
SET "quietHoursEnd" = lpad(split_part("quietHoursEnd", ':', 1), 2, '0') || ':' || split_part("quietHoursEnd", ':', 2)
WHERE "quietHoursEnd" ~ '^[0-9]{1,2}:[0-9]{2}$'
  AND "quietHoursEnd" !~ '^[0-9]{2}:[0-9]{2}$';

ALTER TABLE "UserSettings"
  ADD CONSTRAINT "UserSettings_quietHoursStart_clock_check"
  CHECK ("quietHoursStart" IS NULL OR "quietHoursStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "UserSettings_quietHoursEnd_clock_check"
  CHECK ("quietHoursEnd" IS NULL OR "quietHoursEnd" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
