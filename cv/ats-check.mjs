#!/usr/bin/env node
// ATS safety check for a built CV PDF. Exit 0 = pass, 1 = fail.
//   node cv/ats-check.mjs <cv.pdf> --content <cv.yaml> [--max-pages 3] [--max-mb 2]
// Needs poppler: pdfinfo, pdftotext, pdffonts, pdfimages (brew install poppler / apt install poppler-utils).
// Checks: page count; no page overflow (from <pdf>.layout.json written by build.mjs); name, email, phone,
// every section heading and every job company/role/date present in `pdftotext -layout`; each heading comes
// before its section and headings are in order (raw reading order); each skill card's heading is followed by
// its own body; no images (text must never be an image); no em dashes; all fonts embedded; size limit.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { expectations } from './build.mjs';

const args = process.argv.slice(2);
const pdf = args.find(a => a.endsWith('.pdf'));
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
if (!pdf || !fs.existsSync(pdf)) { console.error('usage: ats-check.mjs <cv.pdf> --content <cv.yaml>'); process.exit(2); }
const maxPages = +opt('--max-pages', 3), maxMb = +opt('--max-mb', 2);
const content = opt('--content') ? YAML.parse(fs.readFileSync(opt('--content'), 'utf8')) : null;

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { encoding: 'utf8' });
  if (r.error) { console.error(`missing ${cmd}: install poppler (brew install poppler)`); process.exit(2); }
  return r.stdout || '';
};
const norm = s => String(s ?? '').normalize('NFKC').replace(/­/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\*\*|\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const fails = [], notes = [];
const fail = m => fails.push(m);

// pages + overflow
const pages = +(run('pdfinfo', [pdf]).match(/Pages:\s+(\d+)/) || [0, 0])[1];
if (!pages) fail('pdfinfo could not read the PDF');
if (pages > maxPages) fail(`${pages} pages, limit is ${maxPages}`);
const lj = pdf.replace(/\.pdf$/, '.layout.json');
if (fs.existsSync(lj)) {
  const L = JSON.parse(fs.readFileSync(lj, 'utf8'));
  if (L.overflow?.length) fail('content does not fit a page: ' + L.overflow.join(' | '));
  notes.push('fill ' + (L.fill || []).join('/'));
} else notes.push('no layout.json (overflow not checked; build with cv/build.mjs)');

// text layer
const layoutText = norm(run('pdftotext', ['-layout', pdf, '-']));
const raw = norm(run('pdftotext', [pdf, '-']));
if (layoutText.length < 400) fail('almost no extractable text (is the text an image?)');
if (/—/.test(run('pdftotext', [pdf, '-']))) fail('em dash found in the PDF text');
const spaced = raw.match(/(?:^|\s)(?:[a-z0-9&] ){5,}[a-z0-9&](?=\s|$)/);
if (spaced) fail(`letter-spaced text extracts as single letters ("${spaced[0].trim().slice(0, 30)}"): reduce letter-spacing in the theme`);
if (content) {
  const e = expectations(content);
  const need = (label, s) => { if (s && !layoutText.includes(norm(s))) fail(`${label} missing from text layer: "${s}"`); };
  need('name', e.name); need('email', e.email);
  if (e.phone) { const d = e.phone.replace(/\D/g, ''); if (!layoutText.replace(/\D/g, '').includes(d)) fail(`phone missing: ${e.phone}`); }
  for (const h of e.headings) need('heading', h.h);
  for (const j of e.jobs) { need('company', j.company); need('role', j.role); need('date', j.date); }
  // reading order: heading before its first content, headings in sequence
  let last = -1;
  for (const h of e.headings) {
    const hi = raw.indexOf(norm(h.h));
    const fi = h.first ? raw.indexOf(norm(h.first).slice(0, 40), Math.max(hi, 0)) : hi;
    if (hi < 0) continue;
    if (hi < last) fail(`heading out of order: "${h.h}"`);
    if (h.first && (fi < 0 || raw.indexOf(norm(h.first).slice(0, 40)) < hi)) fail(`section content appears before its heading: "${h.h}"`);
    last = hi;
  }
  // skill cards: heading immediately followed by its own body (no other card heading in between)
  const titles = e.cards.map(c => norm(c.title));
  const from = Math.max(0, raw.indexOf(norm(e.cardsHeading)));
  for (const c of e.cards) {
    const ti = raw.indexOf(norm(c.title), from); const bi = raw.indexOf(norm(c.body).slice(0, 30), ti);
    if (ti < 0 || bi < 0) { fail(`skill card not readable in order: "${c.title}"`); continue; }
    const between = raw.slice(ti + norm(c.title).length, bi);
    if (titles.some(t => t !== norm(c.title) && between.includes(t))) fail(`skill card "${c.title}" body is separated from its heading in reading order`);
  }
  const src = JSON.stringify(content);
  if (/—/.test(src)) fail('em dash in the CV content source');
}

// images, fonts, size
const imgs = run('pdfimages', ['-list', pdf]).trim().split('\n').slice(2).filter(Boolean);
if (imgs.length) fail(`${imgs.length} image(s) in the PDF; keep all text as real text`);
const fontRows = run('pdffonts', [pdf]).trim().split('\n').slice(2).filter(Boolean);
const notEmb = fontRows.filter(r => { const c = r.trim().split(/\s+/); return c.at(-5) !== 'yes'; });
if (!fontRows.length) fail('no fonts found (text may be outlined or rasterised)');
if (notEmb.length) fail('fonts not embedded: ' + notEmb.map(r => r.trim().split(/\s+/)[0]).join(', '));
const mb = fs.statSync(pdf).size / 1048576;
if (mb > maxMb) fail(`file is ${mb.toFixed(2)} MB, limit ${maxMb} MB`);

const tag = pdf.split('/').pop();
if (fails.length) { console.log(`ATS CHECK FAIL ${tag} (${pages}p, ${mb.toFixed(2)} MB)\n  - ` + fails.join('\n  - ')); process.exit(1); }
console.log(`ATS CHECK PASS ${tag} (${pages}p, ${mb.toFixed(2)} MB, ${fontRows.length} fonts embedded, ${notes.join(', ')})`);
