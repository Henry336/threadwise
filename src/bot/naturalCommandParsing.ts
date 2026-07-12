export type ListKind = "tasks" | "notes" | "ideas";
export type NaturalHelpTopic = "general" | "reminders" | "notes" | "ideas" | "images" | "expenses" | "excel" | "search" | "settings" | "cleanup" | "commands";

export function parseListRequest(text: string): ListKind | undefined {
  const normalized = normalize(text);
  const match = normalized.match(/^(?:(?:show|list|view|open|give)\s+)?(?:me\s+)?(?:all\s+|recent\s+|open\s+)?(?:my\s+|the\s+)?(tasks?|notes?|ideas?)$/)
    ?? normalized.match(/^(?:let\s+me\s+(?:see|view)|what\s+(?:are|were)\s+my|what)\s+(?:all\s+|recent\s+|open\s+)?(?:my\s+)?(tasks?|notes?|ideas?)(?:\s+do\s+i\s+have)?$/)
    ?? normalized.match(/^what\s+(tasks?|notes?|ideas?)\s+do\s+i\s+have$/);
  if (!match?.[1]) {
    return undefined;
  }

  const item = match[1];
  if (item.startsWith("task")) return "tasks";
  if (item.startsWith("note")) return "notes";
  return "ideas";
}

export function parseNaturalReminderBody(text: string): string | undefined {
  const normalized = text.trim();
  const directMatch = normalized.match(/^(?:please\s+)?remind\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:can|could|would|will)\s+you\s+remind\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:set|create|make)\s+(?:me\s+)?(?:a\s+)?reminder\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:i\s+)?(?:need|want)\s+(?:a\s+)?reminder\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?reminder\s*[:,-]?\s+(.+)$/i);
  if (directMatch?.[1]) {
    return stripTrailingPunctuation(directMatch[1]);
  }

  const forgetMatch = normalized.match(/^(?:please\s+)?(?:do\s+not|don't)\s+let\s+me\s+forget\s+(to|about)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?i\s+need\s+to\s+remember\s+(to|about)\s+(.+)$/i);
  if (forgetMatch?.[1] && forgetMatch[2]) {
    return `me ${forgetMatch[1].toLowerCase()} ${stripTrailingPunctuation(forgetMatch[2])}`;
  }

  const nudgeMatch = normalized.match(/^(?:please\s+)?(?:ping|nudge)\s+me\s+(to|about)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:alert|notify)\s+me\s+(to|about|for)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:give|send)\s+me\s+(?:a\s+)?reminder\s+(to|about|for)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?make\s+sure\s+i\s+remember\s+(to|about)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?don't\s+forget\s+(to|about)\s+(.+)$/i);
  if (nudgeMatch?.[1] && nudgeMatch[2]) {
    return `me ${nudgeMatch[1].toLowerCase()} ${stripTrailingPunctuation(nudgeMatch[2])}`;
  }

  return undefined;
}

export function parseNaturalNoteBody(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:please\s+)?note\s+to\s+self\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:note|save\s+(?:this\s+as\s+)?(?:a\s+)?note)\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:write|jot)\s+(?:this\s+)?down\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:save|keep|store)\s+(?:this\s+)?(?:as\s+)?(?:a\s+)?note\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:make|create)\s+(?:me\s+)?(?:a\s+)?note\s+(?:that|of|about)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?remember\s+that\s+(.+)$/i);
  return match?.[1] ? stripTrailingPunctuation(match[1]).replace(/^that\s+/i, "") : undefined;
}

export function parseNaturalIdeaBody(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:please\s+)?idea\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:save|capture|record)\s+(?:this\s+)?(?:as\s+)?(?:an\s+)?idea\s*[:,-]?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?i\s+(?:have|had)\s+an\s+idea\s+(?:for|to|about)\s+(.+)$/i);
  return match?.[1] ? stripTrailingPunctuation(match[1]) : undefined;
}

