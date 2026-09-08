import Anthropic from '@anthropic-ai/sdk';
import { SEGMENTS, type Segment } from './segments.js';

type Vehicle = { brandName: string; modelName: string };
type ModelInput = Vehicle & { id: number };
const MODEL = 'claude-sonnet-4-5';
const BATCH_SIZE = 20;
const SYSTEM_PROMPT = `Classify Brazilian car models into these segments, using exactly these values:
${SEGMENTS.join(', ')}.
Respond with one numbered segment per input, retaining its number. No other text.
Perua means station wagon. Caminhão Leve means light cargo trucks.
Van/Utilitário means passenger vans and utility vehicles.`;

export function parseSegments(text: string, size: number): Segment[] {
  const segments = new Map<number, Segment>();
  for (const line of text.trim().split('\n')) {
    const match = /^(\d+)\.\s*(.+)$/.exec(line.trim());
    if (!match) throw new Error('Classification must contain numbered segments');
    const number = Number(match[1]);
    const segment = SEGMENTS.find((value) => value.toLowerCase() === match[2].trim().toLowerCase());
    if (!segment || number < 1 || number > size || segments.has(number)) {
      throw new Error('Classification contains an invalid, duplicate or out-of-range answer');
    }
    segments.set(number, segment);
  }
  if (segments.size !== size) throw new Error('Classification is missing answers');
  return Array.from({ length: size }, (_, index) => segments.get(index + 1) as Segment);
}

export function createClassifier(apiKey: string, client = new Anthropic({ apiKey })) {
  async function classifyBatch(vehicles: Vehicle[]): Promise<Segment[]> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: vehicles
            .map((v, i) => `${i + 1}. Brand: ${v.brandName}, Model: ${v.modelName}`)
            .join('\n'),
        },
      ],
    });
    if (response.stop_reason === 'max_tokens')
      throw new Error('Classification response was truncated');
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return parseSegments(text, vehicles.length);
  }
  return {
    async classifyModels(models: ModelInput[]) {
      const results: { id: number; segment: Segment | null }[] = [];
      for (let i = 0; i < models.length; i += BATCH_SIZE) {
        const batch = models.slice(i, i + BATCH_SIZE);
        try {
          const segments = await classifyBatch(batch);
          results.push(
            ...batch.map((model, index) => ({ id: model.id, segment: segments[index] })),
          );
        } catch (error) {
          console.error(
            `Classification batch failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          results.push(...batch.map((model) => ({ id: model.id, segment: null })));
        }
        if (i + BATCH_SIZE < models.length) await Bun.sleep(500);
      }
      return results;
    },
    async classifySingleModel(brandName: string, modelName: string): Promise<Segment> {
      const [segment] = await classifyBatch([{ brandName, modelName }]);
      return segment;
    },
  };
}
