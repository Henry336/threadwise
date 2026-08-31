import {
  CommunityModerationActionType,
  CommunityOffenceSeverity,
  CommunityReportStatus,
  type CommunityGroup,
  type CommunityModerator,
  type CommunityReport,
  type CommunityTriggerGroup
} from "@prisma/client";
import { Bot, Context, InlineKeyboard } from "grammy";
import type { BeaconConfig } from "../config/env";
import { logger } from "../logger";
import {
  activeCommunityConversation,
  addTrustedCommunityMember,
  addCommunityTrigger,
  approveCommunityTrigger,
  attachCommunityReportMessage,
  clearCommunityConversation,
  communityAccess,
  communityActionById,
  communityForumTopic,
  communityGroupById,
  communityGroupForChat,
  communityControlSession,
  communityMemberOffenceScore,
  communityMemberOffences,
  communityModeratorById,
  communityOffenceById,
  communityReportById,
  communitySeverityPoints,
  communitySeverityRules,
  communityTriggerById,
  communityTriggerByGlobalId,
  countOpenCommunityReports,
  createCommunityTriggerGroup,
  createCommunityOffenceProposal,
  createOrIncrementCommunityReport,
  confirmCommunityOffence,
  cycleCommunityDuplicatePreset,
  cycleCommunityFloodPreset,
  cycleCommunityMentionLimit,
  deleteEmptyCommunityTriggerGroup,
  expireCommunityEvidence,
  hasPermanentCommunityBan,
  isNewCommunityMemberPaused,
  isTrustedCommunityMember,
  listOpenCommunityReports,
  listPendingCommunityTriggers,
  listCommunityTriggerLibrary,
  listManageableCommunityGroups,
  listCommunityModerators,
  listTrustedCommunityMembers,
  listTriggerGroups,
  markCommunityActionUndone,
  markCommunityForumTopicReplaced,
  markCommunityOffencePermanentBan,
  moveCommunityTrigger,
  moveAndApproveCommunityTrigger,
  policyTriggersForGroup,
  recentCommunityActions,
  recentCommunityAudits,
  recordCommunityAction,
  recordCommunityAudit,
  pardonAllCommunityOffences,
  pardonCommunityOffence,
  reduceCommunityOffence,
  rejectCommunityOffence,
  renameCommunityTriggerGroup,
  removeCommunityModerator,
  removeCommunityTrigger,
  removeTrustedCommunityMember,
  reviewCommunityTriggerGroup,
  resolveCommunityReport,
  saveCommunityModerator,
  setCommunityLockdownMode,
  setCommunityNewMemberPause,
  setCommunityObserveMode,
  setCommunityOwnerNotificationStatus,
  setCommunityRules,
  selectCommunityControlGroup,
  startCommunityConversation,
  suspendCommunityModerator,
  triggerGroupById,
  triggerGroupByName,
  updateCommunityConversation,
  updateCommunityGroupTitle,
  updateCommunityControlTriggerFilters,
  updateCommunityScoreThreshold,
  updateCommunitySeverityPoints,
  updateTriggerGroupAction,
  upsertCommunityForumTopic,
  upsertCommunityMember,
  type CommunityAccess,
  type ModeratorIdentityInput,
  type ModeratorPermissionsInput
} from "./store";
import {
  findPolicyMatches,
  hasSensitiveModeratorPermissions,
  highestSeverityMatch,
  isBeaconInvocation,
  moderatorPermissionQuestions,
  normalizeCommunityText,
  offencePointOptions,
  safeModeratorDefaults,
  type ModeratorWizardPermissions
} from "./policy";
import {
  canOpenBeaconSafety,
  canSubmitTriggerPrivately,
  canUseOwnerMutation,
  canUseReportAction,
  hasBeaconOperationalHistory,
  isBeaconOwnerOnlyControl,
  isBeaconPublicGroupControl
} from "./controlAccess";
import { createRegisteredBeaconBot } from "./registration";
import {
  actionsText,
  auditsText,
  automaticActionKeyboard,
  beaconMoreKeyboard,
  beaconMoreText,
  beaconPolicyKeyboard,
  beaconPolicyText,
  communityPickerKeyboard,
  communityPickerText,
  displayModerator,
  escapeHtml,
  moderatorDetailKeyboard,
  moderatorDetailText,
  moderatorListKeyboard,
  moderatorListText,
  moderatorPermissionQuestion,
  moderatorSummaryKeyboard,
  moderatorSummaryText,
  memberOffencesKeyboard,
  memberOffencesText,
  offenceDetailKeyboard,
  offenceDetailText,
  offenceProposalKeyboard,
  offenceProposalText,
  offenceSeverityKeyboard,
  pendingTriggersKeyboard,
  pendingTriggersText,
  permissionDiff,
  purgeConfirmationKeyboard,
  reportCardKeyboard,
  reportCardText,
  reportActionKeyboard,
  reportHelpText,
  groupBeaconHomeKeyboard,
  groupBeaconHomeText,
  privateBeaconHomeKeyboard,
  privateBeaconHomeText,
  publicBeaconKeyboard,
  safetyKeyboard,
  safetyText,
  severityRulesKeyboard,
  severityRulesText,
  triggerDetailKeyboard,
  triggerDetailText,
  triggerActionFilterKeyboard,
  triggerApprovalKeyboard,
  triggerGroupFilterKeyboard,
  triggerGroupKeyboard,
  triggerGroupText,
  triggerGroupsKeyboard,
  triggerGroupsText,
  triggerLibraryKeyboard,
  triggerLibraryText,
  trustedMembersKeyboard,
  trustedMembersText,
  yesNoKeyboard
} from "./ui";

const OWNER_ONLY = "Only Beacon's owner can do that.";
const SETTINGS_PATTERN = /^(?:\/beacon(?:@\w+)?|beacon\s+(?:settings|menu)|moderation\s+settings)$/iu;
const RULES_PATTERN = /^(?:\/rules(?:@\w+)?|rules|စည်းမျဉ်း(?:များ)?)$/iu;
const floodState = new Map<string, Array<{ at: number; text: string }>>();

type WizardData = {
  target: ModeratorIdentityInput;
  targetName: string;
  moderatorId?: string;
  permissions: ModeratorWizardPermissions;
  index: number;
};

type ActionChoice = { action: CommunityModerationActionType; deleteMessage: boolean; muteDurationMinutes?: number };

export async function createBeaconBot(token: string, config: BeaconConfig): Promise<Bot> {
  return createRegisteredBeaconBot(token, config, {
    showPrivateHome,
    showPrivateEntry,
    configuredGroup,
    accessFor,
    showMemberHelp,
    showGroupHome,
    showRules,
    handleMemberReport,
    beginTopicPurge,
    handleCallback,
    answerCallback,
    handlePrivateMessage,
    handleServiceMessage,
    enforceStructuralSafety,
    handleConversationMessage,
    handleNaturalPolicyCommand,
    beginModeratorTarget,
    enforceConfiguredPolicy,
    notifyOwner,
    memberName,
  });
}
export function startBeaconCleanupLoop(): NodeJS.Timeout {
  return setInterval(() => {
    void expireCommunityEvidence().catch((error) => logger.error("Beacon evidence cleanup failed.", { error: String(error) }));
  }, 60 * 60_000);
}

async function handleCallback(ctx: Context, config: BeaconConfig): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const actorId = String(ctx.from?.id ?? "");
  if (!actorId) return;

  if (data === "bc:noop") return answerCallback(ctx);
  if (data === "bc:switch") {
    await answerCallback(ctx);
    return showPrivateGroupPicker(ctx, config, true);
  }
  if (data.startsWith("bc:pick:")) {
    const group = await communityGroupById(data.slice("bc:pick:".length));
    if (!group?.enabled) return answerCallback(ctx, "That community is not available.", true);
    const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "You do not have Beacon access for that community.", true);
    await selectCommunityControlGroup(actorId, group.id);
    await answerCallback(ctx);
    return showPrivateHome(ctx, group, access, true);
  }

  if (data.startsWith("bc:rp:") || data.startsWith("bc:rpbok:")) {
    await handleReportActionCallback(ctx, config, data);
    return;
  }
  if (data.startsWith("bc:rpa:")) {
    await showReportActions(ctx, config, data.slice("bc:rpa:".length));
    return;
  }
  if (
    data.startsWith("bc:ops:")
    || data.startsWith("bc:opse:")
    || data.startsWith("bc:oppt:")
    || data.startsWith("bc:opa:")
    || data.startsWith("bc:opp:")
    || data.startsWith("bc:opr:")
    || data.startsWith("bc:opban:")
    || data.startsWith("bc:opbanok:")
    || data.startsWith("bc:oph:")
    || data.startsWith("bc:opd:")
    || data.startsWith("bc:opreduce:")
    || data.startsWith("bc:opset:")
    || data.startsWith("bc:oppardon:")
    || data.startsWith("bc:oppardonok:")
    || data.startsWith("bc:opclear:")
    || data.startsWith("bc:opclearok:")
  ) {
    await handleOffenceCallback(ctx, config, data);
    return;
  }
  if (data.startsWith("bc:undo:")) {
    await handleUndoCallback(ctx, config, data.slice("bc:undo:".length));
    return;
  }
  if (
    data.startsWith("bc:tap:")
    || data.startsWith("bc:tchoose:")
    || data.startsWith("bc:treject:")
    || data.startsWith("bc:apto:")
    || data === "bc:trejectok"
  ) {
    await handleTriggerApprovalCallback(ctx, config, data);
    return;
  }

  const group = ctx.chat?.type === "private"
    ? await selectedCommunityGroup(ctx, config)
    : await configuredGroup(ctx);
  if (!group) {
    await answerCallback(ctx, "Choose a community first.", true);
    if (ctx.chat?.type === "private") await showPrivateGroupPicker(ctx, config);
    return;
  }
  const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
  if (ctx.chat?.type !== "private" && isBeaconPublicGroupControl(data)) {
    if (data === "bc:rules") return showPublicRules(ctx, group, true);
    if (data === "bc:reporthelp") return showReportHelp(ctx, true);
    return showMemberHelp(ctx, group, true);
  }
  if (!access.owner && !access.moderator) {
    await answerCallback(ctx, "This control is for Beacon moderators.", true);
    return;
  }
  if (!access.owner && isBeaconOwnerOnlyControl(data)) {
    await answerCallback(ctx, OWNER_ONLY, true);
    return;
  }
  if (ctx.chat?.type !== "private" && ![
    "bc:home",
    "bc:rules",
    "bc:observeinfo",
    "bc:purge:confirm",
    "bc:purge:cancel"
  ].includes(data)) {
    await answerCallback(ctx, "Open Beacon's private chat for sensitive controls.", true);
    return;
  }

  if (data === "bc:home") {
    return ctx.chat?.type === "private"
      ? showPrivateHome(ctx, group, access, true)
      : showGroupHome(ctx, group, access, true);
  }
  if (data === "bc:more") {
    await answerCallback(ctx);
    return editCard(ctx, beaconMoreText(group), beaconMoreKeyboard(access));
  }
  if (data === "bc:policy") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    return showPolicy(ctx, group, true);
  }
  if (data === "bc:cancel") {
    await clearCommunityConversation(group.id, actorId);
    await answerCallback(ctx, "Canceled.");
    return ctx.chat?.type === "private"
      ? showPrivateHome(ctx, group, access, true)
      : showGroupHome(ctx, group, access, true);
  }
  if (data === "bc:observeinfo") {
    await answerCallback(ctx, group.observeMode ? "Observe mode is on. No automatic punishment is applied." : "Active moderation is on.", true);
    return;
  }
  if (data === "bc:purge:confirm") return confirmTopicPurge(ctx, group, access, config);
  if (data === "bc:purge:cancel") {
    await clearCommunityConversation(group.id, actorId);
    await answerCallback(ctx, "Purge canceled.");
    return editCard(ctx, "<b>Purge canceled</b>\nNothing was deleted.", new InlineKeyboard());
  }
  if (data === "bc:mods") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    return showModerators(ctx, group, true);
  }
  if (data === "bc:mod:add") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    await startCommunityConversation({ groupId: group.id, actorTelegramId: actorId, kind: "MODERATOR_TARGET", step: "TARGET" });
    await answerCallback(ctx);
    return editCard(ctx, [
      "<b>Add moderator</b>",
      "Reply to one of their messages, or send their numeric Telegram ID.",
      "",
      "Beacon will verify that they are a current human member before asking about permissions."
    ].join("\n"), new InlineKeyboard().text("Cancel", "bc:cancel"));
  }
  if (data.startsWith("bc:mod:")) return showModerator(ctx, group, data.slice("bc:mod:".length));
  if (data.startsWith("bc:modedit:")) {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const moderator = await communityModeratorById(group.id, data.slice("bc:modedit:".length));
    if (!moderator) return answerCallback(ctx, "Moderator not found.", true);
    await beginExistingModeratorWizard(ctx, group, moderator);
    return;
  }
  if (data.startsWith("bc:modrm:")) {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const moderator = await communityModeratorById(group.id, data.slice("bc:modrm:".length));
    if (!moderator) return answerCallback(ctx, "Moderator not found.", true);
    await startCommunityConversation({
      groupId: group.id,
      actorTelegramId: actorId,
      kind: "REMOVE_MODERATOR",
      step: "CONFIRM",
      data: { moderatorId: moderator.id, targetTelegramId: moderator.telegramId, targetName: displayModerator(moderator) }
    });
    await answerCallback(ctx);
    return editCard(ctx, `<b>Remove moderator?</b>\n${escapeHtml(displayModerator(moderator))}\n\nTheir Beacon permissions will stop immediately.`, new InlineKeyboard().text("Remove", "bc:modrmok").row().text("Cancel", "bc:cancel"));
  }
  if (data === "bc:modrmok") return confirmRemoveModerator(ctx, group, config);
  if (data === "bc:mw:y" || data === "bc:mw:n") return advanceModeratorWizard(ctx, group, data.endsWith(":y"));
  if (data === "bc:mw:recommended") return applyRecommendedModeratorPermissions(ctx, group);
  if (data === "bc:mw:restart") return restartModeratorWizard(ctx, group);
  if (data === "bc:mw:save" || data === "bc:mw:risky") return saveModeratorWizard(ctx, group, config, data.endsWith(":risky"));

  if (data === "bc:lib") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    return showTriggerLibrary(ctx, group, access, true);
  }
  if (data === "bc:libsearch") return beginTriggerLibrarySearch(ctx, group, access);
  if (data === "bc:libactions") {
    await answerCallback(ctx);
    return editCard(ctx, "<b>Filter by action</b>", triggerActionFilterKeyboard());
  }
  if (data === "bc:libgroups") {
    const groups = await listTriggerGroups(group.id);
    await answerCallback(ctx);
    return editCard(ctx, "<b>Filter by trigger group</b>", triggerGroupFilterKeyboard(groups));
  }
  if (data.startsWith("bc:libact:")) return setTriggerLibraryActionFilter(ctx, group, access, data.slice("bc:libact:".length));
  if (data.startsWith("bc:libcat:")) return setTriggerLibraryGroupFilter(ctx, group, access, data.slice("bc:libcat:".length));
  if (data.startsWith("bc:libpage:")) return setTriggerLibraryPage(ctx, group, access, Number(data.slice("bc:libpage:".length)));
  if (data === "bc:libclear") return clearTriggerLibraryFilters(ctx, group, access);
  if (data === "bc:libadd") return beginPrivateTriggerAdd(ctx, group, access);
  if (data === "bc:pending") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    return showPendingTriggers(ctx, group, true);
  }

  if (data === "bc:scores") return showSeverityRules(ctx, group, access);
  if (data.startsWith("bc:score:")) return beginSeverityScoreEdit(ctx, group, access, data.slice("bc:score:".length));
  if (data.startsWith("bc:threshold:")) return beginThresholdEdit(ctx, group, access, data.slice("bc:threshold:".length));
  if (data === "bc:offences" || data === "bc:members") return beginOffenceLookup(ctx, group, access);

  if (data === "bc:cats") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    return showTriggerGroups(ctx, group, true);
  }
  if (data === "bc:catnew") return beginTriggerGroupCreation(ctx, group, access);
  if (data.startsWith("bc:catrename:")) return beginTriggerGroupRename(ctx, group, access, data.slice("bc:catrename:".length));
  if (data.startsWith("bc:catdel:")) return beginTriggerGroupDeletion(ctx, group, access, data.slice("bc:catdel:".length));
  if (data === "bc:catdelok") return confirmTriggerGroupDeletion(ctx, group, access);
  if (data.startsWith("bc:cat:")) return showTriggerGroup(ctx, group, data.slice("bc:cat:".length));
  if (data.startsWith("bc:tradd:")) return beginTriggerInput(ctx, group, access, "ADD_TRIGGER", data.slice("bc:tradd:".length));
  if (data.startsWith("bc:trtest:")) return beginTriggerInput(ctx, group, access, "TEST_TRIGGER", data.slice("bc:trtest:".length));
  if (data.startsWith("bc:tr:") && !data.startsWith("bc:tr:noop")) return showTrigger(ctx, group, access, data.slice("bc:tr:".length));
  if (data.startsWith("bc:trdel:")) return beginDeleteTrigger(ctx, group, access, data.slice("bc:trdel:".length));
  if (data === "bc:trdelok") return confirmDeleteTrigger(ctx, group, access);
  if (data.startsWith("bc:trmove:")) return beginMoveTrigger(ctx, group, access, data.slice("bc:trmove:".length));
  if (data.startsWith("bc:mvto:")) return confirmMoveTrigger(ctx, group, access, data.slice("bc:mvto:".length));
  if (data.startsWith("bc:act:") && !data.startsWith("bc:act:noop")) return beginActionChoice(ctx, group, access, data.slice("bc:act:".length));
  if (data.startsWith("bc:actset:")) return stageActionChoice(ctx, group, access, data.slice("bc:actset:".length));
  if (data === "bc:actok") return confirmActionChoice(ctx, group, access, config);

  if (data === "bc:observe") return beginObserveToggle(ctx, group, access);
  if (data === "bc:observeok") return confirmObserveToggle(ctx, group, access, config);
  if (data === "bc:safety") {
    if (!canOpenBeaconSafety(access)) return answerCallback(ctx, "You do not have access to safety controls.", true);
    await answerCallback(ctx);
    return editCard(ctx, safetyText(group), safetyKeyboard(group, access));
  }
  if (data === "bc:trusted") return showTrustedMembers(ctx, group, access);
  if (data === "bc:trustedadd") return beginTrustedMemberInput(ctx, group, access);
  if (data.startsWith("bc:trustedrm:")) return confirmTrustedMemberRemoval(ctx, group, access, config, data.slice("bc:trustedrm:".length));
  if (data === "bc:flood") return cycleSafetySetting(ctx, group, access, config, "FLOOD");
  if (data === "bc:dupes") return cycleSafetySetting(ctx, group, access, config, "DUPLICATES");
  if (data === "bc:mentions") return cycleSafetySetting(ctx, group, access, config, "MENTIONS");
  if (data === "bc:newpause") return toggleNewMemberPause(ctx, group, access, config);
  if (data === "bc:lockdown") return beginLockdownToggle(ctx, group, access);
  if (data === "bc:lockok") return confirmLockdownToggle(ctx, group, access, config);
  if (data === "bc:actions") {
    if (!hasBeaconOperationalHistory(access)) return answerCallback(ctx, "You do not have access to moderation history.", true);
    const actions = await recentCommunityActions(group.id);
    await answerCallback(ctx);
    return editCard(ctx, actionsText(actions), new InlineKeyboard().text("‹ More", "bc:more"));
  }
  if (data === "bc:audits") {
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const audits = await recentCommunityAudits(group.id);
    await answerCallback(ctx);
    return editCard(ctx, auditsText(audits), new InlineKeyboard().text("‹ More", "bc:more"));
  }
  if (data === "bc:reports") return showOpenReports(ctx, group);
  if (data.startsWith("bc:report:")) return showOpenReport(ctx, group, data.slice("bc:report:".length));
  if (data === "bc:rules") {
    await answerCallback(ctx);
    return showRules(ctx, group, true, access);
  }
  if (data === "bc:rule:en" || data === "bc:rule:my") return beginRuleEdit(ctx, group, access, data.endsWith(":en") ? "EN" : "MY");

  await answerCallback(ctx, "This control is no longer current. Reopen Beacon.", true);
}

