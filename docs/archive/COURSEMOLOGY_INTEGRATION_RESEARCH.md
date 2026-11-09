# Coursemology integration feasibility

Status: researched on 2026-08-17; no Coursemology connection, credential, schema, or production
state was created or changed.

## Conclusion

Tracking Coursemology assessments and deadlines in Threadwise is technically feasible, but the
current official surface is not equivalent to Canvas's documented access-token API. Coursemology's
authenticated web client already reads course lesson-plan JSON containing stable item IDs, titles,
paths, publication state, and per-user `start_at`, `bonus_end_at`, and `end_at` timestamps. Its lesson
plan automatically includes assessments, so that dataset is a strong assignment/deadline source.

The official help and source surfaces inspected did not reveal a documented public student API,
third-party OAuth application flow, webhook, or iCalendar feed. The existing JSON routes are built
for Coursemology's own React client and use its signed-in user's bearer token, cookies, and CSRF
flow. Threadwise must not ask users to paste browser cookies or copy short-lived browser tokens into
Telegram or the dashboard.

## Evidence

- Coursemology documents assessments, submissions, course materials, and lesson plans. It states
  that assessments appear on the lesson plan automatically and are positioned by start date:
  <https://coursemology.github.io/coursemology-help/additional/lesson-plan>.
- Coursemology is open source and currently comprises a Keycloak authentication provider, Rails
  application server, and React client: <https://github.com/Coursemology/coursemology2>.
- `GET /courses/:course_id/lesson_plan` is an authenticated JSON route used by the first-party
  client: <https://github.com/Coursemology/coursemology2/blob/master/config/routes.rb> and
  <https://github.com/Coursemology/coursemology2/blob/master/client/app/api/course/LessonPlan.js>.
- Lesson-plan JSON includes `id`, `title`, `published`, `start_at`, `bonus_end_at`, and `end_at` for
  the current course user:
  <https://github.com/Coursemology/coursemology2/blob/master/app/views/course/lesson_plan/items/_item.json.jbuilder>.
- The first-party browser client attaches a Keycloak-derived bearer token, credentials, and CSRF
  token handling rather than exposing a documented third-party token contract:
  <https://github.com/Coursemology/coursemology2/blob/master/client/app/api/Base.ts>.

The absence claim is deliberately narrow: no supported external contract was found in the official
help, routes, and browser API/authentication code inspected. An NUS-hosted Coursemology instance may
have institution-specific integrations that are not present in the public repository.

## Safe options, in preference order

1. **Ask the Coursemology/NUS instance operator for a supported read-only integration.** Request an
   OAuth client or scoped service endpoint that returns the signed-in student's course list and
   lesson-plan items. This is the durable option and avoids collecting browser session material.
2. **Contribute a minimal read-only OAuth/export surface upstream.** Because Coursemology is open
   source, a scoped endpoint or per-user calendar feed could be proposed. It should expose only
   enrolled courses and published lesson-plan items, use revocable grants, and publish a versioned
   contract.
3. **User-imported calendar/export feed, if the deployed instance adds one.** Threadwise can poll a
   revocable per-user URL server-side and map events idempotently. The current official source did
   not show such a feed, so this is a future capability rather than an available setup step.
4. **Notification-email ingestion as a bounded fallback.** Parse forwarded Coursemology deadline
   notifications with explicit user confirmation. This is incomplete and should be labelled as
   notification-derived, not an authoritative sync.

Do not implement browser automation, password storage, copied cookies, or token scraping. Those
approaches are fragile, may conflict with institutional policy, and create a much larger credential
and account-takeover risk than the value of deadline sync justifies.

## Threadwise implementation shape after operator confirmation

Do not add another Canvas-shaped singleton. Introduce a provider-neutral, tenant-scoped learning
source boundary first:

- `LearningProviderConnection`: provider, workspace/tenant, encrypted credential or grant
  reference, scopes, status, expiry, last successful sync, and revocation state.
- Provider course mapping: stable external course ID to one Threadwise Study module.
- Provider work mapping: stable `(provider, connection, external item ID)` identity, source URL,
  source timestamps, due/start/end time, publication state, last-seen time, and local override flags.
- Connector contract: `verify`, `listCourses`, `listWork`, and optional `listMaterials`, with bounded
  pagination, timeouts, retry/backoff, and redacted errors.
- Sync semantics: incremental, idempotent, restart-safe, single-flight per connection, and
  conservative about missing items. A missing remote item enters review before local archival.
- Security: credentials remain server-side and encrypted; browsers and Telegram never receive
  provider secrets. Logs, audits, and user-facing errors must redact tokens and cookies.

The first Coursemology milestone should be a read-only connector against a synthetic or operator-
provided test account. Assignment submission, grading, or write access is explicitly out of scope.

## Decision gate

Before implementation, obtain one of:

- written confirmation and documentation for an NUS/Coursemology read-only API or OAuth flow; or
- agreement from the Coursemology maintainers/instance operator to add a versioned read-only export.

Until then, keep Coursemology as a researched candidate provider and do not collect credentials.
