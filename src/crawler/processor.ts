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
  year?: number;
  brandCode?: string;
  modelCode?: string;
  classify?: boolean;
  onProgress?: (message: string) => void;
}

export async function crawl(options: CrawlOptions = {}): Promise<void> {
  const log = options.onProgress ?? console.log;

  // Get reference tables (2025 only, or specific one)
  log('Fetching reference tables...');
  const allRefs = await fipeClient.getReferenceTables();

  // Filter to specific reference, year, or default to current year
  const targetYear = options.year ?? new Date().getFullYear();
  const refs = options.referenceCode
    ? allRefs.filter((r) => r.Codigo === options.referenceCode)
    : allRefs.filter((r) => r.Mes.includes(String(targetYear)));

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

    // Get brands
    const allBrands = await fipeClient.getBrands(ref.Codigo);
    const brands = options.brandCode
      ? allBrands.filter((b) => b.Value === options.brandCode)
      : allBrands;

    log(`  Found ${brands.length} brands`);

    for (const brand of brands) {
      const brandRecord = await repo.upsertBrand(brand.Value, brand.Label);
      log(`  Processing brand: ${brand.Label}`);

      try {
        const modelsResponse = await fipeClient.getModels(ref.Codigo, brand.Value);
        const models = options.modelCode
          ? modelsResponse.Modelos.filter((m) => String(m.Value) === options.modelCode)
          : modelsResponse.Modelos;

        for (const model of models) {
          const { model: modelRecord, isNew } = await repo.upsertModel(
            brandRecord.id,
            String(model.Value),
            model.Label,
          );

          // Classify new models (if enabled)
          if (isNew && options.classify) {
            const segment = await classifySingleModel(brand.Label, model.Label);
            if (segment) {
              await repo.updateModelSegment(modelRecord.id, segment, 'ai');
              log(`    Classified ${model.Label} as ${segment}`);
            }
          }

          try {
            const years = await fipeClient.getYears(ref.Codigo, brand.Value, String(model.Value));

            for (const yearData of years) {
              const { year: modelYear, fuelCode } = parseYearValue(yearData.Value);

              try {
                const price = await fipeClient.getPrice({
                  referenceCode: ref.Codigo,
                  brandCode: brand.Value,
                  modelCode: String(model.Value),
                  year: String(modelYear),
                  fuelCode,
                });

                // Only create model_year if we got a valid price
                const modelYearRecord = await repo.upsertModelYear(
                  modelRecord.id,
                  modelYear,
                  fuelCode,
                  yearData.Label,
                );

                await repo.upsertPrice(
                  modelYearRecord.id,
                  refRecord.id,
                  price.CodigoFipe,
                  parsePrice(price.Valor),
                );

                totalPrices++;
              } catch {
                // Price fetch failed - skip this year (don't create model_year)
              }
            }
          } catch {
            // Years fetch failed - skip this model
          }
        }
      } catch (err) {
        // Models fetch failed - skip this brand
        log(`    Error fetching models for ${brand.Label}: ${err}`);
      }
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
