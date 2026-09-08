import type { ReferenceTable } from "../fipe/schemas.js";
import { parseReferenceMonth } from "../fipe/parsers.js";
import type { Repository } from "../db/repository.js";
import type { FipeApi } from "../fipe/client.js";
import type { CrawlOptions, CrawlResult } from "./crawl.js";

export interface RefreshDependencies {
  repo: Repository;
  api: FipeApi;
  crawl: (options: CrawlOptions) => Promise<CrawlResult>;
  acquireLock: () => Promise<RefreshLock | undefined>;
  runBackup: RunBackup;
  healthcheckUrl?: string;
}

export interface ReferenceCursor {
  month: number;
  year: number;
}

export interface RefreshReference extends ReferenceCursor {
  code: number;
  label: string;
}

interface CrawlBacklog {
  uncrawledBrands: number;
  uncrawledModels: number;
  uncrawledModelYears: number;
}

export interface RefreshValidationInput {
  backlog: CrawlBacklog;
  priceCount: number;
  previousPublishedPriceCount?: number;
}

export interface RefreshValidationDecision {
  valid: boolean;
  backlogTotal: number;
  minimumPriceCount?: number;
  priceFloorPassed: boolean;
}

export interface RefreshOptions {
  backup?: boolean;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

type RefreshExitCode = 0 | 1;
type RunBackup = () => Promise<void>;

interface RefreshLock {
  release: () => Promise<void>;
}

export interface PublicationSideEffectRepository {
  getPublishedReferencesPendingLatestPricesRefreshCount: () => Promise<number>;
  refreshLatestPrices: () => Promise<void>;
  markPublishedReferencesLatestPricesRefreshed: () => Promise<void>;
  getPublishedReferencesPendingBackupCount: () => Promise<number>;
  markPublishedReferencesBackedUp: () => Promise<void>;
}

export function toRefreshReference(reference: ReferenceTable): RefreshReference {
  const { month, year } = parseReferenceMonth(reference.Mes);
  return {
    code: reference.Codigo,
    label: reference.Mes.trim(),
    month,
    year,
  };
}

export function isReferenceNewerThan(
  reference: ReferenceCursor,
  latestPublished: ReferenceCursor,
): boolean {
  return (
    reference.year > latestPublished.year ||
    (reference.year === latestPublished.year && reference.month > latestPublished.month)
  );
}

export function selectTargetReferences(
  officialReferences: ReferenceTable[],
  latestPublished?: ReferenceCursor,
): RefreshReference[] {
  return officialReferences
    .map(toRefreshReference)
    .filter((reference) =>
      latestPublished ? isReferenceNewerThan(reference, latestPublished) : true,
    )
    .sort((a, b) => a.year - b.year || a.month - b.month || a.code - b.code);
}

export function getBacklogTotal(backlog: CrawlBacklog): number {
  return backlog.uncrawledBrands + backlog.uncrawledModels + backlog.uncrawledModelYears;
}

export function getMinimumPriceCount(previousPublishedPriceCount: number): number {
  return Math.ceil(previousPublishedPriceCount * 0.9);
}

export function validateRefreshCandidate(input: RefreshValidationInput): RefreshValidationDecision {
  const backlogTotal = getBacklogTotal(input.backlog);
  const minimumPriceCount =
    input.previousPublishedPriceCount === undefined
      ? undefined
      : getMinimumPriceCount(input.previousPublishedPriceCount);
  const priceFloorPassed =
    minimumPriceCount === undefined ? true : input.priceCount >= minimumPriceCount;

  return {
    valid: backlogTotal === 0 && priceFloorPassed,
    backlogTotal,
    minimumPriceCount,
    priceFloorPassed,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pingHealthcheck(
  healthcheckUrl: string | undefined,
  event: "start" | "success" | "fail",
): Promise<void> {
  if (!healthcheckUrl) return;

  const url =
    event === "start"
      ? `${healthcheckUrl}/start`
      : event === "fail"
        ? `${healthcheckUrl}/fail`
        : healthcheckUrl;

  try {
    await fetch(url);
  } catch {
    // Healthchecks must never affect refresh correctness.
  }
}

function logValidationFailure(
  target: RefreshReference,
  backlog: CrawlBacklog,
  priceCount: number,
  decision: RefreshValidationDecision,
  previousPublishedPriceCount: number | undefined,
  errorLog: (message: string) => void,
): void {
  errorLog(`[refresh] validation failed for reference ${target.code} (${target.label})`);
  errorLog(
    `[refresh] backlog: brands=${backlog.uncrawledBrands} ` +
      `models=${backlog.uncrawledModels} model-years=${backlog.uncrawledModelYears}`,
  );

  if (decision.minimumPriceCount === undefined) {
    errorLog(`[refresh] price count: current=${priceCount}; no previous published reference`);
    return;
  }

  errorLog(
    `[refresh] price count: current=${priceCount} ` +
      `previous=${previousPublishedPriceCount} minimum=${decision.minimumPriceCount}`,
  );
}

async function completePendingLatestPricesRefresh(
  repo: PublicationSideEffectRepository,
  log: (message: string) => void,
): Promise<void> {
  const pendingCount = await repo.getPublishedReferencesPendingLatestPricesRefreshCount();
  if (pendingCount === 0) return;

  log(`[refresh] refreshing latest_prices for ${pendingCount} published reference(s)`);
  await repo.refreshLatestPrices();
  await repo.markPublishedReferencesLatestPricesRefreshed();
}

export async function completePendingPublicationSideEffects(
  repo: PublicationSideEffectRepository,
  backup: boolean,
  runBackup: RunBackup,
  log: (message: string) => void,
): Promise<void> {
  await completePendingLatestPricesRefresh(repo, log);

  if (!backup) return;

  const pendingBackupCount = await repo.getPublishedReferencesPendingBackupCount();
  if (pendingBackupCount === 0) return;

  log(`[refresh] running backup for ${pendingBackupCount} published reference(s)`);
  await runBackup();
  await repo.markPublishedReferencesBackedUp();
}

export async function runRefresh(
  options: RefreshOptions,
  dependencies: RefreshDependencies,
): Promise<RefreshExitCode> {
  const log = options.log ?? ((message: string) => console.log(message));
  const errorLog = options.error ?? ((message: string) => console.error(message));
  const { repo, api, crawl, acquireLock, runBackup, healthcheckUrl } = dependencies;
  let lock: RefreshLock | undefined;
  let exitCode: RefreshExitCode = 1;

  try {
    lock = await acquireLock();
    if (!lock) {
      log("[refresh] refresh is already running");
      exitCode = 0;
      return exitCode;
    }

    await pingHealthcheck(healthcheckUrl, "start");

    log("[refresh] fetching official reference tables");
    const officialReferences = await api.getReferenceTables();
    const latestPublished = await repo.getLatestPublishedReference();
    const targets = selectTargetReferences(officialReferences, latestPublished);
    await completePendingPublicationSideEffects(repo, options.backup === true, runBackup, log);

    if (targets.length === 0) {
      log("[refresh] nothing new");
      exitCode = 0;
      return exitCode;
    }

    log(`[refresh] found ${targets.length} target reference(s)`);

    let previousPublishedPriceCount =
      latestPublished === undefined
        ? undefined
        : await repo.getReferencePriceCount(latestPublished.id);

    for (const target of targets) {
      log(`[refresh] crawling reference ${target.code} (${target.label})`);

      try {
        const result = await crawl({ referenceCode: target.code, onProgress: log });
        if (result.failed) throw new Error(`Crawl incomplete: ${result.failed} failures`);
      } catch (error) {
        errorLog(`[refresh] crawl failed for reference ${target.code}: ${errorMessage(error)}`);
        exitCode = 1;
        return exitCode;
      }

      const progress = await repo.getReferenceCrawlProgress(target.code);
      if (!progress) {
        throw new Error(`reference ${target.code} was not found after crawl`);
      }

      const backlog = {
        uncrawledBrands: progress.brands.pending,
        uncrawledModels: progress.models.pending,
        uncrawledModelYears: progress.modelYears.pending,
      };
      const priceCount = progress.prices;
      const decision = validateRefreshCandidate({
        backlog,
        priceCount,
        previousPublishedPriceCount,
      });

      if (!decision.valid) {
        logValidationFailure(
          target,
          backlog,
          priceCount,
          decision,
          previousPublishedPriceCount,
          errorLog,
        );
        exitCode = 1;
        return exitCode;
      }

      await repo.markReferencePublished(target.code);
      await completePendingLatestPricesRefresh(repo, log);
      previousPublishedPriceCount = priceCount;
      log(`[refresh] published reference ${target.code}`);
    }

    await completePendingPublicationSideEffects(repo, options.backup === true, runBackup, log);

    exitCode = 0;
    return exitCode;
  } catch (error) {
    errorLog(`[refresh] failed: ${errorMessage(error)}`);
    exitCode = 1;
    return exitCode;
  } finally {
    if (lock) {
      try {
        await lock.release();
      } catch (error) {
        errorLog(`[refresh] failed to release advisory lock: ${errorMessage(error)}`);
      }
    }
    // A lock-held no-op must stay silent: daily "already running" success
    // pings would mask a wedged refresh from the healthcheck's missed-ping
    // alerting. Failures ping even without the lock (e.g. DB unreachable).
    if (lock || exitCode !== 0) {
      await pingHealthcheck(healthcheckUrl, exitCode === 0 ? "success" : "fail");
    }
  }
}
