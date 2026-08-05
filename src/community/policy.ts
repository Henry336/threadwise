import { fontConvert, fontDetect, setGlobalOptions } from "knayi-myscript";

setGlobalOptions({ silent_mode: true });
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const MYANMAR_DIGITS: Record<string, string> = {
  "၀": "0", "၁": "1", "၂": "2", "၃": "3", "၄": "4",
  "၅": "5", "၆": "6", "၇": "7", "၈": "8", "၉": "9"
};

export type CommunityMatchType = "WORD" | "PHRASE" | "DOMAIN";

export type CommunityPolicyTrigger = {
  id: string;
  pattern: string;
  normalizedPattern: string;
  matchType: CommunityMatchType;
  triggerGroup: {
    id: string;
    name: string;
    action: "REVIEW" | "WARN" | "DELETE" | "MUTE" | "BAN";
    deleteMessage: boolean;
    muteDurationMinutes: number | null;
    notifyModerators: boolean;
    enabled: boolean;
    severity: "MINOR" | "MODERATE" | "SERIOUS" | "CRITICAL";
  };
};

export function isBeaconInvocation(value: string): boolean {
  return /^(?:(?:hey\s+)?beacon(?:\s+(?:menu|settings))?|menu)[.!?]*$/iu.test(value.trim());
}

export function normalizeCommunityText(value: string): string {
  let normalized = value.normalize("NFKC").replace(ZERO_WIDTH, "");
  if (containsMyanmar(normalized) && fontDetect(normalized) === "zawgyi") {
    normalized = fontConvert(normalized, "unicode");
  }
  normalized = normalized.replace(/[၀-၉]/g, (digit) => MYANMAR_DIGITS[digit] ?? digit);
  return normalized
    .toLocaleLowerCase("en")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedCategoryName(value: string): string {
  return normalizeCommunityText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function inferTriggerMatchType(pattern: string): CommunityMatchType {
  const value = pattern.trim();
  if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/|$)/i.test(value)) return "DOMAIN";
  if (/^[\p{L}\p{N}_-]+$/u.test(value)) return "WORD";
  return "PHRASE";
}

export function triggerMatches(normalizedText: string, trigger: Pick<CommunityPolicyTrigger, "normalizedPattern" | "matchType">): boolean {
  const pattern = trigger.normalizedPattern;
  if (!pattern) return false;
  if (trigger.matchType === "PHRASE") return normalizedText.includes(pattern);
  if (trigger.matchType === "DOMAIN") {
    return extractDomains(normalizedText).some((domain) => domain === pattern || domain.endsWith(`.${pattern}`));
  }
  return wordPattern(pattern).test(normalizedText);
}

export function findPolicyMatches(text: string, triggers: CommunityPolicyTrigger[]): CommunityPolicyTrigger[] {
  const normalized = normalizeCommunityText(text);
  return triggers.filter((trigger) => trigger.triggerGroup.enabled && triggerMatches(normalized, trigger));
}

export function highestSeverityMatch(matches: CommunityPolicyTrigger[]): CommunityPolicyTrigger | undefined {
  const rank = { REVIEW: 0, WARN: 1, DELETE: 1, MUTE: 2, BAN: 3 } as const;
  return [...matches].sort((left, right) => rank[right.triggerGroup.action] - rank[left.triggerGroup.action])[0];
}

export function offencePointOptions(policyPoints: number): number[] {
  const safePolicyPoints = Number.isFinite(policyPoints)
    ? Math.min(100, Math.max(0, Math.round(policyPoints)))
    : 0;
  return [...new Set([
    Math.max(0, safePolicyPoints - 1),
    safePolicyPoints,
    Math.min(100, safePolicyPoints + 1),
    Math.min(100, safePolicyPoints + 2)
  ])].sort((left, right) => left - right);
}

export function containsTelegramInvite(text: string): boolean {
  return /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:joinchat\/|\+)[a-z0-9_-]+/i.test(text);
}

function containsMyanmar(value: string): boolean {
  return /[\u1000-\u109F\uAA60-\uAA7F]/u.test(value);
}

function wordPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu");
}

function extractDomains(value: string): string[] {
  const matches = value.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi) ?? [];
  return matches.map((match) => match
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/, 1)[0]!
    .toLowerCase());
}

export const moderatorPermissionQuestions = [
  { key: "canWarnDelete", label: "Can delete messages and issue warnings?", recommended: true },
  { key: "canMute", label: "Can temporarily mute members?", recommended: true },
  { key: "canBan", label: "Can permanently ban members?", recommended: false, sensitive: true },
  { key: "canEditRules", label: "Can edit the English and Burmese rules?", recommended: false },
  { key: "canAddTriggers", label: "Can submit new triggers for owner review?", recommended: false },
  { key: "canManageTrustedMembers", label: "Can manage trusted-member exemptions?", recommended: false },
  { key: "canLockdown", label: "Can activate emergency lockdown?", recommended: false, sensitive: true }
] as const;

export type ModeratorWizardPermissions = {
  canWarnDelete: boolean;
  canMute: boolean;
  canBan: boolean;
  canEditRules: boolean;
  canAddTriggers: boolean;
  canRemoveTriggers: boolean;
  canChangeTriggerSeverity: boolean;
  canManageTriggerGroups: boolean;
  canChangeAutomaticActions: boolean;
  canManageTrustedMembers: boolean;
  canLockdown: boolean;
};

export const safeModeratorDefaults: ModeratorWizardPermissions = {
  canWarnDelete: true,
  canMute: true,
  canBan: false,
  canEditRules: false,
  canAddTriggers: false,
  canRemoveTriggers: false,
  canChangeTriggerSeverity: false,
  canManageTriggerGroups: false,
  canChangeAutomaticActions: false,
  canManageTrustedMembers: false,
  canLockdown: false
};

export function hasSensitiveModeratorPermissions(permissions: ModeratorWizardPermissions): boolean {
  return permissions.canBan || permissions.canLockdown;
}