async function handlePrivateMessage(ctx: Context, config: BeaconConfig): Promise<void> {
  const actorId = String(ctx.from?.id ?? "");
  const text = ctx.message?.text?.trim();
  if (!actorId || !text) return;

  const group = await selectedCommunityGroup(ctx, config);
  if (!group) {
    await showPrivateEntry(ctx, config);
    return;
  }
  const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
  if (!access.owner && !access.moderator) {
    await showPrivateGroupPicker(ctx, config);
    return;
  }

  const conversation = await activeCommunityConversation(group.id, actorId);
  if (conversation && await handleConversationMessage(ctx, group, conversation, access, config)) return;

  if (isBeaconInvocation(text) || SETTINGS_PATTERN.test(text) || /^home$/iu.test(text)) {
    await showPrivateHome(ctx, group, access);
    return;
  }
  if (/^(?:trigger library|triggers|show triggers|open triggers)$/iu.test(text)) {
    if (!access.owner) {
      await ctx.reply(OWNER_ONLY);
      return;
    }
    await showTriggerLibrary(ctx, group, access);
    return;
  }
  const search = text.match(/^(?:find|search)(?:\s+the)?\s+triggers?\s+(?:for\s+)?(.+)$/iu);
  if (search?.[1]) {
    if (!access.owner) {
      await ctx.reply(OWNER_ONLY);
      return;
    }
    await updateCommunityControlTriggerFilters({ actorTelegramId: actorId, searchQuery: search[1], page: 0 });
    await showTriggerLibrary(ctx, group, access);
    return;
  }
  if (/^(?:(?:add|new|submit)\s+trigger|trigger submission)$/iu.test(text)) {
    await beginPrivateTriggerAdd(ctx, group, access);
    return;
  }
  if (/^(?:reports?|review queue)$/iu.test(text)) {
    await showOpenReports(ctx, group);
    return;
  }
  if (/^(?:moderators?|mods)$/iu.test(text) && access.owner) {
    await showModerators(ctx, group);
    return;
  }
  if (/^(?:offences?|offense scores?|score policy)$/iu.test(text) && access.owner) {
    await showSeverityRules(ctx, group, access, false);
    return;
  }
  const offenceHistory = text.match(/^(?:show\s+)?offen[cs]e history (?:for\s+)?(\d+)$/iu);
  if (offenceHistory?.[1]) {
    await showMemberOffenceHistory(ctx, group, offenceHistory[1], access, false);
    return;
  }
  if (/^(?:members(?:\s+and|\s*&)?\s+offences|member lookup)$/iu.test(text)) {
    await beginOffenceLookup(ctx, group, access, false);
    return;
  }
  if (/^policy$/iu.test(text) && access.owner) {
    await showPolicy(ctx, group, false);
    return;
  }
  if (/^more$/iu.test(text)) {
    await ctx.reply(beaconMoreText(group), { parse_mode: "HTML", reply_markup: beaconMoreKeyboard(access) });
    return;
  }
  if (RULES_PATTERN.test(text)) {
    await showRules(ctx, group, false, access);
    return;
  }
  if (await handleNaturalPolicyCommand(ctx, group, access, config)) return;

  await ctx.reply([
    `<b>Managing: ${escapeHtml(group.title || "Configured community")}</b>`,
    "I didn't recognize that control.",
    "Use the controls below or send <code>Beacon</code>."
  ].join("\n"), {
    parse_mode: "HTML",
    reply_markup: privateBeaconHomeKeyboard(access, await countOpenCommunityReports(group.id))
  });
}

async function handleTriggerApprovalCallback(ctx: Context, config: BeaconConfig, data: string): Promise<void> {
  const actorId = String(ctx.from?.id ?? "");
  if (!actorId) return;

  if (data.startsWith("bc:tap:") || data.startsWith("bc:tchoose:") || data.startsWith("bc:treject:")) {
    const triggerId = data.slice(data.lastIndexOf(":") + 1);
    const trigger = await communityTriggerByGlobalId(triggerId);
    if (!trigger?.pendingApproval) return answerCallback(ctx, "This submission is no longer awaiting review.", true);
    const access = await communityAccess(trigger.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    await selectCommunityControlGroup(actorId, trigger.groupId);

    if (data.startsWith("bc:tap:")) {
      const approved = await approveCommunityTrigger(trigger.id, actorId);
      const audit = await recordCommunityAudit({
        groupId: trigger.groupId,
        actorTelegramId: actorId,
        action: "TRIGGER_APPROVED",
        details: { triggerId: trigger.id, pattern: trigger.pattern, triggerGroupId: trigger.triggerGroupId }
      });
      await notifyOwner(botFromContext(ctx), config, trigger.group, audit.id, `<b>Trigger approved</b>\n<code>${escapeHtml(trigger.pattern)}</code>`);
      await notifyTriggerSubmitter(ctx, approved.createdByTelegramId, `Approved: “${approved.pattern}” is now active in ${approved.triggerGroup.name}.`, config.ownerTelegramId);
      await answerCallback(ctx, "Trigger approved.");
      await editCard(ctx, `${triggerDetailText(approved)}\n\n<b>Approved</b>`, triggerDetailKeyboard(approved, { owner: true, canMove: true, canRemove: true }));
      return;
    }

    if (data.startsWith("bc:tchoose:")) {
      const groups = await listTriggerGroups(trigger.groupId);
      await startCommunityConversation({
        groupId: trigger.groupId,
        actorTelegramId: actorId,
        kind: "APPROVE_TRIGGER_MOVE",
        step: "TARGET",
        data: { triggerId: trigger.id, pattern: trigger.pattern, submitterTelegramId: trigger.createdByTelegramId }
      });
      const keyboard = new InlineKeyboard();
      for (const category of groups.filter((candidate) => candidate.id !== trigger.triggerGroupId)) {
        keyboard.text(`${category.name} · ${category.action.toLowerCase()}`, `bc:apto:${category.id}`).row();
      }
      keyboard.text("Cancel", "bc:cancel");
      await answerCallback(ctx);
      await editCard(ctx, `<b>Approve with action</b>\n<code>${escapeHtml(trigger.pattern)}</code>\n\nChoose the trigger group that owns the desired action.`, keyboard);
      return;
    }

    await startCommunityConversation({
      groupId: trigger.groupId,
      actorTelegramId: actorId,
      kind: "REJECT_TRIGGER",
      step: "CONFIRM",
      data: { triggerId: trigger.id, pattern: trigger.pattern, submitterTelegramId: trigger.createdByTelegramId }
    });
    await answerCallback(ctx);
    await editCard(ctx, `<b>Remove submitted trigger?</b>\n<code>${escapeHtml(trigger.pattern)}</code>`, new InlineKeyboard().text("Remove", "bc:trejectok").row().text("Cancel", "bc:cancel"));
    return;
  }

  const group = await selectedCommunityGroup(ctx, config);
  if (!group) return answerCallback(ctx, "Choose a community first.", true);
  const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
  if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
  const conversation = await activeCommunityConversation(group.id, actorId);

  if (data.startsWith("bc:apto:")) {
    if (!conversation || conversation.kind !== "APPROVE_TRIGGER_MOVE") return answerCallback(ctx, "This approval expired.", true);
    const values = jsonData(conversation.data);
    const triggerId = stringValue(values.triggerId);
    const targetGroupId = data.slice("bc:apto:".length);
    if (!triggerId || !(await moveAndApproveCommunityTrigger(group.id, triggerId, targetGroupId, actorId))) {
      return answerCallback(ctx, "That approval could not be completed.", true);
    }
    const approved = await communityTriggerById(group.id, triggerId);
    await clearCommunityConversation(group.id, actorId);
    await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "TRIGGER_APPROVED_AND_MOVED", details: { triggerId, targetGroupId } });
    if (approved) await notifyTriggerSubmitter(ctx, approved.createdByTelegramId, `Approved: “${approved.pattern}” is now active in ${approved.triggerGroup.name}.`, config.ownerTelegramId);
    await answerCallback(ctx, "Trigger approved.");
    await showTriggerLibrary(ctx, group, access, true);
    return;
  }

  if (data === "bc:trejectok") {
    if (!conversation || conversation.kind !== "REJECT_TRIGGER") return answerCallback(ctx, "This removal expired.", true);
    const values = jsonData(conversation.data);
    const triggerId = stringValue(values.triggerId);
    if (!triggerId || !(await removeCommunityTrigger(group.id, triggerId))) return answerCallback(ctx, "That trigger is no longer available.", true);
    await clearCommunityConversation(group.id, actorId);
    await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "TRIGGER_REJECTED", details: { triggerId, pattern: values.pattern } });
    const submitter = stringValue(values.submitterTelegramId);
    if (submitter) await notifyTriggerSubmitter(ctx, submitter, `Not added: “${stringValue(values.pattern) ?? "Submitted trigger"}” was removed during review.`, config.ownerTelegramId);
    await answerCallback(ctx, "Submission removed.");
    await showTriggerLibrary(ctx, group, access, true);
  }
}

async function notifyTriggerSubmitter(ctx: Context, telegramId: string, text: string, ownerTelegramId: string): Promise<void> {
  if (telegramId === ownerTelegramId) return;
  await ctx.api.sendMessage(Number(telegramId), text).catch(() => undefined);
}

