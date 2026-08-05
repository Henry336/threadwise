import { InlineKeyboard } from "grammy";
import {
  CommunityOffenceSeverity,
  type CommunityOffence,
  CommunityAudit,
  CommunityGroup,
  CommunityModerator,
  CommunityModerationAction,
  CommunityReport,
  CommunityTrigger,
  CommunityTriggerGroup
} from "@prisma/client";
import type { ModeratorWizardPermissions } from "./policy";

export function beaconHomeText(group: CommunityGroup): string {
  const mode = group.observeMode ? "Observe" : "Active";
  const environment = group.environment === "TEST" ? "Testing group" : "Scholarship community";
  return [
    "<b>Beacon</b>",
    `${environment} · ${mode}`,
    "",
    "English · မြန်မာ",
    "Moderation and community safety, configured here in Telegram."
  ].join("\n");
}

export function beaconHomeKeyboard(group: CommunityGroup): InlineKeyboard {
  return new InlineKeyboard()
    .text("Moderators", "bc:mods").text("Trigger groups", "bc:cats").row()
    .text(group.observeMode ? "Observe mode: On" : "Active moderation", "bc:observe").text("Safety", "bc:safety").row()
    .text("Reports", "bc:reports").text("Recent actions", "bc:actions").row()
    .text("Rules", "bc:rules");
}

export function communityPickerText(): string {
  return [
    "<b>Beacon</b>",
    "Choose a community to manage privately.",
    "",
    "Your permissions are checked again before every action."
  ].join("\n");
}

export function communityPickerKeyboard(groups: CommunityGroup[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const group of groups) {
    keyboard.text(group.title || (group.environment === "TEST" ? "Testing group" : "Scholarship community"), `bc:pick:${group.id}`).row();
  }
  return keyboard;
}

export function privateBeaconHomeText(group: CommunityGroup): string {
  return [
    "<b>Beacon private controls</b>",
    `Managing: <b>${escapeHtml(group.title || "Configured community")}</b>`,
    `${group.environment === "TEST" ? "Testing" : "Production"} · ${group.observeMode ? "Observe mode" : "Active moderation"}`,
    "",
    "Sensitive policy lists and permission changes stay in this private chat."
  ].join("\n");
}

export function privateBeaconHomeKeyboard(group: CommunityGroup, owner: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (owner) keyboard.text("Trigger library", "bc:lib").text("Reports", "bc:reports").row();
  else keyboard.text("Submit trigger", "bc:libadd").text("Reports", "bc:reports").row();
  if (owner) keyboard.text("Offence scores", "bc:scores").text("Offence lookup", "bc:offences").row();
  if (owner) keyboard.text("Moderators", "bc:mods").text("Rules", "bc:rules").row();
  else keyboard.text("Rules", "bc:rules").row();
  return keyboard
    .text(group.observeMode ? "Observe mode: On" : "Active moderation", "bc:observe").text("Safety", "bc:safety").row()
    .text("Recent actions", "bc:actions").text("Recent changes", "bc:audits").row()
    .text("Switch community", "bc:switch");
}

export function groupBeaconHomeText(group: CommunityGroup): string {
  return [
    "<b>Beacon</b>",
    `${group.observeMode ? "Observe mode" : "Active moderation"} · ${escapeHtml(group.title || "This community")}`,
    "",
    "Sensitive configuration is managed privately."
  ].join("\n");
}

export function groupBeaconHomeKeyboard(privateControlsUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .url("Review reports privately", privateControlsUrl).text("Observe status", "bc:observeinfo").row()
    .text("Rules", "bc:rules").url("Open private controls", privateControlsUrl);
}

export function moderatorListText(moderators: CommunityModerator[]): string {
  const rows = moderators.length
    ? moderators.map((moderator, index) => {
      const name = displayModerator(moderator);
      const status = moderator.status === "ACTIVE" ? "active" : moderator.status.toLowerCase();
      return `${index + 1}. ${escapeHtml(name)} · ${status}`;
    })
    : ["No moderators yet."];
  return ["<b>Moderators</b>", "The owner is permanent and cannot be changed here.", "", ...rows].join("\n");
}

