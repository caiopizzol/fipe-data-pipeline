import type { z } from 'zod';
import type {
  brandSchema,
  fipeErrorSchema,
  modelSchema,
  modelsResponseSchema,
  priceSchema,
  referenceTableSchema,
  yearSchema,
} from './schemas.js';

export type ReferenceTable = z.infer<typeof referenceTableSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Model = z.infer<typeof modelSchema>;
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
export type Year = z.infer<typeof yearSchema>;
export type Price = z.infer<typeof priceSchema>;
export type FipeError = z.infer<typeof fipeErrorSchema>;

export interface PriceParams {
  referenceCode: number;
  brandCode: string;
  modelCode: string;
  year: string;
  fuelCode: number;
}
