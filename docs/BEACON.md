# Beacon Community Moderator

Beacon is a second Telegram bot identity that runs inside the existing Threadwise Node.js service. It reuses the paid Render process and PostgreSQL connection, but it does not present itself as Threadwise and does not expose a dashboard.

## Product boundary

Beacon is designed for one English/Burmese scholarship-information community and its private testing group. It is not a generic public moderation platform.

- Exact chat IDs form the allowlist. Beacon ignores every other group.
- The owner is read from `BEACON_OWNER_TELEGRAM_ID` and cannot be changed from Telegram or the database UI.
- Only the owner can add, remove, or edit moderators.
- Moderator-management permission does not exist and therefore cannot be delegated.
- Policies and moderator permissions are scoped independently to each configured group.
- Policies apply across every forum topic in that group. Reports, warnings, actions, and audit context retain the originating topic, but there are deliberately no topic-specific policy overrides yet.
- The testing group starts in Observe mode. Add the production group only after the policy is proven.

## Capabilities

- Delete join/leave service messages when Telegram grants delete rights.
- Show editable English and Burmese rules with `/rules`.
- Normalize Zawgyi to Unicode before matching Burmese policy text.
- Match configurable whole words, phrases, and domains.
- Create, rename, and delete empty trigger groups without a deploy.
- Select and privately manage any authorized community from Beacon's direct chat.
- Search and filter a paginated private trigger library by text, action, or trigger group.
- Keep that trigger library owner-only. Moderators may privately submit a proposed trigger, but cannot enumerate, remove, move, or reclassify the hidden policy pool.
- Add, test, move, and delete triggers from Telegram without exposing the policy list in the group.
- Let authorized moderators submit new triggers to a review-only Watchlist; the owner privately approves, reclassifies, or removes each submission before it can enforce anything.
- Configure review, delete-and-warn, temporary mute, or ban actions with confirmation.
- Observe matches without affecting members.
- Aggregate duplicate reports of one message into one private review card.
- Show the flagged text, source topic, member identity, Telegram user ID, active offence score, and report count on the compact review card; open offence history only when requested.
- Let moderators propose a severity and incident score while reserving confirmation, severity-point policy, thresholds, reductions, pardons, and permanent bans for the immutable owner.
- Restore owner-confirmed permanent bans when the same Telegram account rejoins, until its active banning offence is pardoned.
- Purge one non-General forum topic through an owner-only, expiring confirmation that deletes and recreates the topic while preserving known name/icon metadata.
- Warn, delete, mute, or ban from a report according to the moderator's capabilities.
- Undo reversible mute and ban actions.
- Apply flood, duplicate-message, and mass-mention controls.
- Exempt trusted members from automatic controls.
- Pause new-member posting or activate a confirmed emergency lockdown.
- Suspend a moderator's Beacon access automatically after they leave the group.
- Record policy and permission changes durably and DM the owner.

## Render environment

Beacon remains disabled unless both its token and owner ID exist. This lets the same commit deploy safely before the BotFather setup is complete.

```text
BEACON_BOT_TOKEN=<BotFather token>
BEACON_OWNER_TELEGRAM_ID=5969845149
BEACON_TEST_CHAT_ID=<negative testing-group ID>
BEACON_PRODUCTION_CHAT_ID=<negative production-group ID; omit during testing>
BEACON_MODERATOR_CHAT_ID=<optional private moderator-review group ID>
BEACON_WEBHOOK_SECRET_PATH=/telegram/beacon-webhook
```

`BEACON_WEBHOOK_SECRET_PATH` must differ from the primary `WEBHOOK_SECRET_PATH`.

## BotFather and Telegram setup

1. Create a new bot identity in BotFather and copy its token directly into Render.
2. Run `/setprivacy`, select Beacon, and choose **Disable**. Policy matching requires ordinary group messages.
3. Add Beacon to the private testing group as an administrator.
4. Grant **Delete messages** and **Ban users**. These rights cover removal, warning cleanup, mute, ban, lockdown, and service-message cleanup. Grant **Manage topics** if the owner will use `/purge`. Grant **Invite users** if moderators must undo bans.
5. Start Beacon once in a private chat from the owner account. Telegram otherwise prevents the owner audit DMs.
6. Optionally create a private moderator-review group, add Beacon and the moderators, and put its ID in `BEACON_MODERATOR_CHAT_ID`.
7. Add the Render variables, then use **Save, rebuild, and deploy**.

Do not paste the BotFather token into Telegram, source control, screenshots, or issue reports.

## First live test

Keep Observe mode enabled for this test.

1. In the configured testing group, send `/beacon`, `Beacon`, `Hey Beacon`, or `menu`.
2. Press **Private controls**. Beacon's private chat remembers the selected group and always shows which community is being managed.
3. Open **More → Moderators → Add moderator** and send the intended person's numeric Telegram ID.
4. Choose **Use safe recommended permissions**, review the result, and confirm. Verify the owner receives a private audit DM.
5. Open **Policy → Trigger library**, choose **Add trigger**, and add a harmless unique phrase such as `beacon-policy-test-8362` to a review-only group.
6. Use **Test message** to confirm the match without affecting a member.
7. Grant a test moderator only **Add triggers for review**. Have them submit a second harmless phrase privately and verify it cannot match until the owner approves it from the private DM.
8. Send the approved phrase normally and confirm an Observe notification arrives privately.
9. Reply to a harmless message with `/report`. Confirm the public command disappears, the reporter receives a private acknowledgement, and one private review card appears with its topic when applicable. Verify the card initially shows only **Dismiss**, **Take action**, and **Offence history**.
10. Report the same message again from the same account and verify no duplicate case is created.
11. Remove the test moderator from the group and verify Beacon suspends their permissions and DMs the owner.
12. Open **Policy → Offence scoring** in the owner's private controls, adjust only harmless test values, propose an offence through **Take action**, and verify the owner must confirm it before the score counts.
13. In a disposable non-General topic, run `/purge`, cancel once, then confirm once. Verify only that topic is recreated empty and the owner receives an audit DM. Never use a topic containing evidence you still need.

