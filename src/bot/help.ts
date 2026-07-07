import { bold, code } from "../utils/html";

export const HELP_PAGE_SIZE = 10;

export type HelpCommand = {
  command: string;
  description: string;
  example: string;
};

export const HELP_COMMANDS: HelpCommand[] = [
  { command: "/help", description: "Show this command guide.", example: "/help" },
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
  { command: "/settings", description: "View or edit timezone, quiet hours, reminder interval, and caps.", example: "/settings timezone Myanmar" },
  { command: "/undo", description: "Reverse the last supported change.", example: "/undo" },
  { command: "/version", description: "Show app version and delivery diagnostics.", example: "/version" }
];

export function formatStartText(timezone = "Asia/Singapore"): string {
  return [
    bold("Welcome to Threadwise"),
    "A private Telegram inbox for tasks, reminders, notes, ideas, search, reviews, and implementation briefs.",
    "",
    bold("First checklist"),
    `${bold("Current")} ${code(timezone)}`,
    `[ ] ${code("change timezone to Singapore")} - set timezone if this looks wrong`,
    `[ ] ${code("add pay invoice tomorrow at 9am")} - add your first task`,
    `[ ] ${code("note Deployment reliability depends on avoiding sleeping workers")} - save your first note`,
    "",
    bold("Timezone examples"),
    `${code("change timezone to Singapore")} - Singapore`,
    `${code("change timezone to Myanmar")} - Myanmar`,
    `${code("change timezone to Malaysia")} - Malaysia`,
    `${code("/settings timezone America/New_York")} - New York`,
    "Telegram does not share an exact device timezone with bots, so Threadwise makes a best guess from language and accepts common country/city names.",
    "",
    bold("Try these"),
    `${code("/help")} - show the full command guide`,
    `${code("/remind tomorrow at 9am | submit the form")} - schedule a reminder`,
    `${code("/idea build a Telegram bot for life admin")} - save and structure an idea`,
    `${code("/settings")} - view timezone, quiet hours, and reminder settings`,
    `${code("/version")} - show version and reminder diagnostics`,
    "",
    bold("Natural language works too"),
    "You can talk normally: show me the tasks, show me the notes, remind me to check the logs after 5 mins, change timezone to Yangon, search notes deployment, or merge notes 1 2 3.",
    "",
    `${code("/help")} has the complete command list.`
  ].join("\n");
}

export const HELP_TEXT = [
  formatHelpPage(1, HELP_PAGE_SIZE),
  "",
  "You can also talk naturally. Clear tasks, reminders, notes, ideas, and command-like requests such as merge notes 1 2 3 are handled directly; use /undo if I guessed wrong."
].join("\n");

export function formatHelpPage(page: number, pageSize = HELP_PAGE_SIZE): string {
  const totalPages = helpTotalPages(pageSize);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const visibleCommands = sortedHelpCommands().slice(start, start + pageSize);

  return [
    bold("Threadwise commands"),
    `Page ${currentPage}/${totalPages}`,
    "",
    ...visibleCommands.map(formatHelpCommand),
    "",
    "Talk naturally too: show me the tasks, change timezone to Myanmar, or remind me to check the logs after 5 mins."
  ].join("\n");
}

export function helpTotalPages(pageSize = HELP_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(HELP_COMMANDS.length / pageSize));
}

function sortedHelpCommands(): HelpCommand[] {
  return [...HELP_COMMANDS].sort((a, b) => a.command.localeCompare(b.command));
}

function formatHelpCommand(item: HelpCommand): string {
  return [`${code(item.command)} - ${item.description}`, `Example: ${code(item.example)}`].join("\n");
}
