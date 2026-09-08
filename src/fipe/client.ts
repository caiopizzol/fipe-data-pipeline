import type { CrawlerConfig } from '../config.js';
import {
  brandsSchema,
  fipeErrorSchema,
  modelsResponseSchema,
  priceSchema,
  referenceTablesSchema,
  yearsSchema,
} from './schemas.js';
import type { Brand, ModelsResponse, Price, ReferenceTable, Year } from './schemas.js';

const BASE_URL = 'https://veiculos.fipe.org.br/api/veiculos';
const VEHICLE_TYPE_CAR = 1;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FipeClient {
  private lastRequestTime = 0;
  private currentThrottleMs: number;

  constructor(
    private readonly config: CrawlerConfig,
    private readonly fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {
    this.currentThrottleMs = config.RATE_LIMIT_MS;
  }
  private successCount = 0;
  private retryNotBefore = 0;

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.currentThrottleMs) {
      await this.wait(this.currentThrottleMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private calculateBackoff(attempt: number, is429 = false): number {
    // For 429s, use longer base delay (5s, 10s, 20s, 40s...)
    // For other errors, use standard delay (1s, 2s, 4s, 8s...)
    const baseDelay = is429 ? 5000 : 1000;
    return Math.min(baseDelay * 2 ** attempt, 60_000);
  }

  private increaseThrottle(): void {
    const newThrottle = Math.min(this.currentThrottleMs * 2, this.config.MAX_THROTTLE_MS);
    if (newThrottle !== this.currentThrottleMs) {
      console.log(
        `Rate limited: increasing throttle from ${this.currentThrottleMs}ms to ${newThrottle}ms`,
      );
      this.currentThrottleMs = newThrottle;
    }
    this.successCount = 0;
  }

  private recordSuccess(): void {
    this.successCount++;
    // After 10 consecutive successes, reduce throttle by 25%
    if (this.successCount >= 10 && this.currentThrottleMs > this.config.RATE_LIMIT_MS) {
      const newThrottle = Math.max(
        Math.floor(this.currentThrottleMs * 0.75),
        this.config.RATE_LIMIT_MS,
      );
      if (newThrottle !== this.currentThrottleMs) {
        console.log(
          `Throttle recovery: decreasing from ${this.currentThrottleMs}ms to ${newThrottle}ms`,
        );
        this.currentThrottleMs = newThrottle;
      }
      this.successCount = 0;
    }
  }

  private async request(
    endpoint: string,
    body: Record<string, unknown>,
    retries = this.config.MAX_RETRIES,
    attempt = 0,
  ): Promise<unknown> {
    if (Date.now() < this.retryNotBefore)
      throw new Error('FIPE requested a long cooldown; retry this crawl later');
    await this.throttle();

    let response: Response;
    try {
      response = await this.fetcher(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        ...(this.config.FIPE_PROXY ? { proxy: this.config.FIPE_PROXY } : {}),
      });
    } catch (error) {
      if (retries > 0) {
        const waitTime = this.calculateBackoff(attempt);
        console.log(
          `Network error (${error instanceof Error ? error.message : error}), waiting ${waitTime}ms before retry (${retries} retries left)`,
        );
        await this.wait(waitTime);
        return this.request(endpoint, body, retries - 1, attempt + 1);
      }
      throw error;
    }

    if (!response.ok) {
      if (response.status === 429) {
        this.increaseThrottle();

        // Check for Retry-After header
        const retryAfter = response.headers.get('Retry-After');
        const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
        const date = retryAfter ? Date.parse(retryAfter) : Number.NaN;
        const waitTime =
          seconds !== undefined
            ? seconds * 1000
            : Number.isFinite(date)
              ? Math.max(0, date - Date.now())
              : this.calculateBackoff(attempt, true);
        if (waitTime > 60_000) {
          this.retryNotBefore = Date.now() + waitTime;
          throw new Error(
            'FIPE requested a cooldown longer than 60 seconds; retry this crawl later',
          );
        }

        if (retries > 0) {
          console.log(`429 received, waiting ${waitTime}ms before retry (${retries} retries left)`);
          await this.wait(waitTime);
          return this.request(endpoint, body, retries - 1, attempt + 1);
        }

        // Exhausted retries - wait before throwing to give API time to recover
        console.log(`429 exhausted retries, cooling down for ${waitTime}ms before failing`);
        await this.wait(waitTime);
      } else if (response.status >= 500 && retries > 0) {
        const waitTime = this.calculateBackoff(attempt);
        console.log(
          `HTTP ${response.status}, waiting ${waitTime}ms before retry (${retries} retries left)`,
        );
        await this.wait(waitTime);
        return this.request(endpoint, body, retries - 1, attempt + 1);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Check for FIPE error response
    const errorResult = fipeErrorSchema.safeParse(data);
    if (errorResult.success) {
      throw new Error(`FIPE error: ${errorResult.data.erro}`);
    }

    this.recordSuccess();
    return data;
  }

  async getReferenceTables(): Promise<ReferenceTable[]> {
    const data = await this.request('ConsultarTabelaDeReferencia', {});
    return referenceTablesSchema.parse(data);
  }

  async getBrands(referenceCode: number): Promise<Brand[]> {
    const data = await this.request('ConsultarMarcas', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
    });
    return brandsSchema.parse(data);
  }

  async getModels(referenceCode: number, brandCode: string): Promise<ModelsResponse> {
    const data = await this.request('ConsultarModelos', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
      codigoMarca: brandCode,
    });
    return modelsResponseSchema.parse(data);
  }

  async getYears(referenceCode: number, brandCode: string, modelCode: string): Promise<Year[]> {
    const data = await this.request('ConsultarAnoModelo', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
      codigoMarca: brandCode,
      codigoModelo: modelCode,
    });
    return yearsSchema.parse(data);
  }

  async getPrice(params: PriceParams): Promise<Price> {
    const data = await this.request('ConsultarValorComTodosParametros', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: params.referenceCode,
      codigoMarca: params.brandCode,
      codigoModelo: params.modelCode,
      anoModelo: params.year,
      codigoTipoCombustivel: params.fuelCode,
      tipoConsulta: 'tradicional',
    });
    return priceSchema.parse(data);
  }
}

export interface PriceParams {
  referenceCode: number;
  brandCode: string;
  modelCode: string;
  year: string;
  fuelCode: number;
}
export type FipeApi = Pick<
  FipeClient,
  'getReferenceTables' | 'getBrands' | 'getModels' | 'getYears' | 'getPrice'
>;