export function parseNaturalTaskBody(text: string): string | undefined {
  const normalized = text.trim();
  const match = normalized.match(/^(?:please\s+)?(?:add|create|make)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?(?:task|todo|to-do)\s*(?:to|for|:|-)?\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?(?:add|todo|task)\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?i\s+need\s+to\s+(.+)$/i)
    ?? normalized.match(/^(?:please\s+)?put\s+(.+?)\s+on\s+my\s+(?:task|todo|to-do)\s+list$/i);
  return match?.[1] ? stripTrailingPunctuation(match[1]) : undefined;
}

export function parseNaturalHelpRequest(text: string): NaturalHelpTopic | undefined {
  const normalized = normalize(text).replace(/[?.!]+$/g, "");

  if (/^(help|help me|what can you do|how do i use this bot|how do i use threadwise|what does this bot do)$/.test(normalized)) {
    return "general";
  }

  if (/^(commands|slash commands|show commands|show command list|command list|full command list)$/.test(normalized)) {
    return "commands";
  }

  const helpMatch = normalized.match(/^(?:help(?:\s+me)?(?:\s+with|\s+on)?|how\s+do\s+i|how\s+can\s+i|what\s+can\s+i\s+do\s+with|show\s+me\s+how\s+to|teach\s+me\s+to)\s+(.+)$/);
  const topicText = helpMatch?.[1]?.trim();
  if (!topicText) {
    return undefined;
  }

  return helpTopicFromText(topicText);
}

export function parseNaturalSettingChange(text: string): string[] | undefined {
  const reminderMode = text.match(/^(?:please\s+)?(?:use|switch\s+to|set|make)\s+(?:my\s+)?(?:reminder\s+)?(?:messages?\s+)?(?:to\s+)?(compact|digest|detailed|full|normal|individual)(?:\s+(?:reminders?|messages?))?$/i)
    ?? text.match(/^(?:please\s+)?(?:make|show)\s+(?:my\s+)?reminders?\s+(compact|detailed|full|normal)$/i);
  if (reminderMode?.[1]) return ["mode", reminderMode[1].toLowerCase()];

  const currencyMatch = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:default\s+|expense\s+)?currency\s*(?:to|as|is)?\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?(?:use|record|save)\s+(.+?)\s+(?:as|for|when recording|for recording)\s+(?:my\s+)?expenses?$/i)
    ?? text.match(/^(?:please\s+)?record\s+(?:my\s+)?expenses?\s+in\s+(.+)$/i);
  if (currencyMatch?.[1]) return ["currency", currencyMatch[1].trim()];

  const ocrMatch = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:image\s+)?ocr(?:\s+language)?\s*(?:to|as|is)?\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?(?:read|scan|extract(?:\s+text\s+from)?)\s+(?:my\s+)?images?\s+in\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?use\s+(.+?)\s+for\s+(?:image\s+)?ocr$/i);
  if (ocrMatch?.[1]) return ["ocr", ocrMatch[1].trim()];

  const timezone = parseNaturalTimezoneChange(text);
  if (timezone) {
    return ["timezone", timezone];
  }

  const quiet = parseNaturalQuietHoursChange(text);
  if (quiet) {
    return quiet;
  }

  const dueNudge = parseNaturalMinutesSetting(
    text,
    /^(?:please\s+)?(?:(?:change|set|update|make)?\s*(?:my\s+)?(?:due\s+)?nudge\s*(?:to|as)?|(?:start\s+)?warn(?:ing)?\s+me(?:\s+again)?|(?:start\s+)?warning\s+me)\s+(.+?)(?:\s+before\s+(?:due\s+)?(?:tasks?|reminders?))?$/i,
    "due-nudge"
  );
  if (dueNudge) {
    return dueNudge;
  }

  const interval = parseNaturalMinutesSetting(
    text,
    /^(?:please\s+)?(?:(?:change|set|update|make)?\s*(?:my\s+)?(?:reminder\s+)?interval\s*(?:to|as|every)?|remind\s+me\s+again\s+every|keep\s+reminding\s+me\s+every)\s+(.+)$/i,
    "interval"
  );
  if (interval) {
    return interval;
  }

  const maxMatch = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:max(?:imum)?\s+)?reminders?(?:\s+per\s+day)?\s*(?:to|as)?\s+(\d+)$/i)
    ?? text.match(/^(?:please\s+)?allow\s+up\s+to\s+(\d+)\s+reminders?(?:\s+per\s+day)?$/i)
    ?? text.match(/^(?:please\s+)?(?:change|set|update|make)\s+(?:my\s+)?max(?:imum)?\s*(?:to|as)?\s+(\d+)$/i);
  if (maxMatch?.[1]) {
    return ["max", maxMatch[1]];
  }

  return undefined;
}