async function handleConversationMessage(
  ctx: Context,
  group: CommunityGroup,
  conversation: Awaited<ReturnType<typeof activeCommunityConversation>>,
  access: CommunityAccess,
  config: BeaconConfig
): Promise<boolean> {
  if (!conversation || !ctx.message?.text) return false;
  const actorId = String(ctx.from?.id ?? "");
  if (conversation.kind === "EDIT_SEVERITY_SCORE") {
    if (!access.owner) return true;
    const data = jsonData(conversation.data);
    const severity = stringValue(data.severity) as CommunityOffenceSeverity | undefined;
    const points = Number(ctx.message.text.trim());
    if (!severity || !Object.values(CommunityOffenceSeverity).includes(severity) || !Number.isInteger(points) || points < 0 || points > 100) {
      await ctx.reply("Send a whole number from 0 to 100.");
      return true;
    }
    await updateCommunitySeverityPoints(group.id, severity, points);
    await clearCommunityConversation(group.id, actorId);
    await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "OFFENCE_SEVERITY_SCORE_CHANGED", details: { severity, points } });
    await ctx.reply(`${severity.toLowerCase()} offences now carry ${points} point${points === 1 ? "" : "s"}.`);
    await showSeverityRules(ctx, await communityGroupById(group.id) ?? group, access, false);
    return true;
  }
  if (conversation.kind === "EDIT_SCORE_THRESHOLD") {
    if (!access.owner) return true;
    const data = jsonData(conversation.data);
    const kind = stringValue(data.kind) as "WARNING" | "MUTE" | "BAN" | undefined;
    const points = Number(ctx.message.text.trim());
    if (!kind || !["WARNING", "MUTE", "BAN"].includes(kind) || !Number.isInteger(points) || points < 1 || points > 100) {
      await ctx.reply("Send a whole number from 1 to 100.");
      return true;
    }
    const fresh = await communityGroupById(group.id) ?? group;
    const next = {
      WARNING: kind === "WARNING" ? points : fresh.warningScoreThreshold,
      MUTE: kind === "MUTE" ? points : fresh.muteScoreThreshold,
      BAN: kind === "BAN" ? points : fresh.banScoreThreshold
    };
    if (!(next.WARNING <= next.MUTE && next.MUTE <= next.BAN)) {
      await ctx.reply("Thresholds must stay ordered: warning ≤ mute ≤ permanent ban.");
      return true;
    }
    await updateCommunityScoreThreshold(group.id, kind, points);
    await clearCommunityConversation(group.id, actorId);
    await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "OFFENCE_THRESHOLD_CHANGED", details: { kind, points } });
    await ctx.reply(`${kind.toLowerCase()} threshold set to ${points}.`);
    await showSeverityRules(ctx, await communityGroupById(group.id) ?? group, access, false);
    return true;
  }
  if (conversation.kind === "OFFENCE_LOOKUP") {
    if (!access.owner && !access.moderator) return true;
    if (ctx.chat?.type !== "private") return true;
    const telegramId = ctx.message.text.trim().match(/^\d+$/)?.[0];
    if (!telegramId) {
      await ctx.reply("Send the member's numeric Telegram ID.");
      return true;
    }
    await clearCommunityConversation(group.id, actorId);
    await showMemberOffenceHistory(ctx, group, telegramId, access, false);
    return true;
  }
  if (conversation.kind === "PURGE_TOPIC_NAME") {
    if (!access.owner) return true;
    const name = ctx.message.text.trim();
    const data = jsonData(conversation.data);
    const messageThreadId = typeof data.messageThreadId === "number" ? data.messageThreadId : undefined;
    if (!messageThreadId || name.length < 1 || name.length > 128) {
      await ctx.reply("Send a topic name between 1 and 128 characters.");
      return true;
    }
    await upsertCommunityForumTopic({ groupId: group.id, messageThreadId, name });
    await updateCommunityConversation(conversation.id, "CONFIRM", { messageThreadId, topicName: name });
    await ctx.reply([
      "<b>Purge this topic?</b>",
      "Every message will be permanently deleted and the topic will be recreated empty.",
      "Old links and pins will stop working."
    ].join("\n"), { parse_mode: "HTML", reply_markup: purgeConfirmationKeyboard() });
    return true;
  }
  if (conversation.kind === "SEARCH_TRIGGER_LIBRARY") {
    if (!access.owner || ctx.chat?.type !== "private") return true;
    await updateCommunityControlTriggerFilters({ actorTelegramId: actorId, searchQuery: ctx.message.text, page: 0 });
    await clearCommunityConversation(group.id, actorId);
    await showTriggerLibrary(ctx, group, access);
    return true;
  }
  if (conversation.kind === "MODERATOR_TARGET") {
    if (!access.owner) return true;
    const repliedUser = ctx.message.reply_to_message?.from;
    const requestedId = repliedUser?.id ? String(repliedUser.id) : ctx.message.text.trim().match(/^\d+$/)?.[0];
    if (!requestedId) {
      await ctx.reply("Reply to a member's message or send their numeric Telegram ID.");
      return true;
    }
    if (requestedId === config.ownerTelegramId) {
      await ctx.reply("The owner is permanent and does not need a moderator role.");
      return true;
    }
    let member;
    try {
      member = await ctx.api.getChatMember(Number(group.telegramChatId), Number(requestedId));
    } catch {
      await ctx.reply("I couldn't verify that Telegram ID in this group.");
      return true;
    }
    if (member.user.is_bot || ["left", "kicked"].includes(member.status)) {
      await ctx.reply("Choose a current human member of this group.");
      return true;
    }
    await beginModeratorTarget(ctx, group, config, member.user, conversation.id);
    return true;
  }
  if (conversation.kind === "ADD_TRIGGER") {
    if (!canSubmitTriggerPrivately(access, ctx.chat?.type)) {
      if (!access.canAddTriggers) return true;
      await deleteMessageQuietly(ctx, ctx.message.message_id);
      await ctx.api.sendMessage(Number(actorId), "Continue the trigger submission in Beacon's private chat.").catch(() => undefined);
      return true;
    }
    const data = jsonData(conversation.data);
    const triggerGroupId = stringValue(data.triggerGroupId);
    if (!triggerGroupId) return true;
    try {
      const targetGroup = access.owner ? await triggerGroupById(group.id, triggerGroupId) : await reviewCommunityTriggerGroup(group.id);
      if (!targetGroup) throw new Error("TRIGGER_GROUP_NOT_FOUND");
      const trigger = await addCommunityTrigger({
        groupId: group.id,
        triggerGroupId: targetGroup.id,
        pattern: ctx.message.text,
        actorTelegramId: actorId,
        pendingApproval: !access.owner
      });
      await clearCommunityConversation(group.id, actorId);
      const audit = await recordCommunityAudit({
        groupId: group.id,
        actorTelegramId: actorId,
        action: access.owner ? "TRIGGER_ADDED" : "TRIGGER_SUBMITTED",
        details: { pattern: trigger.pattern, triggerGroupId: targetGroup.id, pendingApproval: !access.owner }
      });
      if (access.owner) {
        await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Trigger added</b>\n<code>${escapeHtml(trigger.pattern)}</code>`);
        await ctx.reply(`Added “${trigger.pattern}”.`, { reply_markup: new InlineKeyboard().text("Open trigger library", "bc:lib") });
      } else {
        await notifyOwner(botFromContext(ctx), config, group, audit.id, [
          "<b>Trigger submitted for review</b>",
          `Added by: <code>${escapeHtml(actorId)}</code>`,
          `Trigger: <code>${escapeHtml(trigger.pattern)}</code>`,
          "Initial action: Review only"
        ].join("\n"), triggerApprovalKeyboard(trigger.id));
        await ctx.reply(`Submitted “${trigger.pattern}” for owner review.`);
      }
    } catch (error) {
      await ctx.reply(error instanceof Error && error.message === "INVALID_TRIGGER" ? "Use a trigger between 1 and 300 characters." : "That trigger could not be saved. It may already exist in another group.");
    }
    return true;
  }
  if (conversation.kind === "CREATE_TRIGGER_GROUP") {
    if (!access.canManageTriggerGroups) return true;
    const [nameLine, ...descriptionLines] = ctx.message.text.split(/\r?\n/);
    try {
      const category = await createCommunityTriggerGroup({
        groupId: group.id,
        name: nameLine ?? "",
        description: descriptionLines.join("\n")
      });
      await clearCommunityConversation(group.id, actorId);
      await recordCommunityAudit({
        groupId: group.id,
        actorTelegramId: actorId,
        action: "TRIGGER_GROUP_CREATED",
        details: { triggerGroupId: category.id, name: category.name }
      });
      await ctx.reply(`Created “${category.name}” in review-only mode.`, {
        reply_markup: new InlineKeyboard().text("Open trigger group", `bc:cat:${category.id}`)
      });
    } catch {
      await ctx.reply("Use a unique name between 2 and 40 characters. An optional second line can describe the group.");
    }
    return true;
  }
  if (conversation.kind === "RENAME_TRIGGER_GROUP") {
    if (!access.canManageTriggerGroups) return true;
    const data = jsonData(conversation.data);
    const triggerGroupId = stringValue(data.triggerGroupId);
    if (!triggerGroupId) return true;
    try {
      const result = await renameCommunityTriggerGroup({ groupId: group.id, triggerGroupId, name: ctx.message.text });
      if (result.count !== 1) throw new Error("TRIGGER_GROUP_NOT_FOUND");
      await clearCommunityConversation(group.id, actorId);
      await recordCommunityAudit({
        groupId: group.id,
        actorTelegramId: actorId,
        action: "TRIGGER_GROUP_RENAMED",
        details: { triggerGroupId, previousName: data.previousName, name: ctx.message.text.trim() }
      });
      await ctx.reply(`Renamed the trigger group to “${ctx.message.text.trim()}”.`, {
        reply_markup: new InlineKeyboard().text("Open trigger group", `bc:cat:${triggerGroupId}`)
      });
    } catch {
      await ctx.reply("Use a unique name between 2 and 40 characters.");
    }
    return true;
  }
  if (conversation.kind === "TEST_TRIGGER") {
    if (!access.canAddTriggers && !access.canChangeTriggerSeverity && !access.owner) return true;
    const triggers = await policyTriggersForGroup(group.id);
    const matches = findPolicyMatches(ctx.message.text, triggers);
    await clearCommunityConversation(group.id, actorId);
    await ctx.reply([
      "<b>Policy test</b>",
      `Normalized: <code>${escapeHtml(normalizeCommunityText(ctx.message.text))}</code>`,
      matches.length ? `Matched: ${matches.map((match) => escapeHtml(match.triggerGroup.name)).join(", ")}` : "Matched: nothing",
      matches.length ? `Strongest action: ${highestSeverityMatch(matches)?.triggerGroup.action}` : "No automatic action would run.",
      "",
      "No member or message was affected."
    ].join("\n"), { parse_mode: "HTML" });
    return true;
  }
  if (conversation.kind === "EDIT_RULES") {
    if (!access.canEditRules) return true;
    const data = jsonData(conversation.data);
    const language = data.language === "MY" ? "MY" : "EN";
    const value = ctx.message.text.trim();
    if (value.length < 10 || value.length > 4_000) {
      await ctx.reply("Rules must be between 10 and 4,000 characters.");
      return true;
    }
    await setCommunityRules(group.id, language, value);
    await clearCommunityConversation(group.id, actorId);
    await recordAndNotify(botFromContext(ctx), config, group, {
      actorTelegramId: actorId,
      action: "RULES_CHANGED",
      details: { language, length: value.length }
    }, `<b>${language === "MY" ? "Burmese" : "English"} rules changed</b>\n${escapeHtml(value.slice(0, 600))}`);
    await ctx.reply("Rules updated.", { reply_markup: new InlineKeyboard().text("View rules", "bc:rules") });
    return true;
  }
  if (conversation.kind === "TRUSTED_TARGET") {
    if (!access.canManageTrustedMembers) return true;
    const repliedUser = ctx.message.reply_to_message?.from;
    const requestedId = repliedUser?.id ? String(repliedUser.id) : ctx.message.text.trim().match(/^\d+$/)?.[0];
    if (!requestedId) {
      await ctx.reply("Reply to a member's message or send their numeric Telegram ID.");
      return true;
    }
    let member;
    try {
      member = await ctx.api.getChatMember(Number(group.telegramChatId), Number(requestedId));
    } catch {
      await ctx.reply("I couldn't verify that Telegram ID in this group.");
      return true;
    }
    if (member.user.is_bot || ["left", "kicked"].includes(member.status)) {
      await ctx.reply("Choose a current human member of this group.");
      return true;
    }
    const trusted = await addTrustedCommunityMember({
      groupId: group.id,
      telegramId: requestedId,
      username: member.user.username,
      displayName: memberName(member.user),
      actorTelegramId: actorId
    });
    await clearCommunityConversation(group.id, actorId);
    await recordAndNotify(botFromContext(ctx), config, group, {
      actorTelegramId: actorId,
      action: "TRUSTED_MEMBER_ADDED",
      targetTelegramId: requestedId
    }, `<b>Trusted-member exemption added</b>\n${escapeHtml(trusted.displayName ?? trusted.username ?? trusted.telegramId)}`);
    await ctx.reply("Trusted-member exemption added.", { reply_markup: new InlineKeyboard().text("Open trusted members", "bc:trusted") });
    return true;
  }
  return false;
}

async function handleNaturalPolicyCommand(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<boolean> {
  const text = ctx.message?.text?.trim() ?? "";
  if (!access.canAddTriggers) return false;
  if (ctx.chat?.type !== "private") return false;
  const add = text.match(/^add\s+["“]?(.+?)["”]?\s+to\s+(.+)$/iu);
  if (add) {
    const pattern = add[1] ?? "";
    const categoryName = add[2] ?? "";
    const category = await triggerGroupByName(group.id, categoryName);
    if (!category) {
      await ctx.reply(`I couldn't find a trigger group named “${categoryName}”.`);
      return true;
    }
    try {
      const actorId = String(ctx.from!.id);
      const targetGroup = access.owner ? category : await reviewCommunityTriggerGroup(group.id);
      if (!targetGroup) throw new Error("TRIGGER_GROUP_NOT_FOUND");
      const trigger = await addCommunityTrigger({
        groupId: group.id,
        triggerGroupId: targetGroup.id,
        pattern,
        actorTelegramId: actorId,
        pendingApproval: !access.owner
      });
      const audit = await recordCommunityAudit({
        groupId: group.id,
        actorTelegramId: actorId,
        action: access.owner ? "TRIGGER_ADDED" : "TRIGGER_SUBMITTED",
        details: { pattern: trigger.pattern, requestedGroup: category.name, triggerGroupId: targetGroup.id, pendingApproval: !access.owner }
      });
      if (access.owner) {
        await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Trigger added</b>\n<code>${escapeHtml(trigger.pattern)}</code>`);
      } else {
        await notifyOwner(botFromContext(ctx), config, group, audit.id, [
          "<b>Trigger submitted for review</b>",
          `Added by: <code>${escapeHtml(actorId)}</code>`,
          `Trigger: <code>${escapeHtml(trigger.pattern)}</code>`,
          `Requested group: ${escapeHtml(category.name)}`,
          "Initial action: Review only"
        ].join("\n"), triggerApprovalKeyboard(trigger.id));
      }
      await ctx.reply(access.owner
        ? `Added “${trigger.pattern}” to ${category.name}.`
        : `Submitted “${trigger.pattern}” for owner review.`);
    } catch {
      await ctx.reply("That trigger could not be saved. It may already exist.");
    }
    return true;
  }
  const show = text.match(/^show\s+(?:all\s+)?(.+?)\s+triggers$/iu);
  if (show) {
    if (!access.owner) {
      await ctx.reply(OWNER_ONLY);
      return true;
    }
    const category = await triggerGroupByName(group.id, show[1] ?? "");
    if (!category) return false;
    await ctx.reply(`Open ${category.name}:`, { reply_markup: new InlineKeyboard().text(category.name, `bc:cat:${category.id}`) });
    return true;
  }
  return false;
}

async function beginModeratorTarget(ctx: Context, group: CommunityGroup, config: BeaconConfig, user?: { id: number; username?: string; first_name: string; last_name?: string }, conversationId?: string): Promise<void> {
  if (!user) {
    await ctx.reply("Reply to the member you want to add.");
    return;
  }
  const identity: ModeratorIdentityInput = {
    telegramId: String(user.id),
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name
  };
  if (identity.telegramId === config.ownerTelegramId) {
    await ctx.reply("The owner is permanent and does not need a moderator role.");
    return;
  }
  const data: WizardData = { target: identity, targetName: memberName(user), permissions: { ...safeModeratorDefaults }, index: 0 };
  if (conversationId) await updateCommunityConversation(conversationId, "0", data);
  else await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "MODERATOR_WIZARD", step: "0", data });
  await sendPermissionQuestion(ctx, data);
}

async function beginExistingModeratorWizard(ctx: Context, group: CommunityGroup, moderator: CommunityModerator): Promise<void> {
  const data: WizardData = {
    target: {
      telegramId: moderator.telegramId,
      username: moderator.username ?? undefined,
      firstName: moderator.firstName ?? undefined,
      lastName: moderator.lastName ?? undefined
    },
    targetName: displayModerator(moderator),
    moderatorId: moderator.id,
    permissions: {
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
    },
    index: 0
  };
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "MODERATOR_WIZARD", step: "0", data });
  await answerCallback(ctx);
  await editPermissionQuestion(ctx, data);
}

async function advanceModeratorWizard(ctx: Context, group: CommunityGroup, value: boolean): Promise<void> {
  const conversation = await activeCommunityConversation(group.id, String(ctx.from!.id));
  if (!conversation || conversation.kind !== "MODERATOR_WIZARD") return answerCallback(ctx, "This setup expired. Start again.", true);
  const data = wizardData(conversation.data);
  const question = moderatorPermissionQuestions[data.index];
  if (!question) return answerCallback(ctx, "This setup expired. Start again.", true);
  data.permissions[question.key] = value;
  data.index += 1;
  await updateCommunityConversation(conversation.id, String(data.index), data);
  await answerCallback(ctx);
  if (data.index < moderatorPermissionQuestions.length) return editPermissionQuestion(ctx, data);
  await editCard(ctx, moderatorSummaryText(data.targetName, data.permissions), moderatorSummaryKeyboard(false));
}

async function applyRecommendedModeratorPermissions(ctx: Context, group: CommunityGroup): Promise<void> {
  const conversation = await activeCommunityConversation(group.id, String(ctx.from!.id));
  if (!conversation || conversation.kind !== "MODERATOR_WIZARD") return answerCallback(ctx, "This setup expired. Start again.", true);
  const data = wizardData(conversation.data);
  if (data.moderatorId || data.index !== 0) return answerCallback(ctx, "The recommended preset is available only when adding a new moderator.", true);
  data.permissions = { ...safeModeratorDefaults };
  data.index = moderatorPermissionQuestions.length;
  await updateCommunityConversation(conversation.id, "REVIEW", data);
  await answerCallback(ctx);
  await editCard(ctx, moderatorSummaryText(data.targetName, data.permissions), moderatorSummaryKeyboard(false));
}

async function restartModeratorWizard(ctx: Context, group: CommunityGroup): Promise<void> {
  const conversation = await activeCommunityConversation(group.id, String(ctx.from!.id));
  if (!conversation || conversation.kind !== "MODERATOR_WIZARD") return answerCallback(ctx, "This setup expired. Start again.", true);
  const data = wizardData(conversation.data);
  data.index = 0;
  data.permissions = { ...safeModeratorDefaults };
  await updateCommunityConversation(conversation.id, "0", data);
  await answerCallback(ctx);
  await editPermissionQuestion(ctx, data);
}

async function saveModeratorWizard(ctx: Context, group: CommunityGroup, config: BeaconConfig, sensitiveConfirmed: boolean): Promise<void> {
  const actorId = String(ctx.from!.id);
  const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
  if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "MODERATOR_WIZARD") return answerCallback(ctx, "This setup expired. Start again.", true);
  const data = wizardData(conversation.data);
  if (hasSensitiveModeratorPermissions(data.permissions) && !sensitiveConfirmed) {
    await answerCallback(ctx);
    return editCard(ctx, moderatorSummaryText(data.targetName, data.permissions, true), moderatorSummaryKeyboard(true));
  }
  const saved = await saveCommunityModerator({ groupId: group.id, identity: data.target, permissions: data.permissions, actorTelegramId: actorId });
  await clearCommunityConversation(group.id, actorId);
  const audit = await recordCommunityAudit({
    groupId: group.id,
    actorTelegramId: actorId,
    action: saved.before ? "MODERATOR_PERMISSIONS_CHANGED" : "MODERATOR_ADDED",
    targetTelegramId: saved.after.telegramId,
    details: { before: permissionSnapshot(saved.before), after: permissionSnapshot(saved.after) }
  });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, [
    saved.before ? "<b>Moderator permissions changed</b>" : "<b>Moderator added</b>",
    escapeHtml(displayModerator(saved.after)),
    permissionDiff(saved.before, saved.after),
    "",
    moderatorDetailText(saved.after).replace("<b>Moderator</b>\n", "")
  ].join("\n"));
  await answerCallback(ctx, "Moderator saved.");
  await showModerators(ctx, group, true);
}

async function confirmRemoveModerator(ctx: Context, group: CommunityGroup, config: BeaconConfig): Promise<void> {
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "REMOVE_MODERATOR") return answerCallback(ctx, "This confirmation expired.", true);
  const data = jsonData(conversation.data);
  const moderatorId = stringValue(data.moderatorId);
  if (!moderatorId) return;
  const removed = await removeCommunityModerator(group.id, moderatorId);
  await clearCommunityConversation(group.id, actorId);
  if (!removed) return answerCallback(ctx, "Moderator not found.", true);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "MODERATOR_REMOVED", targetTelegramId: removed.telegramId });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Moderator removed</b>\n${escapeHtml(displayModerator(removed))}`);
  await answerCallback(ctx, "Moderator removed.");
  await showModerators(ctx, group, true);
}

async function beginTriggerInput(ctx: Context, group: CommunityGroup, access: CommunityAccess, kind: "ADD_TRIGGER" | "TEST_TRIGGER", triggerGroupId: string): Promise<void> {
  if (kind === "ADD_TRIGGER" && !access.canAddTriggers) return answerCallback(ctx, "You cannot add triggers.", true);
  if (kind === "TEST_TRIGGER" && !access.canAddTriggers && !access.canChangeTriggerSeverity && !access.owner) return answerCallback(ctx, "You cannot test policy triggers.", true);
  const category = await triggerGroupById(group.id, triggerGroupId);
  if (!category) return answerCallback(ctx, "Trigger group not found.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind, step: "INPUT", data: { triggerGroupId } });
  await answerCallback(ctx);
  await editCard(ctx, kind === "ADD_TRIGGER"
    ? `<b>Add trigger · ${escapeHtml(category.name)}</b>\nSend one word, phrase, or domain.\n\nUse Test message first when context could create false positives.`
    : `<b>Test policy</b>\nSend a sample message. Beacon will show the normalized text, matches, and proposed action without affecting anyone.`,
  new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function beginTriggerGroupCreation(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canManageTriggerGroups) return answerCallback(ctx, "You cannot manage trigger groups.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "CREATE_TRIGGER_GROUP", step: "INPUT" });
  await answerCallback(ctx);
  await editCard(ctx, [
    "<b>New trigger group</b>",
    "Send its name on the first line.",
    "Add an optional description on the second line.",
    "",
    "New groups begin in review-only mode."
  ].join("\n"), new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function beginTriggerGroupRename(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerGroupId: string): Promise<void> {
  if (!access.canManageTriggerGroups) return answerCallback(ctx, "You cannot manage trigger groups.", true);
  const category = await triggerGroupById(group.id, triggerGroupId);
  if (!category) return answerCallback(ctx, "Trigger group not found.", true);
  await startCommunityConversation({
    groupId: group.id,
    actorTelegramId: String(ctx.from!.id),
    kind: "RENAME_TRIGGER_GROUP",
    step: "INPUT",
    data: { triggerGroupId, previousName: category.name }
  });
  await answerCallback(ctx);
  await editCard(ctx, `<b>Rename trigger group</b>\nCurrent name: ${escapeHtml(category.name)}\n\nSend the new name.`, new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function beginTriggerGroupDeletion(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerGroupId: string): Promise<void> {
  if (!access.canManageTriggerGroups) return answerCallback(ctx, "You cannot manage trigger groups.", true);
  const category = await triggerGroupById(group.id, triggerGroupId);
  if (!category) return answerCallback(ctx, "Trigger group not found.", true);
  if (category.triggers.length > 0) return answerCallback(ctx, "Move or delete this group's triggers first.", true);
  await startCommunityConversation({
    groupId: group.id,
    actorTelegramId: String(ctx.from!.id),
    kind: "DELETE_TRIGGER_GROUP",
    step: "CONFIRM",
    data: { triggerGroupId, name: category.name }
  });
  await answerCallback(ctx);
  await editCard(ctx, `<b>Delete empty trigger group?</b>\n${escapeHtml(category.name)}`, new InlineKeyboard().text("Delete", "bc:catdelok").row().text("Cancel", "bc:cancel"));
}

async function confirmTriggerGroupDeletion(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canManageTriggerGroups) return answerCallback(ctx, "You cannot manage trigger groups.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "DELETE_TRIGGER_GROUP") return answerCallback(ctx, "This confirmation expired.", true);
  const data = jsonData(conversation.data);
  const triggerGroupId = stringValue(data.triggerGroupId);
  if (!triggerGroupId) return;
  const result = await deleteEmptyCommunityTriggerGroup(group.id, triggerGroupId);
  if (result !== "DELETED") return answerCallback(ctx, result === "NOT_EMPTY" ? "Move or delete its triggers first." : "Trigger group not found.", true);
  await clearCommunityConversation(group.id, actorId);
  await recordCommunityAudit({
    groupId: group.id,
    actorTelegramId: actorId,
    action: "TRIGGER_GROUP_DELETED",
    details: { triggerGroupId, name: data.name }
  });
  await answerCallback(ctx, "Trigger group deleted.");
  await showTriggerGroups(ctx, group, true);
}

async function beginDeleteTrigger(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerId: string): Promise<void> {
  if (!access.canRemoveTriggers) return answerCallback(ctx, "You cannot remove triggers.", true);
  const trigger = await communityTriggerById(group.id, triggerId);
  if (!trigger) return answerCallback(ctx, "Trigger not found.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "DELETE_TRIGGER", step: "CONFIRM", data: { triggerId, triggerGroupId: trigger.triggerGroupId, pattern: trigger.pattern } });
  await answerCallback(ctx);
  await editCard(ctx, `<b>Delete trigger?</b>\n<code>${escapeHtml(trigger.pattern)}</code>`, new InlineKeyboard().text("Delete", "bc:trdelok").row().text("Cancel", "bc:cancel"));
}

async function confirmDeleteTrigger(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canRemoveTriggers) return answerCallback(ctx, "You cannot remove triggers.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "DELETE_TRIGGER") return answerCallback(ctx, "This confirmation expired.", true);
  const data = jsonData(conversation.data);
  const triggerId = stringValue(data.triggerId);
  const triggerGroupId = stringValue(data.triggerGroupId);
  if (!triggerId || !triggerGroupId) return;
  await removeCommunityTrigger(group.id, triggerId);
  await clearCommunityConversation(group.id, actorId);
  await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "TRIGGER_REMOVED", details: { pattern: data.pattern } });
  await answerCallback(ctx, "Trigger deleted.");
  await showTriggerGroup(ctx, group, triggerGroupId);
}

async function beginMoveTrigger(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerId: string): Promise<void> {
  if (!access.canChangeTriggerSeverity) return answerCallback(ctx, "You cannot change trigger severity.", true);
  const trigger = await communityTriggerById(group.id, triggerId);
  if (!trigger) return answerCallback(ctx, "Trigger not found.", true);
  const groups = await listTriggerGroups(group.id);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "MOVE_TRIGGER", step: "TARGET", data: { triggerId, pattern: trigger.pattern } });
  const keyboard = new InlineKeyboard();
  for (const category of groups.filter((candidate) => candidate.id !== trigger.triggerGroupId)) keyboard.text(category.name, `bc:mvto:${category.id}`).row();
  keyboard.text("Cancel", "bc:cancel");
  await answerCallback(ctx);
  await editCard(ctx, `<b>Move trigger</b>\n<code>${escapeHtml(trigger.pattern)}</code>\n\nChoose the new trigger group.`, keyboard);
}

async function confirmMoveTrigger(ctx: Context, group: CommunityGroup, access: CommunityAccess, targetGroupId: string): Promise<void> {
  if (!access.canChangeTriggerSeverity) return answerCallback(ctx, "You cannot change trigger severity.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "MOVE_TRIGGER") return answerCallback(ctx, "This move expired.", true);
  const data = jsonData(conversation.data);
  const triggerId = stringValue(data.triggerId);
  if (!triggerId || !(await moveCommunityTrigger(group.id, triggerId, targetGroupId))) return answerCallback(ctx, "That move could not be completed.", true);
  await clearCommunityConversation(group.id, actorId);
  await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "TRIGGER_MOVED", details: { pattern: data.pattern, targetGroupId } });
  await answerCallback(ctx, "Trigger moved.");
  await showTriggerGroup(ctx, group, targetGroupId);
}

async function beginActionChoice(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerGroupId: string): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic actions.", true);
  const category = await triggerGroupById(group.id, triggerGroupId);
  if (!category) return answerCallback(ctx, "Trigger group not found.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "CHANGE_ACTION", step: "CHOOSE", data: { triggerGroupId, categoryName: category.name } });
  await answerCallback(ctx);
  await editCard(ctx, `<b>Automatic action · ${escapeHtml(category.name)}</b>\nChoose the proposed action. Every change requires confirmation.\n\nUse automatic bans only for high-confidence scam domains or exact repeated templates.`, automaticActionKeyboard());
}

async function stageActionChoice(ctx: Context, group: CommunityGroup, access: CommunityAccess, code: string): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic actions.", true);
  const conversation = await activeCommunityConversation(group.id, String(ctx.from!.id));
  if (!conversation || conversation.kind !== "CHANGE_ACTION") return answerCallback(ctx, "This setup expired.", true);
  const choice = actionChoice(code);
  if (!choice) return answerCallback(ctx, "Unknown action.", true);
  const data: Record<string, unknown> = { ...jsonData(conversation.data), choice };
  await updateCommunityConversation(conversation.id, "CONFIRM", data);
  await answerCallback(ctx);
  await editCard(ctx, [
    "<b>Confirm automatic action</b>",
    escapeHtml(stringValue(data.categoryName) ?? "Trigger group"),
    `Action: ${choice.action}${choice.deleteMessage ? " + delete message" : ""}${choice.muteDurationMinutes ? ` · ${choice.muteDurationMinutes} minutes` : ""}`,
    choice.action === CommunityModerationActionType.BAN ? "\nPermanent automatic bans can cause serious false positives." : ""
  ].join("\n"), new InlineKeyboard().text("Confirm change", "bc:actok").row().text("Cancel", "bc:cancel"));
}

async function confirmActionChoice(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic actions.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "CHANGE_ACTION") return answerCallback(ctx, "This confirmation expired.", true);
  const data = jsonData(conversation.data);
  const triggerGroupId = stringValue(data.triggerGroupId);
  const choice = actionChoiceObject(data.choice);
  if (!triggerGroupId || !choice) return;
  await updateTriggerGroupAction({ groupId: group.id, triggerGroupId, ...choice });
  await clearCommunityConversation(group.id, actorId);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "AUTOMATIC_ACTION_CHANGED", details: { triggerGroupId, choice } });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Automatic action changed</b>\n${escapeHtml(stringValue(data.categoryName) ?? "Trigger group")} → ${choice.action}`);
  await answerCallback(ctx, "Automatic action updated.");
  await showTriggerGroup(ctx, group, triggerGroupId);
}

async function beginObserveToggle(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic actions.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "OBSERVE_MODE", step: "CONFIRM", data: { next: !group.observeMode } });
  await answerCallback(ctx);
  await editCard(ctx, group.observeMode
    ? "<b>Activate automatic moderation?</b>\nMatches will begin applying their configured actions. Policy tests and moderator notifications remain available."
    : "<b>Return to observe mode?</b>\nMatches will be logged and sent for review without affecting members.",
  new InlineKeyboard().text("Confirm", "bc:observeok").row().text("Cancel", "bc:cancel"));
}

async function confirmObserveToggle(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic actions.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "OBSERVE_MODE") return answerCallback(ctx, "This confirmation expired.", true);
  const next = Boolean(jsonData(conversation.data).next);
  const updated = await setCommunityObserveMode(group.id, next);
  await clearCommunityConversation(group.id, actorId);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "OBSERVE_MODE_CHANGED", details: { observeMode: next } });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Beacon mode changed</b>\n${next ? "Observe mode" : "Active moderation"}`);
  await answerCallback(ctx, next ? "Observe mode enabled." : "Automatic moderation enabled.");
  if (ctx.chat?.type === "private") await showPrivateHome(ctx, updated, access, true);
  else await showGroupHome(ctx, updated, access, true);
}

