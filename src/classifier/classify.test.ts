import { expect, test } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import { createClassifier, parseSegments } from './classify.js';

test('maps reordered answers to their explicit input number', () => {
  expect(parseSegments('2. SUV\n1. Hatch', 2)).toEqual(['Hatch', 'SUV']);
});
test.each(['1. SUV\n1. Hatch', '2. SUV', '3. SUV\n1. Hatch', 'SUV\nHatch', '1. SUV\n2. Unknown'])(
  'rejects ambiguous classification %s',
  (response) => {
    expect(() => parseSegments(response, 2)).toThrow();
  },
);

test('the installed SDK sends one batch and maps identities before returning results', async () => {
  const client = new Anthropic({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('claude-sonnet-4-5');
      expect(body.messages[0].content).toContain('1. Brand: VW');
      return Response.json({
        id: 'test',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: '2. SUV\n1. Hatch' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      });
    },
  });
  const results = await createClassifier('test-key', client).classifyModels([
    { id: 10, brandName: 'VW', modelName: 'Car' },
    { id: 20, brandName: 'Other', modelName: 'SUV' },
  ]);
  expect(results).toEqual([
    { id: 10, segment: 'Hatch' },
    { id: 20, segment: 'SUV' },
  ]);
});
