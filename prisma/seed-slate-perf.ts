/**
 * Seeds a PERFORMANCE FIXTURE: a ~300-contract slate approximating the upper
 * bound of a full NFL Sunday's Kalshi listing (Pitch 10, SIG-91, RD-3).
 *
 * This is NOT the demo slate (`seed-slate.ts`) — it exists only to give the
 * Lighthouse/LCP harness a realistic, deterministic, production-size Slate to
 * measure against. It deliberately maximises the shape that stresses the old
 * flat list: many players, and several thresholds per player/stat (which the
 * redesign collapses into one card).
 *
 * Honest by construction: projections are stored as real distribution
 * parameters and probabilities/edges are computed by the SAME arithmetic the
 * app uses (`src/lib/slate/probability`). Numbers are synthetic but internally
 * consistent; player names are generated and clearly synthetic — this fixture
 * is for measurement, not for looking at.
 *
 * Guard: refuses a non-local database unless SEED_SLATE_FORCE=1. Idempotent:
 * ids are deterministic (hash of a stable key); writes are upserts.
 *
 * Run:  npm run db:seed:slate:perf
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

/** Target contract count. RD-3: a realistic upper bound for a Sunday listing. */
const TARGET_CONTRACTS = 300;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

function uid(key: string): string {
  const h = createHash("md5").update(`sightline:seed-slate-perf:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Deterministic pseudo-random in [0,1) from a string key — no Math.random. */
function rand(key: string): number {
  const h = createHash("md5").update(key).digest("hex");
  return parseInt(h.slice(0, 8), 16) / 0xffffffff;
}

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
const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function zilQuantiles(z: Zil): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of GRID) {
    const key = `q${String(Math.round(q * 100)).padStart(2, "0")}`;
    out[key] =
      q <= z.p_zero ? 0 : round1(Math.exp(z.mu + z.sigma * invNorm((q - z.p_zero) / (1 - z.p_zero))));
  }
  return out;
}

function kickoff(daysAhead: number, hourEt: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hourEt + 4, minute, 0, 0);
  return d;
}

const clampCents = (cents: number) => Math.max(1, Math.min(99, cents));

// A small pool of real abbreviations; synthetic names are generated per player.
const TEAM_ABBRS = ["CIN", "BAL", "DET", "GB", "LA", "SEA", "BUF", "MIA", "KC", "LV", "PHI", "DAL", "SF", "NYJ", "CHI", "TB"];
const FIRST = ["Marcus", "Deshawn", "Trey", "Cole", "Isaiah", "Jaylen", "Bryce", "Kenneth", "Malik", "Devin", "Xavier", "Rashad"];
const LAST = ["Whitfield", "Callahan", "Osei", "Renfro", "Baptiste", "Yeboah", "Marchetti", "Salvador", "Underwood", "Prescott-Hale", "Nakamura", "Okonkwo"];

const YARD_STATS = ["receiving_yards", "rushing_yards", "passing_yards"] as const;
const YARD_THRESHOLDS = [24.5, 39.5, 49.5, 59.5, 74.5, 89.5, 99.5, 124.5, 224.5, 274.5];

async function main(): Promise<void> {
  const now = new Date();
  const GAME_COUNT = 12; // 24 teams, a heavy Sunday
  const PLAYERS_PER_GAME = 8; // 4 per side

  // --- Teams ---------------------------------------------------------------
  const teamIds = new Map<string, string>();
  for (const abbr of TEAM_ABBRS) {
    const team = await prisma.team.upsert({
      where: { nflverseAbbr: abbr },
      create: { id: uid(`team:${abbr}`), nflverseAbbr: abbr, fullName: `${abbr} (perf fixture)` },
      update: {},
    });
    teamIds.set(abbr, team.id);
  }

  // --- Games ---------------------------------------------------------------
  const gameKeys: string[] = [];
  const gameKickoff = new Map<string, Date>();
  const gameTeams = new Map<string, [string, string]>();
  for (let g = 0; g < GAME_COUNT; g += 1) {
    const away = TEAM_ABBRS[(g * 2) % TEAM_ABBRS.length];
    const home = TEAM_ABBRS[(g * 2 + 1) % TEAM_ABBRS.length];
    const key = `G${g}-${away}${home}`;
    const at = kickoff(2 + (g % 3), 13 + (g % 4) * 3, (g % 2) * 25);
    const id = uid(`game:${key}`);
    await prisma.game.upsert({
      where: { id },
      create: {
        id,
        season: 2026,
        week: 80 + g, // far outside real weeks — never collides with ingest
        seasonType: "REG",
        homeTeamId: teamIds.get(home)!,
        awayTeamId: teamIds.get(away)!,
        isDome: g % 3 === 0,
        status: "scheduled",
        kickoffAt: at,
      },
      update: { kickoffAt: at, status: "scheduled" },
    });
    gameKeys.push(key);
    gameKickoff.set(key, at);
    gameTeams.set(key, [away, home]);
  }

  // --- Sync run ------------------------------------------------------------
  const syncRunId = uid("sync-run");
  await prisma.marketSyncRun.upsert({
    where: { id: syncRunId },
    create: {
      id: syncRunId,
      status: "complete",
      marketsDiscovered: TARGET_CONTRACTS,
      contractsUpserted: TARGET_CONTRACTS,
      observationsWritten: TARGET_CONTRACTS,
      startedAt: new Date(now.getTime() - 5000),
      finishedAt: now,
    },
    update: { startedAt: new Date(now.getTime() - 5000), finishedAt: now },
  });

  // --- Players, projections, contracts, books ------------------------------
  let contractCount = 0;
  const computedAt = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const informationCutoff = new Date(computedAt.getTime() - 30 * 60 * 1000);

  outer: for (let gi = 0; gi < gameKeys.length; gi += 1) {
    const gameKey = gameKeys[gi];
    const gameId = uid(`game:${gameKey}`);
    const closeTime = gameKickoff.get(gameKey)!;

    for (let pi = 0; pi < PLAYERS_PER_GAME; pi += 1) {
      const playerKey = `${gameKey}-P${pi}`;
      const fullName = `${FIRST[(gi + pi) % FIRST.length]} ${LAST[(gi * 3 + pi) % LAST.length]} ${gi}${pi}`;
      const playerId = uid(`player:${playerKey}`);
      await prisma.player.upsert({
        where: { id: playerId },
        create: { id: playerId, fullName, position: pi < 4 ? "WR" : "RB" },
        update: {},
      });

      // One yardage stat per player plus (for some) a receptions market, with
      // several thresholds each — the many-thresholds-per-player shape.
      const yardStat = YARD_STATS[(gi + pi) % YARD_STATS.length];
      const mu = 3.6 + rand(`${playerKey}:mu`) * 1.1; // ~ e^mu median yards
      const sigma = 0.42 + rand(`${playerKey}:sigma`) * 0.25;
      const zil: Zil = { p_zero: 0.02 + rand(`${playerKey}:pz`) * 0.05, mu, sigma };
      const quantiles = zilQuantiles(zil);
      const mean = (1 - zil.p_zero) * Math.exp(zil.mu + zil.sigma ** 2 / 2);
      const projectionId = uid(`projection:${playerKey}:${yardStat}`);
      const confidence = (["high", "medium", "low"] as const)[Math.floor(rand(`${playerKey}:conf`) * 3)];
      const projData = {
        playerId,
        gameId,
        statType: yardStat,
        modelVersion: "baseline-zil-0.1.0",
        distributionKind: "zero_inflated_lognormal",
        params: zil as object,
        quantiles,
        pmf: undefined,
        projectedValue: round3(mean),
        projectedMedian: round3(quantiles.q50),
        intervalLow: quantiles.q10,
        intervalHigh: quantiles.q90,
        confidence,
        nEff: 5 + Math.floor(rand(`${playerKey}:neff`) * 12),
        computedAt,
        informationCutoff,
      };
      await prisma.projection.upsert({
        where: { id: projectionId },
        create: { id: projectionId, ...projData },
        update: projData,
      });
      await prisma.projectionDriver.upsert({
        where: { projectionId_rank: { projectionId, rank: 0 } },
        create: {
          id: uid(`driver:${playerKey}:0`),
          projectionId,
          rank: 0,
          text: `Synthetic perf-fixture projection; median ${round1(quantiles.q50)} ${yardStat.replace(/_/g, " ")}.`,
        },
        update: {},
      });

      // Number of thresholds for this player's yardage stat (3–5) to hit ~300.
      const nThresh = 3 + Math.floor(rand(`${playerKey}:nt`) * 3);
      for (let t = 0; t < nThresh; t += 1) {
        const threshold = YARD_THRESHOLDS[(gi + pi + t) % YARD_THRESHOLDS.length];
        const prob = probAtLeast(
          { distributionKind: "zero_inflated_lognormal", params: zil as unknown as Record<string, number>, pmf: null },
          threshold,
        );
        const contractKey = `${playerKey}:${yardStat}:${threshold}`;
        const contractId = uid(`contract:${contractKey}`);
        const statLabel = yardStat.replace(/_/g, " ");
        await prisma.contract.upsert({
          where: { id: contractId },
          create: {
            id: contractId,
            kalshiTicker: `PERF-${contractKey.toUpperCase().replace(/[^A-Z0-9]/g, "-")}`,
            kalshiEventTicker: `PERF-${gameKey}`,
            kalshiSeriesTicker: "PERFSERIES",
            title: `${fullName}: ${threshold}+ ${statLabel}`,
            kalshiPlayerName: fullName,
            playerId,
            gameId,
            statType: yardStat,
            threshold,
            resolutionStatus: "resolved",
            status: "active",
            closeTime,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: { status: "active", lastSeenAt: now },
        });

        const modelPts = prob !== null ? prob * 100 : 50;
        const offset = Math.round((rand(`${contractKey}:off`) - 0.5) * 24);
        const yesAsk = clampCents(Math.round(modelPts + offset));
        const yesBid = clampCents(yesAsk - 2);
        const obsId = uid(`obs:${contractKey}`);
        const book = {
          yesBidCents: yesBid,
          yesAskCents: yesAsk,
          noBidCents: clampCents(100 - yesAsk - 1),
          noAskCents: clampCents(100 - yesBid + 1),
          observedAt: now,
        };
        await prisma.priceObservation.upsert({
          where: { id: obsId },
          create: { id: obsId, contractId, syncRunId, ...book },
          update: book,
        });

        contractCount += 1;
        if (contractCount >= TARGET_CONTRACTS) break outer;
      }
    }
  }

  const total = await prisma.contract.count({ where: { kalshiSeriesTicker: "PERFSERIES" } });
  console.warn(
    `Seeded PERF slate: ${gameKeys.length} games, ${total} contracts (target ${TARGET_CONTRACTS}). ` +
      `Open /slate to measure LCP against this fixture.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