async function toggleNewMemberPause(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<void> {
  if (!access.canLockdown) return answerCallback(ctx, "You cannot change emergency controls.", true);
  const updated = await setCommunityNewMemberPause(group.id, !group.pauseNewMemberPosting);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: String(ctx.from!.id), action: "NEW_MEMBER_POSTING_CHANGED", details: { enabled: updated.pauseNewMemberPosting, hours: updated.newMemberPauseHours } });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>New-member posting changed</b>\n${updated.pauseNewMemberPosting ? `Paused for ${updated.newMemberPauseHours} hours after joining.` : "Posting allowed."}`);
  await answerCallback(ctx, "Safety control updated.");
  await editCard(ctx, safetyText(updated), safetyKeyboard(updated, access));
}

async function beginLockdownToggle(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canLockdown) return answerCallback(ctx, "You cannot activate lockdown.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "LOCKDOWN", step: "CONFIRM", data: { next: !group.lockdownMode } });
  await answerCallback(ctx);
  await editCard(ctx, group.lockdownMode
    ? "<b>End emergency lockdown?</b>\nOrdinary members will be able to post again."
    : "<b>Activate emergency lockdown?</b>\nBeacon will remove new ordinary-member messages until lockdown is ended. Owner, moderators, and trusted members remain exempt.",
  new InlineKeyboard().text("Confirm", "bc:lockok").row().text("Cancel", "bc:cancel"));
}

async function confirmLockdownToggle(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<void> {
  if (!access.canLockdown) return answerCallback(ctx, "You cannot activate lockdown.", true);
  const actorId = String(ctx.from!.id);
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || conversation.kind !== "LOCKDOWN") return answerCallback(ctx, "This confirmation expired.", true);
  const next = Boolean(jsonData(conversation.data).next);
  const updated = await setCommunityLockdownMode(group.id, next);
  await clearCommunityConversation(group.id, actorId);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "LOCKDOWN_CHANGED", details: { enabled: next } });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Emergency lockdown ${next ? "activated" : "ended"}</b>`);
  await answerCallback(ctx, next ? "Lockdown activated." : "Lockdown ended.");
  await editCard(ctx, safetyText(updated), safetyKeyboard(updated, access));
}

async function showTrustedMembers(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canManageTrustedMembers) return answerCallback(ctx, "You cannot manage trusted members.", true);
  const members = await listTrustedCommunityMembers(group.id);
  await answerCallback(ctx);
  await editCard(ctx, trustedMembersText(members), trustedMembersKeyboard(members));
}

async function beginTrustedMemberInput(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.canManageTrustedMembers) return answerCallback(ctx, "You cannot manage trusted members.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "TRUSTED_TARGET", step: "TARGET" });
  await answerCallback(ctx);
  await editCard(ctx, "<b>Add trusted member</b>\nReply to one of their messages, or send their numeric Telegram ID.\n\nTrusted members bypass automatic filters and emergency restrictions.", new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function confirmTrustedMemberRemoval(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig, trustedId: string): Promise<void> {
  if (!access.canManageTrustedMembers) return answerCallback(ctx, "You cannot manage trusted members.", true);
  const removed = await removeTrustedCommunityMember(group.id, trustedId);
  if (!removed) return answerCallback(ctx, "Trusted member not found.", true);
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: String(ctx.from!.id), action: "TRUSTED_MEMBER_REMOVED", details: { trustedId } });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, "<b>Trusted-member exemption removed</b>");
  await answerCallback(ctx, "Exemption removed.");
  await showTrustedMembers(ctx, group, access);
}

async function cycleSafetySetting(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig, setting: "FLOOD" | "DUPLICATES" | "MENTIONS"): Promise<void> {
  if (!access.canChangeAutomaticActions) return answerCallback(ctx, "You cannot change automatic safety actions.", true);
  const updated = setting === "FLOOD"
    ? await cycleCommunityFloodPreset(group)
    : setting === "DUPLICATES"
      ? await cycleCommunityDuplicatePreset(group)
      : await cycleCommunityMentionLimit(group);
  const details = setting === "FLOOD"
    ? { limit: updated.floodMessageLimit, seconds: updated.floodWindowSeconds }
    : setting === "DUPLICATES"
      ? { limit: updated.duplicateMessageLimit, seconds: updated.duplicateWindowSeconds }
      : { limit: updated.massMentionLimit };
  const audit = await recordCommunityAudit({ groupId: group.id, actorTelegramId: String(ctx.from!.id), action: `SAFETY_${setting}_CHANGED`, details });
  await notifyOwner(botFromContext(ctx), config, group, audit.id, `<b>Safety threshold changed</b>\n${setting.toLowerCase()} · ${escapeHtml(JSON.stringify(details))}`);
  await answerCallback(ctx, "Safety threshold updated.");
  await editCard(ctx, safetyText(updated), safetyKeyboard(updated, access));
}

