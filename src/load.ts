import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Workflow } from './types.js';

export interface LoadedWorkflow {
  source: string;
  workflow: Workflow;
}

export interface LoadResult {
  workflows: LoadedWorkflow[];
  /** Files that could not be read as workflows, with the reason. */
  skipped: { source: string; reason: string }[];
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function isWorkflow(value: unknown): value is Workflow {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Workflow).nodes) &&
    (value as Workflow).nodes.every((n) => typeof n === 'object' && n !== null && typeof n.type === 'string')
  );
}

/**
 * Pulls workflows out of the JSON shapes people actually have: a single export, the array that
 * `n8n export:workflow --all` writes, a public API list ({ data: [...] }) and the template
 * gallery API response ({ workflow: { workflow: {...} } }).
 */
export function extractWorkflows(json: unknown): Workflow[] {
  if (Array.isArray(json)) return json.flatMap(extractWorkflows);
  if (isWorkflow(json)) return [json];
  if (typeof json !== 'object' || json === null) return [];
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data.flatMap(extractWorkflows);
  if (typeof obj.workflow === 'object' && obj.workflow !== null) {
    const outer = obj.workflow as Record<string, unknown>;
    const inner = extractWorkflows(outer.workflow ?? outer);
    // The gallery keeps the name and id on the outer object.
    return inner.map((wf) => ({ ...wf, name: wf.name ?? (outer.name as string), id: wf.id ?? (outer.id as number) }));
  }
  return [];
}

async function listJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : listJsonFiles(full);
        return entry.isFile() && entry.name.toLowerCase().endsWith('.json') ? [full] : [];
      }),
  );
  return nested.flat();
}

async function loadFile(file: string, result: LoadResult): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    result.skipped.push({ source: file, reason: `not valid JSON (${(err as Error).message})` });
    return;
  }
  const found = extractWorkflows(json);
  if (found.length === 0) {
    result.skipped.push({ source: file, reason: 'no n8n workflow found (no "nodes" array)' });
    return;
  }
  for (const workflow of found) result.workflows.push({ source: file, workflow });
}

/** Loads every workflow from the given files and folders (folders are searched recursively for *.json). */
export async function loadWorkflows(inputs: readonly string[]): Promise<LoadResult> {
  const result: LoadResult = { workflows: [], skipped: [] };
  for (const input of inputs) {
    const info = await stat(input);
    const files = info.isDirectory() ? await listJsonFiles(input) : [input];
    for (const file of files) await loadFile(file, result);
  }
  return result;
}
