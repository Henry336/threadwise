/**
 * Single executor for task actions (complete, snooze, cancel, assign, unassign)
 * that arrive from slash commands, natural text or buttons in src/bot. Keeping
 * the group permission check and activity logging here means every entry point
 * applies the same rules.
 */
import { GroupActivityType, TaskStatus } from "@prisma/client";
import { recordGroupTaskActivity, type CollaborationActor } from "./groupCollaboration";
import { assertGroupTaskAction, GroupTaskPermissionError, type GroupTaskAccess, type GroupTaskAction } from "./groupTaskPolicy";
import { assignTask, cancelTask, completeTask, formatAssignee, snoozeTask, unassignTask, type TaskCreationOptions } from "./tasks";

/**
 * Who issued a task command. A group member is checked against the shared-task policy and
 * their change is written to the group activity log; a private-chat owner acts on their own list.
 * `isManager` is a lazy Telegram admin lookup, asked only when the cheaper rules refuse.
 */
export type TaskCommandActor =
  | { inGroup: false }
  | { inGroup: true; member: CollaborationActor; isManager: () => Promise<boolean> };

/** Where the command came from. Plain data for logs and tests; the executor treats every source alike. */
export type TaskCommandSource = "command" | "text" | "button";

/** The parsed intent alone, before the entry point adds whose list it is, who asked and from where. */
export type TaskCommandInput = {
  /** A list number, public id (TASK-3) or task id, exactly as the user or button gave it. */
  ref: string;
} & (
  | { action: "complete"; expectedDueAt?: Date }
  | { action: "snooze"; duration?: string }
  | { action: "cancel" }
  | { action: "assign"; assignees: string; options: TaskCreationOptions }
  /** Without an assignee every assignee is removed. */
  | { action: "unassign"; assignee?: string; options?: TaskCreationOptions }
);

/**
 * One task intent, parsed from a slash command, natural text or a button. Entry points only
 * build this object; executeTaskCommand owns policy, the service call and the activity log.
 */
export type TaskCommand = TaskCommandInput & {
  /** Owner of the task list: the person in a private chat, the synthetic chat owner in a group. */
  userId: string;
  actor: TaskCommandActor;
  source: TaskCommandSource;
};

type CompletedTask = Awaited<ReturnType<typeof completeTask>>["task"];
type ChangedTask = Awaited<ReturnType<typeof snoozeTask>>;
type AssignedTask = Awaited<ReturnType<typeof assignTask>>;

/** What happened, for each entry point to render in its own surface with the shared formatters. */
export type TaskCommandResult =
  | { action: "complete"; status: "completed" | "already-completed"; task: CompletedTask }
  /** A Done button for an occurrence a recurring task has already moved past (stale card or double tap). */
  | { action: "complete"; status: "stale"; task: CompletedTask }
  | { action: "snooze"; task: ChangedTask }
  | { action: "cancel"; task: ChangedTask }
  | { action: "assign" | "unassign"; task: AssignedTask };

/**
 * Runs one task command: group policy check, service call, group activity record. It is the
 * single copy of those rules for every Telegram entry point, so the paths cannot drift.
 * Policy refusals throw GroupTaskPermissionError; service errors propagate unchanged.
 */
export async function executeTaskCommand(command: TaskCommand): Promise<TaskCommandResult> {
  const { userId, ref, actor } = command;
  switch (command.action) {
    case "complete": {
      await authorize(command, "complete");
      const completion = await completeTask(userId, ref, command.expectedDueAt);
      if (completion.alreadyCompleted) {
        // A recurring task stays OPEN, so "already completed" on an open task means the
        // occurrence the caller saw has already moved on.
        const status = completion.task.status === TaskStatus.DONE ? "already-completed" : "stale";
        return { action: "complete", status, task: completion.task };
      }
      await recordActivity(actor, userId, GroupActivityType.TASK_COMPLETED, completion.task, (name) => `${name} completed ${completion.task.publicId}.`);
      return { action: "complete", status: "completed", task: completion.task };
    }
    case "snooze": {
      await authorize(command, "snooze");
      return { action: "snooze", task: await snoozeTask(userId, ref, command.duration) };
    }
    case "cancel": {
      await authorize(command, "manage");
      return { action: "cancel", task: await cancelTask(userId, ref) };
    }
    case "assign": {
      await authorize(command, "manage");
      const task = await assignTask(userId, ref, command.assignees, command.options);
      await recordActivity(actor, userId, GroupActivityType.TASK_ASSIGNED, task, (name) => `${name} assigned ${task.publicId} to ${formatAssignee(task)}.`);
      return { action: "assign", task };
    }
    case "unassign": {
      await authorize(command, "manage");
      const task = await unassignTask(userId, ref, command.assignee, command.options);
      const verb = command.assignee ? "updated" : "cleared";
      await recordActivity(actor, userId, GroupActivityType.TASK_UNASSIGNED, task, (name) => `${name} ${verb} the assignees on ${task.publicId}.`);
      return { action: "unassign", task };
    }
  }
}

/**
 * Asserts a group task action, asking for admin status only after the cheaper creator/assignee
 * rules refused it. `isManager` fails closed (false on any error), so the original refusal stands.
 */
export async function assertGroupTaskActionLazily(
  ownerUserId: string,
  reference: string,
  member: CollaborationActor,
  isManager: () => Promise<boolean>,
  action: GroupTaskAction,
): Promise<GroupTaskAccess> {
  try {
    return await assertGroupTaskAction(ownerUserId, reference, member, false, action);
  } catch (error) {
    if (!(error instanceof GroupTaskPermissionError) || !(await isManager())) throw error;
    return assertGroupTaskAction(ownerUserId, reference, member, true, action);
  }
}

/** Applies the shared-task policy to group members; a private-chat owner may do anything to their own list. */
async function authorize(command: TaskCommand, action: GroupTaskAction): Promise<void> {
  if (!command.actor.inGroup) return;
  await assertGroupTaskActionLazily(command.userId, command.ref, command.actor.member, command.actor.isManager, action);
}

/** Records a group member's change in the shared activity log; private changes are not logged. */
async function recordActivity(
  actor: TaskCommandActor,
  userId: string,
  type: GroupActivityType,
  task: { publicId: string; title: string },
  summary: (actorName: string) => string,
): Promise<void> {
  if (!actor.inGroup) return;
  await recordGroupTaskActivity(userId, actor.member, type, task, summary(actor.member.displayName));
}
