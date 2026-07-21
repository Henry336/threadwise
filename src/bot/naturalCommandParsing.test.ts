import { describe, expect, it } from "vitest";
import { normalizeNaturalCommandText, parseListRequest, parseNaturalHelpRequest, parseNaturalIdeaBody, parseNaturalNoteBody, parseNaturalReminderBody, parseNaturalSettingChange, parseNaturalTaskAssignment, parseNaturalTaskBody, parseNaturalTimezoneChange } from "./naturalCommandParsing";

describe("natural command parsing", () => {
  it.each([
    ["Hey Threadwise, could you please show me my tasks?", "show me my tasks"],
    ["I want you to list my notes for me", "list my notes"],
    ["Would you mind opening idea 2 please", "open idea 2"],
    ["Would you mind reminding me to call Mum at 8pm?", "remind me to call Mum at 8pm"],
    ["Please could you maybe archive note 2, thanks", "archive note 2"],
    ["hey, can u show my reminders pls", "show my reminders"],
    ["plz remind me to call Mum at 8pm thx", "remind me to call Mum at 8pm"]
  ])("normalizes conversational command wrappers: %s", (input, expected) => {
    expect(normalizeNaturalCommandText(input)).toBe(expected);
  });
  it.each([
    ["show me the notes", "notes"],
    ["show me the tasks", "tasks"],
    ["list my ideas", "ideas"],
    ["open tasks", "tasks"],
    ["what notes do I have", "notes"],
    ["let me see my ideas", "ideas"],
    ["show recent notes", "notes"],
    ["what are my open tasks", "tasks"],
    ["pull up my saved notes", "notes"],
    ["do I have any tasks", "tasks"],
    ["show my reminders", "tasks"],
    ["open my to-do list", "tasks"],
    ["what's on my plate", "tasks"],
    ["what do I need to do", "tasks"],
    ["what's coming up", "tasks"]
  ])("parses list requests: %s", (input, expected) => {
    expect(parseListRequest(input)).toBe(expected);
  });

  it.each([
    ["help", "general"],
    ["how do i use this bot?", "general"],
    ["what can you do", "general"],
    ["how do i set reminders?", "reminders"],
    ["help me with reminders", "reminders"],
    ["help me set reminders", "reminders"],
    ["how can i snooze tasks?", "reminders"],
    ["how do i save notes?", "notes"],
    ["help me with notes", "notes"],
    ["how do i save ideas?", "ideas"],
    ["what can i do with search?", "search"],
    ["how do i change my settings?", "settings"],
    ["help me with quiet hours", "settings"],
    ["how do i view the command list?", "commands"],
    ["show command list", "commands"],
    ["slash commands", "commands"],
    ["how do i undo something?", "cleanup"],
    ["how do I extract text from an image?", "images"],
    ["help me save a receipt", "expenses"],
    ["how do I sync expenses to Excel?", "excel"],
    ["help me with privacy", "privacy"],
    ["who can access my data?", "privacy"]
  ])("parses natural help requests: %s", (input, expected) => {
    expect(parseNaturalHelpRequest(input)).toBe(expected);
  });

  it.each([
    ["change my timezone to myanmar", "myanmar"],
    ["change my timezone to yangon", "yangon"],
    ["change my timezone to malaysia", "malaysia"],
    ["change timezone to singapore", "singapore"],
    ["change timezone singapore", "singapore"],
    ["timezone is Yangon", "Yangon"]
  ])("parses timezone changes: %s", (input, expected) => {
    expect(parseNaturalTimezoneChange(input)).toBe(expected);
  });

  it.each([
    ["set reminder interval to 3 hours", ["interval", "180"]],
    ["remind me again every 3 hours", ["interval", "180"]],
    ["set due nudge to 3 mins", ["due-nudge", "3"]],
    ["warn me 10 mins before due tasks", ["due-nudge", "10"]],
    ["start warning me 30 minutes before reminders", ["due-nudge", "30"]],
    ["quiet hours off", ["quiet", "off"]],
    ["set quiet hours to 22:00-08:00", ["quiet", "22:00", "08:00"]],
    ["max reminders 5", ["max", "5"]],
    ["allow up to 200 reminders per day", ["max", "200"]],
    ["set my expense currency to MMK", ["currency", "MMK"]],
    ["record my expenses in kyat", ["currency", "kyat"]],
    ["use EUR for my expenses", ["currency", "EUR"]],
    ["read images in Burmese", ["ocr", "Burmese"]],
    ["set OCR language to English and Burmese", ["ocr", "English and Burmese"]],
    ["use Myanmar for image OCR", ["ocr", "Myanmar"]],
    ["use compact reminders", ["mode", "compact"]],
    ["make my reminders detailed", ["mode", "detailed"]],
    ["send me assigned task reminders in private", ["dm", "on"]],
    ["stop dming me", ["dm", "off"]],
    ["set quiet hours to 22.00-08.00", ["quiet", "22:00", "08:00"]]
  ])("parses natural settings: %s", (input, expected) => {
    expect(parseNaturalSettingChange(input)).toEqual(expected);
  });

  it.each([
    ["remind me to check the washer after 5 mins", "me to check the washer after 5 mins"],
    ["please remind me about the meeting in 2 hours", "me about the meeting in 2 hours"],
    ["remind us to submit our assignment at 10:16 am", "us to submit our assignment at 10:16 am"],
    ["remind @henry_derek to submit his assignment at 10:19 am", "@henry_derek to submit his assignment at 10:19 am"],
    ["set a reminder for school at 9 am", "for school at 9 am"],
    ["create reminder to leave in 20 min", "to leave in 20 min"],
    ["could you remind me to call Mum tomorrow at 9?", "me to call Mum tomorrow at 9"],
    ["don't let me forget to submit the form at 5pm", "me to submit the form at 5pm"],
    ["nudge me to check the oven in 20 minutes", "check the oven in 20 minutes"],
    ["send me a reminder about rent on 10 July at 8am", "me about rent on 10 July at 8am"],
    ["Give me a reminder to prepare for the 4:30pm-IT2900-group-interview at 4 pm on 23 July", "me to prepare for the 4:30pm-IT2900-group-interview at 4 pm on 23 July"],
    ["remind me to finish all tasks by 9 pm", "me to finish all tasks by 9 pm"],
    ["notify me to leave before 8:30am", "leave before 8:30am"],
    ["I need a reminder to pay rent by 9pm", "to pay rent by 9pm"],
    ["make sure I remember to call Mum around 7pm", "me to call Mum around 7pm"],
    ["don't forget to lock the door at 11pm", "me to lock the door at 11pm"],
    ["reminder: submit the form tomorrow", "submit the form tomorrow"],
    ["schedule a reminder for me to stretch in 20 minutes", "stretch in 20 minutes"],
    ["wake me up to check the oven at 7am", "check the oven at 7am"],
    ["buzz me to leave at 6pm", "leave at 6pm"],
    ["give me a heads-up about rent tomorrow", "rent tomorrow"],
    ["don't let me miss the meeting at 2pm", "me about the meeting at 2pm"],
    ["make sure I don't forget to submit the form by 5pm", "me to submit the form by 5pm"]
  ])("parses reminder starter bodies: %s", (input, expected) => {
    expect(parseNaturalReminderBody(input)).toBe(expected);
  });

  it("does not confuse reminder requests with task assignment", () => {
    expect(parseNaturalTaskAssignment("Give me a reminder to prepare for an interview tomorrow at 4pm")).toBeUndefined();
    expect(parseNaturalTaskAssignment("give task 12 to @alex")).toEqual(["12", "@alex"]);
    expect(parseNaturalTaskAssignment("assign TASK-9 to Henry")).toEqual(["TASK-9", "Henry"]);
  });

  it.each([
    ["save a note that the spare key is in the blue drawer", "the spare key is in the blue drawer"],
    ["write this down: DATABASE_URL lives in Render", "DATABASE_URL lives in Render"],
    ["make a note about the book Alex recommended", "the book Alex recommended"],
    ["note to self: renew the passport after the trip", "renew the passport after the trip"],
    ["remember that Wi-Fi password is on the router", "Wi-Fi password is on the router"],
    ["add the hotel address to my notes", "the hotel address"],
    ["file this as a note: call reference 123", "call reference 123"],
    ["keep this in mind: the spare key is with Sam", "the spare key is with Sam"],
    ["save this for later: deployment checklist", "deployment checklist"],
    ["remember: the locker code changed", "the locker code changed"]
  ])("parses natural note capture: %s", (input, expected) => {
    expect(parseNaturalNoteBody(input)).toBe(expected);
  });

  it.each([
    ["create a task to buy batteries tomorrow", "buy batteries tomorrow"],
    ["I need to submit the report by Friday", "submit the report by Friday"],
    ["put book dentist on my todo list", "book dentist"],
    ["I must renew my passport next month", "renew my passport next month"],
    ["remember to buy milk tomorrow", "buy milk tomorrow"],
    ["put renew passport on my list", "renew passport"],
    ["my next task is to email Alex", "email Alex"],
    ["I've got to submit the form", "submit the form"],
    ["I gotta call Mum", "call Mum"]
  ])("parses natural task capture: %s", (input, expected) => {
    expect(parseNaturalTaskBody(input)).toBe(expected);
  });

  it.each([
    ["save this as an idea: a receipt scanner for Telegram", "a receipt scanner for Telegram"],
    ["I have an idea for a quiet-hours dashboard", "a quiet-hours dashboard"],
    ["here's an idea: shared grocery reminders", "shared grocery reminders"],
    ["put receipt categorization in my ideas", "receipt categorization"],
    ["brainwave: a calmer reminder digest", "a calmer reminder digest"],
    ["concept: shared household errands", "shared household errands"]
  ])("parses natural idea capture: %s", (input, expected) => {
    expect(parseNaturalIdeaBody(input)).toBe(expected);
  });
});
