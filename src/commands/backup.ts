import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupConfig } from "../config.js";

const DAILY_PREFIX = "daily/";
const MONTHLY_PREFIX = "monthly/";
const DAILY_KEEP = 14;
const MONTHLY_KEEP = 12;

async function runCommand(cmd: string[], runEnv?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: runEnv });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${cmd[0]} exited ${code}: ${stderr.trim() || stdout.trim()}`);
  }
  return stdout;
}

export function createBackupCommands(env: BackupConfig, run = runCommand) {
  const awsEnvironment = {
    ...process.env,
    AWS_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: "auto",
  };
  // 20260528T220000Z — lexicographically sortable == chronological.
  function utcStamp(d: Date): string {
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }

  // Swap the database name in a postgres:// URL, preserving query params.
  function withDatabase(url: string, dbName: string): string {
    const u = new URL(url);
    u.pathname = `/${dbName}`;
    return u.toString();
  }

  async function s3DumpKeys(prefix: string): Promise<string[]> {
    const out = await run(
      [
        "aws",
        "s3api",
        "list-objects-v2",
        "--bucket",
        env.R2_BUCKET,
        "--prefix",
        prefix,
        "--endpoint-url",
        env.R2_ENDPOINT,
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    if (!out.trim()) return [];
    const parsed = JSON.parse(out) as { Contents?: { Key: string }[] };
    return (parsed.Contents ?? []).map((o) => o.Key).filter((k) => k.endsWith(".dump"));
  }

  async function s3Copy(from: string, to: string): Promise<void> {
    await run(
      ["aws", "s3", "cp", from, to, "--endpoint-url", env.R2_ENDPOINT, "--only-show-errors"],
      awsEnvironment,
    );
  }

  async function s3Delete(key: string): Promise<void> {
    await run(
      [
        "aws",
        "s3api",
        "delete-object",
        "--bucket",
        env.R2_BUCKET,
        "--key",
        key,
        "--endpoint-url",
        env.R2_ENDPOINT,
      ],
      awsEnvironment,
    );
  }

  async function prune(prefix: string, keep: number): Promise<number> {
    const keys = (await s3DumpKeys(prefix)).sort();
    const toDelete = keys.slice(0, Math.max(0, keys.length - keep));
    for (const key of toDelete) {
      await s3Delete(key);
    }
    return toDelete.length;
  }

  async function runBackup(): Promise<void> {
    const now = new Date();
    const stamp = utcStamp(now);
    const directory = await mkdtemp(join(tmpdir(), "fipe-backup-"));
    const tmp = join(directory, "backup.dump");
    let failure: unknown;

    try {
      console.log(`[backup] pg_dump -> ${tmp}`);
      await run(["pg_dump", "-Fc", "--no-owner", "--no-privileges", "-f", tmp, env.DATABASE_URL]);
      console.log(`[backup] dump ${(Bun.file(tmp).size / 1e6).toFixed(1)} MB`);

      const dailyKey = `${DAILY_PREFIX}fipe-${stamp}-${randomUUID()}.dump`;
      await s3Copy(tmp, `s3://${env.R2_BUCKET}/${dailyKey}`);
      console.log(`[backup] uploaded ${dailyKey}`);

      // Keep one dump per month, created by the first successful run of the month
      // (checked by existence, not the calendar day) so a missed run on the 1st
      // does not skip the monthly point.
      const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const monthlyKey = `${MONTHLY_PREFIX}fipe-${ym}.dump`;
      if (!(await s3DumpKeys(MONTHLY_PREFIX)).includes(monthlyKey)) {
        await s3Copy(tmp, `s3://${env.R2_BUCKET}/${monthlyKey}`);
        console.log(`[backup] uploaded ${monthlyKey}`);
      }

      const prunedDaily = await prune(DAILY_PREFIX, DAILY_KEEP);
      const prunedMonthly = await prune(MONTHLY_PREFIX, MONTHLY_KEEP);
      console.log(`[backup] pruned daily=${prunedDaily} monthly=${prunedMonthly}`);
      console.log("[backup] uploaded and pruned");
    } catch (error) {
      failure = error;
    } finally {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        failure = new AggregateError(
          failure ? [failure, error] : [error],
          "Backup temporary cleanup failed",
        );
      }
    }
    if (failure) throw failure;
    console.log("[backup] done");
  }

  async function runRestoreDrill(): Promise<void> {
    const keys = (await s3DumpKeys(DAILY_PREFIX)).sort();
    if (!keys.length) throw new Error("[restore-drill] no daily backups found");
    const latest = keys[keys.length - 1];
    const directory = await mkdtemp(join(tmpdir(), "fipe-restore-"));
    const dump = join(directory, "backup.dump");
    const scratch = `fipe_restore_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = withDatabase(env.DATABASE_URL, "postgres");
    const scratchUrl = withDatabase(env.DATABASE_URL, scratch);
    let created = false;
    const errors: unknown[] = [];
    try {
      console.log(`[restore-drill] downloading ${latest}`);
      await s3Copy(`s3://${env.R2_BUCKET}/${latest}`, dump);
      await run(["pg_restore", "-l", dump]);
      await run(["psql", adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${scratch};`]);
      created = true;
      await run([
        "pg_restore",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "-d",
        scratchUrl,
        dump,
      ]);
      const count = Number(
        (
          await run([
            "psql",
            scratchUrl,
            "-v",
            "ON_ERROR_STOP=1",
            "-tAc",
            "SELECT count(*) FROM prices;",
          ])
        ).trim(),
      );
      if (!Number.isSafeInteger(count) || count <= 0)
        throw new Error("[restore-drill] restored database has no valid prices");
      console.log(`[restore-drill] restored prices rows: ${count}`);
    } catch (error) {
      errors.push(error);
    } finally {
      if (created) {
        try {
          await run(["psql", adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE ${scratch};`]);
        } catch (error) {
          errors.push(new Error(`Failed to remove scratch database ${scratch}`, { cause: error }));
        }
      }
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        errors.push(
          new Error(`Failed to remove temporary directory ${directory}`, { cause: error }),
        );
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors,
        errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; "),
      );
    console.log("[restore-drill] OK");
  }
  return { runBackup, runRestoreDrill };
}
