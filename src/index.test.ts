import { spawnSync } from "node:child_process";
import { expect, test } from "vite-plus/test";

async function invoke(...args: string[]) {
  const child = spawnSync("bun", ["--no-env-file", "src/index.ts", ...args], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
    timeout: 15000,
  });
  return { code: child.status, out: child.stdout, error: child.stderr };
}

test("help and version work without operational configuration", async () => {
  const help = await invoke("--help");
  expect(help.code).toBe(0);
  expect(help.out).toContain("Usage: fipe");
  expect((await invoke("--version")).code).toBe(0);
});
test("invalid command combinations fail before configuration", async () => {
  const result = await invoke("crawl", "--model", "5940");
  expect(result.code).toBe(1);
  expect(result.error).toContain("--model requires --brand");
  const conflict = await invoke("crawl", "--reference", "328", "--year", "2024");
  expect(conflict.code).toBe(1);
  expect(conflict.error).toContain("cannot be used");
});
