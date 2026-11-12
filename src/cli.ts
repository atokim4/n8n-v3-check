#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { checkWorkflow } from './check.js';
import { loadWorkflows } from './load.js';
import { formatText, summarize } from './report.js';
import type { WorkflowReport } from './types.js';

const USAGE = `Usage: n8n-v3-check [options] <workflow.json | folder>...

Checks exported n8n workflow JSON for what n8n 3.0 removes or changes. Works offline.

Options:
  --json             Print a JSON report instead of text
  --ignore-disabled  Skip disabled nodes (n8n's own report includes them)
  --strict           Exit 1 on behaviour changes too, not only on breaking nodes
  --show-info        Also list items that depend on instance settings (community nodes, Slack secret)
  -h, --help         Show this help

Exit codes: 0 nothing breaking, 1 breaking findings (or any finding with --strict), 2 usage or read error.`;

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        'ignore-disabled': { type: 'boolean', default: false },
        strict: { type: 'boolean', default: false },
        'show-info': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (positionals.length === 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let loaded;
  try {
    loaded = await loadWorkflows(positionals);
  } catch (err) {
    process.stderr.write(`n8n-v3-check: ${(err as Error).message}\n`);
    return 2;
  }
  for (const skip of loaded.skipped) process.stderr.write(`skipped ${skip.source}: ${skip.reason}\n`);
  if (loaded.workflows.length === 0) {
    process.stderr.write('n8n-v3-check: no workflows found\n');
    return 2;
  }

  const reports: WorkflowReport[] = loaded.workflows.map(({ source, workflow }) => ({
    source,
    workflowName: workflow.name ?? '(unnamed workflow)',
    workflowId: workflow.id,
    findings: checkWorkflow(workflow, { ignoreDisabled: values['ignore-disabled'] }),
  }));

  const summary = summarize(reports);
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ summary, skipped: loaded.skipped, workflows: reports }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatText(reports, { showInfo: values['show-info'] })}\n`);
  }

  if (summary.errors > 0) return 1;
  if (values.strict && summary.warnings > 0) return 1;
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