export function moderatorListKeyboard(moderators: CommunityModerator[]): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("Add moderator", "bc:mod:add").row();
  for (const moderator of moderators.slice(0, 8)) {
    keyboard.text(`Edit · ${truncate(displayModerator(moderator), 24)}`, `bc:mod:${moderator.id}`).row();
  }
  return keyboard.text("‹ Beacon", "bc:home");
}

export function moderatorPermissionQuestion(label: string, recommended: boolean, step: number, total: number): string {
  return [
    `<b>Moderator permissions · ${step}/${total}</b>`,
    escapeHtml(label),
    recommended ? "Recommended: Yes" : "Recommended: No"
  ].join("\n");
}

export function yesNoKeyboard(showRecommended = false): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("Yes", "bc:mw:y").text("No", "bc:mw:n").row();
  if (showRecommended) keyboard.text("Use safe recommended permissions", "bc:mw:recommended").row();
  return keyboard.text("Cancel", "bc:cancel");
}

export function moderatorSummaryText(name: string, permissions: ModeratorWizardPermissions, sensitiveConfirmation = false): string {
  const rows = [
    permissionLine("Warn and delete", permissions.canWarnDelete),
    permissionLine("Temporary mute", permissions.canMute),
    permissionLine("Permanent ban", permissions.canBan),
    permissionLine("Edit rules", permissions.canEditRules),
    permissionLine("Add triggers for review", permissions.canAddTriggers),
    permissionLine("Trusted-member exemptions", permissions.canManageTrustedMembers),
    permissionLine("Emergency lockdown", permissions.canLockdown)
  ];
  return [
    sensitiveConfirmation ? "<b>Confirm sensitive access</b>" : "<b>Confirm moderator</b>",
    escapeHtml(name),
    "",
    ...rows,
    sensitiveConfirmation ? "\nBan, automatic-action, or lockdown access is selected." : ""
  ].filter(Boolean).join("\n");
}

export function moderatorSummaryKeyboard(sensitive = false): InlineKeyboard {
  return new InlineKeyboard()
    .text(sensitive ? "Confirm sensitive access" : "Confirm", sensitive ? "bc:mw:risky" : "bc:mw:save")
    .row()
    .text("Start over", "bc:mw:restart").text("Cancel", "bc:cancel");
}

export function moderatorDetailText(moderator: CommunityModerator): string {
  const permissions: ModeratorWizardPermissions = {
    canWarnDelete: moderator.canWarn && moderator.canDelete,
    canMute: moderator.canMute,
    canBan: moderator.canBan,
    canEditRules: moderator.canEditRules,
    canAddTriggers: moderator.canAddTriggers,
    canRemoveTriggers: moderator.canRemoveTriggers,
    canChangeTriggerSeverity: moderator.canChangeTriggerSeverity,
    canManageTriggerGroups: moderator.canManageTriggerGroups,
    canChangeAutomaticActions: moderator.canChangeAutomaticActions,
    canManageTrustedMembers: moderator.canManageTrustedMembers,
    canLockdown: moderator.canLockdown
  };
  return moderatorSummaryText(displayModerator(moderator), permissions).replace("Confirm moderator", "Moderator");
}

export function moderatorDetailKeyboard(moderator: CommunityModerator): InlineKeyboard {
  return new InlineKeyboard()
    .text("Edit permissions", `bc:modedit:${moderator.id}`).row()
    .text("Remove moderator", `bc:modrm:${moderator.id}`).row()
    .text("‹ Moderators", "bc:mods");
}

export function triggerGroupsText(groups: Array<CommunityTriggerGroup & { triggers: CommunityTrigger[] }>): string {
  return [
    "<b>Trigger groups</b>",
    "Triggers are stored in Beacon and take effect without a redeploy.",
    "",
    ...groups.map((group) => `${escapeHtml(group.name)} · ${group.triggers.length} · ${actionLabel(group)}`)
  ].join("\n");
}