async function beginRuleEdit(ctx: Context, group: CommunityGroup, access: CommunityAccess, language: "EN" | "MY"): Promise<void> {
  if (!access.canEditRules) return answerCallback(ctx, "You cannot edit community rules.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "EDIT_RULES", step: "TEXT", data: { language } });
  await answerCallback(ctx);
  await editCard(ctx, `<b>Edit ${language === "MY" ? "Burmese" : "English"} rules</b>\nSend the complete replacement text.`, new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function showOpenReports(ctx: Context, group: CommunityGroup): Promise<void> {
  const [reports, total] = await Promise.all([
    listOpenCommunityReports(group.id),
    countOpenCommunityReports(group.id),
  ]);
  const keyboard = new InlineKeyboard();
  for (const report of reports) keyboard.text(`${report.reportCount} · ${report.reportedDisplayName ?? report.reportedUsername ?? "Report"}`, `bc:report:${report.id}`).row();
  keyboard.text("‹ Home", "bc:home");
  const text = [
    "<b>Open reports</b>",
    total ? `${total} report case${total === 1 ? "" : "s"}.` : "No reports need review."
  ].join("\n");
  if (ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, keyboard);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function showOpenReport(ctx: Context, group: CommunityGroup, reportId: string): Promise<void> {
  const report = await communityReportById(reportId);
  if (!report || report.groupId !== group.id || report.status !== CommunityReportStatus.OPEN) {
    await answerCallback(ctx, "This report is no longer open.", true);
    return showOpenReports(ctx, group);
  }
  const presentation = await communityReportPresentation(report);
  await answerCallback(ctx);
  await editCard(ctx, reportCardText(report, presentation.score), reportCardKeyboard(report));
}

async function handleMemberReport(ctx: Context, group: CommunityGroup, config: BeaconConfig, reason?: string): Promise<void> {
  const replied = ctx.message?.reply_to_message;
  if (!replied || !ctx.from) {
    await ctx.reply("Reply to the message you want to report, then send <code>/report</code> or <code>report this</code>.", { parse_mode: "HTML" });
    return;
  }
  if (replied.from?.id === ctx.from.id) {
    await deleteMessageQuietly(ctx, ctx.message!.message_id);
    await ctx.api.sendMessage(ctx.from.id, "You cannot report your own message.").catch(() => undefined);
    return;
  }
  const result = await createOrIncrementCommunityReport({
    groupId: group.id,
    sourceChatId: group.telegramChatId,
    sourceMessageId: replied.message_id,
    sourceMessageThreadId: replied.message_thread_id ?? ctx.message?.message_thread_id,
    sourceTopicName: topicLabel(replied.message_thread_id ?? ctx.message?.message_thread_id),
    reporterTelegramId: String(ctx.from.id),
    reportedTelegramId: replied.from?.id ? String(replied.from.id) : undefined,
    reportedUsername: replied.from?.username,
    reportedDisplayName: replied.from ? memberName(replied.from) : undefined,
    evidenceText: replied.text ?? replied.caption,
    reason
  });
  await deleteMessageQuietly(ctx, ctx.message!.message_id);
  await deliverReport(botFromContext(ctx), config, group, result.report);
  const acknowledgement = result.incremented
    ? "Report received. Moderators will review it."
    : "You already reported that message.";
  try {
    await ctx.api.sendMessage(ctx.from.id, acknowledgement);
  } catch {
    const fallback = await ctx.api.sendMessage(Number(group.telegramChatId), acknowledgement, threadOptions(ctx.message?.message_thread_id)).catch(() => undefined);
    if (fallback) setTimeout(() => void ctx.api.deleteMessage(Number(group.telegramChatId), fallback.message_id).catch(() => undefined), 8_000);
  }
}

async function deliverReport(bot: Pick<Bot, "api">, config: BeaconConfig, group: CommunityGroup, report: CommunityReport): Promise<void> {
  const destination = group.moderatorReviewChatId ?? config.moderatorChatId ?? config.ownerTelegramId;
  const presentation = await communityReportPresentation(report);
  const text = reportCardText(report, presentation.score);
  const keyboard = reportCardKeyboard(report);
  if (report.moderatorChatId && report.moderatorMessageId) {
    try {
      await bot.api.editMessageText(report.moderatorChatId, report.moderatorMessageId, text, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    } catch {
      // The moderator card may have been deleted. Create one replacement.
    }
  }
  try {
    const message = await bot.api.sendMessage(destination, text, { parse_mode: "HTML", reply_markup: keyboard });
    await attachCommunityReportMessage(report.id, String(destination), message.message_id);
  } catch (error) {
    logger.error("Beacon could not deliver a report.", { reportId: report.id, error: String(error) });
  }
}

async function handleOffenceCallback(ctx: Context, config: BeaconConfig, data: string): Promise<void> {
  const actorId = String(ctx.from?.id ?? "");
  if (!actorId) return;

  if (data.startsWith("bc:ops:")) {
    const report = await communityReportById(data.slice("bc:ops:".length));
    if (!report?.reportedTelegramId || report.status !== CommunityReportStatus.OPEN) return answerCallback(ctx, "This report cannot receive an offence score.", true);
    if (report.reportedTelegramId === config.ownerTelegramId) return answerCallback(ctx, "Beacon's owner cannot receive an offence score.", true);
    const access = await communityAccess(report.groupId, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can propose an offence.", true);
    await answerCallback(ctx);
    return editCard(ctx, [
      "<b>Propose offence severity</b>",
      `Member: ${escapeHtml(report.reportedDisplayName ?? report.reportedUsername ?? report.reportedTelegramId)}`,
      `User ID: <code>${escapeHtml(report.reportedTelegramId)}</code>`,
      "",
      "Beacon's owner controls the points attached to each severity."
    ].join("\n"), offenceSeverityKeyboard(report.id));
  }

  const severityMatch = data.match(/^bc:opse:(MINOR|MODERATE|SERIOUS|CRITICAL):(.+)$/);
  if (severityMatch) {
    const severity = severityMatch[1] as CommunityOffenceSeverity;
    const report = await communityReportById(severityMatch[2] ?? "");
    if (!report?.reportedTelegramId || report.status !== CommunityReportStatus.OPEN) return answerCallback(ctx, "This report is no longer open.", true);
    if (report.reportedTelegramId === config.ownerTelegramId) return answerCallback(ctx, "Beacon's owner cannot receive an offence score.", true);
    const access = await communityAccess(report.groupId, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can propose an offence.", true);
    const points = await communitySeverityPoints(report.groupId, severity);
    const keyboard = new InlineKeyboard();
    for (const option of offencePointOptions(points)) keyboard.text(`${option}${option === points ? " · policy" : ""}`, `bc:oppt:${severity}:${option}:${report.id}`);
    keyboard.row().text("Cancel", `bc:report:${report.id}`);
    await answerCallback(ctx);
    return editCard(ctx, [
      `<b>${escapeHtml(severity.toLowerCase())} offence</b>`,
      `Policy value: ${points} point${points === 1 ? "" : "s"}`,
      "",
      "Propose a score for this incident. This does not change the owner's severity policy."
    ].join("\n"), keyboard);
  }

  const pointMatch = data.match(/^bc:oppt:(MINOR|MODERATE|SERIOUS|CRITICAL):(\d+):(.+)$/);
  if (pointMatch) {
    const severity = pointMatch[1] as CommunityOffenceSeverity;
    const proposedPoints = Number(pointMatch[2]);
    const report = await communityReportById(pointMatch[3] ?? "");
    if (!report?.reportedTelegramId || report.status !== CommunityReportStatus.OPEN) return answerCallback(ctx, "This report is no longer open.", true);
    if (report.reportedTelegramId === config.ownerTelegramId) return answerCallback(ctx, "Beacon's owner cannot receive an offence score.", true);
    const access = await communityAccess(report.groupId, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can propose an offence.", true);
    const points = await communitySeverityPoints(report.groupId, severity);
    if (!offencePointOptions(points).includes(proposedPoints)) return answerCallback(ctx, "That score proposal is no longer available.", true);
    const proposal = await createCommunityOffenceProposal({
      reportId: report.id,
      severity,
      policyPoints: points,
      proposedPoints,
      proposedByTelegramId: actorId,
      proposalReason: report.reason ?? undefined
    });
    const offence = proposal.offence;
    if (!proposal.created) return answerCallback(ctx, "This report already has a pending or active offence score.", true);
    const audit = await recordCommunityAudit({
      groupId: report.groupId,
      actorTelegramId: actorId,
      action: "OFFENCE_SCORE_PROPOSED",
      targetTelegramId: report.reportedTelegramId,
      details: { offenceId: offence.id, reportId: report.id, severity, proposedPoints }
    });
    await notifyOwner(botFromContext(ctx), config, offence.group, audit.id, offenceProposalText(offence, report.evidenceText), offenceProposalKeyboard(offence.id, proposedPoints, points));
    await answerCallback(ctx, "Proposal sent to Beacon's owner.");
    const presentation = await communityReportPresentation(report);
    return editCard(ctx, `${reportCardText(report, presentation.score)}\n\n<b>Score proposed · ${severity.toLowerCase()} · ${proposedPoints}</b>`, reportCardKeyboard(report));
  }

  const decisionMatch = data.match(/^bc:op(a|p|r):(.+)$/);
  if (decisionMatch) {
    const offence = await communityOffenceById(decisionMatch[2] ?? "");
    if (!offence || offence.status !== "PENDING") return answerCallback(ctx, "This proposal is no longer pending.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    if (decisionMatch[1] === "r") {
      await rejectCommunityOffence(offence.id, actorId);
      await recordCommunityAudit({ groupId: offence.groupId, actorTelegramId: actorId, action: "OFFENCE_SCORE_REJECTED", targetTelegramId: offence.targetTelegramId, details: { offenceId: offence.id } });
      await answerCallback(ctx, "Proposal rejected.");
      return editCard(ctx, `${offenceProposalText(offence, offence.report?.evidenceText)}\n\n<b>Rejected</b>`, new InlineKeyboard());
    }
    const points = decisionMatch[1] === "p" ? offence.policyPoints : offence.proposedPoints;
    const confirmed = await confirmCommunityOffence(offence.id, actorId, points);
    if (!confirmed) return answerCallback(ctx, "This proposal is no longer pending.", true);
    if (offence.reportId) await resolveCommunityReport(offence.reportId, CommunityReportStatus.ACTIONED, actorId);
    await recordCommunityAudit({
      groupId: offence.groupId,
      actorTelegramId: actorId,
      action: "OFFENCE_SCORE_CONFIRMED",
      targetTelegramId: offence.targetTelegramId,
      details: { offenceId: offence.id, points, score: confirmed.score, severity: offence.severity }
    });
    await answerCallback(ctx, "Offence score confirmed.");
    if (confirmed.score >= offence.group.banScoreThreshold) {
      return editCard(ctx, [
        offenceProposalText(confirmed.offence, confirmed.offence.report?.evidenceText),
        "",
        `<b>Active score: ${confirmed.score}</b>`,
        `The permanent-ban threshold is ${offence.group.banScoreThreshold}. Confirm the ban separately.`
      ].join("\n"), new InlineKeyboard().text("Permanently ban", `bc:opban:${offence.id}`).row().text("Not now", "bc:noop"));
    }
    await applyScoreThresholdAction(ctx, offence.group, confirmed.offence, confirmed.score);
    return editCard(ctx, `${offenceProposalText(confirmed.offence, confirmed.offence.report?.evidenceText)}\n\n<b>Confirmed · active score ${confirmed.score}</b>`, new InlineKeyboard());
  }

  if (data.startsWith("bc:opban:")) {
    const offence = await communityOffenceById(data.slice("bc:opban:".length));
    if (!offence || offence.status !== "ACTIVE") return answerCallback(ctx, "This offence is no longer active.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const score = await communityMemberOffenceScore(offence.groupId, offence.targetTelegramId);
    if (score < offence.group.banScoreThreshold) return answerCallback(ctx, "The member is now below the ban threshold.", true);
    await startCommunityConversation({
      groupId: offence.groupId,
      actorTelegramId: actorId,
      kind: "OFFENCE_PERMANENT_BAN",
      step: "CONFIRM",
      data: { offenceId: offence.id, targetTelegramId: offence.targetTelegramId, score }
    });
    await answerCallback(ctx);
    return editCard(ctx, [
      "<b>Permanently ban this member?</b>",
      `User ID: <code>${escapeHtml(offence.targetTelegramId)}</code>`,
      `Active offence score: <b>${score}</b>`,
      "",
      "They cannot rejoin until the owner pardons the ban."
    ].join("\n"), new InlineKeyboard()
      .text("Confirm permanent ban", `bc:opbanok:${offence.id}`).row()
      .text("Cancel", `bc:opd:${offence.id}`));
  }

  if (data.startsWith("bc:opbanok:")) {
    const offence = await communityOffenceById(data.slice("bc:opbanok:".length));
    if (!offence || offence.status !== "ACTIVE") return answerCallback(ctx, "This offence is no longer active.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const confirmation = await activeCommunityConversation(offence.groupId, actorId);
    const bound = confirmation?.kind === "OFFENCE_PERMANENT_BAN" ? jsonData(confirmation.data) : {};
    const score = await communityMemberOffenceScore(offence.groupId, offence.targetTelegramId);
    if (
      !confirmation
      || confirmation.kind !== "OFFENCE_PERMANENT_BAN"
      || stringValue(bound.offenceId) !== offence.id
      || stringValue(bound.targetTelegramId) !== offence.targetTelegramId
      || Number(bound.score) !== score
      || score < offence.group.banScoreThreshold
    ) {
      await answerCallback(ctx, "This confirmation expired or the score changed. Reopen the offence and try again.", true);
      return editCard(ctx, offenceDetailText(offence), offenceDetailKeyboard(offence, true));
    }
    await clearCommunityConversation(offence.groupId, actorId);
    await ctx.api.banChatMember(Number(offence.group.telegramChatId), Number(offence.targetTelegramId));
    await markCommunityOffencePermanentBan(offence.id);
    await recordCommunityAction({ groupId: offence.groupId, actorTelegramId: actorId, targetTelegramId: offence.targetTelegramId, action: CommunityModerationActionType.BAN, source: "OFFENCE_THRESHOLD", reportId: offence.reportId ?? undefined, reason: `Active offence score ${score}`, reversible: true });
    await recordCommunityAudit({ groupId: offence.groupId, actorTelegramId: actorId, action: "OFFENCE_THRESHOLD_PERMANENT_BAN", targetTelegramId: offence.targetTelegramId, details: { offenceId: offence.id, score } });
    await answerCallback(ctx, "Member permanently banned.");
    return editCard(ctx, `${offenceDetailText(offence)}\n\n<b>Permanently banned · score ${score}</b>`, new InlineKeyboard());
  }

  if (data.startsWith("bc:oph:")) {
    const reference = data.slice("bc:oph:".length);
    const report = await communityReportById(reference);
    let group: CommunityGroup | null = report?.group ?? null;
    let telegramId = report?.reportedTelegramId ?? (/^\d+$/.test(reference) ? reference : undefined);
    if (!group && ctx.chat?.type === "private") group = await selectedCommunityGroup(ctx, config);
    if (!group || !telegramId) return answerCallback(ctx, "Member history is unavailable.", true);
    const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can view offence history.", true);
    await answerCallback(ctx);
    return showMemberOffenceHistory(ctx, group, telegramId, access, true, report?.id);
  }

  if (data.startsWith("bc:opd:")) {
    const offence = await communityOffenceById(data.slice("bc:opd:".length));
    if (!offence) return answerCallback(ctx, "Offence not found.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can view offence history.", true);
    await answerCallback(ctx);
    return editCard(ctx, offenceDetailText(offence), offenceDetailKeyboard(offence, access.owner));
  }

  if (data.startsWith("bc:opreduce:")) {
    const offence = await communityOffenceById(data.slice("bc:opreduce:".length));
    if (!offence || offence.status !== "ACTIVE" || offence.appliedPoints === null) return answerCallback(ctx, "This offence cannot be reduced.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    const keyboard = new InlineKeyboard();
    for (let points = 0; points < offence.appliedPoints; points += 1) {
      keyboard.text(String(points), `bc:opset:${points}:${offence.id}`);
      if ((points + 1) % 4 === 0) keyboard.row();
    }
    keyboard.row().text("Cancel", `bc:opd:${offence.id}`);
    await answerCallback(ctx);
    return editCard(ctx, `${offenceDetailText(offence)}\n\nChoose the reduced point value.`, keyboard);
  }

  const reduceMatch = data.match(/^bc:opset:(\d+):(.+)$/);
  if (reduceMatch) {
    const points = Number(reduceMatch[1]);
    const offence = await communityOffenceById(reduceMatch[2] ?? "");
    if (!offence || offence.status !== "ACTIVE" || offence.appliedPoints === null || points >= offence.appliedPoints) return answerCallback(ctx, "That reduction is no longer valid.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!access.owner) return answerCallback(ctx, OWNER_ONLY, true);
    const previousPoints = offence.appliedPoints;
    await reduceCommunityOffence(offence.id, points);
    await recordCommunityAudit({ groupId: offence.groupId, actorTelegramId: actorId, action: "OFFENCE_SCORE_REDUCED", targetTelegramId: offence.targetTelegramId, details: { offenceId: offence.id, previousPoints, points } });
    await answerCallback(ctx, "Offence score reduced.");
    return showMemberOffenceHistory(ctx, offence.group, offence.targetTelegramId, access, true);
  }

  if (data.startsWith("bc:oppardon:")) {
    const offence = await communityOffenceById(data.slice("bc:oppardon:".length));
    if (!offence || offence.status !== "ACTIVE") return answerCallback(ctx, "This offence is no longer active.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
    await answerCallback(ctx);
    return editCard(ctx, `${offenceDetailText(offence)}\n\n<b>Pardon this offence?</b>\nIts points will stop counting, but the audit record remains.`, new InlineKeyboard().text("Pardon offence", `bc:oppardonok:${offence.id}`).row().text("Cancel", `bc:opd:${offence.id}`));
  }

  if (data.startsWith("bc:oppardonok:")) {
    const offence = await communityOffenceById(data.slice("bc:oppardonok:".length));
    if (!offence) return answerCallback(ctx, "Offence not found.", true);
    const access = await communityAccess(offence.groupId, actorId, config.ownerTelegramId);
    if (!access.owner) return answerCallback(ctx, OWNER_ONLY, true);
    const result = await pardonCommunityOffence(offence.id, actorId, "Owner-approved pardon");
    if (!result.count) return answerCallback(ctx, "This offence is no longer active.", true);
    if (!(await hasPermanentCommunityBan(offence.groupId, offence.targetTelegramId))) {
      await ctx.api.unbanChatMember(Number(offence.group.telegramChatId), Number(offence.targetTelegramId), { only_if_banned: true }).catch(() => undefined);
    }
    await recordCommunityAudit({ groupId: offence.groupId, actorTelegramId: actorId, action: "OFFENCE_PARDONED", targetTelegramId: offence.targetTelegramId, details: { offenceId: offence.id } });
    await answerCallback(ctx, "Offence pardoned.");
    return showMemberOffenceHistory(ctx, offence.group, offence.targetTelegramId, access, true);
  }

  if (data.startsWith("bc:opclear:") && !data.startsWith("bc:opclearok:")) {
    const telegramId = data.slice("bc:opclear:".length);
    const group = ctx.chat?.type === "private" ? await selectedCommunityGroup(ctx, config) : null;
    if (!group) return answerCallback(ctx, "Open private controls first.", true);
    const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
    if (!access.owner) return answerCallback(ctx, OWNER_ONLY, true);
    await answerCallback(ctx);
    return editCard(ctx, `<b>Pardon all active offences?</b>\nUser ID: <code>${escapeHtml(telegramId)}</code>\n\nThe audit history will remain.`, new InlineKeyboard().text("Pardon all", `bc:opclearok:${telegramId}`).row().text("Cancel", `bc:oph:${telegramId}`));
  }

  if (data.startsWith("bc:opclearok:")) {
    const telegramId = data.slice("bc:opclearok:".length);
    const group = ctx.chat?.type === "private" ? await selectedCommunityGroup(ctx, config) : null;
    if (!group) return answerCallback(ctx, "Open private controls first.", true);
    const access = await communityAccess(group.id, actorId, config.ownerTelegramId);
    if (!access.owner) return answerCallback(ctx, OWNER_ONLY, true);
    const result = await pardonAllCommunityOffences(group.id, telegramId, actorId, "Owner cleared active score");
    await ctx.api.unbanChatMember(Number(group.telegramChatId), Number(telegramId), { only_if_banned: true }).catch(() => undefined);
    await recordCommunityAudit({ groupId: group.id, actorTelegramId: actorId, action: "OFFENCE_SCORE_CLEARED", targetTelegramId: telegramId, details: { pardonedCount: result.count } });
    await answerCallback(ctx, `${result.count} active offence${result.count === 1 ? "" : "s"} pardoned.`);
    return showMemberOffenceHistory(ctx, group, telegramId, access, true);
  }

  await answerCallback(ctx, "This offence control is no longer current.", true);
}

async function applyScoreThresholdAction(ctx: Context, group: CommunityGroup, offence: NonNullable<Awaited<ReturnType<typeof communityOffenceById>>>, score: number): Promise<void> {
  const action = score >= group.muteScoreThreshold ? CommunityModerationActionType.MUTE
    : score >= group.warningScoreThreshold ? CommunityModerationActionType.WARN
      : undefined;
  if (!action) return;
  const muteUntil = action === CommunityModerationActionType.MUTE ? new Date(Date.now() + 24 * 60 * 60_000) : undefined;
  await applyModerationAction(botFromContext(ctx), group, {
    action,
    targetTelegramId: offence.targetTelegramId,
    sourceMessageId: offence.sourceMessageId ?? undefined,
    sourceMessageThreadId: offence.sourceMessageThreadId ?? undefined,
    actorTelegramId: "BEACON",
    reason: `Active offence score ${score}`,
    muteUntil
  });
  await recordCommunityAction({
    groupId: group.id,
    actorTelegramId: "BEACON",
    targetTelegramId: offence.targetTelegramId,
    action,
    source: "OFFENCE_THRESHOLD",
    sourceMessageId: offence.sourceMessageId ?? undefined,
    sourceMessageThreadId: offence.sourceMessageThreadId ?? undefined,
    sourceTopicName: offence.sourceTopicName ?? undefined,
    reportId: offence.reportId ?? undefined,
    reason: `Active offence score ${score}`,
    muteUntil,
    reversible: action === CommunityModerationActionType.MUTE
  });
}

async function communityReportPresentation(report: CommunityReport) {
  if (!report.reportedTelegramId) return { score: 0 };
  return { score: await communityMemberOffenceScore(report.groupId, report.reportedTelegramId) };
}

async function showReportActions(ctx: Context, config: BeaconConfig, reportId: string): Promise<void> {
  const report = await communityReportById(reportId);
  if (!report) {
    await answerCallback(ctx, "This report is no longer open.", true);
    return;
  }
  const access = await communityAccess(report.groupId, String(ctx.from?.id ?? ""), config.ownerTelegramId);
  if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can review reports.", true);
  if (report.status !== CommunityReportStatus.OPEN) {
    await answerCallback(ctx, "This report is no longer open. Showing the current queue.", true);
    return showOpenReports(ctx, report.group);
  }
  const presentation = await communityReportPresentation(report);
  await answerCallback(ctx);
  await editCard(ctx, `${reportCardText(report, presentation.score)}\n\n<b>Take action</b>`, reportActionKeyboard(report, access));
}

async function handleReportActionCallback(ctx: Context, config: BeaconConfig, data: string): Promise<void> {
  const confirmedBan = data.startsWith("bc:rpbok:");
  const match = data.match(/^bc:rp:([dwmxb]):(.+)$/);
  const code = confirmedBan ? "b" : match?.[1];
  const reportId = confirmedBan ? data.slice("bc:rpbok:".length) : match?.[2];
  if (!code || !reportId) return answerCallback(ctx, "Unknown report action.", true);
  const report = await communityReportById(reportId);
  if (!report) return answerCallback(ctx, "This report is no longer available.", true);
  const actorId = String(ctx.from!.id);
  const access = await communityAccess(report.groupId, actorId, config.ownerTelegramId);
  if (!access.owner && !access.moderator) return answerCallback(ctx, "Only Beacon moderators can review reports.", true);
  if (report.status !== CommunityReportStatus.OPEN) {
    await answerCallback(ctx, "This report is already closed. Showing the current queue.", true);
    return showOpenReports(ctx, report.group);
  }
  if (!canUseReportAction(access, code)) return answerCallback(ctx, "You do not have permission for that action.", true);
  if (report.reportedTelegramId === config.ownerTelegramId) {
    return answerCallback(ctx, "Beacon's owner cannot be moderated by Beacon.", true);
  }
  if (report.reportedTelegramId && !access.owner) {
    const targetAccess = await communityAccess(report.groupId, report.reportedTelegramId, config.ownerTelegramId);
    if (targetAccess.moderator) return answerCallback(ctx, "Only Beacon's owner can moderate another moderator.", true);
  }
  if (code === "b" && !confirmedBan) {
    await startCommunityConversation({
      groupId: report.groupId,
      actorTelegramId: actorId,
      kind: "REPORT_PERMANENT_BAN",
      step: "CONFIRM",
      data: {
        reportId: report.id,
        sourceChatId: report.sourceChatId,
        sourceMessageThreadId: report.sourceMessageThreadId,
      },
    });
    await answerCallback(ctx);
    return editCard(ctx, [
      "<b>Permanently ban this member?</b>",
      escapeHtml(report.reportedDisplayName ?? report.reportedUsername ?? report.reportedTelegramId ?? "Unknown member"),
      report.reportedTelegramId ? `User ID: <code>${escapeHtml(report.reportedTelegramId)}</code>` : "",
      "",
      "They will be prevented from rejoining until the owner pardons the ban."
    ].filter(Boolean).join("\n"), new InlineKeyboard()
      .text("Confirm permanent ban", `bc:rpbok:${report.id}`).row()
      .text("‹ Take action", `bc:rpa:${report.id}`));
  }
  if (confirmedBan) {
    const confirmation = await activeCommunityConversation(report.groupId, actorId);
    const bound = confirmation?.kind === "REPORT_PERMANENT_BAN" ? jsonData(confirmation.data) : {};
    if (
      !confirmation
      || confirmation.kind !== "REPORT_PERMANENT_BAN"
      || stringValue(bound.reportId) !== report.id
      || stringValue(bound.sourceChatId) !== report.sourceChatId
      || (typeof bound.sourceMessageThreadId === "number" ? bound.sourceMessageThreadId : null) !== (report.sourceMessageThreadId ?? null)
    ) {
      await answerCallback(ctx, "This confirmation expired. Reopen the report and try again.", true);
      return showOpenReport(ctx, report.group, report.id);
    }
    await clearCommunityConversation(report.groupId, actorId);
  }
  if (code === "d") {
    await resolveCommunityReport(report.id, CommunityReportStatus.DISMISSED, actorId);
    await answerCallback(ctx, "Report dismissed.");
    const presentation = await communityReportPresentation(report);
    return editCard(ctx, `${reportCardText(report, presentation.score)}\n\n<b>Dismissed</b>`, new InlineKeyboard());
  }
  const action = code === "w" ? CommunityModerationActionType.WARN
    : code === "x" ? CommunityModerationActionType.DELETE
      : code === "m" ? CommunityModerationActionType.MUTE
        : CommunityModerationActionType.BAN;
  const reversible = action === CommunityModerationActionType.MUTE || action === CommunityModerationActionType.BAN;
  const muteUntil = action === CommunityModerationActionType.MUTE ? new Date(Date.now() + 60 * 60_000) : undefined;
  await applyModerationAction(botFromContext(ctx), report.group, {
    action,
    targetTelegramId: report.reportedTelegramId,
    sourceMessageId: report.sourceMessageId,
    sourceMessageThreadId: report.sourceMessageThreadId ?? undefined,
    actorTelegramId: actorId,
    reason: `Member report · ${report.reportCount} report${report.reportCount === 1 ? "" : "s"}`,
    muteUntil
  });
  const recorded = await recordCommunityAction({
    groupId: report.groupId,
    actorTelegramId: actorId,
    targetTelegramId: report.reportedTelegramId ?? undefined,
    action,
    source: "REPORT",
    sourceMessageId: report.sourceMessageId,
    sourceMessageThreadId: report.sourceMessageThreadId ?? undefined,
    sourceTopicName: report.sourceTopicName ?? undefined,
    reportId: report.id,
    reason: report.reason ?? undefined,
    muteUntil,
    reversible
  });
  await resolveCommunityReport(report.id, CommunityReportStatus.ACTIONED, actorId);
  await answerCallback(ctx, "Action applied.");
  const presentation = await communityReportPresentation(report);
  await editCard(ctx, `${reportCardText(report, presentation.score)}\n\n<b>Actioned · ${action}</b>`, reversible
    ? new InlineKeyboard().text("Undo", `bc:undo:${recorded.id}`)
    : new InlineKeyboard());
}

async function handleUndoCallback(ctx: Context, config: BeaconConfig, actionId: string): Promise<void> {
  const action = await communityActionById(actionId);
  if (!action || action.undoneAt || !action.reversible || !action.targetTelegramId) return answerCallback(ctx, "This action cannot be undone.", true);
  const access = await communityAccess(action.groupId, String(ctx.from!.id), config.ownerTelegramId);
  if (!access.owner && !(action.action === CommunityModerationActionType.BAN ? access.canBan : access.canMute)) return answerCallback(ctx, "You cannot undo that action.", true);
  if (action.action === CommunityModerationActionType.BAN) {
    await ctx.api.unbanChatMember(Number(action.group.telegramChatId), Number(action.targetTelegramId), { only_if_banned: true });
  } else if (action.action === CommunityModerationActionType.MUTE) {
    await ctx.api.restrictChatMember(Number(action.group.telegramChatId), Number(action.targetTelegramId), writablePermissions());
  } else return answerCallback(ctx, "This action cannot be undone.", true);
  await markCommunityActionUndone(action.id, String(ctx.from!.id));
  await answerCallback(ctx, "Moderation action undone.");
  await editCard(ctx, `${ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : "Action"}\n\nUndone`, new InlineKeyboard());
}

async function enforceConfiguredPolicy(ctx: Context, group: CommunityGroup, config: BeaconConfig, text: string): Promise<void> {
  const triggers = await policyTriggersForGroup(group.id);
  const matches = findPolicyMatches(text, triggers);
  const strongest = highestSeverityMatch(matches);
  if (!strongest) return;
  const action = strongest.triggerGroup.action;
  await notifyPolicyMatch(botFromContext(ctx), config, group, ctx, strongest.triggerGroup, group.observeMode);
  if (group.observeMode || action === CommunityModerationActionType.REVIEW) return;
  const muteUntil = action === CommunityModerationActionType.MUTE
    ? new Date(Date.now() + (strongest.triggerGroup.muteDurationMinutes ?? 60) * 60_000)
    : undefined;
  await applyModerationAction(botFromContext(ctx), group, {
    action,
    deleteMessage: strongest.triggerGroup.deleteMessage,
    targetTelegramId: String(ctx.from!.id),
    sourceMessageId: ctx.message!.message_id,
    sourceMessageThreadId: ctx.message?.message_thread_id,
    actorTelegramId: "BEACON",
    reason: `Matched ${strongest.triggerGroup.name}`,
    muteUntil
  });
  await recordCommunityAction({
    groupId: group.id,
    actorTelegramId: "BEACON",
    targetTelegramId: String(ctx.from!.id),
    action,
    source: "AUTOMATIC",
    sourceMessageId: ctx.message!.message_id,
    sourceMessageThreadId: ctx.message?.message_thread_id,
    sourceTopicName: topicLabel(ctx.message?.message_thread_id),
    reason: `Matched ${strongest.triggerGroup.name}`,
    muteUntil,
    reversible: action === CommunityModerationActionType.MUTE || action === CommunityModerationActionType.BAN
  });
}

async function enforceStructuralSafety(ctx: Context, group: CommunityGroup, config: BeaconConfig, text: string): Promise<boolean> {
  const senderId = String(ctx.from!.id);
  if (group.lockdownMode) {
    await deleteMessageQuietly(ctx, ctx.message!.message_id);
    await notifyStructuralMatch(botFromContext(ctx), config, group, ctx, "Emergency lockdown");
    return true;
  }
  if (await isNewCommunityMemberPaused(group, senderId)) {
    await deleteMessageQuietly(ctx, ctx.message!.message_id);
    await notifyStructuralMatch(botFromContext(ctx), config, group, ctx, "New-member posting pause");
    return true;
  }
  const normalized = normalizeCommunityText(text);
  const key = `${group.id}:${senderId}`;
  const now = Date.now();
  const history = (floodState.get(key) ?? []).filter((entry) => entry.at >= now - Math.max(group.floodWindowSeconds, group.duplicateWindowSeconds) * 1_000);
  history.push({ at: now, text: normalized });
  floodState.set(key, history.slice(-Math.max(group.floodMessageLimit, group.duplicateMessageLimit) * 2));
  const flood = history.filter((entry) => entry.at >= now - group.floodWindowSeconds * 1_000).length > group.floodMessageLimit;
  const duplicate = normalized.length >= 4 && history.filter((entry) => entry.at >= now - group.duplicateWindowSeconds * 1_000 && entry.text === normalized).length > group.duplicateMessageLimit;
  const mentions = (ctx.message?.entities ?? []).filter((entity) => entity.type === "mention" || entity.type === "text_mention").length;
  const reason = flood ? "Flood control" : duplicate ? "Repeated duplicate messages" : mentions > group.massMentionLimit ? "Mass mentions" : undefined;
  if (!reason) return false;
  await notifyStructuralMatch(botFromContext(ctx), config, group, ctx, reason);
  if (!group.observeMode) {
    await deleteMessageQuietly(ctx, ctx.message!.message_id);
    const muteUntil = new Date(Date.now() + 10 * 60_000);
    await muteMember(botFromContext(ctx), group.telegramChatId, senderId, muteUntil);
    await recordCommunityAction({
      groupId: group.id,
      actorTelegramId: "BEACON",
      targetTelegramId: senderId,
      action: CommunityModerationActionType.MUTE,
      source: "AUTOMATIC",
      sourceMessageId: ctx.message!.message_id,
      sourceMessageThreadId: ctx.message?.message_thread_id,
      sourceTopicName: topicLabel(ctx.message?.message_thread_id),
      reason,
      muteUntil,
      reversible: true
    });
  }
  return true;
}

async function applyModerationAction(bot: Pick<Bot, "api">, group: CommunityGroup, input: {
  action: CommunityModerationActionType;
  targetTelegramId?: string | null;
  sourceMessageId?: number;
  sourceMessageThreadId?: number;
  actorTelegramId: string;
  reason: string;
  deleteMessage?: boolean;
  muteUntil?: Date;
}): Promise<void> {
  if (
    input.deleteMessage
    || input.action === CommunityModerationActionType.DELETE
    || input.action === CommunityModerationActionType.MUTE
    || input.action === CommunityModerationActionType.BAN
  ) {
    if (input.sourceMessageId) await bot.api.deleteMessage(Number(group.telegramChatId), input.sourceMessageId).catch(() => undefined);
  }
  if (input.action === CommunityModerationActionType.WARN && input.targetTelegramId) {
    const warning = await bot.api.sendMessage(Number(group.telegramChatId), [
      `<a href="tg://user?id=${input.targetTelegramId}">Member</a>, please follow the community rules.`,
      "ကျေးဇူးပြု၍ အဖွဲ့၏ စည်းမျဉ်းများကို လိုက်နာပေးပါ။"
    ].join("\n"), { parse_mode: "HTML", ...threadOptions(input.sourceMessageThreadId) });
    setTimeout(() => void bot.api.deleteMessage(Number(group.telegramChatId), warning.message_id).catch(() => undefined), 15_000);
  }
  if (input.action === CommunityModerationActionType.MUTE && input.targetTelegramId) {
    await muteMember(bot, group.telegramChatId, input.targetTelegramId, input.muteUntil ?? new Date(Date.now() + 60 * 60_000));
  }
  if (input.action === CommunityModerationActionType.BAN && input.targetTelegramId) {
    await bot.api.banChatMember(Number(group.telegramChatId), Number(input.targetTelegramId));
  }
}

async function handleServiceMessage(ctx: Context, group: CommunityGroup, config: BeaconConfig): Promise<void> {
  const topicCreated = ctx.message?.forum_topic_created;
  const topicEdited = ctx.message?.forum_topic_edited;
  const threadId = ctx.message?.message_thread_id;
  if (threadId && topicCreated) {
    await upsertCommunityForumTopic({
      groupId: group.id,
      messageThreadId: threadId,
      name: topicCreated.name,
      iconColor: topicCreated.icon_color,
      iconCustomEmojiId: topicCreated.icon_custom_emoji_id
    });
  } else if (threadId && topicEdited?.name) {
    const existing = await communityForumTopic(group.id, threadId);
    await upsertCommunityForumTopic({
      groupId: group.id,
      messageThreadId: threadId,
      name: topicEdited.name,
      iconColor: existing?.iconColor ?? undefined,
      iconCustomEmojiId: topicEdited.icon_custom_emoji_id ?? existing?.iconCustomEmojiId ?? undefined
    });
  }
  for (const user of ctx.message?.new_chat_members ?? []) {
    await upsertCommunityMember({ groupId: group.id, telegramId: String(user.id), username: user.username, displayName: memberName(user), joined: true, active: true });
  }
  if (ctx.message?.left_chat_member) {
    const user = ctx.message.left_chat_member;
    await upsertCommunityMember({ groupId: group.id, telegramId: String(user.id), username: user.username, displayName: memberName(user), active: false });
    const suspended = await suspendCommunityModerator(group.id, String(user.id));
    if (suspended) {
      const audit = await recordCommunityAudit({
        groupId: group.id,
        actorTelegramId: "SYSTEM",
        action: "MODERATOR_AUTO_SUSPENDED",
        targetTelegramId: suspended.telegramId,
        details: { reason: "left_group_service_message" }
      });
      await notifyOwner(botFromContext(ctx), config, group, audit.id, [
        "<b>Moderator suspended</b>",
        `${escapeHtml(displayModerator(suspended))} left the group. Beacon permissions were suspended automatically.`
      ].join("\n"));
    }
  }
  if (group.cleanupServiceMessages && ctx.message) await deleteMessageQuietly(ctx, ctx.message.message_id);
}

async function beginTopicPurge(ctx: Context, group: CommunityGroup, config: BeaconConfig): Promise<void> {
  const actorId = String(ctx.from?.id ?? "");
  if (actorId !== config.ownerTelegramId) {
    await ctx.reply(OWNER_ONLY);
    return;
  }
  const messageThreadId = ctx.message?.message_thread_id;
  if (!messageThreadId || messageThreadId === 1) {
    await ctx.reply("Beacon cannot purge Telegram's General topic. Run this inside a non-General forum topic.");
    return;
  }
  const known = await communityForumTopic(group.id, messageThreadId);
  if (!known?.name) {
    await startCommunityConversation({
      groupId: group.id,
      actorTelegramId: actorId,
      kind: "PURGE_TOPIC_NAME",
      step: "NAME",
      data: { messageThreadId },
      ttlMs: 60_000
    });
    await ctx.reply([
      "<b>Topic name required</b>",
      "Telegram does not let Beacon fetch an older topic's name.",
      "Reply with the name Beacon should use when recreating this topic. This request expires in 60 seconds."
    ].join("\n"), { parse_mode: "HTML" });
    return;
  }
  await startCommunityConversation({
    groupId: group.id,
    actorTelegramId: actorId,
    kind: "PURGE_TOPIC",
    step: "CONFIRM",
    data: { messageThreadId, topicName: known.name },
    ttlMs: 60_000
  });
  await ctx.reply([
    `<b>Purge “${escapeHtml(known.name)}”?</b>`,
    "Every message will be permanently deleted and the topic will be recreated empty.",
    "Old links and pins will stop working. Confirmation expires in 60 seconds."
  ].join("\n"), { parse_mode: "HTML", reply_markup: purgeConfirmationKeyboard() });
}

async function confirmTopicPurge(ctx: Context, group: CommunityGroup, access: CommunityAccess, config: BeaconConfig): Promise<void> {
  if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
  const actorId = String(ctx.from?.id ?? "");
  const conversation = await activeCommunityConversation(group.id, actorId);
  if (!conversation || !["PURGE_TOPIC", "PURGE_TOPIC_NAME"].includes(conversation.kind) || conversation.step !== "CONFIRM") {
    return answerCallback(ctx, "This purge confirmation expired.", true);
  }
  const data = jsonData(conversation.data);
  const messageThreadId = typeof data.messageThreadId === "number" ? data.messageThreadId : undefined;
  const topicName = stringValue(data.topicName);
  const callbackThreadId = ctx.callbackQuery?.message && "message_thread_id" in ctx.callbackQuery.message
    ? ctx.callbackQuery.message.message_thread_id
    : undefined;
  if (!messageThreadId || messageThreadId === 1 || !topicName || callbackThreadId !== messageThreadId) {
    return answerCallback(ctx, "This confirmation belongs to a different topic.", true);
  }
  const topic = await communityForumTopic(group.id, messageThreadId);
  await answerCallback(ctx, "Purging topic…");
  try {
    await ctx.api.deleteForumTopic(Number(group.telegramChatId), messageThreadId);
    const allowedIconColors = [7322096, 16766590, 13338331, 9367192, 16749490, 16478047] as const;
    const iconColor = topic?.iconColor && allowedIconColors.includes(topic.iconColor as (typeof allowedIconColors)[number])
      ? topic.iconColor as (typeof allowedIconColors)[number]
      : undefined;
    const replacement = await ctx.api.createForumTopic(Number(group.telegramChatId), topicName, topic?.iconCustomEmojiId
      ? { icon_custom_emoji_id: topic.iconCustomEmojiId }
      : iconColor ? { icon_color: iconColor } : {});
    await markCommunityForumTopicReplaced(group.id, messageThreadId, replacement.message_thread_id);
    await upsertCommunityForumTopic({
      groupId: group.id,
      messageThreadId: replacement.message_thread_id,
      name: topicName,
      iconColor: replacement.icon_color,
      iconCustomEmojiId: replacement.icon_custom_emoji_id
    });
    await clearCommunityConversation(group.id, actorId);
    const audit = await recordCommunityAudit({
      groupId: group.id,
      actorTelegramId: actorId,
      action: "FORUM_TOPIC_PURGED",
      details: { previousThreadId: messageThreadId, replacementThreadId: replacement.message_thread_id, topicName }
    });
    await notifyOwner(botFromContext(ctx), config, group, audit.id, [
      "<b>Topic purged</b>",
      escapeHtml(topicName),
      `New topic ID: <code>${replacement.message_thread_id}</code>`
    ].join("\n"));
  } catch (error) {
    logger.error("Beacon topic purge failed.", { groupId: group.id, messageThreadId, error: String(error) });
    await clearCommunityConversation(group.id, actorId);
    await ctx.api.sendMessage(Number(group.telegramChatId), "Beacon could not purge and recreate that topic. Check that it can delete messages and manage topics.", threadOptions(messageThreadId)).catch(() => undefined);
  }
}

async function showSeverityRules(ctx: Context, group: CommunityGroup, access: CommunityAccess, edit = true): Promise<void> {
  if (!canUseOwnerMutation(access)) {
    if (ctx.callbackQuery) await answerCallback(ctx, OWNER_ONLY, true);
    else await ctx.reply(OWNER_ONLY);
    return;
  }
  const fresh = await communityGroupById(group.id) ?? group;
  const rules = await communitySeverityRules(group.id);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, severityRulesText(fresh, rules), severityRulesKeyboard());
  } else {
    await ctx.reply(severityRulesText(fresh, rules), { parse_mode: "HTML", reply_markup: severityRulesKeyboard() });
  }
}

async function beginSeverityScoreEdit(ctx: Context, group: CommunityGroup, access: CommunityAccess, value: string): Promise<void> {
  if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
  if (!Object.values(CommunityOffenceSeverity).includes(value as CommunityOffenceSeverity)) return answerCallback(ctx, "Unknown severity.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "EDIT_SEVERITY_SCORE", step: "POINTS", data: { severity: value } });
  await answerCallback(ctx);
  await editCard(ctx, `<b>${escapeHtml(value.toLowerCase())} offence points</b>\nSend a whole number from 0 to 100.`, new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function beginThresholdEdit(ctx: Context, group: CommunityGroup, access: CommunityAccess, value: string): Promise<void> {
  if (!canUseOwnerMutation(access)) return answerCallback(ctx, OWNER_ONLY, true);
  if (!["WARNING", "MUTE", "BAN"].includes(value)) return answerCallback(ctx, "Unknown threshold.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "EDIT_SCORE_THRESHOLD", step: "POINTS", data: { kind: value } });
  await answerCallback(ctx);
  await editCard(ctx, `<b>${escapeHtml(value.toLowerCase())} threshold</b>\nSend a whole number from 1 to 100. Thresholds must remain ordered.`, new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function beginOffenceLookup(ctx: Context, group: CommunityGroup, access: CommunityAccess, edit = true): Promise<void> {
  if (!access.owner && !access.moderator) {
    if (ctx.callbackQuery) await answerCallback(ctx, "Only Beacon moderators can view offence history.", true);
    return;
  }
  if (ctx.chat?.type !== "private") return answerCallback(ctx, "Open Beacon's private chat for member history.", true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "OFFENCE_LOOKUP", step: "TELEGRAM_ID" });
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, "<b>Members & offences</b>\nSend the member's numeric Telegram ID.", new InlineKeyboard().text("‹ Home", "bc:home"));
  } else {
    await ctx.reply("<b>Members & offences</b>\nSend the member's numeric Telegram ID.", {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("‹ Home", "bc:home"),
    });
  }
}

async function showMemberOffenceHistory(ctx: Context, group: CommunityGroup, telegramId: string, access: CommunityAccess, edit: boolean, reportId?: string): Promise<void> {
  const [score, offences] = await Promise.all([
    communityMemberOffenceScore(group.id, telegramId),
    communityMemberOffences(group.id, telegramId, 10)
  ]);
  const name = offences[0]?.targetDisplayName ?? offences[0]?.targetUsername ?? telegramId;
  const text = memberOffencesText({ name, telegramId, score, offences });
  const keyboard = memberOffencesKeyboard(telegramId, offences, access.owner, reportId);
  if (edit && ctx.callbackQuery) await editCard(ctx, text, keyboard);
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

async function showPrivateEntry(ctx: Context, config: BeaconConfig): Promise<void> {
  const selected = await selectedCommunityGroup(ctx, config);
  if (selected) {
    const access = await communityAccess(selected.id, String(ctx.from?.id ?? ""), config.ownerTelegramId);
    await showPrivateHome(ctx, selected, access);
    return;
  }
  const groups = await listManageableCommunityGroups(String(ctx.from?.id ?? ""), config.ownerTelegramId);
  if (groups.length === 1) {
    await selectCommunityControlGroup(String(ctx.from!.id), groups[0]!.id);
    const access = await communityAccess(groups[0]!.id, String(ctx.from!.id), config.ownerTelegramId);
    await showPrivateHome(ctx, groups[0]!, access);
    return;
  }
  await showPrivateGroupPicker(ctx, config);
}

async function showPrivateGroupPicker(ctx: Context, config: BeaconConfig, edit = false): Promise<void> {
  const groups = await listManageableCommunityGroups(String(ctx.from?.id ?? ""), config.ownerTelegramId);
  const text = groups.length
    ? communityPickerText()
    : "<b>Beacon</b>\nYou do not manage any configured communities.";
  const keyboard = communityPickerKeyboard(groups);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, keyboard);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function selectedCommunityGroup(ctx: Context, config: BeaconConfig): Promise<CommunityGroup | null> {
  const actorId = String(ctx.from?.id ?? "");
  if (!actorId) return null;
  const session = await communityControlSession(actorId);
  if (!session?.selectedGroup?.enabled) return null;
  const access = await communityAccess(session.selectedGroup.id, actorId, config.ownerTelegramId);
  return access.owner || access.moderator ? session.selectedGroup : null;
}

async function showPrivateHome(ctx: Context, group: CommunityGroup, access: CommunityAccess, edit = false): Promise<void> {
  const fresh = await communityGroupById(group.id) ?? group;
  const reviewCount = await countOpenCommunityReports(group.id);
  const text = privateBeaconHomeText(fresh, access.owner);
  const keyboard = privateBeaconHomeKeyboard(access, reviewCount);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, keyboard);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function showGroupHome(ctx: Context, group: CommunityGroup, access: CommunityAccess, edit = false): Promise<void> {
  const fresh = await communityGroupById(group.id) ?? group;
  const username = ctx.me.username;
  const privateControlsUrl = `https://t.me/${username}?start=manage_${fresh.id}`;
  const text = groupBeaconHomeText(fresh);
  const keyboard = groupBeaconHomeKeyboard(access.owner || access.moderator ? privateControlsUrl : undefined);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, keyboard);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function showMemberHelp(ctx: Context, group: CommunityGroup, edit = false): Promise<void> {
  const text = [
    "<b>Beacon</b>",
    "Community moderation and reporting."
  ].join("\n");
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, publicBeaconKeyboard());
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: publicBeaconKeyboard() });
  }
}

async function showReportHelp(ctx: Context, edit = false): Promise<void> {
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, reportHelpText(), new InlineKeyboard().text("‹ Beacon", "bc:public"));
  } else {
    await ctx.reply(reportHelpText(), { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("‹ Beacon", "bc:public") });
  }
}

async function showPublicRules(ctx: Context, group: CommunityGroup, edit = false): Promise<void> {
  const text = communityRulesText(group);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, new InlineKeyboard().text("‹ Beacon", "bc:public"));
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("‹ Beacon", "bc:public") });
  }
}

async function showPolicy(ctx: Context, group: CommunityGroup, edit: boolean): Promise<void> {
  const pending = await listPendingCommunityTriggers(group.id, 100);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, beaconPolicyText(), beaconPolicyKeyboard(pending.length));
  } else {
    await ctx.reply(beaconPolicyText(), { parse_mode: "HTML", reply_markup: beaconPolicyKeyboard(pending.length) });
  }
}

async function showPendingTriggers(ctx: Context, group: CommunityGroup, edit: boolean): Promise<void> {
  const pending = await listPendingCommunityTriggers(group.id);
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, pendingTriggersText(pending), pendingTriggersKeyboard(pending));
  } else {
    await ctx.reply(pendingTriggersText(pending), { parse_mode: "HTML", reply_markup: pendingTriggersKeyboard(pending) });
  }
}

async function showTriggerLibrary(ctx: Context, group: CommunityGroup, access: CommunityAccess, edit = false): Promise<void> {
  if (!access.owner) {
    if (ctx.callbackQuery) await answerCallback(ctx, OWNER_ONLY, true);
    else await ctx.reply(OWNER_ONLY);
    return;
  }
  const actorId = String(ctx.from!.id);
  let session = await communityControlSession(actorId);
  if (!session || session.selectedGroupId !== group.id) {
    await selectCommunityControlGroup(actorId, group.id);
    session = await communityControlSession(actorId);
  }
  const page = session?.triggerPage ?? 0;
  let result = await listCommunityTriggerLibrary({
    groupId: group.id,
    query: session?.triggerSearchQuery,
    action: session?.triggerActionFilter,
    triggerGroupId: session?.triggerGroupFilterId,
    page
  });
  if (result.page >= result.pages && result.page > 0) {
    await updateCommunityControlTriggerFilters({ actorTelegramId: actorId, page: result.pages - 1 });
    result = await listCommunityTriggerLibrary({
      groupId: group.id,
      query: session?.triggerSearchQuery,
      action: session?.triggerActionFilter,
      triggerGroupId: session?.triggerGroupFilterId,
      page: result.pages - 1
    });
  }
  const selectedCategory = session?.triggerGroupFilterId
    ? await triggerGroupById(group.id, session.triggerGroupFilterId)
    : null;
  const text = triggerLibraryText({
    group,
    ...result,
    query: session?.triggerSearchQuery,
    action: session?.triggerActionFilter,
    triggerGroupName: selectedCategory?.name
  });
  const keyboard = triggerLibraryKeyboard({
    items: result.items,
    page: result.page,
    pages: result.pages,
    canAdd: access.canAddTriggers,
    filtered: Boolean(session?.triggerSearchQuery || session?.triggerActionFilter || session?.triggerGroupFilterId)
  });
  if (edit && ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, text, keyboard);
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

async function beginTriggerLibrarySearch(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!access.owner) return answerCallback(ctx, OWNER_ONLY, true);
  await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "SEARCH_TRIGGER_LIBRARY", step: "QUERY" });
  await answerCallback(ctx);
  await editCard(ctx, "<b>Search trigger library</b>\nSend a word, phrase, domain, or trigger-group name.", new InlineKeyboard().text("Cancel", "bc:cancel"));
}

