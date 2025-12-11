import cliProgress from 'cli-progress';
import { fipeClient } from '../fipe/client.js';
import * as repo from '../db/repository.js';
import { classifySingleModel } from '../classifier/segment-classifier.js';

function parseYearValue(value: string): { year: number; fuelCode: number } {
  // Format: "2020-1" (year-fuelCode)
  const [yearStr, fuelCodeStr] = value.split('-');
  return {
    year: parseInt(yearStr, 10),
    fuelCode: parseInt(fuelCodeStr, 10),
  };
}

function parsePrice(valor: string): string {
  // "R$ 4.147,00" -> "4147.00"
  return valor.replace('R$ ', '').replace(/\./g, '').replace(',', '.');
}

function parseReferenceMonth(mes: string): { month: number; year: number } {
  // "dezembro/2025 " -> { month: 12, year: 2025 }
  const months: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    março: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };

  const [monthName, yearStr] = mes.trim().toLowerCase().split('/');
  return {
    month: months[monthName] || 0,
    year: parseInt(yearStr, 10),
  };
}

interface CrawlOptions {
  referenceCode?: number;
  years?: number[];
  months?: number[];
  brandCode?: string;
  modelCodes?: string[];
  classify?: boolean;
  force?: boolean;
  onProgress?: (message: string) => void;
}

