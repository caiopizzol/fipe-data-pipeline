export const SEGMENTS = [
  'Buggy',
  'Caminhão Leve',
  'Conversível',
  'Coupé',
  'Hatch',
  'Perua',
  'Pick-up',
  'Sedã',
  'SUV',
  'Van/Utilitário',
] as const;

export type Segment = (typeof SEGMENTS)[number];
