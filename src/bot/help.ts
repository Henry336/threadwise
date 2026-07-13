import { bold, code } from "../utils/html";

export type HelpCommand = {
  command: string;
  description: string;
  example: string;
};

type HelpSection = {
  topic: HelpTopic;
  title: string;
  description: string;
  natural: string[];
  commands: string[];
};

export type HelpTopic = "general" | "reminders" | "notes" | "ideas" | "images" | "expenses" | "excel" | "search" | "settings" | "cleanup" | "commands";

export const HELP_COMMANDS: HelpCommand[] = [
  { command: "/help", description: "Show the natural-language capability guide.", example: "/help" },
  { command: "/commands", description: "Show the full slash-command reference.", example: "/commands" },
  { command: "/start", description: "Show first-run onboarding and timezone examples.", example: "/start" },
  { command: "/menu", description: "Restore the private-chat menu beneath the reply box.", example: "/menu" },
  { command: "/add", description: "Add a task and keep it on your radar until done.", example: "/add pay invoice tomorrow at 9am" },
  { command: "/remind", description: "Schedule a reminder for a specific time.", example: "/remind tomorrow at 9am | submit the form" },
  { command: "/tasks", description: "List open tasks with active numbers and buttons.", example: "/tasks" },
  { command: "/task", description: "Show one task's details and reminder status.", example: "/task 1" },
  { command: "/done", description: "Complete one task, or preview and confirm several.", example: "/done 1 2 3" },
  { command: "/snooze", description: "Delay a task reminder.", example: "/snooze 1 1h" },
  { command: "/reschedule", description: "Move a dated task to another time.", example: "/reschedule 1 tomorrow at 10am" },
  { command: "/assign", description: "Add one or more people to a group task.", example: "/assign 1 @alex and @sam" },
  { command: "/unassign", description: "Remove one assignee, or everyone when no name is given.", example: "/unassign 1 @alex" },
  { command: "/images", description: "Browse or search saved images by caption, OCR text, or filename.", example: "/images passport" },
  { command: "/image", description: "Open, caption, or request deletion of one saved image.", example: "/image caption IMG-2 Mum's passport" },
  { command: "/cancel", description: "Cancel one task, or preview and confirm several.", example: "/cancel 1 2 3" },
  { command: "/idea", description: "Save and structure an idea.", example: "/idea build a Telegram bot for life admin" },
  { command: "/ideas", description: "List or open saved ideas.", example: "/ideas 1" },
  { command: "/important", description: "Mark a task important.", example: "/important 1" },
  { command: "/archive", description: "Archive notes or ideas; multiple items require confirmation.", example: "/archive notes 1 2 3" },
  { command: "/score", description: "Score an idea for usefulness, buildability, risk, and more.", example: "/score IDEA-1" },
  { command: "/brief", description: "Create an implementation prompt for a saved idea.", example: "/brief IDEA-1" },
  { command: "/note", description: "Save a cleaned searchable note, or open a note by number.", example: "/note 1" },
  { command: "/notes", description: "List or search saved notes.", example: "/notes deployment reliability" },
  { command: "/note-analysis", description: "Analyze your saved notekeeping style.", example: "/note-analysis" },
  { command: "/merge", description: "Preview a merged note from related notes.", example: "/merge notes 1 2 3" },
  { command: "/search", description: "Semantic search across ideas, notes, and open tasks.", example: "/search notes deployment" },
  { command: "/review", description: "Show a compact review of tasks, notes, and ideas.", example: "/review" },
  { command: "/pin", description: "Mark a task important, or pin/star a note or idea.", example: "/pin 1" },
  { command: "/unpin", description: "Remove an important marker, pin, or star.", example: "/unpin 1" },
  { command: "/pins", description: "Show important tasks plus pinned notes and ideas.", example: "/pins" },
  { command: "/archived", description: "Browse archived notes, ideas, or tasks.", example: "/archived notes" },
  { command: "/restore", description: "Restore an archived item.", example: "/restore NOTE-1" },
  { command: "/calendar", description: "Connect Google Calendar or add/update a dated task as an event.", example: "/calendar 1" },
  { command: "/googlecal", description: "Get only the Google Calendar link for a dated task.", example: "/googlecal 1" },
  { command: "/gmail", description: "Connect Gmail, scan unread emails, and create reminders for important mail.", example: "/gmail connect" },
  { command: "/expense", description: "Prepare a manual expense for confirmation.", example: "/expense spent $18.40 on lunch at Toast Box today" },
  { command: "/expenses", description: "Browse saved expenses with date, month, or year filters.", example: "/expenses this month" },
  { command: "/excel", description: "Export expenses or connect and synchronize an Excel workbook.", example: "/excel create" },
  { command: "/settings", description: "Edit timezone, expense currency, OCR languages, quiet hours, and reminder behavior.", example: "/settings currency MMK" },
  { command: "/undo", description: "Reverse the last supported change.", example: "/undo" },
  { command: "/version", description: "Show app version and delivery diagnostics.", example: "/version" },
  { command: "/groupcheck", description: "Diagnose bot identity and allowlist access inside a Telegram group.", example: "/groupcheck" }
];

