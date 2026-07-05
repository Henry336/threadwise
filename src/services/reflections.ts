import type { AiProvider } from "../ai/types";
import { bold, code, h } from "../utils/html";
import { prisma } from "../db/prisma";
import { nextPublicId } from "./publicIds";

export async function createReflection(userId: string, sourceText: string, ai: AiProvider) {
  const advice = await ai.adviseOnReflection(sourceText);
  const embedding = await ai.embed(`${advice.situation}\n${advice.balancedView}\n${advice.immediateAction}\n${sourceText}`);
  const publicId = await nextPublicId(userId, "REF");

  return prisma.reflection.create({
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
}

export function formatReflection(reflection: {
  publicId: string;
  balancedView: string;
  immediateAction: string;
  keepInMind: string;
  risks: string[];
}): string {
  return [
    `${bold("Saved")} ${code(reflection.publicId)}`,
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
