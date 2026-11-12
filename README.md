# n8n-v3-check

An offline checker for n8n workflow JSON. It reads your exported workflows and lists every node and
setting that n8n 3.0 removes or changes, with the replacement for each one. It doesn't need a running n8n
instance, so it works on workflows you keep in git, on exports from a 1.x instance and on templates from the
public gallery. Exit codes let you use it as a CI gate.

n8n's own Migration Report (Settings > Migration Report) does the same job, but only inside a running 2.x
instance and only for workflows saved in it. This tool copies the workflow-level rules of that report, so you
can run them anywhere.

I also used it to check the public template gallery. The numbers are in [The census](#the-census) below.

## Install and run

Needs Node.js 22 or newer.

```bash
git clone https://github.com/atokim4/n8n-v3-check.git
cd n8n-v3-check
npm install          # also builds dist/
node dist/cli.js path/to/workflow.json
node dist/cli.js workflows/            # a folder, searched recursively for *.json
npm link && n8n-v3-check workflows/    # optional: put the command on your PATH
```

Accepted inputs: a single workflow export, the array that `n8n export:workflow --all` writes, a public API list
(`{ "data": [...] }`) and a template gallery response (`{ "workflow": { "workflow": {...} } }`). Files that are
not valid JSON or hold no workflow are reported on stderr and skipped.

```text
$ n8n-v3-check test/fixtures/legacy-multi.json
Legacy nightly report  (test/fixtures/legacy-multi.json)
  BREAKS  "Cron" (n8n-nodes-base.cron v1) [Migration Report offers auto-migration]
          Cron node is removed in n8n 3.0
          fix: Schedule Trigger.
  BREAKS  "Function" (n8n-nodes-base.function v1)
          Function node is removed in n8n 3.0
          fix: Code node, mode "Run Once for All Items".
  ...
1 workflow(s) checked: 1 affected, 5 breaking, 1 behaviour change(s), 0 to check by hand.
```

### Options

| Option | What it does |
| --- | --- |
| `--json` | Print a JSON report (summary, skipped files, findings per workflow) |
| `--ignore-disabled` | Skip disabled nodes. n8n's own report includes them, so the default is to include them |
| `--strict` | Exit 1 on behaviour changes too, not only on breaking findings |
| `--show-info` | Also list items that depend on instance settings (community nodes, Slack Trigger secret) |

Exit codes: `0` nothing breaking, `1` breaking findings (or any finding with `--strict`), `2` usage or read
error.

### Severities

- **BREAKS** (`error`): the node fails or the workflow stops activating on 3.0 (n8n's `executionsFail`).
- **CHANGES** (`warning`): the node still runs but behaves differently (n8n's `behaviorChanges`).
- **CHECK** (`info`): depends on something workflow JSON doesn't contain, such as instance environment
  variables or credentials.

`[Migration Report offers auto-migration]` marks the rules where n8n 2.x has a one-click fix. It can still
refuse unusual configurations, so treat it as a hint.

### CI example

```yaml
- run: git clone --depth 1 https://github.com/atokim4/n8n-v3-check.git /tmp/n8n-v3-check
- run: npm --prefix /tmp/n8n-v3-check install
- run: node /tmp/n8n-v3-check/dist/cli.js workflows/
```

## Rules and where they come from

Every rule is ported from n8n's own v3 migration-report code:
`packages/cli/src/modules/breaking-changes/rules/v3/` on the `3.x` branch of
[n8n-io/n8n](https://github.com/n8n-io/n8n), commit `fe44b6c2b64dcc1e11990052c07c259554f0efc4`
(2026-11-11). The removed-node lists are identical on `master` at `dd098f0`. No node type is in this tool
unless it appears in that code.

| Rule (n8n file) | What is checked |
| --- | --- |
| `removed-nodes-with-replacements.rule.ts` | 28 removed node types with a replacement: Function, Function Item, Item Lists, Cron, Interval, HTML Extract, iCalendar, Convert to/from binary data, Read Binary File(s), Write Binary File, Read PDF, Workflow Trigger, OpenAI (legacy), OpenAI Assistant, OpenAI Model, HTTP Request Tool (legacy), SerpApi (Google Search) tool, Manual Chat Trigger, Chat Messages Retriever, Binary/JSON Input Loader, In Memory, Pinecone and Supabase Insert/Load vector stores |
| `removed-nodes.rule.ts` | 8 removed node types without a direct replacement: GitHub Document Loader, Motorhead, Zep memory, Zep Vector Store (and Insert/Load), Orbit, LangChain Code |
| `ai-transform-deprecated.rule.ts` | AI Transform node |
| `agent-removed-modes.rule.ts`, `agent-node-version.rule.ts` | AI Agent below v2: removed modes (Conversational, OpenAI Functions, Plan and Execute, ReAct, SQL) break; Tools Agent v1 changes behaviour |
| `edit-image-version.rule.ts` | Edit Image v1 |
| `gmail-trigger-version.rule.ts` | Gmail Trigger below v1.4 |
| `execute-workflow-source-modes.rule.ts` | Execute Sub-workflow with the URL or Local File source |
| `get-paired-item.rule.ts` | `$getPairedItem` in any parameter |
| `evaluate-expression-code-node.rule.ts` | `$evaluateExpression` in JavaScript Code nodes |
| `always-output-data-multi-output.rule.ts` | Always Output Data on If, Switch, Compare Datasets, Loop Over Items v2+ and nodes with an error output |
| `chat-trigger-embedded-json.rule.ts` | Chat Trigger in embedded (webhook) mode |
| `slack-trigger-signature-secret.rule.ts` | Slack Trigger (info: the signing secret lives in the credential) |
| `unverified-packages.rule.ts` | Community node types (info: depends on which packages are verified) |

Instance-level rules (storage paths, task runner timeouts, SSRF ranges, compression limits, Docker-only
deployment and others) look at environment variables and the database, not at workflow JSON, so they are out
of scope here. Run the official report on your instance for those.

Known limit: n8n resolves node outputs from the installed node code. Offline, the Always Output Data rule only
knows the core multi-output nodes listed above.

## Development

```bash
npm run typecheck
npm run lint
npm test             # Vitest: rules on fixtures plus CLI exit codes
npm run build
```

The fixtures in `test/fixtures/` are hand-written sample workflows (multi-node, disabled nodes, sticky notes,
community nodes, AI Agent modes, version-specific rules, a folder with a broken file and an
`export:workflow --all` array).

## The census

`census/` holds the scripts behind the gallery numbers:

- `census/collect.mjs` reads the public template API at `api.n8n.io` one request at a time (at most about 3
  per second), caches every response gzipped under `data/raw/` (gitignored) and resumes where it stopped.
- `census/analyze.mjs` runs the checker over every cached template and writes `data/summary.csv`,
  `data/top20.csv` and `data/coverage.json`. Only public template metadata is kept: id, name, views, price,
  the creator-verified flag and the creation year.
- `census/charts.mjs` draws the SVG charts in `charts/` from `data/summary.csv`.

```bash
node census/collect.mjs && node census/collect.mjs --sort createdAt:desc
npm run census:analyze && npm run census:charts
```

### Results (collected 2026-11-12)

The gallery API reported 14,216 templates; paging through it by views and again by creation date returned
14,139 distinct ids, and all 14,139 were downloaded and checked. Full tables: [data/summary.csv](data/summary.csv),
[data/top20.csv](data/top20.csv), [data/coverage.json](data/coverage.json).

- 1,117 templates (7.9%) contain at least one node or setting that fails on n8n 3.0. They hold 26.1% of all
  template views.
- 1,787 more (12.6%) run on 3.0 but behave differently, mostly AI Agent v1 (Tools Agent) and Gmail Trigger
  below v1.4.
- In 321 of the 1,117 breaking templates, every breaking item has a one-click fix in n8n's Migration Report.
- Old templates are the problem: 62.5% of 2019 templates break, 2.7% of 2026 ones.
- The most common removed nodes are Function (328 templates) and Cron (244). By views, SerpApi (Google Search)
  leads: 81 templates, 6.8% of all views, including the most viewed template in the gallery.

![Share of templates and views affected](charts/overall.svg)
![Most common removed items](charts/removed-items.svg)
![Share that breaks by publication year](charts/by-year.svg)

Caveats: gallery templates are examples, not running production workflows. "Breaks" means the workflow needs an
edit before it runs on 3.0, not that it can't be migrated. Views are the search index's `totalViews` counter;
the detail endpoint reports a higher counter, and weighted by that one the breaking share of views is 21.0%.


## Licence

MIT, see [LICENSE](LICENSE). Not affiliated with n8n GmbH. "n8n" is used only to name the software this
tool checks.