const HELP_SECTIONS: HelpSection[] = [
  {
    topic: "general",
    title: "👋 Quick Start",
    description: "Type normal messages. Clear requests become tasks, reminders, notes, ideas, searches, or settings changes.",
    natural: [
      "remind me to call mom tomorrow at 9",
      "don't let me forget to submit the form at 5pm",
      "nudge me to check the oven in half an hour",
      "save note passport expires in May",
      "show me my tasks",
      "change timezone to Myanmar",
      "@ThreadwiseBot remind @Alex to bring snacks at 5pm"
    ],
    commands: ["/remind tomorrow at 9am | call mom", "/note passport expires in May", "/tasks", "/settings timezone Myanmar"]
  },
  {
    topic: "reminders",
    title: "⏰ Reminders And Tasks",
    description: "Create, move, finish, snooze, cancel, or repeat reminders daily, weekly, monthly, or yearly.",
    natural: [
      "add pay invoice tomorrow at 9am",
      "remind me to check the washer after 5 mins",
      "could you remind me to call Mum day after tomorrow at noon?",
      "remind me to have dinner at 7pm every day",
      "remind me to take out the trash every Friday at 7pm",
      "remind me to pay rent on the 1st of every month at 9am",
      "remind me of Mum's birthday on 26 July every year",
      "remind Dad and @alex to check the bot at 10pm",
      "assign task 2 to @alex and @sam",
      "remove @alex from task 2",
      "send me assigned task reminders in private",
      "show task 2",
      "complete task 1",
      "complete tasks 1, 2 and 3",
      "mark task 1 as done",
      "snooze task 1 for 1 hour",
      "move task 2 to Friday",
      "mark task 2 important",
      "remove important from task 2",
      "connect my Google Calendar",
      "add task 2 to my calendar",
      "cancel task 3"
    ],
    commands: ["/add pay invoice tomorrow at 9am", "/remind 7pm every day | have dinner", "/remind every Friday at 7pm | take out the trash", "/assign 2 @alex and @sam", "/unassign 2 @alex", "/settings dm on", "/task 2", "/done 1 2 3", "/snooze 1 1h", "/reschedule 2 Friday", "/important 2", "/calendar connect", "/calendar 2", "/cancel 1 2 3"]
  },
  {
    topic: "notes",
    title: "📝 Notes",
    description: "Save, open, search, merge, archive, or restore notes.",
    natural: [
      "note DATABASE_URL is stored in Render",
      "write this down: the spare key is in the blue drawer",
      "remember that Wi-Fi password is on the router",
      "show me the notes",
      "show note 3",
      "search notes deployment",
      "merge notes 1 2 3",
      "archive note 2",
      "delete notes 1, 2 and 3",
      "bring back note NOTE-2"
    ],
    commands: ["/note DATABASE_URL is stored in Render", "/notes", "/note 3", "/search notes deployment", "/merge notes 1 2 3", "/archive notes 1 2 3", "/restore NOTE-2"]
  },
  {
    topic: "ideas",
    title: "💡 Ideas",
    description: "Capture ideas, open them later, score them, or create implementation briefs.",
    natural: [
      "idea build a Telegram bot for life admin",
      "I have an idea for a quiet-hours dashboard",
      "show me my ideas",
      "show idea 1",
      "score IDEA-1",
      "brief IDEA-1"
    ],
    commands: ["/idea build a Telegram bot for life admin", "/ideas", "/ideas 1", "/score IDEA-1", "/brief IDEA-1"]
  },
  {
    topic: "images",
    title: "🖼️ Images And OCR",
    description: "Keep the original, add an editable caption, extract searchable text locally, or read a receipt.",
    natural: [
      "send any image, then tap Save image or Extract text",
      "send an image with: save this as Mum's passport scan",
      "send an image with: save this image and extract the text",
      "send an image with: extract the text",
      "send a receipt with: save this as an expense",
      "send a Burmese receipt with: read this in Burmese and save as expense",
      "send a screenshot with: turn this into a task",
      "send an image with: remind me about this tomorrow at 9",
      "show my saved images",
      "find images captioned passport",
      "search images electricity bill",
      "open image 2",
      "caption image 2 as July electricity bill",
      "delete image 2",
      "read images in English and Burmese"
    ],
    commands: ["No command needed: attach an image and choose a button.", "/images passport", "/search images electricity bill", "/image IMG-2", "/image caption IMG-2 July bill", "/image delete IMG-2", "/settings ocr English and Burmese"]
  },
  {
    topic: "expenses",
    title: "💰 Expenses",
    description: "Save manual spending or receipt results in Threadwise, confirm/edit fields, and browse 10 newest-first rows per page.",
    natural: [
      "spent $18.40 on lunch at Toast Box today using Visa",
      "record an expense of SGD 25 for groceries",
      "set my expense currency to MMK",
      "change currency of EXP-2 to USD",
      "show my expenses today",
      "what did I spend this month",
      "show expenses for June 2026"
    ],
    commands: ["/expense spent $18.40 on lunch", "/expense edit EXP-2 currency USD", "/expenses", "/expenses today", "/expenses this month", "/expenses 2026"]
  },
  {
    topic: "excel",
    title: "📊 Excel",
    description: "Threadwise always keeps the expense record. Excel is an optional export or synchronized OneDrive workbook.",
    natural: [
      "connect my Microsoft Excel",
      "create my expense workbook",
      "sync my expenses to Excel",
      "download my expenses as Excel",
      "show my Excel status"
    ],
    commands: ["/excel connect", "/excel create", "/excel sync", "/excel export", "/excel use <OneDrive link>", "/excel disconnect"]
  },
  {
    topic: "search",
    title: "🔎 Find And Review",
    description: "Search saved items, review open loops, and see pinned or archived items.",
    natural: [
      "search reminder bot ideas",
      "search done curriculum paper",
      "find images captioned passport",
      "show review",
      "show pins",
      "show archived notes"
    ],
    commands: ["/search reminder bot ideas", "/search done curriculum paper", "/search images passport", "/review", "/pins", "/archived notes"]
  },
  {
    topic: "settings",
    title: "⚙️ Settings",
    description: "Change reminder behavior without scheduler jargon.",
    natural: [
      "change timezone to Singapore",
      "set my expense currency to MMK",
      "read images in English and Burmese",
      "use compact reminders",
      "quiet hours off",
      "set quiet hours to 22:00-08:00",
      "remind me again every 3 hours",
      "start warning me 10 mins before due tasks",
      "allow up to 200 reminders per day"
    ],
    commands: ["/settings timezone Singapore", "/settings currency MMK", "/settings ocr English and Burmese", "/settings mode compact", "/settings quiet off", "/settings quiet 22:00 08:00", "/settings interval 180", "/settings due-nudge 10", "/settings max 200"]
  },
  {
    topic: "cleanup",
    title: "↩️ Undo And Cleanup",
    description: "Reverse recent saves, edits, pins, and archive changes.",
    natural: [
      "undo",
      "take that back",
      "unstar NOTE-1",
      "remove important from task 2",
      "show archived tasks",
      "delete ideas 1, 2 and 3"
    ],
    commands: ["/undo", "/unpin NOTE-1", "/unpin 2", "/delete ideas 1 2 3", "/archived tasks"]
  }
];

