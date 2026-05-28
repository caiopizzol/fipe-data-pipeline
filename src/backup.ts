import { unlink } from 'node:fs/promises';
import { env } from './config.js';

// Disaster-recovery backups: pg_dump -Fc uploaded to S3-compatible object
// storage (e.g. Cloudflare R2) via aws-cli, with daily + monthly retention and
// a restore drill. These two commands require the R2_* env vars; the
// crawl/status/classify commands are unaffected. The
// configured DB role needs read access to every table for a complete dump (the
// predefined pg_read_all_data role works) and CREATEDB for the restore drill's
// throwaway scratch database, which it always drops afterward.

const DAILY_PREFIX = 'daily/';
const MONTHLY_PREFIX = 'monthly/';
const DAILY_KEEP = 14;
const MONTHLY_KEEP = 12;
const SCRATCH_DB = 'fipe_restore_drill';

interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  bucket: string;
}

function requireR2(): R2Config {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET } = env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET) {
    throw new Error(
      'R2 not configured: set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET',
    );
  }
  return {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    endpoint: R2_ENDPOINT,
    bucket: R2_BUCKET,
  };
}

function awsEnv(r2: R2Config): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    AWS_ACCESS_KEY_ID: r2.accessKeyId,
    AWS_SECRET_ACCESS_KEY: r2.secretAccessKey,
    AWS_DEFAULT_REGION: 'auto',
  };
}

async function run(cmd: string[], runEnv?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: runEnv });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `${cmd.slice(0, 2).join(' ')} exited ${code}: ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

// 20260528T220000Z — lexicographically sortable == chronological.
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
}

// Swap the database name in a postgres:// URL, preserving query params.
function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function s3DumpKeys(r2: R2Config, prefix: string): Promise<string[]> {
  const out = await run(
    [
      'aws',
      's3api',
      'list-objects-v2',
      '--bucket',
      r2.bucket,
      '--prefix',
      prefix,
      '--endpoint-url',
      r2.endpoint,
      '--output',
      'json',
    ],
    awsEnv(r2),
  );
  if (!out.trim()) return [];
  const parsed = JSON.parse(out) as { Contents?: { Key: string }[] };
  return (parsed.Contents ?? []).map((o) => o.Key).filter((k) => k.endsWith('.dump'));
}

async function s3Copy(r2: R2Config, from: string, to: string): Promise<void> {
  await run(
    ['aws', 's3', 'cp', from, to, '--endpoint-url', r2.endpoint, '--only-show-errors'],
    awsEnv(r2),
  );
}

async function s3Delete(r2: R2Config, key: string): Promise<void> {
  await run(
    [
      'aws',
      's3api',
      'delete-object',
      '--bucket',
      r2.bucket,
      '--key',
      key,
      '--endpoint-url',
      r2.endpoint,
    ],
    awsEnv(r2),
  );
}

async function prune(r2: R2Config, prefix: string, keep: number): Promise<number> {
  const keys = (await s3DumpKeys(r2, prefix)).sort();
  const toDelete = keys.slice(0, Math.max(0, keys.length - keep));
  for (const key of toDelete) {
    await s3Delete(r2, key);
  }
  return toDelete.length;
}

export async function runBackup(): Promise<void> {
  const r2 = requireR2();
  const now = new Date();
  const stamp = utcStamp(now);
  const tmp = `/tmp/fipe-${stamp}.dump`;

  try {
    console.log(`[backup] pg_dump -> ${tmp}`);
    await run(['pg_dump', '-Fc', '--no-owner', '--no-privileges', '-f', tmp, env.DATABASE_URL]);
    console.log(`[backup] dump ${(Bun.file(tmp).size / 1e6).toFixed(1)} MB`);

    const dailyKey = `${DAILY_PREFIX}fipe-${stamp}.dump`;
    await s3Copy(r2, tmp, `s3://${r2.bucket}/${dailyKey}`);
    console.log(`[backup] uploaded ${dailyKey}`);

    // Keep one dump per month, created by the first successful run of the month
    // (checked by existence, not the calendar day) so a missed run on the 1st
    // does not skip the monthly point.
    const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthlyKey = `${MONTHLY_PREFIX}fipe-${ym}.dump`;
    if (!(await s3DumpKeys(r2, MONTHLY_PREFIX)).includes(monthlyKey)) {
      await s3Copy(r2, tmp, `s3://${r2.bucket}/${monthlyKey}`);
      console.log(`[backup] uploaded ${monthlyKey}`);
    }

    const prunedDaily = await prune(r2, DAILY_PREFIX, DAILY_KEEP);
    const prunedMonthly = await prune(r2, MONTHLY_PREFIX, MONTHLY_KEEP);
    console.log(`[backup] pruned daily=${prunedDaily} monthly=${prunedMonthly}`);
    console.log('[backup] done');
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

// Download the newest daily dump, verify its archive TOC, then fully restore it
// into a throwaway scratch DB and assert a non-empty prices table before dropping.
export async function runRestoreDrill(): Promise<void> {
  const r2 = requireR2();
  const keys = (await s3DumpKeys(r2, DAILY_PREFIX)).sort();
  if (keys.length === 0) {
    throw new Error('[restore-drill] no daily backups found');
  }
  const latest = keys[keys.length - 1];
  const tmp = '/tmp/restore-drill.dump';

  console.log(`[restore-drill] downloading ${latest}`);
  await s3Copy(r2, `s3://${r2.bucket}/${latest}`, tmp);

  const toc = await run(['pg_restore', '-l', tmp]);
  const tocEntries = toc
    .split('\n')
    .filter((l) => /TABLE DATA|MATERIALIZED VIEW|INDEX|SEQUENCE/.test(l)).length;
  console.log(`[restore-drill] archive TOC entries: ${tocEntries}`);

  const adminUrl = withDatabase(env.DATABASE_URL, 'postgres');
  const scratchUrl = withDatabase(env.DATABASE_URL, SCRATCH_DB);
  await run([
    'psql',
    adminUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `DROP DATABASE IF EXISTS ${SCRATCH_DB};`,
  ]);
  await run(['psql', adminUrl, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${SCRATCH_DB};`]);
  try {
    await run(['pg_restore', '--no-owner', '--no-privileges', '-d', scratchUrl, tmp]);
    const count = Number.parseInt(
      (await run(['psql', scratchUrl, '-tAc', 'SELECT count(*) FROM prices;'])).trim(),
      10,
    );
    console.log(`[restore-drill] restored prices rows: ${count}`);
    if (!(count > 0)) {
      throw new Error('[restore-drill] restored database has 0 prices');
    }
  } finally {
    await run([
      'psql',
      adminUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `DROP DATABASE IF EXISTS ${SCRATCH_DB};`,
    ]).catch(() => {});
    await unlink(tmp).catch(() => {});
  }
  console.log('[restore-drill] OK');
}
