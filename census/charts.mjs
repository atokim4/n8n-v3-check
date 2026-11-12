// Renders the census charts from data/summary.csv as standalone SVG files in charts/.
// Palette, ink and chrome follow the dataviz reference palette (validated light and dark).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseCsv(text) {
  const [header, ...lines] = text.trim().split('\n');
  const keys = header.split(',');
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'));
    return Object.fromEntries(keys.map((k, i) => [k, cells[i]]));
  });
}

const rows = parseCsv(await readFile(path.join(ROOT, 'data/summary.csv'), 'utf8'));
const get = (section, key) => rows.find((r) => r.section === section && r.key === key);
const pct = (n) => `${Number(n).toFixed(1)}%`;
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const fmt = (n) => Number(n).toLocaleString('en-US');

const STYLE = `
  <style>
    svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7;
          --s1:#2a78d6; --o-high:#184f95; --o-mid:#3987e5; --o-low:#86b6ef; }
    @media (prefers-color-scheme: dark) {
      svg { --surface:#1a1a19; --ink:#f0efec; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835;
            --s1:#3987e5; --o-high:#3987e5; --o-mid:#256abf; --o-low:#184f95; }
    }
    text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--ink2); font-size: 13px; }
    .title { fill: var(--ink); font-size: 17px; font-weight: 600; }
    .sub { fill: var(--ink2); font-size: 13px; }
    .val { fill: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
    .muted { fill: var(--muted); font-size: 11px; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .axis { stroke: var(--axis); stroke-width: 1; }
    .hit { fill: transparent; }
    g.mark:hover .bar { opacity: .82; }
  </style>`;

const frame = (w, h, title, sub, body, source) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title><desc id="d">${esc(sub)}</desc>${STYLE}
  <rect width="${w}" height="${h}" rx="8" fill="var(--surface)"/>
  <text x="24" y="34" class="title">${esc(title)}</text>
  <text x="24" y="56" class="sub">${esc(sub)}</text>
${body}
  <text x="24" y="${h - 14}" class="muted">${esc(source)}</text>
