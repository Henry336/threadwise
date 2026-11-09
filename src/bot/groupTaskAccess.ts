import type { Context } from "grammy";
import { collaborationActorFromContext } from "../services/groupCollaboration";
import {
  assertGroupTaskAction,
  getGroupTaskAccess,
  GroupTaskPermissionError,
  type GroupTaskAccess,
  type GroupTaskAction,
} from "../services/groupTaskPolicy";
import { isGroupManager } from "../services/groupWorkspaces";

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
  const actor = collaborationActorFromContext(ctx);
  try {
    return await assertGroupTaskAction(ownerUserId, reference, actor, false, action);
  } catch (error) {
    if (!(error instanceof GroupTaskPermissionError) || !(await isGroupManager(ctx))) throw error;
    return assertGroupTaskAction(ownerUserId, reference, actor, true, action);
  }
}
