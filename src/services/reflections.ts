import type { AiProvider } from "../ai/types";
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
    `Saved ${reflection.publicId}`,
    "",
    `Balanced view: ${reflection.balancedView}`,
    "",
    `Next step: ${reflection.immediateAction}`,
    "",
    `Keep in mind: ${reflection.keepInMind}`,
    reflection.risks.length ? `Risks: ${reflection.risks.join("; ")}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}

