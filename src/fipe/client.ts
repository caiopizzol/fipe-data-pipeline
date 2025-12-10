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

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < env.RATE_LIMIT_MS) {
      await sleep(env.RATE_LIMIT_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>,
    retries = env.MAX_RETRIES,
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
      if (retries > 0) {
        await sleep(1000);
        return this.request(endpoint, body, retries - 1);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Check for FIPE error response
    const errorResult = fipeErrorSchema.safeParse(data);
    if (errorResult.success) {
      throw new Error(`FIPE error: ${errorResult.data.erro}`);
    }

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
