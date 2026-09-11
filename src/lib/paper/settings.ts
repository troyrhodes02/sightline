import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  ModelSelectionRowDto,
  PaperBotSettingsDto,
} from "@/lib/dto/autonomy";
import type { StatType } from "../../../generated/prisma/enums";
import {
  BASELINE_VERSION,
  SIMULATION_VERSION,
  modelSupportsStat,
} from "@/lib/model-eval/config";
import { readStatLeaders } from "@/lib/model-eval";
import { evidenceStrength } from "@/lib/model-eval/leader";
import { readConfiguration } from "./read";

/**
 * Paper Bot → Settings read (PME-6, D13).
 *
 * Assembles the per-stat model-selection table alongside the existing paper
 * configuration. Each row shows the current active selection, whether the
 * Simulation radio is enabled (the engine supports the stat), and an ADVISORY
 * recommendation glyph derived from the live per-stat leader — decision support
 * only, never a control (D12). This read never writes `ModelSelection`; the only
 * writer is the confirmed `POST /api/model-selection` route.
 */

const STAT_TYPES: StatType[] = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "rushing_tds",
  "receiving_tds",
];

const MODEL_LABEL: Record<string, string> = {
  [SIMULATION_VERSION]: "Simulation",
  [BASELINE_VERSION]: "Baseline",
};

export async function readPaperBotSettings(): Promise<PaperBotSettingsDto> {
  const config = await readConfiguration();

  const [selections, statLeaders] = await Promise.all([
    prisma.modelSelection.findMany({
      select: { statType: true, modelVersion: true },
    }),
    // The advisory recommendation per stat comes from the LIVE leader (D13).
    readStatLeaders("live"),
  ]);

  const activeByStat = new Map(
    selections.map((row) => [row.statType, row.modelVersion]),
  );
  const leaderByStat = new Map(statLeaders.map((row) => [row.statType, row]));

  const modelSelections: ModelSelectionRowDto[] = STAT_TYPES.map((statType) => {
    // Default to Baseline for a stat with no explicit row — the seed ships all
    // six on baseline, but a missing row must still read legibly.
    const activeModelVersion = activeByStat.get(statType) ?? BASELINE_VERSION;
    const leader = leaderByStat.get(statType);

    // The ★ target: the model the per-stat leader favours, or null when the
    // leader is too_close_to_call / not_enough_evidence. Advisory only.
    const recommendedModelVersion =
      leader?.leader === "simulation_leads"
        ? SIMULATION_VERSION
        : leader?.leader === "baseline_leads"
          ? BASELINE_VERSION
          : null;

    const evidenceLabel = recommendationEvidenceLabel(leader, statType);

    return {
      statType,
      activeModelVersion,
      simulationSupported: modelSupportsStat(SIMULATION_VERSION, statType),
      recommendedModelVersion,
      evidenceLabel,
    };
  });

  return {
    config,
    modelSelections,
    baselineModelVersion: BASELINE_VERSION,
    simulationModelVersion: SIMULATION_VERSION,
  };
}

function recommendationEvidenceLabel(
  leader:
    { leader: string; sampleSize: number; belowFloor: boolean } | undefined,
  statType: StatType,
): string {
  if (!leader) return "not enough evidence";
  if (leader.leader === "too_close_to_call") return "too close to call";
  if (leader.leader === "not_enough_evidence") return "not enough evidence";

  const model =
    leader.leader === "simulation_leads"
      ? MODEL_LABEL[SIMULATION_VERSION]
      : MODEL_LABEL[BASELINE_VERSION];
  const strength = evidenceStrength("live", leader.sampleSize);
  // A stat Simulation cannot price never recommends Simulation; if the leader
  // is simulation there it is a data artefact — guard it.
  if (
    leader.leader === "simulation_leads" &&
    !modelSupportsStat(SIMULATION_VERSION, statType)
  ) {
    return "not enough evidence";
  }
  return `${model} (${strength})`;
}