</svg>
`;

/** Horizontal bar with a 4px rounded data end and a square baseline end. */
const hbar = (x, y, w, h, cls = 'bar', fill = 'var(--s1)') => {
  if (w <= 0) return '';
  const r = Math.min(4, w);
  return `<path class="${cls}" fill="${fill}" d="M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z"/>`;
};

const SOURCE = 'Source: api.n8n.io public template gallery, checked with n8n-v3-check (rules from n8n 3.x migration report).';

// 1. Overall: one 100% bar per measure, three ordinal states.
function overallChart() {
  const total = get('overall', 'breaks_on_3.0');
  const change = get('overall', 'behaviour_change_only');
  const measures = [
    { label: 'Share of templates', b: +total.affected / +total.templates, c: +change.affected / +change.templates },
    { label: 'Share of views', b: +total.affected_views / +total.views, c: +change.affected_views / +change.views },
  ];
  const W = 760, x0 = 170, bw = 540, bh = 34;
  const states = [
    { key: 'b', name: 'Breaks on 3.0', fill: 'var(--o-high)' },
    { key: 'c', name: 'Runs, but behaves differently', fill: 'var(--o-mid)' },
    { key: 'ok', name: 'Not affected', fill: 'var(--o-low)' },
  ];
  let body = '';
  // Legend in one row above the plot.
  let lx = 24;
  for (const s of states) {
    body += `  <rect x="${lx}" y="78" width="12" height="12" rx="2" fill="${s.fill}"/><text x="${lx + 18}" y="89">${s.name}</text>\n`;
    lx += 18 + s.name.length * 7.2 + 24;
  }
  measures.forEach((m, i) => {
    const y = 116 + i * 64;
    const parts = { b: m.b, c: m.c, ok: 1 - m.b - m.c };
    body += `  <text x="24" y="${y + bh / 2 + 5}" fill="var(--ink)">${m.label}</text>\n`;
    let x = x0;
    for (const s of states) {
      const w = parts[s.key] * bw;
      const gap = s.key === 'ok' ? 0 : 2;
      body += `  <g class="mark"><title>${m.label}: ${s.name} ${pct(parts[s.key] * 100)}</title><rect class="bar" x="${x}" y="${y}" width="${Math.max(0, w - gap)}" height="${bh}" fill="${s.fill}" ${s.key === 'ok' ? 'rx="4"' : ''}/>`;
      const label = pct(parts[s.key] * 100);
      if (w > 44) body += `<text x="${x + 8}" y="${y + bh / 2 + 5}" style="fill:${s.key === 'ok' ? '#0b0b0b' : '#ffffff'};font-weight:600">${label}</text>`;
      else if (w > 0) body += `<text x="${x}" y="${y - 6}" class="val" style="font-weight:600">${label}</text>`; // too narrow: label above
      body += '</g>\n';
      x += w;
    }
  });
  body += `  <text x="24" y="262" class="sub">${fmt(total.templates)} templates, ${fmt(total.views)} total views. "Breaks" = at least one node n8n 3.0 removes or fails.</text>\n`;
  return frame(W, 300, 'How the public n8n templates fare on n8n 3.0', 'Each template counted once by its most severe finding', body, SOURCE);
}

// 2. Removed / failing items, share of templates, sorted.
function rulesChart() {
  const list = rows
    .filter((r) => r.section === 'by_rule' && r.severity === 'error')
    .sort((a, b) => +b.share_pct - +a.share_pct)
    .slice(0, 12);
  const W = 760, x0 = 300, plotW = 380, bh = 20, step = 30, top = 92;
  const max = Math.max(...list.map((r) => +r.share_pct));
  const tick = max > 8 ? 2 : 1;
  const scaleMax = Math.ceil(max / tick) * tick;
  const sx = (v) => (v / scaleMax) * plotW;
  let body = '';
  for (let t = 0; t <= scaleMax; t += tick) {
    body += `  <line class="grid" x1="${x0 + sx(t)}" x2="${x0 + sx(t)}" y1="${top - 8}" y2="${top + list.length * step - 6}"/><text x="${x0 + sx(t)}" y="${top - 14}" class="muted" text-anchor="middle">${t}%</text>\n`;
  }
  list.forEach((r, i) => {
    const y = top + i * step;
    const w = sx(+r.share_pct);
    body += `  <g class="mark"><title>${esc(r.label)}: ${fmt(r.affected)} of ${fmt(r.templates)} templates (${pct(r.share_pct)}), ${pct(r.view_share_pct)} of views</title>`;
    body += `<rect class="hit" x="24" y="${y - 4}" width="${W - 48}" height="${step}"/>`;
    body += `<text x="${x0 - 10}" y="${y + 15}" text-anchor="end" fill="var(--ink)">${esc(r.label)}</text>`;
    body += hbar(x0, y, w, bh);
    body += `<text x="${x0 + w + 6}" y="${y + 15}" class="val">${pct(r.share_pct)} (${fmt(r.affected)})</text></g>\n`;
  });
  body += `  <line class="axis" x1="${x0}" x2="${x0}" y1="${top - 8}" y2="${top + list.length * step - 6}"/>\n`;
  const h = top + list.length * step + 40;
  return frame(W, h, 'What breaks: the most common removed items', 'Share of all public templates that contain each one (a template can have several)', body, SOURCE);
}

// 3. Share breaking by template creation year.
function yearChart() {
  const list = rows.filter((r) => r.section === 'by_year' && +r.templates >= 20);
  const W = 760, H = 330, left = 64, bottom = 250, plotH = 160, top = bottom - plotH;
  const slot = (W - 24 - left) / list.length;
  const colW = Math.min(70, slot - 24);
  const max = Math.max(...list.map((r) => +r.share_pct));
  const scaleMax = Math.ceil(max / 20) * 20;
  const sy = (v) => (v / scaleMax) * plotH;
  let body = '';
  for (let t = 0; t <= scaleMax; t += 20) {
    body += `  <line class="grid" x1="${left}" x2="${W - 24}" y1="${bottom - sy(t)}" y2="${bottom - sy(t)}"/><text x="${left - 8}" y="${bottom - sy(t) + 4}" class="muted" text-anchor="end">${t}%</text>\n`;
  }
  list.forEach((r, i) => {
    const x = left + i * slot + (slot - colW) / 2;
    const h = sy(+r.share_pct);
    const r4 = Math.min(4, h);
    body += `  <g class="mark"><title>${r.key}: ${fmt(r.affected)} of ${fmt(r.templates)} templates break (${pct(r.share_pct)})</title>`;
    body += `<rect class="hit" x="${x - 6}" y="${top}" width="${colW + 12}" height="${plotH + 40}"/>`;
    if (h > 0) body += `<path class="bar" fill="var(--s1)" d="M${x},${bottom} V${bottom - h + r4} Q${x},${bottom - h} ${x + r4},${bottom - h} H${x + colW - r4} Q${x + colW},${bottom - h} ${x + colW},${bottom - h + r4} V${bottom} Z"/>`;
    body += `<text x="${x + colW / 2}" y="${bottom - h - 6}" class="val" text-anchor="middle">${pct(r.share_pct)}</text>`;
    body += `<text x="${x + colW / 2}" y="${bottom + 18}" text-anchor="middle" fill="var(--ink)">${r.key}</text>`;
    body += `<text x="${x + colW / 2}" y="${bottom + 34}" class="muted" text-anchor="middle">n=${fmt(r.templates)}</text></g>\n`;
  });
  body += `  <line class="axis" x1="${left}" x2="${W - 24}" y1="${bottom}" y2="${bottom}"/>\n`;
  return frame(W, H, 'Share of templates that break, by publication year', 'Templates that break on n8n 3.0, grouped by the year they were published (years with 20+ templates)', body, SOURCE);
}

await writeFile(path.join(ROOT, 'charts/overall.svg'), overallChart());
await writeFile(path.join(ROOT, 'charts/removed-items.svg'), rulesChart());
await writeFile(path.join(ROOT, 'charts/by-year.svg'), yearChart());
console.log('charts written');
