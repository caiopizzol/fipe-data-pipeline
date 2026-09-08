import { mock } from "bun:test";
import type { FipeApi } from "../../src/fipe/client.js";

await mock.module("../../src/fipe/client.js", () => ({
  FipeClient: class implements FipeApi {
    async getReferenceTables() {
      return [{ Codigo: 328, Mes: "junho/2024" }];
    }
    async getBrands() {
      return [{ Value: "59", Label: "VW" }];
    }
    async getModels() {
      return { Modelos: [{ Value: 5940, Label: "Car" }] };
    }
    async getYears() {
      return [{ Value: "2024-1", Label: "Gasolina" }];
    }
    async getPrice(): Promise<never> {
      throw new Error("simulated FIPE outage");
    }
  },
}));