export function triggerGroupsKeyboard(groups: CommunityTriggerGroup[]): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("New trigger group", "bc:catnew").row();
  for (const group of groups) keyboard.text(group.name, `bc:cat:${group.id}`).row();
  return keyboard.text("‹ Beacon", "bc:home");
}

export function triggerLibraryText(input: {
  group: CommunityGroup;
  items: Array<CommunityTrigger & { triggerGroup: CommunityTriggerGroup }>;
  total: number;
  page: number;
  pages: number;
  query?: string | null;
  action?: string | null;
  triggerGroupName?: string | null;
}): string {
  const filters = [
    input.query ? `Search: “${escapeHtml(input.query)}”` : "",
    input.action ? `Action: ${escapeHtml(input.action.toLowerCase())}` : "",
    input.triggerGroupName ? `Group: ${escapeHtml(input.triggerGroupName)}` : ""
  ].filter(Boolean);
  const rows = input.items.length
    ? input.items.map((trigger, index) => {
        const pending = trigger.pendingApproval ? " · awaiting owner" : "";
        return `${input.page * 6 + index + 1}. <code>${escapeHtml(trigger.pattern)}</code> · ${actionLabel(trigger.triggerGroup)}${pending}`;
      })
    : ["No triggers match this view."];
  return [
    "<b>Trigger library</b>",
    `Managing: <b>${escapeHtml(input.group.title || "Configured community")}</b>`,
    `${input.total} trigger${input.total === 1 ? "" : "s"} · Page ${input.page + 1}/${input.pages}`,
    filters.length ? filters.join(" · ") : "All trigger groups and actions",
    "",
    ...rows
  ].join("\n");
}

export function triggerLibraryKeyboard(input: {
  items: Array<CommunityTrigger & { triggerGroup: CommunityTriggerGroup }>;
  page: number;
  pages: number;
  canAdd: boolean;
  filtered: boolean;
}): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (input.canAdd) keyboard.text("Add trigger", "bc:libadd");
  keyboard.text("Search", "bc:libsearch").row()
    .text("Filter by action", "bc:libactions").text("Filter by group", "bc:libgroups").row();
  if (input.filtered) keyboard.text("Clear filters", "bc:libclear").row();
  for (const trigger of input.items) {
    keyboard.text(`${trigger.pendingApproval ? "Pending · " : ""}${truncate(trigger.pattern, 28)}`, `bc:tr:${trigger.id}`).row();
  }
  if (input.pages > 1) {
    if (input.page > 0) keyboard.text("←", `bc:libpage:${input.page - 1}`);
    keyboard.text(`${input.page + 1}/${input.pages}`, "bc:noop");
    if (input.page + 1 < input.pages) keyboard.text("→", `bc:libpage:${input.page + 1}`);
    keyboard.row();
  }
  return keyboard.text("‹ Beacon", "bc:home");
}

export function triggerActionFilterKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Review", "bc:libact:REVIEW").text("Warn", "bc:libact:WARN").row()
    .text("Delete", "bc:libact:DELETE").text("Mute", "bc:libact:MUTE").row()
    .text("Ban", "bc:libact:BAN").row()
    .text("Clear", "bc:libact:ALL").text("‹ Library", "bc:lib");
}

export function triggerGroupFilterKeyboard(groups: CommunityTriggerGroup[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const group of groups) keyboard.text(group.name, `bc:libcat:${group.id}`).row();
  return keyboard.text("Clear", "bc:libcat:ALL").text("‹ Library", "bc:lib");
}

export function triggerGroupText(group: CommunityTriggerGroup & { triggers: CommunityTrigger[] }): string {
  const triggers = group.triggers.length
    ? group.triggers.slice(0, 20).map((trigger, index) => `${index + 1}. <code>${escapeHtml(trigger.pattern)}</code> · ${trigger.matchType.toLowerCase()}`)
    : ["No triggers yet."];
  return [
    `<b>${escapeHtml(group.name)}</b>`,
    escapeHtml(group.description ?? ""),
    `Automatic action: ${actionLabel(group)}`,
    "",
    ...triggers
  ].join("\n");
}