function helpTopicFromText(text: string): NaturalHelpTopic | undefined {
  const normalized = normalize(text)
    .replace(/^(?:to|the|my|with|about)\s+/g, "")
    .replace(/\b(?:things|stuff|features|commands?)\b/g, "command")
    .trim();

  if (/(?:command|slash|command list)/.test(normalized)) {
    return "commands";
  }

  if (/(?:remind|reminder|reminders|task|tasks|todo|to do|snooze|complete|done|reschedule|move task|important)/.test(normalized)) {
    return "reminders";
  }

  if (/(?:note|notes|save note|saved note|merge note|archive note)/.test(normalized)) {
    return "notes";
  }

  if (/(?:idea|ideas|score|brief|implementation brief)/.test(normalized)) {
    return "ideas";
  }

  if (/(?:image|images|photo|photos|picture|pictures|screenshot|ocr|extract text|read receipt)/.test(normalized)) {
    return "images";
  }

  if (/(?:excel|spreadsheet|workbook|microsoft|onedrive|sync expense)/.test(normalized)) {
    return "excel";
  }

  if (/(?:expense|expenses|receipt|receipts|spending|spent|purchase|purchases)/.test(normalized)) {
    return "expenses";
  }

  if (/(?:search|find|review|pins|pinned|archived|archives)/.test(normalized)) {
    return "search";
  }

  if (/(?:setting|settings|timezone|time zone|currency|ocr|image language|quiet hour|quiet hours|interval|every|warn|warning|nudge|max|limit)/.test(normalized)) {
    return "settings";
  }

  if (/(?:undo|cleanup|clean up|restore|archive|unstar|unpin|delete|remove)/.test(normalized)) {
    return "cleanup";
  }

  if (/(?:use this bot|use threadwise|start|begin|get started)/.test(normalized)) {
    return "general";
  }

  return undefined;
}

export function parseNaturalTimezoneChange(text: string): string | undefined {
  const match = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?(?:time\s*zone|timezone)\s*(?:to|as|is)?\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?(?:change|set|update|make)\s+(?:my\s+)?(?:time\s*zone|timezone)\s+(.+)$/i);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  return value.replace(/^(?:to|as|is)\s+/i, "").trim();
}

function parseNaturalQuietHoursChange(text: string): string[] | undefined {
  if (/^(?:please\s+)?(?:turn\s+)?quiet\s+hours\s+off$/i.test(text.trim())) {
    return ["quiet", "off"];
  }

  const match = text.match(/^(?:please\s+)?(?:change|set|update|make)?\s*(?:my\s+)?quiet\s+hours\s*(?:to|as)?\s+(\d{1,2}:\d{2})\s*(?:-|to|until)\s*(\d{1,2}:\d{2})$/i);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return ["quiet", match[1], match[2]];
}

function parseNaturalMinutesSetting(text: string, pattern: RegExp, setting: string): string[] | undefined {
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  if (!value) {
    return undefined;
  }

  if (/^off$/i.test(value)) {
    return [setting, "off"];
  }

  const minutes = parseMinutes(value);
  return minutes ? [setting, String(minutes)] : undefined;
}

function parseMinutes(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith("h")) return amount * 60;
  if (unit.startsWith("d")) return amount * 24 * 60;
  return amount;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[?.!]+$/g, "").trim();
}