export function formatStartText(timezone = "Asia/Singapore"): string {
  return [
    bold("👋 Welcome to Threadwise"),
    "I can keep track of the small stuff so it does not keep taking up space in your head.",
    "Just tell me what you want to remember, do, find, change, or schedule.",
    "In groups, mention me or reply to me so I know the message is for Threadwise.",
    "",
    bold("Try typing"),
    code("remind me to call mom tomorrow at 9"),
    code("remind me to stretch every day at 6pm"),
    code("save note passport expires in May"),
    code("send a photo, then choose Save image or Extract text"),
    code("show me my tasks"),
    code("change timezone to Myanmar"),
    "",
    bold("First setup"),
    `${bold("Current timezone:")} ${code(timezone)}`,
    "Telegram does not share an exact device timezone with bots, so I make a best guess. If this looks wrong, type a country or city:",
    code("change timezone to Singapore"),
    code("change timezone to Myanmar"),
    code("change timezone to Malaysia"),
    "",
    `${code("/menu")} restores the private-chat buttons if you hide them.`,
    `${code("/help")} shows what I can do with natural examples.`,
    `${code("/commands")} shows the compact slash-command reference.`
  ].join("\n");
}

export const HELP_TEXT = formatHelpGuide();

export function formatHelpGuide(): string {
  return [
    bold("❓ Threadwise help"),
    "Type naturally—I will do my best to understand. Pick a topic below for detailed examples.",
    "",
    ...HELP_SECTIONS.map(formatHelpSectionSummary),
    "",
    `Prefer slash commands? Type ${code("/commands")} for the full reference.`
  ].join("\n\n");
}

