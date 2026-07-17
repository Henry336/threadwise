import { cancelPendingExpenseEdits } from "../services/expenses";
import { cancelPendingImageReminders } from "../services/imageOcr";
import { cancelPendingItemEdit } from "../services/itemEdits";
import { clearMenuInput } from "./menuInputs";

export type CanceledTransientInteractions = {
  menuInput: boolean;
  itemEdit: boolean;
  expenseEdits: number;
  imageReminders: number;
};

/**
 * Leave every text-consuming prompt without touching completed or saved records.
 * Pending expense previews and image captures remain available; only their active
 * "the next message is an edit/time" modes are switched off.
 */
export async function cancelTransientInteractions(
  userId: string,
  actorTelegramId: string | number
): Promise<CanceledTransientInteractions> {
  const menuInput = clearMenuInput(userId, actorTelegramId);
  const [itemEdit, expenseEdits, imageReminders] = await Promise.all([
    cancelPendingItemEdit(userId),
    cancelPendingExpenseEdits(userId),
    cancelPendingImageReminders(userId)
  ]);

  return { menuInput, itemEdit, expenseEdits, imageReminders };
}