async function setTriggerLibraryActionFilter(ctx: Context, group: CommunityGroup, access: CommunityAccess, value: string): Promise<void> {
  const action = value === "ALL" ? null : Object.values(CommunityModerationActionType).includes(value as CommunityModerationActionType)
    ? value as CommunityModerationActionType
    : undefined;
  if (action === undefined) return answerCallback(ctx, "Unknown action filter.", true);
  await updateCommunityControlTriggerFilters({ actorTelegramId: String(ctx.from!.id), action, page: 0 });
  await showTriggerLibrary(ctx, group, access, true);
}

async function setTriggerLibraryGroupFilter(ctx: Context, group: CommunityGroup, access: CommunityAccess, value: string): Promise<void> {
  if (value !== "ALL" && !(await triggerGroupById(group.id, value))) return answerCallback(ctx, "Trigger group not found.", true);
  await updateCommunityControlTriggerFilters({ actorTelegramId: String(ctx.from!.id), triggerGroupId: value === "ALL" ? null : value, page: 0 });
  await showTriggerLibrary(ctx, group, access, true);
}

async function setTriggerLibraryPage(ctx: Context, group: CommunityGroup, access: CommunityAccess, page: number): Promise<void> {
  if (!Number.isInteger(page) || page < 0) return answerCallback(ctx, "Unknown page.", true);
  await updateCommunityControlTriggerFilters({ actorTelegramId: String(ctx.from!.id), page });
  await showTriggerLibrary(ctx, group, access, true);
}