export async function crawl(options: CrawlOptions = {}): Promise<void> {
  const log = options.onProgress ?? console.log;

  // Get reference tables from API
  log('Fetching reference tables...');
  const allRefs = await fipeClient.getReferenceTables();

  // Filter to specific reference, year/month, or default to current year
  const currentYear = new Date().getFullYear();
  const years = options.years ?? [currentYear];

  const refs = options.referenceCode
    ? allRefs.filter((r) => r.Codigo === options.referenceCode)
    : allRefs.filter((r) => {
        const { year, month } = parseReferenceMonth(r.Mes);
        const yearMatch = years.includes(year);
        const monthMatch = !options.months || options.months.includes(month);
        return yearMatch && monthMatch;
      });

  if (refs.length === 0) {
    log('No reference tables found to process');
    return;
  }

  log(`Found ${refs.length} reference tables to process`);

  let totalPrices = 0;
  const startTime = Date.now();

  for (const ref of refs) {
    const { month, year } = parseReferenceMonth(ref.Mes);
    const refRecord = await repo.upsertReferenceTable(ref.Codigo, month, year);

    log(`\nProcessing reference ${ref.Codigo} (${ref.Mes.trim()})...`);

    // Clear crawl status if --force
    if (options.force) {
      log('  Force mode: clearing crawl status...');
      await repo.clearCrawlStatus(refRecord.id);
    }

    // Phase 1: Crawl brands (always fetch - cheap API call)
    log('  Phase 1: Crawling brands...');
    const apiBrands = await fipeClient.getBrands(ref.Codigo);
    const filteredBrands = options.brandCode
      ? apiBrands.filter((b) => b.Value === options.brandCode)
      : apiBrands;

    for (const b of filteredBrands) {
      const brand = await repo.upsertBrand(b.Value, b.Label);
      await repo.upsertReferenceBrand(refRecord.id, brand.id);
    }
    log(`    Crawled ${filteredBrands.length} brands`);

    // Phase 2: Crawl models for each uncrawled brand
    const uncrawledBrands = await repo.getUncrawledReferenceBrands(refRecord.id);
    if (uncrawledBrands.length > 0) {
      log(`  Phase 2: Crawling models for ${uncrawledBrands.length} brands...`);

      for (const brand of uncrawledBrands) {
        try {
          const modelsResponse = await fipeClient.getModels(ref.Codigo, brand.fipeCode);
          const filteredModels = options.modelCodes
            ? modelsResponse.Modelos.filter((m) => options.modelCodes!.includes(String(m.Value)))
            : modelsResponse.Modelos;

          for (const m of filteredModels) {
            const { model: modelRecord, isNew } = await repo.upsertModel(
              brand.brandId,
              String(m.Value),
              m.Label,
            );
            await repo.upsertReferenceModel(refRecord.id, modelRecord.id);

            // Classify new models (if enabled)
            if (isNew && options.classify) {
              const segment = await classifySingleModel(brand.name, m.Label);
              if (segment) {
                await repo.updateModelSegment(modelRecord.id, segment, 'ai');
                log(`      Classified ${m.Label} as ${segment}`);
              }
            }
          }

          // Only mark as crawled if we fetched ALL models (no filter)
          if (!options.modelCodes) {
            await repo.markReferenceBrandModelsCrawled(brand.id);
          }
        } catch {
          // Models fetch failed - leave uncrawled for retry
          log(`    Error crawling models for ${brand.name}`);
        }
      }
    } else {
      log('  Phase 2: Models already crawled');
    }

    // Phase 3: Crawl model-years for each uncrawled model
    const uncrawledModels = await repo.getUncrawledReferenceModels(refRecord.id);
    if (uncrawledModels.length > 0) {
      log(`  Phase 3: Crawling years for ${uncrawledModels.length} models...`);

      const bar = new cliProgress.SingleBar({
        format: '    [{bar}] {value}/{total} | {model}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
      });
      bar.start(uncrawledModels.length, 0, { model: '' });

      for (const model of uncrawledModels) {
        bar.update({ model: model.name.slice(0, 30) });

        try {
          const yearsResponse = await fipeClient.getYears(
            ref.Codigo,
            model.brandFipeCode,
            model.fipeCode,
          );

          for (const y of yearsResponse) {
            const { year: modelYear, fuelCode } = parseYearValue(y.Value);
            const yearRecord = await repo.upsertModelYear(
              model.modelId,
              modelYear,
              fuelCode,
              y.Label,
            );
            await repo.upsertReferenceModelYear(refRecord.id, yearRecord.id);
          }

          await repo.markReferenceModelYearsCrawled(model.id);
        } catch {
          // Years fetch failed - leave uncrawled for retry
        }

        bar.increment();
      }

      bar.stop();
    } else {
      log('  Phase 3: Model-years already crawled');
    }

    // Phase 4: Fetch prices for each uncrawled model-year
    const uncrawledModelYears = await repo.getUncrawledReferenceModelYears(refRecord.id);
    if (uncrawledModelYears.length > 0) {
      log(`  Phase 4: Fetching ${uncrawledModelYears.length} prices...`);

      const bar = new cliProgress.SingleBar({
        format: '    [{bar}] {value}/{total} prices',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
      });
      bar.start(uncrawledModelYears.length, 0);

      let refPrices = 0;
      for (const my of uncrawledModelYears) {
        try {
          const price = await fipeClient.getPrice({
            referenceCode: ref.Codigo,
            brandCode: my.brandFipeCode,
            modelCode: my.modelFipeCode,
            year: String(my.year),
            fuelCode: my.fuelCode,
          });

          await repo.upsertPrice(
            my.modelYearId,
            refRecord.id,
            price.CodigoFipe,
            parsePrice(price.Valor),
          );

          await repo.markReferenceModelYearPriceCrawled(my.id);
          totalPrices++;
          refPrices++;
        } catch {
          // Price fetch failed - leave uncrawled for retry
        }

        bar.increment();
      }

      bar.stop();
      log(`    Fetched ${refPrices} prices`);
    } else {
      log('  Phase 4: All prices already crawled');
    }

    await repo.markReferenceCrawled(ref.Codigo);
    log(`  Completed reference ${ref.Codigo}`);
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  log(`\nCrawl complete: ${totalPrices} prices in ${duration}s`);
}

export async function status(): Promise<void> {
  const stats = await repo.getStats();
  console.log('\nDatabase status:');
  console.log(`  References: ${stats.references}`);
  console.log(`  Brands: ${stats.brands}`);
  console.log(`  Models: ${stats.models}`);
  console.log(`  Prices: ${stats.prices}`);
}
