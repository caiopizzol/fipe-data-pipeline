import { env } from '../config.js';
import {
  referenceTablesSchema,
  brandsSchema,
  modelsResponseSchema,
  yearsSchema,
  priceSchema,
  fipeErrorSchema,
} from './schemas.js';
import type { ReferenceTable, Brand, ModelsResponse, Year, Price, PriceParams } from './types.js';

const BASE_URL = 'https://veiculos.fipe.org.br/api/veiculos';
const VEHICLE_TYPE_CAR = 1;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FipeClient {
  private lastRequestTime = 0;
  private currentThrottleMs = env.RATE_LIMIT_MS;
  private successCount = 0;

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.currentThrottleMs) {
      await sleep(this.currentThrottleMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private calculateBackoff(attempt: number, is429 = false): number {
    // For 429s, use longer base delay (5s, 10s, 20s, 40s...)
    // For other errors, use standard delay (1s, 2s, 4s, 8s...)
    const baseDelay = is429 ? 5000 : 1000;
    return baseDelay * Math.pow(2, attempt);
  }

  private increaseThrottle(): void {
    const newThrottle = Math.min(this.currentThrottleMs * 2, env.MAX_THROTTLE_MS);
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
    if (this.successCount >= 10 && this.currentThrottleMs > env.RATE_LIMIT_MS) {
      const newThrottle = Math.max(Math.floor(this.currentThrottleMs * 0.75), env.RATE_LIMIT_MS);
      if (newThrottle !== this.currentThrottleMs) {
        console.log(
          `Throttle recovery: decreasing from ${this.currentThrottleMs}ms to ${newThrottle}ms`,
        );
        this.currentThrottleMs = newThrottle;
      }
      this.successCount = 0;
    }
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    retries = env.MAX_RETRIES,
    attempt = 0,
  ): Promise<T> {
    await this.throttle();

    const response = await fetch(`${BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 429) {
        this.increaseThrottle();

        // Check for Retry-After header
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : this.calculateBackoff(attempt, true);

        if (retries > 0) {
          console.log(`429 received, waiting ${waitTime}ms before retry (${retries} retries left)`);
          await sleep(waitTime);
          return this.request(endpoint, body, retries - 1, attempt + 1);
        }

        // Exhausted retries - wait before throwing to give API time to recover
        console.log(`429 exhausted retries, cooling down for ${waitTime}ms before failing`);
        await sleep(waitTime);
      } else if (retries > 0) {
        const waitTime = this.calculateBackoff(attempt);
        console.log(
          `HTTP ${response.status}, waiting ${waitTime}ms before retry (${retries} retries left)`,
        );
        await sleep(waitTime);
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
    return data as T;
  }

  async getReferenceTables(): Promise<ReferenceTable[]> {
    const data = await this.request<unknown>('ConsultarTabelaDeReferencia', {});
    return referenceTablesSchema.parse(data);
  }

  async getReferenceTables2025(): Promise<ReferenceTable[]> {
    const all = await this.getReferenceTables();
    return all.filter((ref) => ref.Mes.includes('2025'));
  }

  async getBrands(referenceCode: number): Promise<Brand[]> {
    const data = await this.request<unknown>('ConsultarMarcas', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
    });
    return brandsSchema.parse(data);
  }

  async getModels(referenceCode: number, brandCode: string): Promise<ModelsResponse> {
    const data = await this.request<unknown>('ConsultarModelos', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
      codigoMarca: brandCode,
    });
    return modelsResponseSchema.parse(data);
  }

  async getYears(referenceCode: number, brandCode: string, modelCode: string): Promise<Year[]> {
    const data = await this.request<unknown>('ConsultarAnoModelo', {
      codigoTipoVeiculo: VEHICLE_TYPE_CAR,
      codigoTabelaReferencia: referenceCode,
      codigoMarca: brandCode,
      codigoModelo: modelCode,
    });
    return yearsSchema.parse(data);
  }

  async getPrice(params: PriceParams): Promise<Price> {
    const data = await this.request<unknown>('ConsultarValorComTodosParametros', {
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

export const fipeClient = new FipeClient();
