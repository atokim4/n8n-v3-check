// Collects every public template from the n8n template gallery API (api.n8n.io).
// Polite by design: one request at a time, at most ~3 requests per second, and every
// response is cached gzipped under data/raw/ so a second run resumes where the first stopped.
//
// Usage: node census/collect.mjs [--limit N] [--sort createdAt:desc]
// The default index is sorted by views. Views change while the crawl runs, so a few templates can
// slip between pages; a second pass with --sort createdAt:desc (a stable order) picks those up.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const API = 'https://api.n8n.io/api/templates';
const UA = 'n8n-v3-check-census/0.1 (+https://github.com/atokim4/n8n-v3-check)';
const MIN_GAP_MS = 350;
const ROWS = 100;
const RAW = path.resolve(import.meta.dirname, '../data/raw');

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const sortArg = process.argv.indexOf('--sort');
const SORT = sortArg > -1 ? process.argv[sortArg + 1] : 'views:desc';
const INDEX_DIR = SORT === 'views:desc' ? 'search' : `search-${SORT.replace(/\W+/g, '-')}`;

let lastRequest = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeGet(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = lastRequest + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return { status: 404, body: null };
      if (res.ok) return { status: 200, body: await res.text() };
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} for ${url}`);
      console.log(`retry ${attempt}: HTTP ${res.status} ${url}`);
    } catch (err) {
      if (String(err.message).startsWith('HTTP ')) throw err;
      console.log(`retry ${attempt}: ${err.message} ${url}`);
    }
    await sleep(2 ** attempt * 1000);
  }
  throw new Error(`gave up on ${url}`);
}

const exists = (p) => access(p).then(() => true, () => false);
const readGz = async (p) => JSON.parse(gunzipSync(await readFile(p)).toString('utf8'));
const writeGz = (p, text) => writeFile(p, gzipSync(text));

async function collectIndex() {
  await mkdir(path.join(RAW, INDEX_DIR), { recursive: true });
  const ids = [];
  for (let page = 1; ; page++) {
    const file = path.join(RAW, INDEX_DIR, `page-${page}.json.gz`);
    let data;
    if (await exists(file)) data = await readGz(file);
    else {
      const { body } = await politeGet(`${API}/search?page=${page}&rows=${ROWS}&sort=${SORT}`);
      data = JSON.parse(body);
      // Icons are large base64 blobs we never use; drop them before caching.
      for (const wf of data.workflows) for (const n of wf.nodes ?? []) delete n.iconData;
      await writeGz(file, JSON.stringify(data));
    }
    ids.push(...data.workflows.map((w) => w.id));
    if (page % 20 === 0) console.log(`index page ${page}: ${ids.length}/${data.totalWorkflows}`);
    if (data.workflows.length === 0 || page * ROWS >= data.totalWorkflows) break;
  }
  return [...new Set(ids)];
}

async function collectDetails(ids) {
  await mkdir(path.join(RAW, 'wf'), { recursive: true });
  let fetched = 0;
  let missing = 0;
  for (const [i, id] of ids.entries()) {
    const file = path.join(RAW, 'wf', `${id}.json.gz`);
    if (await exists(file)) continue;
    const { status, body } = await politeGet(`${API}/workflows/${id}`);
    if (status === 404) missing++;
    await writeGz(file, body ?? JSON.stringify({ notFound: true, id }));
    fetched++;
    if (fetched % 250 === 0) console.log(`${new Date().toISOString()} details ${i + 1}/${ids.length} (fetched ${fetched}, 404 ${missing})`);
  }
  console.log(`details done: fetched ${fetched}, 404 ${missing}`);
}

const ids = (await collectIndex()).slice(0, limit);
console.log(`${new Date().toISOString()} index: ${ids.length} template ids`);
await writeFile(path.join(RAW, `ids-${INDEX_DIR}.json`), JSON.stringify(ids));
await collectDetails(ids);
console.log(`${new Date().toISOString()} DONE`);