function formatHelpSectionSummary(section: HelpSection): string {
  return [
    bold(section.title),
    section.description,
    section.natural[0] ? `Try: ${code(section.natural[0])}` : undefined,
    `More: ${code(`/help ${section.topic}`)}`
  ].filter(Boolean).join("\n");
}

export function formatHelpTopic(topic: HelpTopic): string {
  if (topic === "commands") {
    return formatCommandReference();
  }

  if (topic === "general") {
    return formatHelpGuide();
  }

  const section = HELP_SECTIONS.find((item) => item.topic === topic);
  if (!section) {
    return formatHelpGuide();
  }

  return [
    bold(`Help: ${section.title}`),
    section.description,
    "",
    bold("Try saying"),
    ...section.natural.map((example) => code(example)),
    "",
    bold("Slash equivalents"),
    ...section.commands.map((example) => code(example)),
    "",
    `More help: ${code("/help")} or ${code("/commands")}.`
  ].join("\n");
}

export function formatCommandReference(): string {
  return [
    bold("Threadwise commands"),
    "Compact slash-command reference. Most of these also work as natural messages.",
    "",
    ...sortedHelpCommands().map(formatHelpCommand)
  ].join("\n\n");
}

export function formatHelpPage(_page = 1): string {
  return formatHelpGuide();
}

export function helpTotalPages(_pageSize = 0): number {
  return 1;
}

function sortedHelpCommands(): HelpCommand[] {
  return [...HELP_COMMANDS].sort((a, b) => a.command.localeCompare(b.command));
}

function formatHelpSection(section: HelpSection): string {
  return [
    bold(section.title),
    section.description,
    "",
    bold("Try saying"),
    ...section.natural.map((example) => code(example)),
    "",
    bold("Slash equivalents"),
    ...section.commands.map((example) => code(example))
  ].join("\n");
}

function formatHelpCommand(item: HelpCommand): string {
  return `${code(item.command)} - ${item.description}`;
}