Only after those checks should the owner turn off Observe mode or configure the production group.

## Moderator permissions

The safe preset grants delete/warn and temporary mute. It does not grant permanent ban; rule editing; trigger submissions; hidden trigger-library access; trigger-group management; automatic-action changes; trusted-member management; or lockdown.

`Add triggers for review` never makes a submitted trigger active: it enters the Watchlist, privately alerts the owner, and waits for approval. The library itself, trigger removal/reclassification, severity-point policy, enforcement thresholds, and moderator management are owner-only and are not grantable.

## Telegram control plane

Beacon has no dashboard. Its complete control plane remains in Telegram, organized around progressive disclosure.

The ordinary group card contains only **Rules** and **How to report**. Authorized staff additionally receive a deep link to private controls; ordinary members do not see report queues, triggers, scores, audits, safety settings, or moderator configuration.

The owner's private home contains **Review queue**, **Members & offences**, **Policy**, and **More**. Policy contains Rules, Trigger library, Offence scoring, Automatic actions, and pending Trigger submissions. More contains Safety, Moderators, Recent actions, Audit history, and Switch community.

A moderator's private home contains **Review queue**, **Rules**, **More**, and **Submit trigger** only when that grant is active. More renders only destinations the moderator can actually use. Trigger values, severity policy, automatic-action configuration, moderator management, and owner audit history remain invisible and are re-authorized again when a callback is handled.

Private controls support buttons and short natural-language requests such as `Beacon`, `Hey Beacon`, `menu`, `reports`, `rules`, `submit trigger`, and `offence history for 123456789`. Owner-only calls also include `trigger library`, trigger search, `policy`, and `moderators`. A saved control session remembers the selected group; use **Switch community** before changing another group's policy.

Sensitive grants—ban, automatic-action changes, and lockdown—require a second confirmation. Every moderator addition, removal, and permission change is stored in `CommunityAudit` and privately delivered to the immutable owner when Telegram allows the DM.

## Reports and evidence

A member reports by replying to the relevant message and sending `/report`, `report this`, or the Burmese report phrase. Beacon removes the public command, stores bounded evidence temporarily, and updates one private review card when more people report the same message.

The initial review card shows the bounded evidence, source topic, member identity, numeric Telegram ID, active offence score, and report count. It offers only **Dismiss**, **Take action**, and **Offence history**. Take action edits that same card and reveals only the current moderator's granted actions; Back returns to the report without leaving abandoned control cards.

Evidence text expires after 30 days. Resolving a report does not publish the reporter's identity in the group.

## Offence scores and permanent bans

An offence proposal is not a punishment. A moderator chooses a severity and proposes an incident score from a narrow set around the owner's configured severity value. Beacon privately asks the immutable owner to accept the proposal, use the policy value, or reject it. Only a confirmed offence contributes to the member's active score.

The owner can configure severity values and ordered warning, mute, and permanent-ban thresholds in private controls. Warning and 24-hour mute thresholds can act after confirmation. Reaching the ban threshold presents a second owner-only **Permanently ban** confirmation; Beacon never silently converts a score into a permanent ban.

Reducing or pardoning an offence preserves its audit record. Pardoned points stop counting. A permanent ban remains attached to the Telegram user ID and is re-applied if that account rejoins; pardoning the active banning offence or clearing the active score removes that Beacon-level rejoin block.

## Topic purge

`/purge` works only for the immutable owner and only inside a non-General forum topic. Telegram has no bulk delete-history API for a topic, so Beacon deletes the topic and recreates it under the same known name and icon. This removes every message in that topic, invalidates old links and pins, and gives the replacement a new topic ID. The confirmation is tied to the originating topic and expires after 60 seconds.

## Failure behavior

- Without the Beacon environment variables, Threadwise starts normally and Beacon remains off.
- Without delete/restrict rights, Telegram rejects the relevant action; Beacon logs the failure instead of fabricating success.
- If the owner has not started Beacon privately, the audit row remains stored with a failed-delivery status.
- If a reporter cannot receive a private DM, Beacon sends a short self-deleting acknowledgement in the group.
- If a stale button references removed state, Beacon asks the moderator to reopen the current menu.

## Possible future additions

Not yet decided or scheduled; noted here so the reasoning isn't lost.

- **Dedicated moderator group:** deferred until the community has enough members to justify it. Ask for moderator volunteers later instead of standing one up now with a thin trigger library and one confirming owner.
- **Member-queryable rules/scholarship info:** a member asks Beacon a question privately; Beacon answers from the maintained rules/scholarship info and deletes the member's question so neither message stays in the visible chat history. Considered against relying on a pinned announcement/rules message, which is free but passive — it only helps if the member scrolls up and reads the whole block. The query flow answers the specific question and keeps repeat Q&A out of the group log entirely, which matters more as member count grows. Tradeoff: it's a knowledge base to build and keep in sync, not just an editable text block. Recommendation: keep the pinned announcement as the baseline for now, and only build this once repeated ad-hoc questions in chat actually show the pinned text isn't enough.
