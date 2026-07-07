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

export type HelpTopic = "general" | "reminders" | "notes" | "ideas" | "search" | "settings" | "cleanup" | "commands";

export const HELP_COMMANDS: HelpCommand[] = [
  { command: "/help", description: "Show the natural-language capability guide.", example: "/help" },
  { command: "/commands", description: "Show the full slash-command reference.", example: "/commands" },
  { command: "/start", description: "Show first-run onboarding and timezone examples.", example: "/start" },
  { command: "/add", description: "Add a task and keep it on your radar until done.", example: "/add pay invoice tomorrow at 9am" },
  { command: "/remind", description: "Schedule a reminder for a specific time.", example: "/remind tomorrow at 9am | submit the form" },
  { command: "/tasks", description: "List open tasks with active numbers and buttons.", example: "/tasks" },
  { command: "/task", description: "Show one task's details and reminder status.", example: "/task 1" },
  { command: "/done", description: "Complete a task.", example: "/done 1" },
  { command: "/snooze", description: "Delay a task reminder.", example: "/snooze 1 1h" },
  { command: "/reschedule", description: "Move a dated task to another time.", example: "/reschedule 1 tomorrow at 10am" },
  { command: "/cancel", description: "Cancel an open task.", example: "/cancel 1" },
  { command: "/idea", description: "Save and structure an idea.", example: "/idea build a Telegram bot for life admin" },
  { command: "/ideas", description: "List or open saved ideas.", example: "/ideas 1" },
  { command: "/important", description: "Mark a task important.", example: "/important 1" },
  { command: "/archive", description: "Archive a note you no longer want in active notes.", example: "/archive note 1" },
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
  { command: "/calendar", description: "Get calendar export options for a dated task.", example: "/calendar 1" },
  { command: "/googlecal", description: "Get only the Google Calendar link for a dated task.", example: "/googlecal 1" },
  { command: "/gmail", description: "Connect Gmail, scan unread emails, and create reminders for important mail.", example: "/gmail connect" },
  { command: "/settings", description: "View or edit timezone, quiet hours, reminder timing, and reminder limits.", example: "/settings timezone Myanmar" },
  { command: "/undo", description: "Reverse the last supported change.", example: "/undo" },
  { command: "/version", description: "Show app version and delivery diagnostics.", example: "/version" }
];

const HELP_SECTIONS: HelpSection[] = [
  {
    topic: "general",
    title: "Quick Start",
    description: "Type normal messages. Clear requests become tasks, reminders, notes, ideas, searches, or settings changes.",
    natural: [
      "remind me to call mom tomorrow at 9",
      "save note passport expires in May",
      "show me my tasks",
      "change timezone to Myanmar"
    ],
    commands: ["/remind tomorrow at 9am | call mom", "/note passport expires in May", "/tasks", "/settings timezone Myanmar"]
  },
  {
    topic: "reminders",
    title: "Reminders And Tasks",
    description: "Create, move, finish, snooze, cancel, or mark tasks important.",
    natural: [
      "add pay invoice tomorrow at 9am",
      "remind me to check the washer after 5 mins",
      "show task 2",
      "complete task 1",
      "snooze task 1 for 1 hour",
      "move task 2 to Friday",
      "mark task 2 important",
      "cancel task 3"
    ],
    commands: ["/add pay invoice tomorrow at 9am", "/remind in 5 mins | check washer", "/task 2", "/done 1", "/snooze 1 1h", "/reschedule 2 Friday", "/important 2", "/cancel 3"]
  },
  {
    topic: "notes",
    title: "Notes",
    description: "Save, open, search, merge, archive, or restore notes.",
    natural: [
      "note DATABASE_URL is stored in Render",
      "show me the notes",
      "show note 3",
      "search notes deployment",
      "merge notes 1 2 3",
      "archive note 2",
      "restore NOTE-2"
    ],
    commands: ["/note DATABASE_URL is stored in Render", "/notes", "/note 3", "/search notes deployment", "/merge notes 1 2 3", "/archive note 2", "/restore NOTE-2"]
  },
  {
    topic: "ideas",
    title: "Ideas",
    description: "Capture ideas, open them later, score them, or create implementation briefs.",
    natural: [
      "idea build a Telegram bot for life admin",
      "show me my ideas",
      "show idea 1",
      "score IDEA-1",
      "brief IDEA-1"
    ],
    commands: ["/idea build a Telegram bot for life admin", "/ideas", "/ideas 1", "/score IDEA-1", "/brief IDEA-1"]
  },
  {
    topic: "search",
    title: "Find And Review",
    description: "Search saved items, review open loops, and see pinned or archived items.",
    natural: [
      "search reminder bot ideas",
      "search done curriculum paper",
      "show review",
      "show pins",
      "show archived notes"
    ],
    commands: ["/search reminder bot ideas", "/search done curriculum paper", "/review", "/pins", "/archived notes"]
  },
  {
    topic: "settings",
    title: "Settings",
    description: "Change reminder behavior without scheduler jargon.",
    natural: [
      "change timezone to Singapore",
      "quiet hours off",
      "set quiet hours to 22:00-08:00",
      "remind me again every 3 hours",
      "start warning me 10 mins before due tasks",
      "allow up to 200 reminders per day"
    ],
    commands: ["/settings timezone Singapore", "/settings quiet off", "/settings quiet 22:00 08:00", "/settings interval 180", "/settings due-nudge 10", "/settings max 200"]
  },
  {
    topic: "cleanup",
    title: "Undo And Cleanup",
    description: "Reverse recent saves, edits, pins, and archive changes.",
    natural: [
      "undo",
      "unstar NOTE-1",
      "remove important from task 2",
      "show archived tasks"
    ],
    commands: ["/undo", "/unpin NOTE-1", "/unpin 2", "/archived tasks"]
  }
];

export function formatStartText(timezone = "Asia/Singapore"): string {
  return [
    bold("Welcome to Threadwise"),
    "Just tell me what you want to remember, do, find, change, or schedule.",
    "",
    bold("Try typing"),
    code("remind me to call mom tomorrow at 9"),
    code("save note passport expires in May"),
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
    `${code("/help")} shows what I can do with natural examples.`,
    `${code("/commands")} shows the compact slash-command reference.`
  ].join("\n");
}

export const HELP_TEXT = formatHelpGuide();

export function formatHelpGuide(): string {
  return [
    bold("Threadwise help"),
    "Type naturally. These are the main things I understand.",
    "",
    ...HELP_SECTIONS.map(formatHelpSection),
    "",
    `Prefer slash commands? Type ${code("/commands")} for the full reference.`
  ].join("\n\n");
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
  return [`${code(item.command)} - ${item.description}`, `Example: ${code(item.example)}`].join("\n");
}
