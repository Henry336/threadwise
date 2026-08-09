import type { CommunityAccess } from "./store";

const OWNER_ONLY_PREFIXES = [
  "bc:mods",
  "bc:mod:",
  "bc:modedit:",
  "bc:modrm:",
  "bc:modrmok",
  "bc:mw:",
  "bc:lib",
  "bc:cats",
  "bc:cat",
  "bc:catdelok",
  "bc:tradd:",
  "bc:tr:",
  "bc:trdel:",
  "bc:trdelok",
  "bc:trmove:",
  "bc:mvto:",
  "bc:act:",
  "bc:actok",
  "bc:scores",
  "bc:score:",
  "bc:threshold:",
  "bc:pending",
  "bc:audits",
] as const;

const PUBLIC_GROUP_CONTROLS = new Set(["bc:public", "bc:rules", "bc:reporthelp"]);

export function isBeaconPublicGroupControl(data: string): boolean {
  return PUBLIC_GROUP_CONTROLS.has(data);
}

export function isBeaconOwnerOnlyControl(data: string): boolean {
  return OWNER_ONLY_PREFIXES.some((prefix) => data === prefix || data.startsWith(prefix));
}

export function canOpenBeaconSafety(access: CommunityAccess): boolean {
  return access.owner
    || access.canChangeAutomaticActions
    || access.canManageTrustedMembers
    || access.canLockdown;
}

export function hasBeaconOperationalHistory(access: CommunityAccess): boolean {
  return access.owner
    || access.canWarn
    || access.canDelete
    || access.canMute
    || access.canBan;
}

export function canUseReportAction(access: CommunityAccess, code: string): boolean {
  if (access.owner) return true;
  if (code === "d") return Boolean(access.moderator);
  if (code === "w") return access.canWarn;
  if (code === "x") return access.canDelete;
  if (code === "m") return access.canMute;
  if (code === "b") return access.canBan;
  if (code === "score") return Boolean(access.moderator);
  return false;
}

export function canSubmitTriggerPrivately(access: CommunityAccess, chatType?: string): boolean {
  return chatType === "private" && access.canAddTriggers;
}

export function canUseOwnerMutation(access: CommunityAccess): boolean {
  return access.owner;
}
