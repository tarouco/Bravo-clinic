import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli } from './cli';

describe('jobs/cli.ts (design.md "Jobs")', () => {
  it('refuses NODE_ENV=production before touching any database', async () => {
    await expect(
      runCli(['renewals', '--now=2026-11-30T06:00:00Z'], {
        NODE_ENV: 'production',
        DATABASE_URL_TEST: 'postgres://never.invalid/db',
      }),
    ).rejects.toThrow('refusing NODE_ENV=production');
  });

  it('parses the job name and --now, ignoring the npm "--" separator', () => {
    const args = parseCliArgs(['--', 'renewals', '--now=2026-11-30T06:00:00Z']);
    expect(args.name).toBe('renewals');
    expect(args.now.toISOString()).toBe('2026-11-30T06:00:00.000Z');
    const clock = new Date('2026-10-26T12:00:00.000Z');
    expect(parseCliArgs(['suspensions'], () => clock).now).toBe(clock);
  });

  it('rejects a missing job, an invalid --now and an unknown job', async () => {
    expect(() => parseCliArgs([])).toThrow('usage: job <name>');
    expect(() => parseCliArgs(['renewals', '--now=amanhã'])).toThrow('invalid --now');
    await expect(runCli(['nope'], { NODE_ENV: 'test' })).rejects.toThrow('unknown job "nope"');
  });
});
