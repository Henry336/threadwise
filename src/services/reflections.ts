import type { AiProvider } from "../ai/types";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextPublicId } from "./publicIds";
import { recordCreateUndo } from "./undo";

export async function createReflection(userId: string, sourceText: string, ai: AiProvider) {
  const advice = await ai.adviseOnReflection(sourceText);
  const embedding = await ai.embed(`${advice.situation}\n${advice.balancedView}\n${advice.immediateAction}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "REF");

  return prisma.$transaction(async (tx) => {
    const reflection = await tx.reflection.create({
      data: {
        userId,
        publicId,
        sourceText,
        situation: advice.situation,
        balancedView: advice.balancedView,
        immediateAction: advice.immediateAction,
        keepInMind: advice.keepInMind,
        risks: advice.risks,
        embedding
      }
    });
    await recordCreateUndo(tx, userId, {
      kind: "reflection",
      id: reflection.id,
      publicId: reflection.publicId,
      title: reflection.situation
    });
    return reflection;
  });
}

export function formatReflection(reflection: {
  publicId: string;
  balancedView: string;
  immediateAction: string;
  keepInMind: string;
  risks: string[];
}): string {
  return [
    `${bold("Saved reflection")} ${code(reflection.publicId)}`,
    "",
    `${bold("Balanced view")} ${h(reflection.balancedView)}`,
    "",
    `${bold("Next step")} ${h(reflection.immediateAction)}`,
    "",
    `${bold("Keep in mind")} ${h(reflection.keepInMind)}`,
    reflection.risks.length ? `${bold("Risks")} ${h(reflection.risks.join("; "))}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
