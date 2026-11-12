// Runs the checker over every cached gallery template and writes the census tables.
// Input: data/raw/ (from census/collect.mjs). Output: data/summary.csv, data/top20.csv, data/coverage.json.
// Only public template metadata is kept (id, name, views, price, creator-verified flag, creation year).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { checkWorkflow, extractWorkflows, REMOVED_NODES } from '../dist/index.js';

const RULE_LABELS = {
  ...Object.fromEntries(REMOVED_NODES.map((r) => [r.ruleId, r.name])),
  'agent-removed-modes-v3': 'AI Agent v1 in a removed mode',
  'agent-node-version-v3': 'AI Agent below v2 (Tools Agent)',
  'edit-image-version-v3': 'Edit Image v1',
  'gmail-trigger-version-v3': 'Gmail Trigger below v1.4',
  'execute-workflow-source-modes-v3': 'Execute Sub-workflow URL/Local File source',
  'get-paired-item-v3': '$getPairedItem expression',
  'evaluate-expression-code-node-v3': '$evaluateExpression in Code',
  'always-output-data-multi-output-v3': 'Always Output Data on multi-output node',
  'chat-trigger-embedded-json-v3': 'Embedded Chat Trigger',
  'slack-trigger-signature-secret-v3': 'Slack Trigger (needs signing secret)',
};
const ruleLabel = (id) => RULE_LABELS[id] ?? id;

const DATA = path.resolve(import.meta.dirname, '../data');
const RAW = path.join(DATA, 'raw');
const readGz = async (p) => JSON.parse(gunzipSync(await readFile(p)).toString('utf8'));

async function loadIndex() {
  const dirs = (await readdir(RAW)).filter((d) => d.startsWith('search'));
  const files = [];
  for (const dir of dirs) {
    for (const f of await readdir(path.join(RAW, dir))) if (f.endsWith('.json.gz')) files.push(path.join(RAW, dir, f));
  }
  const index = new Map();
  let total = 0;
  for (const f of files) {
    const page = await readGz(f);
    total = Math.max(total, page.totalWorkflows);
    for (const w of page.workflows) {
      index.set(w.id, {
        id: w.id,
        name: w.name,
        price: Number(w.price ?? 0),
        verified: w.user?.verified === true,
        year: new Date(w.createdAt).getUTCFullYear(),
        // The search index and the detail endpoint report different view counters (the detail one is
        // higher for most popular templates). The census weights by the search-index counter, the one
        // the gallery sorts by.
        views: Number(w.totalViews ?? 0),
      });
    }
  }
  return { index, total };
}

const { index, total } = await loadIndex();
const templates = [];
const coverage = { galleryTotal: total, indexed: index.size, fetched: 0, notFound: 0, noWorkflowJson: 0, analyzed: 0 };

for (const meta of index.values()) {
  let detail;
  try {
    detail = await readGz(path.join(RAW, 'wf', `${meta.id}.json.gz`));
  } catch {
    continue; // not collected yet
  }
  coverage.fetched++;
  if (detail.notFound) {
    coverage.notFound++;
    continue;
  }
  const [workflow] = extractWorkflows(detail);
  if (!workflow) {
    coverage.noWorkflowJson++;
    continue;
  }
  const findings = checkWorkflow(workflow);
  const errors = findings.filter((f) => f.severity === 'error');
  const enabledErrors = errors.filter((f) => !f.disabled);
  templates.push({
    ...meta,
    detailViews: Number(detail.workflow?.totalViews ?? detail.workflow?.views ?? 0),
    breaks: errors.length > 0,
    breaksEnabled: enabledErrors.length > 0,
    changesOnly: errors.length === 0 && findings.some((f) => f.severity === 'warning'),
    allAuto: errors.length > 0 && errors.every((f) => f.autoMigratable),
    community: findings.some((f) => f.ruleId === 'unverified-packages-v3'),
    rules: new Set(findings.filter((f) => f.severity !== 'info').map((f) => f.ruleId)),
    ruleSeverity: new Map(findings.map((f) => [f.ruleId, f.severity])),
    errorNodes: [...new Set(errors.map((f) => ruleLabel(f.ruleId)))],
  });
}
coverage.analyzed = templates.length;
coverage.viewsSearchIndex = templates.reduce((s, t) => s + t.views, 0);
coverage.viewsDetailEndpoint = templates.reduce((s, t) => s + t.detailViews, 0);
// Robustness check: the break share weighted by the other view counter.
coverage.breakViewSharePctDetailCounter = Number(
  ((100 * templates.filter((t) => t.breaks).reduce((s, t) => s + t.detailViews, 0)) / coverage.viewsDetailEndpoint).toFixed(2),
);

const rows = [];
function addRow(section, key, group, predicate, severity = '') {
  const hit = group.filter(predicate);
  const views = group.reduce((s, t) => s + t.views, 0);
  const hitViews = hit.reduce((s, t) => s + t.views, 0);
  rows.push({
    section,
    key,
    label: section === 'by_rule' ? ruleLabel(key) : key,
    severity,
    templates: group.length,
    affected: hit.length,
    share_pct: group.length ? ((100 * hit.length) / group.length).toFixed(2) : '',
    views,
    affected_views: hitViews,
    view_share_pct: views ? ((100 * hitViews) / views).toFixed(2) : '',
  });
}

const breaks = (t) => t.breaks;
addRow('overall', 'breaks_on_3.0', templates, breaks);
addRow('overall', 'breaks_on_3.0_enabled_nodes_only', templates, (t) => t.breaksEnabled);
addRow('overall', 'behaviour_change_only', templates, (t) => t.changesOnly);
addRow('overall', 'breaks_and_every_break_has_auto_migration', templates, (t) => t.allAuto);
addRow('overall', 'uses_community_node', templates, (t) => t.community);

const ruleIds = [...new Set(templates.flatMap((t) => [...t.rules]))].sort();
for (const id of ruleIds) {
  addRow('by_rule', id, templates, (t) => t.rules.has(id), templates.find((t) => t.rules.has(id))?.ruleSeverity.get(id));
}

addRow('by_price', 'free', templates.filter((t) => t.price === 0), breaks);
addRow('by_price', 'paid', templates.filter((t) => t.price > 0), breaks);
addRow('by_creator', 'verified', templates.filter((t) => t.verified), breaks);
addRow('by_creator', 'not_verified', templates.filter((t) => !t.verified), breaks);
for (const year of [...new Set(templates.map((t) => t.year))].sort()) {
  addRow('by_year', String(year), templates.filter((t) => t.year === year), breaks);
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : String(v));
const toCsv = (list) => [Object.keys(list[0]).join(','), ...list.map((r) => Object.values(r).map(csvCell).join(','))].join('\n') + '\n';

await writeFile(path.join(DATA, 'summary.csv'), toCsv(rows));
const top = templates
  .filter(breaks)
  .sort((a, b) => b.views - a.views)
  .slice(0, 20)
  .map((t) => ({ id: t.id, name: t.name, views: t.views, year: t.year, breaking_items: t.errorNodes.join('; ') }));
await writeFile(path.join(DATA, 'top20.csv'), toCsv(top));
await writeFile(path.join(DATA, 'coverage.json'), JSON.stringify({ ...coverage, generatedAt: new Date().toISOString() }, null, 2) + '\n');

console.log(coverage);
console.table(rows.filter((r) => r.section !== 'by_rule'));
