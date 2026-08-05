import { InlineKeyboard } from "grammy";
import type {
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
    permissionLine("Edit rules and triggers", permissions.canEditRules),
    permissionLine("Change automatic actions", permissions.canChangeAutomaticActions),
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
    `${trigger.matchType.toLowerCase()} · ${escapeHtml(trigger.triggerGroup.name)}`
  ].join("\n");
}

export function triggerDetailKeyboard(trigger: CommunityTrigger): InlineKeyboard {
  return new InlineKeyboard()
    .text("Move", `bc:trmove:${trigger.id}`).text("Delete", `bc:trdel:${trigger.id}`).row()
    .text("‹ Trigger group", `bc:cat:${trigger.triggerGroupId}`);
}

export function automaticActionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Review only", "bc:actset:review").row()
    .text("Delete + warn", "bc:actset:warn").row()
    .text("Delete + mute 1h", "bc:actset:mute60").text("Mute 24h", "bc:actset:mute1440").row()
    .text("Delete + ban", "bc:actset:ban").row()
    .text("Cancel", "bc:cancel");
}

export function reportCardText(report: CommunityReport): string {
  return [
    `<b>Reported message · ${report.reportCount} report${report.reportCount === 1 ? "" : "s"}</b>`,
    `From: ${escapeHtml(report.reportedDisplayName ?? report.reportedUsername ?? report.reportedTelegramId ?? "Unknown member")}`,
    report.reason ? `Reason: ${escapeHtml(report.reason)}` : "",
    "",
    report.evidenceText ? escapeHtml(truncate(report.evidenceText, 1_800)) : "Media or unavailable text evidence.",
    "",
    `Source message: ${report.sourceMessageId}`
  ].filter(Boolean).join("\n");
}

export function reportCardKeyboard(report: CommunityReport): InlineKeyboard {
  return new InlineKeyboard()
    .text("Dismiss", `bc:rp:d:${report.id}`).text("Warn", `bc:rp:w:${report.id}`).row()
    .text("Mute 1h", `bc:rp:m:${report.id}`).text("Delete", `bc:rp:x:${report.id}`).row()
    .text("Ban", `bc:rp:b:${report.id}`);
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

export function displayModerator(moderator: Pick<CommunityModerator, "telegramId" | "username" | "firstName" | "lastName">): string {
  const name = [moderator.firstName, moderator.lastName].filter(Boolean).join(" ").trim();
  return name || (moderator.username ? `@${moderator.username}` : moderator.telegramId);
}

export function permissionDiff(before: CommunityModerator | null, after: CommunityModerator): string {
  if (!before) return "Moderator added.";
  const keys: Array<keyof Pick<CommunityModerator, "canWarn" | "canDelete" | "canMute" | "canBan" | "canEditRules" | "canChangeAutomaticActions" | "canManageTrustedMembers" | "canLockdown">> = [
    "canWarn", "canDelete", "canMute", "canBan", "canEditRules", "canChangeAutomaticActions", "canManageTrustedMembers", "canLockdown"
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