export function triggerGroupKeyboard(group: CommunityTriggerGroup & { triggers: CommunityTrigger[] }): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Add trigger", `bc:tradd:${group.id}`).text("Change action", `bc:act:${group.id}`).row()
    .text("Test message", `bc:trtest:${group.id}`).text("Rename", `bc:catrename:${group.id}`).row();
  for (const trigger of group.triggers.slice(0, 12)) {
    keyboard.text(`Manage · ${truncate(trigger.pattern, 28)}`, `bc:tr:${trigger.id}`).row();
  }
  if (group.triggers.length === 0) keyboard.text("Delete empty group", `bc:catdel:${group.id}`).row();
  return keyboard.text("‹ Trigger groups", "bc:cats");
}

export function triggerDetailText(trigger: CommunityTrigger & { triggerGroup: CommunityTriggerGroup }): string {
  return [
    "<b>Trigger</b>",
    `<code>${escapeHtml(trigger.pattern)}</code>`,
    `${trigger.matchType.toLowerCase()} · ${escapeHtml(trigger.triggerGroup.name)}`,
    `Action: ${actionLabel(trigger.triggerGroup)}`,
    `Added by: <code>${escapeHtml(trigger.createdByTelegramId)}</code>`,
    trigger.pendingApproval ? "Status: Awaiting owner review" : "Status: Active"
  ].join("\n");
}

export function triggerDetailKeyboard(trigger: CommunityTrigger, permissions?: { canMove?: boolean; canRemove?: boolean; owner?: boolean }): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (trigger.pendingApproval && permissions?.owner) {
    keyboard.text("Approve", `bc:tap:${trigger.id}`).text("Choose action", `bc:tchoose:${trigger.id}`).row();
  }
  if (permissions?.canMove) keyboard.text("Move", `bc:trmove:${trigger.id}`);
  if (permissions?.canRemove) keyboard.text("Remove", `bc:trdel:${trigger.id}`);
  if (permissions?.canMove || permissions?.canRemove) keyboard.row();
  return keyboard.text("‹ Trigger library", "bc:lib");
}

export function triggerApprovalKeyboard(triggerId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Approve for review", `bc:tap:${triggerId}`).row()
    .text("Choose action", `bc:tchoose:${triggerId}`).text("Remove", `bc:treject:${triggerId}`);
}

export function automaticActionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Review only", "bc:actset:review").row()
    .text("Delete + warn", "bc:actset:warn").row()
    .text("Delete + mute 1h", "bc:actset:mute60").text("Mute 24h", "bc:actset:mute1440").row()
    .text("Delete + ban", "bc:actset:ban").row()
    .text("Cancel", "bc:cancel");
}

export function reportCardText(report: CommunityReport, activeScore = 0, recentOffences: Array<Pick<CommunityOffence, "severity" | "appliedPoints" | "status" | "createdAt">> = []): string {
  const history = recentOffences.slice(0, 3).map((offence) =>
    `${offence.severity.toLowerCase()} · ${offence.appliedPoints ?? 0} point${offence.appliedPoints === 1 ? "" : "s"} · ${offence.status.toLowerCase()}`
  );
  const internalChatId = report.sourceChatId.startsWith("-100") ? report.sourceChatId.slice(4) : undefined;
  const sourceLink = internalChatId ? `https://t.me/c/${internalChatId}/${report.sourceMessageId}` : undefined;
  return [
    `<b>Reported message · ${report.reportCount} report${report.reportCount === 1 ? "" : "s"}</b>`,
    `From: ${escapeHtml(report.reportedDisplayName ?? report.reportedUsername ?? report.reportedTelegramId ?? "Unknown member")}`,
    report.reportedTelegramId ? `User ID: <code>${escapeHtml(report.reportedTelegramId)}</code>` : "",
    `Active offence score: <b>${activeScore}</b>`,
    report.reason ? `Reason: ${escapeHtml(report.reason)}` : "",
    "",
    report.evidenceText ? escapeHtml(truncate(report.evidenceText, 1_800)) : "Media or unavailable text evidence.",
    "",
    report.sourceMessageThreadId ? `Topic: ${escapeHtml(report.sourceTopicName || `#${report.sourceMessageThreadId}`)}` : "",
    sourceLink ? `<a href="${sourceLink}">Open original message</a>` : `Source message: ${report.sourceMessageId}`,
    history.length ? "\nRecent offences:\n" + history.map((row) => `• ${escapeHtml(row)}`).join("\n") : ""
  ].filter(Boolean).join("\n");
}

