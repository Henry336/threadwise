import { bold, code } from "../utils/html";

export const HELP_TEXT = [
  bold("Threadwise commands"),
  "",
  `${bold("Capture")} ${code("/idea <text>")} ${code("/note <text>")} ${code("/add <task>")}`,
  `${bold("Review")} ${code("/tasks")} ${code("/task 1")} ${code("/review")}`,
  `${bold("Finish")} ${code("/done 1")} ${code("/snooze 1 1h")} ${code("/cancel 1")}`,
  `${bold("Remember")} ${code("/remind <when> | <task>")} ${code("/calendar 1")}`,
  `${bold("Notes")} ${code("/notes")} ${code("/notes <query>")} ${code("/note NOTE-1")} ${code("/note-analysis")}`,
  `${bold("Ideas")} ${code("/score IDEA-1")} ${code("/brief IDEA-1")}`,
  `${bold("Reflect")} ${code("/relationship <situation>")} ${code("/reflect <situation>")}`,
  `${bold("Find")} ${code("/search <query>")}`,
  `${bold("Settings")} ${code("/settings")} ${code("/settings quiet off")} ${code("/settings timezone Asia/Singapore")}`,
  "",
  "You can also send a normal message. I will classify it and ask before saving."
].join("\n");
