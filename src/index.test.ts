import { expect, test } from 'bun:test';

async function invoke(...args: string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', 'src/index.ts', ...args], {
    env: { PATH: process.env.PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: await child.exited,
    out: await new Response(child.stdout).text(),
    error: await new Response(child.stderr).text(),
  };
}

test('help and version work without operational configuration', async () => {
  const help = await invoke('--help');
  expect(help.code).toBe(0);
  expect(help.out).toContain('Usage: fipe');
  expect((await invoke('--version')).code).toBe(0);
});
test('invalid command combinations fail before configuration', async () => {
  const result = await invoke('crawl', '--model', '5940');
  expect(result.code).toBe(1);
  expect(result.error).toContain('--model requires --brand');
  const conflict = await invoke('crawl', '--reference', '328', '--year', '2024');
  expect(conflict.code).toBe(1);
  expect(conflict.error).toContain('cannot be used');
});