export function reportCardKeyboard(report: CommunityReport): InlineKeyboard {
  return new InlineKeyboard()
    .text("Propose offence", `bc:ops:${report.id}`).text("Offence history", `bc:oph:${report.id}`).row()
    .text("Dismiss", `bc:rp:d:${report.id}`).text("Warn", `bc:rp:w:${report.id}`).row()
    .text("Mute 1h", `bc:rp:m:${report.id}`).text("Delete", `bc:rp:x:${report.id}`).row()
    .text("Ban", `bc:rp:b:${report.id}`);
}

export function severityRulesText(group: CommunityGroup, rules: Array<{ severity: CommunityOffenceSeverity; points: number }>): string {
  const point = (severity: CommunityOffenceSeverity) => rules.find((rule) => rule.severity === severity)?.points ?? 0;
  return [
    "<b>Offence scoring</b>",
    "Only Beacon's owner can change these values.",
    "",
    `Minor · ${point(CommunityOffenceSeverity.MINOR)} point(s)`,
    `Moderate · ${point(CommunityOffenceSeverity.MODERATE)} point(s)`,
    `Serious · ${point(CommunityOffenceSeverity.SERIOUS)} point(s)`,
    `Critical · ${point(CommunityOffenceSeverity.CRITICAL)} point(s)`,
    "",
    `Warning threshold · ${group.warningScoreThreshold}`,
    `Mute threshold · ${group.muteScoreThreshold}`,
    `Permanent-ban threshold · ${group.banScoreThreshold}`
  ].join("\n");
}

export function severityRulesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Minor points", "bc:score:MINOR").text("Moderate points", "bc:score:MODERATE").row()
    .text("Serious points", "bc:score:SERIOUS").text("Critical points", "bc:score:CRITICAL").row()
    .text("Warning threshold", "bc:threshold:WARNING").row()
    .text("Mute threshold", "bc:threshold:MUTE").text("Ban threshold", "bc:threshold:BAN").row()
    .text("‹ Beacon", "bc:home");
}

export function offenceSeverityKeyboard(reportId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("Minor", `bc:opse:MINOR:${reportId}`).text("Moderate", `bc:opse:MODERATE:${reportId}`).row()
    .text("Serious", `bc:opse:SERIOUS:${reportId}`).text("Critical", `bc:opse:CRITICAL:${reportId}`).row()
    .text("Cancel", "bc:cancel");
}

export function offenceProposalKeyboard(offenceId: string, proposedPoints: number, policyPoints: number): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(`Accept ${proposedPoints}`, `bc:opa:${offenceId}`).row();
  if (policyPoints !== proposedPoints) keyboard.text(`Use policy ${policyPoints}`, `bc:opp:${offenceId}`).row();
  return keyboard.text("Reject", `bc:opr:${offenceId}`);
}

export function offenceProposalText(offence: CommunityOffence, evidence?: string | null): string {
  return [
    "<b>Offence score proposed</b>",
    `Member: ${escapeHtml(offence.targetDisplayName ?? offence.targetUsername ?? offence.targetTelegramId)}`,
    `User ID: <code>${escapeHtml(offence.targetTelegramId)}</code>`,
    `Severity: ${offence.severity.toLowerCase()}`,
    `Policy score: ${offence.policyPoints}`,
    `Moderator proposal: <b>${offence.proposedPoints}</b>`,
    `Proposed by: <code>${escapeHtml(offence.proposedByTelegramId)}</code>`,
    offence.proposalReason ? `Reason: ${escapeHtml(offence.proposalReason)}` : "",
    "",
    evidence ? escapeHtml(evidence.slice(0, 1_500)) : "Evidence text is unavailable."
  ].filter(Boolean).join("\n");
}

