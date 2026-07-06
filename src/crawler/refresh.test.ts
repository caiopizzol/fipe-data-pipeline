import { describe, expect, test } from 'bun:test';
import type { ReferenceTable } from '../fipe/types.js';
import {
  type PublicationSideEffectRepository,
  completePendingPublicationSideEffects,
  getMinimumPriceCount,
  selectTargetReferences,
  validateRefreshCandidate,
} from './refresh.js';

const emptyBacklog = {
  uncrawledBrands: 0,
  uncrawledModels: 0,
  uncrawledModelYears: 0,
};

describe('selectTargetReferences', () => {
  test('selects official references newer than the latest published month oldest-to-newest', () => {
    const officialReferences: ReferenceTable[] = [
      { Codigo: 304, Mes: 'abril/2026 ' },
      { Codigo: 302, Mes: 'fevereiro/2026 ' },
      { Codigo: 301, Mes: 'janeiro/2026 ' },
      { Codigo: 205, Mes: 'dezembro/2025 ' },
      { Codigo: 303, Mes: 'março/2026 ' },
    ];

    expect(
      selectTargetReferences(officialReferences, { month: 12, year: 2025 }).map(
        (reference) => reference.code,
      ),
    ).toEqual([301, 302, 303, 304]);
  });

  test('returns nothing when no official reference is newer', () => {
    const officialReferences: ReferenceTable[] = [
      { Codigo: 205, Mes: 'dezembro/2025 ' },
      { Codigo: 204, Mes: 'novembro/2025 ' },
    ];

    expect(selectTargetReferences(officialReferences, { month: 12, year: 2025 })).toEqual([]);
  });

  test('selects every official reference when nothing has been published', () => {
    const officialReferences: ReferenceTable[] = [
      { Codigo: 302, Mes: 'fevereiro/2026 ' },
      { Codigo: 301, Mes: 'janeiro/2026 ' },
    ];

    expect(selectTargetReferences(officialReferences).map((reference) => reference.code)).toEqual([
      301, 302,
    ]);
  });
});

describe('validateRefreshCandidate', () => {
  test('passes with zero backlog and at least 90 percent of previous price count', () => {
    expect(getMinimumPriceCount(101)).toBe(91);
    expect(
      validateRefreshCandidate({
        backlog: emptyBacklog,
        priceCount: 900,
        previousPublishedPriceCount: 1000,
      }).valid,
    ).toBe(true);
  });

  test('fails below the 90 percent price floor', () => {
    const decision = validateRefreshCandidate({
      backlog: emptyBacklog,
      priceCount: 899,
      previousPublishedPriceCount: 1000,
    });

    expect(decision.valid).toBe(false);
    expect(decision.priceFloorPassed).toBe(false);
    expect(decision.minimumPriceCount).toBe(900);
  });

  test('fails when checkpoint backlog remains', () => {
    const decision = validateRefreshCandidate({
      backlog: { ...emptyBacklog, uncrawledModels: 1 },
      priceCount: 1000,
      previousPublishedPriceCount: 1000,
    });

    expect(decision.valid).toBe(false);
    expect(decision.backlogTotal).toBe(1);
  });

  test('skips the price floor when there is no previous published reference', () => {
    const decision = validateRefreshCandidate({
      backlog: emptyBacklog,
      priceCount: 0,
    });

    expect(decision.valid).toBe(true);
    expect(decision.minimumPriceCount).toBeUndefined();
    expect(decision.priceFloorPassed).toBe(true);
  });
});

class FakePublicationSideEffectRepository implements PublicationSideEffectRepository {
  pendingLatestPricesRefreshCount = 0;
  pendingBackupCount = 0;
  calls: string[] = [];

  async getPublishedReferencesPendingLatestPricesRefreshCount(): Promise<number> {
    this.calls.push('count-latest-prices-refresh');
    return this.pendingLatestPricesRefreshCount;
  }

  async refreshLatestPrices(): Promise<void> {
    this.calls.push('refresh-latest-prices');
  }

  async markPublishedReferencesLatestPricesRefreshed(): Promise<void> {
    this.calls.push('mark-latest-prices-refreshed');
    this.pendingLatestPricesRefreshCount = 0;
  }

  async getPublishedReferencesPendingBackupCount(): Promise<number> {
    this.calls.push('count-backup');
    return this.pendingBackupCount;
  }

  async markPublishedReferencesBackedUp(): Promise<void> {
    this.calls.push('mark-backed-up');
    this.pendingBackupCount = 0;
  }
}

describe('completePendingPublicationSideEffects', () => {
  test('refreshes latest_prices before considering backup work', async () => {
    const repo = new FakePublicationSideEffectRepository();
    repo.pendingLatestPricesRefreshCount = 1;
    repo.pendingBackupCount = 1;

    await completePendingPublicationSideEffects(
      repo,
      true,
      async () => {
        repo.calls.push('run-backup');
      },
      () => {},
    );

    expect(repo.calls).toEqual([
      'count-latest-prices-refresh',
      'refresh-latest-prices',
      'mark-latest-prices-refreshed',
      'count-backup',
      'run-backup',
      'mark-backed-up',
    ]);
    expect(repo.pendingLatestPricesRefreshCount).toBe(0);
    expect(repo.pendingBackupCount).toBe(0);
  });

  test('does not mark latest_prices refresh complete when refresh fails', async () => {
    const repo = new FakePublicationSideEffectRepository();
    repo.pendingLatestPricesRefreshCount = 1;
    repo.refreshLatestPrices = async () => {
      repo.calls.push('refresh-latest-prices');
      throw new Error('refresh unavailable');
    };

    await expect(
      completePendingPublicationSideEffects(
        repo,
        false,
        async () => {},
        () => {},
      ),
    ).rejects.toThrow('refresh unavailable');

    expect(repo.calls).toEqual(['count-latest-prices-refresh', 'refresh-latest-prices']);
    expect(repo.pendingLatestPricesRefreshCount).toBe(1);
  });

  test('does not mark backup complete when backup fails, so it can be retried', async () => {
    const repo = new FakePublicationSideEffectRepository();
    repo.pendingBackupCount = 1;

    await expect(
      completePendingPublicationSideEffects(
        repo,
        true,
        async () => {
          repo.calls.push('run-backup');
          throw new Error('backup unavailable');
        },
        () => {},
      ),
    ).rejects.toThrow('backup unavailable');

    expect(repo.calls).toEqual(['count-latest-prices-refresh', 'count-backup', 'run-backup']);
    expect(repo.pendingBackupCount).toBe(1);

    await completePendingPublicationSideEffects(
      repo,
      true,
      async () => {
        repo.calls.push('run-backup-retry');
      },
      () => {},
    );

    expect(repo.pendingBackupCount).toBe(0);
    expect(repo.calls).toContain('mark-backed-up');
  });

  test('leaves pending backup untouched when backup was not requested', async () => {
    const repo = new FakePublicationSideEffectRepository();
    repo.pendingBackupCount = 1;

    await completePendingPublicationSideEffects(
      repo,
      false,
      async () => {},
      () => {},
    );

    expect(repo.calls).toEqual(['count-latest-prices-refresh']);
    expect(repo.pendingBackupCount).toBe(1);
  });
});
