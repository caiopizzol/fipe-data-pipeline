import { randomUUID } from 'node:crypto';
const name = `fipe-test-${randomUUID()}`;
let started = false;

async function run(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(`${args[0]} failed: ${error}`);
  return out.trim();
}

try {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    await run([
      'docker',
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=test',
      '-e',
      'POSTGRES_DB=fipe_test',
      '-p',
      '127.0.0.1::5432',
      'postgres:16-alpine',
    ]);
    started = true;
    const port = (await run(['docker', 'port', name, '5432/tcp'])).split(':').at(-1);
    url = `postgres://postgres:test@127.0.0.1:${port}/fipe_test`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await run([
          'docker',
          'exec',
          name,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
          '-d',
          'fipe_test',
        ]);
        ready = true;
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
    if (!ready) throw new Error('Test PostgreSQL did not become ready');
  }
  const child = Bun.spawn([process.execPath, '--no-env-file', 'test', 'tests/integration'], {
    env: { ...process.env, TEST_DATABASE_URL: url },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await child.exited;
} finally {
  if (started) await run(['docker', 'rm', '--force', name]);
}