export function memberOffencesText(input: {
  name: string;
  telegramId: string;
  score: number;
  offences: CommunityOffence[];
}): string {
  const rows = input.offences.length ? input.offences.map((offence, index) =>
    `${index + 1}. ${offence.severity.toLowerCase()} · ${offence.appliedPoints ?? offence.proposedPoints} · ${offence.status.toLowerCase()} · ${relativeTime(offence.createdAt)}`
  ) : ["No offence history."];
  return [
    "<b>Member offence history</b>",
    escapeHtml(input.name),
    `User ID: <code>${escapeHtml(input.telegramId)}</code>`,
    `Active score: <b>${input.score}</b>`,
    "",
    ...rows
  ].join("\n");
}

export function memberOffencesKeyboard(telegramId: string, offences: CommunityOffence[], owner: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const offence of offences.slice(0, 8)) keyboard.text(`${offence.severity.toLowerCase()} · ${offence.status.toLowerCase()}`, `bc:opd:${offence.id}`).row();
  if (owner && offences.some((offence) => offence.status === "ACTIVE")) keyboard.text("Pardon all active", `bc:opclear:${telegramId}`).row();
  return keyboard.text("‹ Beacon", "bc:home");
}

export function offenceDetailText(offence: CommunityOffence): string {
  return [
    "<b>Offence</b>",
    `Member: ${escapeHtml(offence.targetDisplayName ?? offence.targetUsername ?? offence.targetTelegramId)}`,
    `User ID: <code>${escapeHtml(offence.targetTelegramId)}</code>`,
    `Severity: ${offence.severity.toLowerCase()}`,
    `Points: ${offence.appliedPoints ?? offence.proposedPoints}`,
    `Status: ${offence.status.toLowerCase()}`,
    offence.proposalReason ? `Reason: ${escapeHtml(offence.proposalReason)}` : "",
    offence.pardonReason ? `Pardon: ${escapeHtml(offence.pardonReason)}` : ""
  ].filter(Boolean).join("\n");
}

export function offenceDetailKeyboard(offence: CommunityOffence, owner: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (owner && offence.status === "ACTIVE") keyboard.text("Reduce points", `bc:opreduce:${offence.id}`).text("Pardon", `bc:oppardon:${offence.id}`).row();
  return keyboard.text("‹ History", `bc:oph:${offence.reportId ?? offence.targetTelegramId}`);
}

export function purgeConfirmationKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Purge topic", "bc:purge:confirm").row().text("Cancel", "bc:purge:cancel");
}

export function safetyText(group: CommunityGroup): string {
  return [
    "<b>Safety controls</b>",
    `Observe mode: ${group.observeMode ? "On" : "Off"}`,
    `Emergency lockdown: ${group.lockdownMode ? "On" : "Off"}`,
    `Pause new-member posting: ${group.pauseNewMemberPosting ? `On · ${group.newMemberPauseHours}h` : "Off"}`,
    `Flood control: ${group.floodMessageLimit} messages / ${group.floodWindowSeconds}s`,
    `Duplicate control: ${group.duplicateMessageLimit} repeats / ${group.duplicateWindowSeconds}s`,
    `Mass mentions: ${group.massMentionLimit}`
  ].join("\n");
}

export function safetyKeyboard(group: CommunityGroup): InlineKeyboard {
  return new InlineKeyboard()
    .text("Trusted members", "bc:trusted").row()
    .text("Cycle flood limit", "bc:flood").text("Cycle duplicates", "bc:dupes").row()
    .text("Cycle mention limit", "bc:mentions").row()
    .text(group.pauseNewMemberPosting ? "Allow new members" : "Pause new members", "bc:newpause").row()
    .text(group.lockdownMode ? "End lockdown" : "Emergency lockdown", "bc:lockdown").row()
    .text("‹ Beacon", "bc:home");
}