async function clearTriggerLibraryFilters(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  await updateCommunityControlTriggerFilters({ actorTelegramId: String(ctx.from!.id), searchQuery: null, action: null, triggerGroupId: null, page: 0 });
  await showTriggerLibrary(ctx, group, access, true);
}

async function beginPrivateTriggerAdd(ctx: Context, group: CommunityGroup, access: CommunityAccess): Promise<void> {
  if (!canSubmitTriggerPrivately(access, ctx.chat?.type)) {
    if (ctx.chat?.type === "private") {
      if (ctx.callbackQuery) await answerCallback(ctx, "You cannot add triggers.", true);
      else await ctx.reply("You cannot add triggers.");
      return;
    }
    if (ctx.callbackQuery) await answerCallback(ctx, "Add triggers in Beacon's private chat.", true);
    else await ctx.reply("Add triggers in Beacon's private chat.");
    return;
  }
  if (!access.owner) {
    const review = await reviewCommunityTriggerGroup(group.id);
    if (!review) return;
    await startCommunityConversation({ groupId: group.id, actorTelegramId: String(ctx.from!.id), kind: "ADD_TRIGGER", step: "INPUT", data: { triggerGroupId: review.id } });
    if (ctx.callbackQuery) {
      await answerCallback(ctx);
      await editCard(ctx, "<b>Submit trigger for review</b>\nSend one word, phrase, or domain. Beacon will place it in review-only mode until the owner approves it.", new InlineKeyboard().text("Cancel", "bc:cancel"));
    } else await ctx.reply("Send one word, phrase, or domain. It will require owner approval.");
    return;
  }
  const groups = await listTriggerGroups(group.id);
  const keyboard = new InlineKeyboard();
  for (const category of groups) keyboard.text(`${category.name} · ${category.action.toLowerCase()}`, `bc:tradd:${category.id}`).row();
  keyboard.text("Cancel", "bc:cancel");
  if (ctx.callbackQuery) {
    await answerCallback(ctx);
    await editCard(ctx, "<b>Add trigger</b>\nChoose its trigger group. The group's action determines how Beacon responds.", keyboard);
  } else await ctx.reply("Choose a trigger group:", { reply_markup: keyboard });
}

