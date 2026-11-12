import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, ['dist/cli.js', ...args], { cwd: root });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

beforeAll(async () => {
  await run('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd: root });
}, 60_000);

describe('n8n-v3-check CLI', () => {
  it('exits 0 for a clean workflow', async () => {
    const r = await cli(`${fixtures}clean.json`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('1 workflow(s) checked: 0 affected');
  });

  it('exits 1 and names the node, workflow and fix for breaking nodes', async () => {
    const r = await cli(`${fixtures}legacy-multi.json`);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Legacy nightly report');
    expect(r.stdout).toMatch(/BREAKS\s+"Cron" \(n8n-nodes-base\.cron v1\) \[Migration Report offers auto-migration\]/);
    expect(r.stdout).toContain('fix: Schedule Trigger.');
  });

  it('walks folders, reads export arrays and gallery JSON, and reports unreadable files', async () => {
    const r = await cli('--json', `${fixtures}folder`);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.workflows.map((w: { workflowName: string }) => w.workflowName)).toEqual([
      'Export A',
      'Export B',
      'Gallery template',
    ]);
    expect(report.summary).toMatchObject({ workflows: 3, affected: 2, errors: 2 });
    expect(report.skipped).toHaveLength(2);
    expect(r.stderr).toContain('broken.json: not valid JSON');
  });

  it('only fails on behaviour changes with --strict', async () => {
    const plain = await cli(`${fixtures}warnings-only.json`);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('CHANGES "Gmail Trigger"');
    expect((await cli('--strict', `${fixtures}warnings-only.json`)).code).toBe(1);
  });

  it('hides instance-dependent items unless --show-info', async () => {
    const plain = await cli(`${fixtures}community.json`);
    expect(plain.stdout).not.toContain('unverified community packages');
    const info = await cli('--show-info', `${fixtures}community.json`);
    expect(info.stdout).toContain('CHECK   "Serp community"');
  });

  it('exits 2 on usage errors and missing paths', async () => {
    expect((await cli()).code).toBe(2);
    expect((await cli('--nope', 'x')).code).toBe(2);
    const missing = await cli(`${fixtures}does-not-exist.json`);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('ENOENT');
  });
});