export function trustedMembersText(members: Array<{ telegramId: string; username: string | null; displayName: string | null }>): string {
  return [
    "<b>Trusted members</b>",
    "Trusted members bypass automatic filters, lockdown, and new-member posting pauses.",
    "",
    ...(members.length ? members.map((member, index) => `${index + 1}. ${escapeHtml(member.displayName || (member.username ? `@${member.username}` : member.telegramId))}`) : ["No trusted-member exemptions."])
  ].join("\n");
}

export function trustedMembersKeyboard(members: Array<{ id: string; telegramId: string; username: string | null; displayName: string | null }>): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("Add trusted member", "bc:trustedadd").row();
  for (const member of members.slice(0, 8)) {
    keyboard.text(`Remove · ${truncate(member.displayName || member.username || member.telegramId, 24)}`, `bc:trustedrm:${member.id}`).row();
  }
  return keyboard.text("‹ Safety", "bc:safety");
}

export function actionsText(actions: CommunityModerationAction[]): string {
  return [
    "<b>Recent actions</b>",
    actions.length ? "" : "No moderation actions yet.",
    ...actions.map((action) => `${action.action} · ${escapeHtml(action.targetTelegramId ?? "no target")} · ${action.undoneAt ? "undone" : relativeTime(action.createdAt)}`)
  ].join("\n");
}

export function auditsText(audits: CommunityAudit[]): string {
  return [
    "<b>Recent policy changes</b>",
    audits.length ? "" : "No policy changes yet.",
    ...audits.map((audit) => `${escapeHtml(audit.action.replace(/_/g, " ").toLowerCase())} · <code>${escapeHtml(audit.actorTelegramId)}</code> · ${relativeTime(audit.createdAt)}`)
  ].join("\n");
}

export function displayModerator(moderator: Pick<CommunityModerator, "telegramId" | "username" | "firstName" | "lastName">): string {
  const name = [moderator.firstName, moderator.lastName].filter(Boolean).join(" ").trim();
  return name || (moderator.username ? `@${moderator.username}` : moderator.telegramId);
}

export function permissionDiff(before: CommunityModerator | null, after: CommunityModerator): string {
  if (!before) return "Moderator added.";
  const keys: Array<keyof Pick<CommunityModerator, "canWarn" | "canDelete" | "canMute" | "canBan" | "canEditRules" | "canAddTriggers" | "canRemoveTriggers" | "canChangeTriggerSeverity" | "canManageTriggerGroups" | "canChangeAutomaticActions" | "canManageTrustedMembers" | "canLockdown">> = [
    "canWarn", "canDelete", "canMute", "canBan", "canEditRules", "canAddTriggers", "canRemoveTriggers", "canChangeTriggerSeverity", "canManageTriggerGroups", "canChangeAutomaticActions", "canManageTrustedMembers", "canLockdown"
  ];
  const changed = keys.filter((key) => before[key] !== after[key]);
  return changed.length ? `Changed: ${changed.join(", ")}.` : "No capability changes.";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function permissionLine(label: string, enabled: boolean): string {
  return `${enabled ? "✓" : "✕"} ${label}`;
}

function actionLabel(group: Pick<CommunityTriggerGroup, "action" | "deleteMessage" | "muteDurationMinutes">): string {
  if (group.action === "REVIEW") return "Review only";
  if (group.action === "WARN") return group.deleteMessage ? "Delete + warn" : "Warn";
  if (group.action === "DELETE") return "Delete";
  if (group.action === "MUTE") return `${group.deleteMessage ? "Delete + " : ""}mute ${group.muteDurationMinutes ?? 60}m`;
  return `${group.deleteMessage ? "Delete + " : ""}ban`;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1)).trimEnd()}…`;
}

function relativeTime(date: Date): string {
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
