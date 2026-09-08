import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createBackupCommands } from './backup.js';

const config = {
  DATABASE_URL: 'postgres://fake:fake@localhost/fipe',
  R2_ACCESS_KEY_ID: 'fake',
  R2_SECRET_ACCESS_KEY: 'fake',
  R2_ENDPOINT: 'https://fake.invalid',
  R2_BUCKET: 'fake',
};
function fixture(failure?: 'toc' | 'restore' | 'drop' | 'restore-and-drop') {
  const commands: string[][] = [];
  let dump = '';
  const run = async (cmd: string[]) => {
    commands.push(cmd);
    if (cmd[0] === 'aws' && cmd[1] === 's3api')
      return JSON.stringify({ Contents: [{ Key: 'daily/fipe-20260907.dump' }] });
    if (cmd[0] === 'aws' && cmd[1] === 's3') {
      dump = cmd[4];
      await Bun.write(dump, 'fake archive');
    }
    if (cmd[0] === 'pg_restore' && cmd[1] === '-l' && failure === 'toc')
      throw new Error('invalid archive');
    if (cmd[0] === 'pg_restore' && cmd[1] === '--exit-on-error' && failure?.startsWith('restore'))
      throw new Error('restore failed');
    if (cmd.at(-1)?.startsWith('DROP DATABASE') && failure?.endsWith('drop'))
      throw new Error('drop failed');
    if (cmd.includes('-tAc')) return '42';
    return '';
  };
  return {
    commands,
    get dump() {
      return dump;
    },
    drill: () => createBackupCommands(config, run).runRestoreDrill(),
  };
}

test('a failed archive inspection cleans downloaded files without creating or dropping a database', async () => {
  const probe = fixture('toc');
  await expect(probe.drill()).rejects.toThrow('invalid archive');
  expect(existsSync(dirname(probe.dump))).toBe(false);
  expect(probe.commands.some((c) => c[0] === 'psql')).toBe(false);
});
test('each restore owns a unique scratch database and removes it', async () => {
  const first = fixture();
  const second = fixture();
  await first.drill();
  await second.drill();
  const create = (commands: string[][]) =>
    commands.find((c) => c.at(-1)?.startsWith('CREATE DATABASE'))?.at(-1);
  expect(create(first.commands)).not.toBe(create(second.commands));
  const database = create(first.commands)?.replace('CREATE DATABASE ', '');
  expect(first.commands.some((c) => c.at(-1) === `DROP DATABASE ${database}`)).toBe(true);
  expect(existsSync(dirname(first.dump))).toBe(false);
});
test('cleanup failure fails the command and preserves the original failure', async () => {
  const probe = fixture('restore-and-drop');
  try {
    await probe.drill();
    throw new Error('expected failure');
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toContain('restore failed');
    expect((error as AggregateError).message).toContain('Failed to remove scratch database');
  }
  expect(existsSync(dirname(probe.dump))).toBe(false);
});
