import { z } from 'zod';

export const referenceTableSchema = z.object({
  Codigo: z.number(),
  Mes: z.string(),
});

export const referenceTablesSchema = z.array(referenceTableSchema);

export const brandSchema = z.object({
  Label: z.string(),
  Value: z.string(),
});

export const brandsSchema = z.array(brandSchema);

export const modelSchema = z.object({
  Label: z.string(),
  Value: z.number(),
});

export const yearSchema = z.object({
  Label: z.string(),
  Value: z.string(),
});

export const modelsResponseSchema = z.object({
  Modelos: z.array(modelSchema),
  Anos: z.array(yearSchema).optional(),
});

export const yearsSchema = z.array(yearSchema);

export const priceSchema = z.object({
  Valor: z.string(),
  Marca: z.string(),
  Modelo: z.string(),
  AnoModelo: z.number(),
  Combustivel: z.string(),
  CodigoFipe: z.string(),
  MesReferencia: z.string(),
  Autenticacao: z.string(),
  TipoVeiculo: z.number(),
  SiglaCombustivel: z.string(),
  DataConsulta: z.string(),
});

export const fipeErrorSchema = z.object({
  codigo: z.string(),
  erro: z.string(),
});
