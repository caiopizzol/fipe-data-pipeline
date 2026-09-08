import type { Segment } from "../classifier/segments.js";
import type { CrawlScope, Repository } from "../db/repository.js";
import type { FipeApi } from "../fipe/client.js";
import { parsePrice, parseReferenceMonth, parseYearValue } from "../fipe/parsers.js";

export interface CrawlOptions extends CrawlScope {
  referenceCode?: number;
  years?: number[];
  months?: number[];
  force?: boolean;
  refreshLatestPrices?: boolean;
  onProgress?: (message: string) => void;
}
export interface CrawlResult {
  references: number;
  prices: number;
  failed: number;
}

export async function crawl(
  options: CrawlOptions,
  repo: Repository,
  api: FipeApi,
  classifyModel?: (brand: string, model: string) => Promise<Segment>,
): Promise<CrawlResult> {
  const log = options.onProgress ?? console.log;
  const result = { references: 0, prices: 0, failed: 0 };
  const fail = (context: string, error: unknown) => {
    result.failed++;
    log(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  };
  log("Fetching reference tables...");
  const years = options.years ?? [new Date().getFullYear()];
  const refs = (await api.getReferenceTables()).filter((ref) => {
    if (options.referenceCode !== undefined) return ref.Codigo === options.referenceCode;
    const { year, month } = parseReferenceMonth(ref.Mes);
    return years.includes(year) && (!options.months || options.months.includes(month));
  });
  if (!refs.length) throw new Error("No reference tables match the requested scope");

  for (const ref of refs) {
    try {
      const { month, year } = parseReferenceMonth(ref.Mes);
      const record = await repo.getOrCreateReferenceTable(ref.Codigo, month, year);
      const fullReference = !options.brandCodes && !options.modelCodes;
      if (fullReference) await repo.markReferenceCrawled(ref.Codigo, false);
      if (options.force) await repo.clearCrawlStatus(record.id, options);
      log(`Reference ${ref.Codigo} (${ref.Mes.trim()}): discovering brands`);
      const brands = (await api.getBrands(ref.Codigo)).filter(
        (brand) => !options.brandCodes || options.brandCodes.includes(brand.Value),
      );
      if (!brands.length) throw new Error("No brands match the requested scope");
      if (options.brandCodes?.some((code) => !brands.some((brand) => brand.Value === code))) {
        throw new Error("One or more requested brands are absent from this reference");
      }
      for (const brand of brands) {
        const stored = await repo.getOrCreateBrand(brand.Value, brand.Label);
        await repo.ensureReferenceBrand(record.id, stored.id);
      }
      const pendingBrands = await repo.getUncrawledReferenceBrands(record.id, options);
      const foundModels = new Set<string>();
      log(`  Fetching models for ${pendingBrands.length} brands`);
      for (const brand of pendingBrands) {
        try {
          const response = await api.getModels(ref.Codigo, brand.fipeCode);
          for (const model of response.Modelos) {
            const code = String(model.Value);
            if (options.modelCodes && !options.modelCodes.includes(code)) continue;
            foundModels.add(code);
            const { model: stored, isNew } = await repo.getOrCreateModel(
              brand.brandId,
              code,
              model.Label,
            );
            await repo.ensureReferenceModel(record.id, stored.id);
            if (isNew && classifyModel) {
              try {
                const segment = await classifyModel(brand.name, model.Label);
                await repo.updateModelSegment(stored.id, segment, "ai");
              } catch (error) {
                fail(`Classification for ${model.Label} (retry with classify)`, error);
              }
            }
          }
          if (!options.modelCodes) await repo.markReferenceBrandModelsCrawled(brand.id);
        } catch (error) {
          fail(`Models for brand ${brand.fipeCode}`, error);
        }
      }
      if (options.modelCodes?.some((code) => !foundModels.has(code))) {
        fail(`Reference ${ref.Codigo}`, "One or more requested models were not discovered");
      }
      const pendingModels = await repo.getUncrawledReferenceModels(record.id, options);
      log(`  Fetching years for ${pendingModels.length} models`);
      for (const model of pendingModels) {
        try {
          for (const value of await api.getYears(ref.Codigo, model.brandFipeCode, model.fipeCode)) {
            const { year: modelYear, fuelCode } = parseYearValue(value.Value);
            const stored = await repo.getOrCreateModelYear(
              model.modelId,
              modelYear,
              fuelCode,
              value.Label,
            );
            await repo.ensureReferenceModelYear(record.id, stored.id);
          }
          await repo.markReferenceModelYearsCrawled(model.id);
        } catch (error) {
          fail(`Years for model ${model.fipeCode}`, error);
        }
      }
      const pendingYears = await repo.getUncrawledReferenceModelYears(record.id, options);
      log(`  Fetching ${pendingYears.length} prices`);
      let processed = 0;
      for (const value of pendingYears) {
        try {
          const price = await api.getPrice({
            referenceCode: ref.Codigo,
            brandCode: value.brandFipeCode,
            modelCode: value.modelFipeCode,
            year: String(value.year),
            fuelCode: value.fuelCode,
          });
          await repo.upsertPrice(
            value.modelYearId,
            record.id,
            price.CodigoFipe,
            parsePrice(price.Valor),
          );
          await repo.markReferenceModelYearPriceCrawled(value.id);
          result.prices++;
        } catch (error) {
          fail(
            `Price for ${value.brandFipeCode}/${value.modelFipeCode}/${value.year}-${value.fuelCode}`,
            error,
          );
        }
        processed++;
        if (processed % 100 === 0) log(`  Prices processed: ${processed}/${pendingYears.length}`);
      }
      const progress = await repo.getReferenceCrawlProgress(ref.Codigo);
      if (!progress) throw new Error("Reference disappeared while crawling");
      const pending =
        progress.brands.pending + progress.models.pending + progress.modelYears.pending;
      if (fullReference && pending === 0) await repo.markReferenceCrawled(ref.Codigo, true);
      log(
        `  Reference ${ref.Codigo}: ${fullReference && pending === 0 ? "complete" : "scoped or incomplete"} (${pending} pending across reference)`,
      );
      result.references++;
    } catch (error) {
      fail(`Reference ${ref.Codigo}`, error);
    }
  }
  log(`Crawl finished: ${result.prices} prices, ${result.failed} failures`);
  if (options.refreshLatestPrices) {
    // Refresh on a resumed run too: a previous run may have stored prices before its refresh failed.
    await repo.refreshLatestPrices();
  }
  return result;
}
