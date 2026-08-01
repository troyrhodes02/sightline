/**
 * Seeds a REALISTIC DEMO SLATE for local development.
 *
 * The live slate needs three things that do not exist in the offseason: an
 * ingested schedule, listed Kalshi player-prop markets, and a stored
 * projection set. This script fabricates all three so every slate and
 * contract-detail state is exercisable locally: recommended rows, a
 * below-threshold row, a fade-side (no) row, a no-projection row, a
 * projection-without-price row, and an unresolved contract with an admin
 * diagnostic.
 *
 * Honest by construction where it matters: projections are stored as real
 * distribution parameters and probabilities/edges are computed by the SAME
 * arithmetic the app uses (`src/lib/slate/probability`), so the numbers on
 * screen are derived, not painted on. Kickoffs are placed a few days in the
 * future relative to whenever you run it.
 *
 * Deliberately NOT seeded: decisions. Clicking Take/Fade/Skip yourself is
 * the flow worth testing, and unmarked-is-absence is part of what you should
 * see.
 *
 * Guard: refuses to run against a non-local database unless
 * SEED_SLATE_FORCE=1 — this writes fictional games and contracts and must
 * never touch a shared environment.
 *
 * Idempotent: ids are deterministic (hash of a stable key), writes are
 * upserts. Re-running refreshes kickoffs and prices; it never duplicates.
 *
 * Run:  npm run db:seed:slate
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { probAtLeast } from "../src/lib/slate/probability";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required.");

const LOCAL = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
if (!LOCAL && process.env.SEED_SLATE_FORCE !== "1") {
  throw new Error(
    "DATABASE_URL does not look local. This seed writes FICTIONAL games and " +
      "contracts; set SEED_SLATE_FORCE=1 only if you are sure.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

/** Deterministic uuid-shaped id from a stable key, so re-runs upsert. */
function uid(key: string): string {
  const h = createHash("md5").update(`sightline:seed-slate:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Acklam's inverse normal CDF approximation (~1e-9) — for quantile grids. */
function invNorm(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const GRID = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

type Zil = { p_zero: number; mu: number; sigma: number };

/** Mirrors ZeroInflatedLogNormal.quantiles() from the Python engine. */
function zilQuantiles(z: Zil): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of GRID) {
    const key = `q${String(Math.round(q * 100)).padStart(2, "0")}`;
    out[key] =
      q <= z.p_zero
        ? 0
        : round1(Math.exp(z.mu + z.sigma * invNorm((q - z.p_zero) / (1 - z.p_zero))));
  }
  return out;
}

/** Negative-binomial PMF via the standard recurrence (mirrors the engine). */
function nbPmf(r: number, p: number, cap: number): number[] {
  const out = [Math.pow(p, r)];
  for (let k = 1; k <= cap; k += 1) out.push((out[k - 1] * (r + k - 1)) / k * (1 - p));
  return out;
}

function nbQuantiles(pmf: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of GRID) {
    const key = `q${String(Math.round(q * 100)).padStart(2, "0")}`;
    let cum = 0;
    let value = pmf.length - 1;
    for (let k = 0; k < pmf.length; k += 1) {
      cum += pmf[k];
      if (cum >= q) {
        value = k;
        break;
      }
    }
    out[key] = value;
  }
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Kickoff helpers: upcoming windows a few days out, at real ET slot times. */
function kickoff(daysAhead: number, hourEt: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  // ET is UTC-4 in season; close enough for a demo slate.
  d.setUTCHours(hourEt + 4, minute, 0, 0);
  return d;
}

async function main(): Promise<void> {
  const now = new Date();

  // --- Teams (upsert by nflverseAbbr so a real corpus is reused, not duped) --
  const TEAMS: Array<[string, string]> = [
    ["CIN", "Cincinnati Bengals"],
    ["BAL", "Baltimore Ravens"],
    ["DET", "Detroit Lions"],
    ["GB", "Green Bay Packers"],
    ["LA", "Los Angeles Rams"],
    ["SEA", "Seattle Seahawks"],
    ["BUF", "Buffalo Bills"],
    ["MIA", "Miami Dolphins"],
  ];
  const teamIds = new Map<string, string>();
  for (const [abbr, name] of TEAMS) {
    const team = await prisma.team.upsert({
      where: { nflverseAbbr: abbr },
      create: { id: uid(`team:${abbr}`), nflverseAbbr: abbr, fullName: name },
      update: {},
    });
    teamIds.set(abbr, team.id);
  }

  // --- Upcoming games ------------------------------------------------------
  const GAMES: Array<{ key: string; away: string; home: string; at: Date }> = [
    { key: "CINBAL", away: "CIN", home: "BAL", at: kickoff(2, 13) },
    { key: "DETGB", away: "DET", home: "GB", at: kickoff(2, 16, 25) },
    { key: "LASEA", away: "LA", home: "SEA", at: kickoff(2, 16, 5) },
    { key: "BUFMIA", away: "BUF", home: "MIA", at: kickoff(3, 20, 15) },
  ];
  const gameIds = new Map<string, string>();
  for (const [index, game] of GAMES.entries()) {
    const id = uid(`game:${game.key}`);
    await prisma.game.upsert({
      where: { id },
      create: {
        id,
        season: 2026,
        week: 90 + index, // far outside real weeks: never collides with ingest
        seasonType: "REG",
        homeTeamId: teamIds.get(game.home)!,
        awayTeamId: teamIds.get(game.away)!,
        isDome: false,
        status: "scheduled",
        kickoffAt: game.at,
      },
      update: { kickoffAt: game.at, status: "scheduled" },
    });
    gameIds.set(game.key, id);
  }

  // --- Players -------------------------------------------------------------
  const PLAYERS: Array<[string, string, string]> = [
    ["chase", "Ja'Marr Chase", "WR"],
    ["gibbs", "Jahmyr Gibbs", "RB"],
    ["stbrown", "Amon-Ra St. Brown", "WR"],
    ["nacua", "Puka Nacua", "WR"],
    ["kraft", "Tucker Kraft", "TE"],
    ["shakir", "Khalil Shakir", "WR"],
    ["achane", "De'Von Achane", "RB"],
    ["jsn", "Jaxon Smith-Njigba", "WR"],
  ];
  const playerIds = new Map<string, string>();
  for (const [key, fullName, position] of PLAYERS) {
    const id = uid(`player:${key}`);
    await prisma.player.upsert({
      where: { id },
      create: { id, fullName, position },
      update: {},
    });
    playerIds.set(key, id);
  }

  // --- Sync run (the completeness fact behind the header timestamp) --------
  const syncRunId = uid("sync-run");
  await prisma.marketSyncRun.upsert({
    where: { id: syncRunId },
    create: {
      id: syncRunId,
      status: "complete",
      marketsDiscovered: 7,
      contractsUpserted: 7,
      observationsWritten: 6,
      startedAt: new Date(now.getTime() - 5000),
      finishedAt: now,
    },
    update: { startedAt: new Date(now.getTime() - 5000), finishedAt: now },
  });

  // --- The slate: projections + contracts + books --------------------------
  // Each row states the SCREEN STATE it exists to demonstrate. Asks are
  // derived from the computed probability so the intended edge is guaranteed.
  type Row = {
    key: string;
    player: string;
    game: string;
    statType: "receiving_yards" | "rushing_yards" | "receptions";
    threshold: number;
    projection?:
      | { kind: "zil"; params: Zil; confidence: "high" | "medium" | "low"; nEff: number }
      | { kind: "nb"; r: number; p: number; confidence: "high" | "medium" | "low"; nEff: number };
    /** Yes-ask relative to model probability, in points. Negative = value. */
    askOffsetPts?: number;
    priced: boolean;
    drivers?: string[];
  };

  const ROWS: Row[] = [
    {
      // Recommended, high confidence, +7ish edge on YES.
      key: "chase-rec-74.5",
      player: "chase",
      game: "CINBAL",
      statType: "receiving_yards",
      threshold: 74.5,
      projection: { kind: "zil", params: { p_zero: 0.03, mu: 4.46, sigma: 0.45 }, confidence: "high", nEff: 14 },
      askOffsetPts: -7,
      priced: true,
      drivers: [
        "14 eligible prior games; exponentially-weighted form 81.2 receiving yards.",
        "Shrunk 22% toward the WR prior for 2026, fitted on 2019–2025 (48,112 player-games).",
        "Projected value 82.3, prior weight 0.22.",
      ],
    },
    {
      // Recommended, high confidence.
      key: "gibbs-rush-54.5",
      player: "gibbs",
      game: "DETGB",
      statType: "rushing_yards",
      threshold: 54.5,
      projection: { kind: "zil", params: { p_zero: 0.02, mu: 4.19, sigma: 0.42 }, confidence: "high", nEff: 12 },
      askOffsetPts: -6,
      priced: true,
      drivers: [
        "12 eligible prior games; exponentially-weighted form 68.4 rushing yards.",
        "Shrunk 25% toward the RB prior for 2026, fitted on 2019–2025 (51,006 player-games).",
        "Projected value 66.1, prior weight 0.25.",
      ],
    },
    {
      // Below threshold: small edge, medium confidence — visible, de-emphasised.
      key: "stbrown-recept-6.5",
      player: "stbrown",
      game: "DETGB",
      statType: "receptions",
      threshold: 6.5,
      projection: { kind: "nb", r: 9.5, p: 0.58, confidence: "medium", nEff: 9 },
      askOffsetPts: -2,
      priced: true,
      drivers: [
        "9 eligible prior games; exponentially-weighted form 7.1 receptions.",
        "Shrunk 30% toward the WR prior for 2026.",
      ],
    },
    {
      // Negative edge on YES, low confidence — the model likes NEITHER side.
      key: "nacua-rec-89.5",
      player: "nacua",
      game: "LASEA",
      statType: "receiving_yards",
      threshold: 89.5,
      projection: { kind: "zil", params: { p_zero: 0.05, mu: 4.28, sigma: 0.62 }, confidence: "low", nEff: 4 },
      askOffsetPts: 3,
      priced: true,
      drivers: [
        "4 eligible prior games; exponentially-weighted form 78.9 receiving yards.",
        "Shrunk 50% toward the WR prior for 2026.",
        "Form window crosses a season boundary.",
      ],
    },
    {
      // FADE case: model probability well UNDER the market → NO side favoured.
      key: "achane-rush-74.5",
      player: "achane",
      game: "BUFMIA",
      statType: "rushing_yards",
      threshold: 74.5,
      projection: { kind: "zil", params: { p_zero: 0.04, mu: 4.02, sigma: 0.5 }, confidence: "medium", nEff: 8 },
      askOffsetPts: 14, // yes ask far above model → the no side carries the edge
      priced: true,
      drivers: [
        "8 eligible prior games; exponentially-weighted form 58.7 rushing yards.",
        "Shrunk 33% toward the RB prior for 2026.",
      ],
    },
    {
      // No projection: priced market, model declined. Em dashes, caution chip.
      key: "kraft-rec-40.5",
      player: "kraft",
      game: "DETGB",
      statType: "receiving_yards",
      threshold: 40.5,
      priced: true,
    },
    {
      // Projection but NO price: never observed. Detail shows "Never observed."
      key: "shakir-rec-54.5",
      player: "shakir",
      game: "BUFMIA",
      statType: "receiving_yards",
      threshold: 54.5,
      projection: { kind: "zil", params: { p_zero: 0.04, mu: 4.12, sigma: 0.48 }, confidence: "medium", nEff: 7 },
      priced: false,
      drivers: [
        "7 eligible prior games; exponentially-weighted form 61.8 receiving yards.",
        "Shrunk 36% toward the WR prior for 2026.",
      ],
    },
  ];

  for (const row of ROWS) {
    const playerId = playerIds.get(row.player)!;
    const gameId = gameIds.get(row.game)!;

    let projectionId: string | null = null;
    let probability: number | null = null;

    if (row.projection) {
      projectionId = uid(`projection:${row.key}`);
      const isZil = row.projection.kind === "zil";
      const params = isZil
        ? (row.projection as { params: Zil }).params
        : { r: (row.projection as { r: number }).r, p: (row.projection as { p: number }).p };
      const pmf = isZil ? null : nbPmf((params as { r: number }).r, (params as { p: number }).p, 20);
      const quantiles = isZil ? zilQuantiles(params as Zil) : nbQuantiles(pmf!);
      const distributionKind = isZil ? "zero_inflated_lognormal" : "negative_binomial";

      probability = probAtLeast(
        { distributionKind, params: params as Record<string, number>, pmf },
        row.threshold,
      );

      const median = quantiles.q50;
      const mean = isZil
        ? (1 - (params as Zil).p_zero) * Math.exp((params as Zil).mu + (params as Zil).sigma ** 2 / 2)
        : ((params as { r: number }).r * (1 - (params as { p: number }).p)) / (params as { p: number }).p;

      const computedAt = new Date(now.getTime() - 26 * 60 * 60 * 1000); // yesterday
      const data = {
        playerId,
        gameId,
        statType: row.statType,
        modelVersion: "baseline-zil-0.1.0",
        distributionKind,
        params: params as object,
        quantiles,
        pmf: pmf ?? undefined,
        projectedValue: round3(mean),
        projectedMedian: round3(median),
        intervalLow: quantiles.q10,
        intervalHigh: quantiles.q90,
        confidence: row.projection.confidence,
        nEff: row.projection.nEff,
        computedAt,
        informationCutoff: new Date(computedAt.getTime() - 30 * 60 * 1000),
      };
      await prisma.projection.upsert({
        where: { id: projectionId },
        create: { id: projectionId, ...data },
        update: data,
      });

      for (const [rank, text] of (row.drivers ?? []).entries()) {
        await prisma.projectionDriver.upsert({
          where: { projectionId_rank: { projectionId, rank } },
          create: { id: uid(`driver:${row.key}:${rank}`), projectionId, rank, text },
          update: { text },
        });
      }
    }

    const contractId = uid(`contract:${row.key}`);
    const statLabel = row.statType.replace(/_/g, " ");
    const playerName = PLAYERS.find(([k]) => k === row.player)![1];
    await prisma.contract.upsert({
      where: { id: contractId },
      create: {
        id: contractId,
        kalshiTicker: `SEED-${row.key.toUpperCase()}`,
        kalshiEventTicker: `SEED-${row.game}`,
        kalshiSeriesTicker: "SEEDSERIES",
        title: `${playerName}: ${row.threshold}+ ${statLabel}`,
        kalshiPlayerName: playerName,
        playerId,
        gameId,
        statType: row.statType,
        threshold: row.threshold,
        resolutionStatus: "resolved",
        status: "active",
        closeTime: GAMES.find((g) => g.key === row.game)!.at,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { status: "active", lastSeenAt: now },
    });

    if (row.priced) {
      const modelPts = probability !== null ? probability * 100 : 50;
      const yesAsk = clampCents(Math.round(modelPts + (row.askOffsetPts ?? 0)));
      const yesBid = clampCents(yesAsk - 2);
      const noAsk = clampCents(100 - yesBid + 1);
      const noBid = clampCents(100 - yesAsk - 1);
      const observationId = uid(`obs:${row.key}`);
      const book = {
        yesBidCents: yesBid,
        yesAskCents: yesAsk,
        noBidCents: noBid,
        noAskCents: noAsk,
        observedAt: now,
      };
      await prisma.priceObservation.upsert({
        where: { id: observationId },
        create: { id: observationId, contractId, syncRunId, ...book },
        update: book,
      });
    }
  }

  // --- One unresolved contract with an admin diagnostic --------------------
  const unresolvedId = uid("contract:unresolved-jsn");
  await prisma.contract.upsert({
    where: { id: unresolvedId },
    create: {
      id: unresolvedId,
      kalshiTicker: "SEED-UNRESOLVED-JSN-74.5",
      kalshiEventTicker: "SEED-LASEA",
      kalshiSeriesTicker: "SEEDSERIES",
      title: "J. Smith-Njigba: 75+ receiving yards",
      kalshiPlayerName: "J. Smith-Njigba",
      resolutionStatus: "unresolved",
      resolutionNote:
        'Kalshi name "J. Smith-Njigba" matched 0 players. Parsed: receiving yards, threshold 74.5, game candidate LA at SEA.',
      status: "active",
      closeTime: GAMES.find((g) => g.key === "LASEA")!.at,
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: { status: "active", lastSeenAt: now },
  });
  const unresolvedObsId = uid("obs:unresolved-jsn");
  await prisma.priceObservation.upsert({
    where: { id: unresolvedObsId },
    create: {
      id: unresolvedObsId,
      contractId: unresolvedId,
      syncRunId,
      yesBidCents: 47,
      yesAskCents: 50,
      noBidCents: 49,
      noAskCents: 52,
      observedAt: now,
    },
    update: { observedAt: now },
  });

  const counts = {
    contracts: await prisma.contract.count({ where: { kalshiSeriesTicker: "SEEDSERIES" } }),
    projections: await prisma.projection.count(),
    observations: await prisma.priceObservation.count(),
  };
  console.warn(
    `Seeded demo slate: ${GAMES.length} upcoming games, ${counts.contracts} contracts ` +
      `(${counts.projections} projections, ${counts.observations} observations).`,
  );
  console.warn(
    "Open /slate. Note: the seeded 'Jaxon Smith-Njigba' player makes the " +
      "unresolved contract resolvable via the admin control — try it.",
  );
}

function clampCents(cents: number): number {
  return Math.max(1, Math.min(99, cents));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
