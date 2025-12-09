import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config.js";
import { SEGMENTS, type Segment } from "../db/schema.js";

const SYSTEM_PROMPT = `You are a Brazilian vehicle classification expert. Your task is to classify car models into segments based on their brand and model name.

Available segments (use EXACTLY these values):
${SEGMENTS.map((s) => `- ${s}`).join("\n")}

Rules:
- Respond with ONLY the segment name, nothing else
- If uncertain, make your best guess based on the model name
- "Perua" is the Brazilian term for station wagon
- "Caminhão Leve" is for light commercial trucks/vans with cargo bed
- "Van/Utilitário" is for passenger vans and utility vehicles`;

type ModelInput = {
  id: number;
  brandName: string;
  modelName: string;
};

type ClassificationResult = {
  id: number;
  segment: Segment | null;
};

export async function classifyModels(
  models: ModelInput[]
): Promise<ClassificationResult[]> {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set, skipping classification");
    return models.map((m) => ({ id: m.id, segment: null }));
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const results: ClassificationResult[] = [];

  // Process in batches to reduce API calls
  const BATCH_SIZE = 20;

  for (let i = 0; i < models.length; i += BATCH_SIZE) {
    const batch = models.slice(i, i + BATCH_SIZE);

    const prompt = batch
      .map((m, idx) => `${idx + 1}. Brand: ${m.brandName}, Model: ${m.modelName}`)
      .join("\n");

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Classify each vehicle. Respond with one segment per line, numbered to match:\n\n${prompt}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== "text") {
        throw new Error("Unexpected response type");
      }

      const lines = content.text.trim().split("\n");

      for (let j = 0; j < batch.length; j++) {
        const line = lines[j] || "";
        // Extract segment from response (handle numbered format like "1. SUV")
        const segmentMatch = line.replace(/^\d+\.\s*/, "").trim();
        const segment = SEGMENTS.find(
          (s) => s.toLowerCase() === segmentMatch.toLowerCase()
        );

        results.push({
          id: batch[j].id,
          segment: segment || null,
        });

        if (!segment) {
          console.warn(
            `Could not parse segment for ${batch[j].brandName} ${batch[j].modelName}: "${segmentMatch}"`
          );
        }
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < models.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error) {
      console.error(`Error classifying batch starting at ${i}:`, error);
      // Add null results for failed batch
      for (const model of batch) {
        results.push({ id: model.id, segment: null });
      }
    }
  }

  return results;
}

export async function classifySingleModel(
  brandName: string,
  modelName: string
): Promise<Segment | null> {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn("ANTHROPIC_API_KEY not set, skipping classification");
    return null;
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 50,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Classify: Brand: ${brandName}, Model: ${modelName}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return null;
    }

    const segmentText = content.text.trim();
    const segment = SEGMENTS.find(
      (s) => s.toLowerCase() === segmentText.toLowerCase()
    );

    if (!segment) {
      console.warn(
        `Could not parse segment for ${brandName} ${modelName}: "${segmentText}"`
      );
    }

    return segment || null;
  } catch (error) {
    console.error(`Error classifying ${brandName} ${modelName}:`, error);
    return null;
  }
}
