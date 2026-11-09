import type { Context } from "grammy";
import { collaborationActorFromContext } from "../services/groupCollaboration";
import { getGroupTaskAccess, type GroupTaskAccess, type GroupTaskAction } from "../services/groupTaskPolicy";
import { isGroupManager } from "../services/groupWorkspaces";
import { assertGroupTaskActionLazily, type TaskCommandActor } from "../services/taskCommands";
import { isGroupChat } from "./groupRouting";

/**
 * Group task access for the keyboard, asking Telegram for admin status only when it matters.
 * isGroupManager costs a getChatMember call plus a membership upsert; it only changes the
 * keyboard for someone who is neither creator nor assignee ("other" vs "manager").
 */
export async function groupTaskKeyboardAccess(ctx: Context, ownerUserId: string, reference: string): Promise<GroupTaskAccess> {
  const actor = collaborationActorFromContext(ctx);
  const access = await getGroupTaskAccess(ownerUserId, reference, actor, false);
  if (access.audience !== "other" || !(await isGroupManager(ctx))) return access;
  return getGroupTaskAccess(ownerUserId, reference, actor, true);
}

/**
 * Asserts a group task action, checking admin status only after the cheaper creator/assignee
 * rules refused it. isGroupManager fails closed (false on any error), so the original refusal stands.
 */
export async function assertGroupTaskActionForContext(
  ctx: Context,
  ownerUserId: string,
  reference: string,
  action: GroupTaskAction,
): Promise<GroupTaskAccess> {
  return assertGroupTaskActionLazily(ownerUserId, reference, collaborationActorFromContext(ctx), () => isGroupManager(ctx), action);
}

/** The task-command actor for this update: a group member with a lazy admin check, or the private-chat owner. */
export function taskCommandActorFromContext(ctx: Context): TaskCommandActor {
  if (!isGroupChat(ctx)) return { inGroup: false };
  return { inGroup: true, member: collaborationActorFromContext(ctx), isManager: () => isGroupManager(ctx) };
}