async function showModerators(ctx: Context, group: CommunityGroup, edit = false): Promise<void> {
  const moderators = await listCommunityModerators(group.id);
  if (edit) {
    await answerCallback(ctx);
    await editCard(ctx, moderatorListText(moderators), moderatorListKeyboard(moderators));
  } else await ctx.reply(moderatorListText(moderators), { parse_mode: "HTML", reply_markup: moderatorListKeyboard(moderators) });
}

async function showModerator(ctx: Context, group: CommunityGroup, moderatorId: string): Promise<void> {
  const moderator = await communityModeratorById(group.id, moderatorId);
  if (!moderator) return answerCallback(ctx, "Moderator not found.", true);
  await answerCallback(ctx);
  await editCard(ctx, moderatorDetailText(moderator), moderatorDetailKeyboard(moderator));
}

async function showTriggerGroups(ctx: Context, group: CommunityGroup, edit = false): Promise<void> {
  const groups = await listTriggerGroups(group.id);
  if (edit) {
    await answerCallback(ctx);
    await editCard(ctx, triggerGroupsText(groups), triggerGroupsKeyboard(groups));
  } else await ctx.reply(triggerGroupsText(groups), { parse_mode: "HTML", reply_markup: triggerGroupsKeyboard(groups) });
}

async function showTriggerGroup(ctx: Context, group: CommunityGroup, triggerGroupId: string): Promise<void> {
  const category = await triggerGroupById(group.id, triggerGroupId);
  if (!category) return answerCallback(ctx, "Trigger group not found.", true);
  await answerCallback(ctx);
  await editCard(ctx, triggerGroupText(category), triggerGroupKeyboard(category));
}

async function showTrigger(ctx: Context, group: CommunityGroup, access: CommunityAccess, triggerId: string): Promise<void> {
  const trigger = await communityTriggerById(group.id, triggerId);
  if (!trigger) return answerCallback(ctx, "Trigger not found.", true);
  await answerCallback(ctx);
  await editCard(ctx, triggerDetailText(trigger), triggerDetailKeyboard(trigger, {
    owner: access.owner,
    canMove: access.canChangeTriggerSeverity,
    canRemove: access.canRemoveTriggers
  }));
}

function communityRulesText(group: CommunityGroup): string {
  return [
    "<b>Community rules</b>",
    group.rulesEnglish?.trim() || "Be respectful, stay relevant, protect personal information, and do not advertise or mislead members.",
    "",
    group.rulesBurmese?.trim() || "အချင်းချင်း လေးစားပါ။ သက်ဆိုင်ရာ အကြောင်းအရာများကိုသာ မျှဝေပြီး ကိုယ်ရေးအချက်အလက်များကို ကာကွယ်ပါ။ ကြော်ငြာခြင်းနှင့် လှည့်ဖြားခြင်း မပြုလုပ်ပါနှင့်။"
  ].join("\n");
}

async function showRules(ctx: Context, group: CommunityGroup, edit = false, access?: CommunityAccess): Promise<void> {
  const text = communityRulesText(group);
  const keyboard = new InlineKeyboard();
  if (access?.canEditRules) keyboard.text("Edit English", "bc:rule:en").text("Edit Burmese", "bc:rule:my").row();
  keyboard.text(access?.owner ? "‹ Policy" : "‹ Home", access?.owner ? "bc:policy" : "bc:home");
  if (edit) await editCard(ctx, text, keyboard);
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

async function sendPermissionQuestion(ctx: Context, data: WizardData): Promise<void> {
  const question = moderatorPermissionQuestions[data.index];
  if (!question) throw new Error("MODERATOR_WIZARD_COMPLETE");
  await ctx.reply(moderatorPermissionQuestion(question.label, question.recommended, data.index + 1, moderatorPermissionQuestions.length), {
    parse_mode: "HTML",
    reply_markup: yesNoKeyboard(!data.moderatorId && data.index === 0)
  });
}

async function editPermissionQuestion(ctx: Context, data: WizardData): Promise<void> {
  const question = moderatorPermissionQuestions[data.index];
  if (!question) throw new Error("MODERATOR_WIZARD_COMPLETE");
  await editCard(
    ctx,
    moderatorPermissionQuestion(question.label, question.recommended, data.index + 1, moderatorPermissionQuestions.length),
    yesNoKeyboard(!data.moderatorId && data.index === 0)
  );
}

async function configuredGroup(ctx: Context): Promise<CommunityGroup | null> {
  if (!ctx.chat || ctx.chat.type === "private") return null;
  return communityGroupForChat(String(ctx.chat.id));
}

async function accessFor(ctx: Context, group: CommunityGroup, config: BeaconConfig): Promise<CommunityAccess> {
  return communityAccess(group.id, String(ctx.from?.id ?? ""), config.ownerTelegramId);
}

async function notifyPolicyMatch(bot: Pick<Bot, "api">, config: BeaconConfig, group: CommunityGroup, ctx: Context, category: Pick<CommunityTriggerGroup, "name" | "action" | "deleteMessage">, observe: boolean): Promise<void> {
  if (!ctx.message || !ctx.from) return;
  const result = await createOrIncrementCommunityReport({
    groupId: group.id,
    sourceChatId: group.telegramChatId,
    sourceMessageId: ctx.message.message_id,
    sourceMessageThreadId: ctx.message.message_thread_id,
    sourceTopicName: topicLabel(ctx.message.message_thread_id),
    reporterTelegramId: "BEACON",
    reportedTelegramId: String(ctx.from.id),
    reportedUsername: ctx.from.username,
    reportedDisplayName: memberName(ctx.from),
    evidenceText: ctx.message.text ?? ctx.message.caption,
    reason: `${observe ? "Observed" : "Moderated"} · ${category.name} · proposed ${category.action}${category.deleteMessage ? " + delete" : ""}`
  });
  await deliverReport(bot, config, group, result.report);
}

async function notifyStructuralMatch(bot: Pick<Bot, "api">, config: BeaconConfig, group: CommunityGroup, ctx: Context, reason: string): Promise<void> {
  if (!ctx.message || !ctx.from) return;
  const result = await createOrIncrementCommunityReport({
    groupId: group.id,
    sourceChatId: group.telegramChatId,
    sourceMessageId: ctx.message.message_id,
    sourceMessageThreadId: ctx.message.message_thread_id,
    sourceTopicName: topicLabel(ctx.message.message_thread_id),
    reporterTelegramId: "BEACON",
    reportedTelegramId: String(ctx.from.id),
    reportedUsername: ctx.from.username,
    reportedDisplayName: memberName(ctx.from),
    evidenceText: ctx.message.text ?? ctx.message.caption,
    reason: `${group.observeMode ? "Observed" : "Moderated"} · ${reason}`
  });
  await deliverReport(bot, config, group, result.report);
}

async function notifyOwner(
  bot: Pick<Bot, "api">,
  config: BeaconConfig,
  group: CommunityGroup,
  auditId: string,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  try {
    await bot.api.sendMessage(config.ownerTelegramId, [`<b>${escapeHtml(group.title ?? "Beacon group")}</b>`, text].join("\n\n"), {
      parse_mode: "HTML",
      reply_markup: replyMarkup
    });
    await setCommunityOwnerNotificationStatus(auditId, "DELIVERED");
  } catch (error) {
    await setCommunityOwnerNotificationStatus(auditId, "FAILED");
    logger.warn("Beacon could not DM its owner. The owner must start Beacon privately first.", { auditId, error: String(error) });
  }
}

async function recordAndNotify(bot: Pick<Bot, "api">, config: BeaconConfig, group: CommunityGroup, audit: { actorTelegramId: string; action: string; targetTelegramId?: string; details?: Record<string, unknown> }, text: string): Promise<void> {
  const record = await recordCommunityAudit({ groupId: group.id, ...audit });
  await notifyOwner(bot, config, group, record.id, text);
}

async function muteMember(bot: Pick<Bot, "api">, chatId: string, telegramId: string, until: Date): Promise<void> {
  await bot.api.restrictChatMember(
    Number(chatId),
    Number(telegramId),
    { can_send_messages: false },
    { until_date: Math.floor(until.getTime() / 1_000) }
  );
}

function writablePermissions() {
  return {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: false,
    can_invite_users: true,
    can_pin_messages: false,
    can_manage_topics: false
  };
}

function actionChoice(code: string): ActionChoice | undefined {
  if (code === "review") return { action: CommunityModerationActionType.REVIEW, deleteMessage: false };
  if (code === "warn") return { action: CommunityModerationActionType.WARN, deleteMessage: true };
  if (code === "mute60") return { action: CommunityModerationActionType.MUTE, deleteMessage: true, muteDurationMinutes: 60 };
  if (code === "mute1440") return { action: CommunityModerationActionType.MUTE, deleteMessage: true, muteDurationMinutes: 1_440 };
  if (code === "ban") return { action: CommunityModerationActionType.BAN, deleteMessage: true };
  return undefined;
}

function actionChoiceObject(value: unknown): ActionChoice | undefined {
  if (!value || typeof value !== "object") return undefined;
  const choice = value as Record<string, unknown>;
  if (!Object.values(CommunityModerationActionType).includes(choice.action as CommunityModerationActionType)) return undefined;
  if (typeof choice.deleteMessage !== "boolean") return undefined;
  if (choice.muteDurationMinutes !== undefined && typeof choice.muteDurationMinutes !== "number") return undefined;
  return choice as ActionChoice;
}

function wizardData(value: unknown): WizardData {
  const data = jsonData(value);
  return {
    target: data.target as ModeratorIdentityInput,
    targetName: stringValue(data.targetName) ?? "Member",
    moderatorId: stringValue(data.moderatorId),
    permissions: { ...safeModeratorDefaults, ...(data.permissions as Partial<ModeratorWizardPermissions> ?? {}) },
    index: typeof data.index === "number" ? data.index : 0
  };
}

function permissionSnapshot(moderator: CommunityModerator | null): Record<string, boolean> | null {
  if (!moderator) return null;
  return {
    warn: moderator.canWarn,
    delete: moderator.canDelete,
    mute: moderator.canMute,
    ban: moderator.canBan,
    editRules: moderator.canEditRules,
    addTriggers: moderator.canAddTriggers,
    removeTriggers: moderator.canRemoveTriggers,
    changeTriggerSeverity: moderator.canChangeTriggerSeverity,
    manageTriggerGroups: moderator.canManageTriggerGroups,
    automaticActions: moderator.canChangeAutomaticActions,
    trustedMembers: moderator.canManageTrustedMembers,
    lockdown: moderator.canLockdown
  };
}

function memberName(user: { first_name: string; last_name?: string; username?: string }): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || (user.username ? `@${user.username}` : "Member");
}

function jsonData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function topicLabel(messageThreadId?: number): string | undefined {
  return messageThreadId ? `Topic #${messageThreadId}` : undefined;
}

function threadOptions(messageThreadId?: number): { message_thread_id?: number } {
  return messageThreadId ? { message_thread_id: messageThreadId } : {};
}

async function editCard(ctx: Context, text: string, keyboard: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch (error) {
    if (!String(error).includes("message is not modified")) throw error;
  }
}

async function answerCallback(ctx: Context, text?: string, showAlert = false): Promise<void> {
  if (!ctx.callbackQuery) return;
  await ctx.answerCallbackQuery(text ? { text, show_alert: showAlert } : {}).catch(() => undefined);
}

async function deleteMessageQuietly(ctx: Context, messageId: number): Promise<void> {
  await ctx.api.deleteMessage(ctx.chat!.id, messageId).catch(() => undefined);
}

function botFromContext(ctx: Context): Pick<Bot, "api"> {
  return { api: ctx.api };
}
