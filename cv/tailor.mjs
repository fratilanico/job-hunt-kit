#!/usr/bin/env node
// Per-job CV tailoring scaffold. Claude (or Codex) does the reading and rewriting; this script does the
// mechanical parts: fetch the JD, set up the workspace, lint voice + facts against the master, render,
// run the ATS check, and write the tailoring report.
//
//   node cv/tailor.mjs init  --company "Acme" --role "Head of Comms" (--jd-url <url> | --jd-file <f> | --jd-text "...")
//        -> out/<company>-<role>/{jd.txt, jd-analysis.yaml (to fill), cv.yaml (copy of the base CV to edit)}
//   node cv/tailor.mjs lint  out/<company>-<role>        voice lint + fact check against profile/cv-master.yaml
//   node cv/tailor.mjs build out/<company>-<role> [--theme name] [--bw]
//        -> <First>-<Last>-CV.pdf (neutral filename, never the company) + tailoring-report.md
//
// Master CV = profile/cv-master.yaml: same shape as cv/sample-content.yaml, holding EVERY proof point
// (more projects and bullets than fit on a page; extra bullets may go under `pool:` as free text).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { lintText } from './voice-lint.mjs';
import { recommendTheme } from './themes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const readYaml = p => YAML.parse(fs.readFileSync(p, 'utf8'));
const profile = (() => { try { return readYaml(process.env.JOBKIT_PROFILE || path.join(ROOT, 'profile/profile.yaml')) || {}; } catch { return {}; } })();
const masterPath = () => [path.join(ROOT, 'profile/cv-master.yaml'), path.join(ROOT, 'profile/cv.yaml')].find(f => fs.existsSync(f));
const basePath = () => [path.join(ROOT, profile.cv?.source || 'profile/cv.yaml'), masterPath()].find(f => f && fs.existsSync(f));

const htmlToText = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' };
async function getJson(u) { const r = await fetch(u, { headers: UA }); return r.ok ? r.json() : null; }

export async function fetchJd(url) {
  let m;
  if ((m = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=([\w-]+)&token=(\d+)|([\w-]+)\/jobs\/(\d+))/))) {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${m[1] || m[3]}/jobs/${m[2] || m[4]}?questions=true`);
    if (d) return `${d.title}\n${d.location?.name || ''}\n\n${htmlToText(htmlToText(d.content || ''))}`;
  }
  if ((m = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/i))) {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${m[1]}?includeCompensation=true`);
    const j = d?.jobs?.find(x => x.id === m[2]);
    if (j) return `${j.title}\n${j.location || ''}\n${j.compensation?.compensationTierSummary || ''}\n\n${j.descriptionPlain || htmlToText(j.descriptionHtml || '')}`;
  }
  if ((m = url.match(/jobs\.(?:eu\.)?lever\.co\/([^/]+)\/([0-9a-f-]{36})/i))) {
    const d = await getJson(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`);
    if (d) return `${d.text}\n${d.categories?.location || ''}\n\n${d.descriptionPlain || ''}\n${(d.lists || []).map(l => `${l.text}\n${htmlToText(l.content)}`).join('\n')}\n${d.additionalPlain || ''}`;
  }
  if ((m = url.match(/linkedin\.com\/jobs\/view\/(?:[^/]*-)?(\d{8,})/))) {
    const r = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${m[1]}`, { headers: UA });
    const h = await r.text(); const d = h.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/);
    if (d) return htmlToText((h.match(/top-card-layout__title[^>]*>([^<]+)/) || [0, ''])[1] + '\n\n' + d[1]);
  }
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  return htmlToText(await r.text()).slice(0, 30000);
}

// ---- fact check: everything checkable in the tailored CV must exist in the master ----
function strings(o, out = []) { if (o == null) return out; if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => strings(x, out)); else if (typeof o === 'object') Object.values(o).forEach(x => strings(x, out)); return out; }
export function factCheck(cv, master) {
  const mtext = strings(master).join('\n').toLowerCase().replace(/\*\*|\[\[|\]\]/g, '');
  const problems = [];
  const numbers = new Set(strings(cv).join(' ').replace(/\*\*|\[\[|\]\]/g, '').match(/\d[\d,.]*\s*%?|£\s?\d[\d,.]*k?/g) || []);
  for (const n of numbers) { const k = n.trim().toLowerCase(); if (!/^\d{1,2}$/.test(k) && !mtext.includes(k)) problems.push(`number not in master: "${n.trim()}"`); }
  for (const j of cv.experience || []) {
    for (const f of ['company', 'date', 'role']) if (j[f] && !mtext.includes(String(j[f]).toLowerCase())) problems.push(`${f} not in master: "${j[f]}"`);
    for (const s of j.subroles || []) if (s.title && !mtext.includes(s.title.toLowerCase())) problems.push(`sub-role not in master: "${s.title}"`);
  }
  for (const p of cv.projects || []) if (!mtext.includes(String(p.title).toLowerCase())) problems.push(`project not in master: "${p.title}"`);
  for (const f of cv.footer || []) for (const l of f.lines || []) if (!mtext.includes(l.toLowerCase())) problems.push(`education/cert line not in master: "${l}"`);
  const warn = [];
  for (const t of cv.tags || []) if (!mtext.includes(t.toLowerCase())) warn.push(`tag not in master (is it a real skill you can evidence?): "${t}"`);
  return { problems, warn };
}

function lint(dir) {
  const cvp = path.join(dir, 'cv.yaml'); const cv = readYaml(cvp);
  const mp = masterPath(); const master = mp ? readYaml(mp) : null;
  const v = lintText(fs.readFileSync(cvp, 'utf8'), path.relative(ROOT, cvp));
  const f = master ? factCheck(cv, master) : { problems: ['no master CV (profile/cv-master.yaml) to check facts against'], warn: [] };
  for (const e of v.errors) console.log('ERROR ' + e);
  for (const e of f.problems) console.log('ERROR ' + e);
  for (const w of [...v.warnings, ...f.warn]) console.log('warn  ' + w);
  const a = fs.existsSync(path.join(dir, 'jd-analysis.yaml')) ? readYaml(path.join(dir, 'jd-analysis.yaml')) || {} : {};
  const unmapped = (a.must_haves || []).filter(x => !x.gap && (!x.proof || /^\(/.test(x.proof) || /^\(/.test(x.need || '')));
  for (const u of unmapped) console.log(`ERROR must-have not mapped to proof or marked gap: "${u.need}"`);
  const n = v.errors.length + f.problems.length + unmapped.length;
  console.log(n ? `LINT FAIL (${n})` : 'LINT PASS');
  return { ok: !n, cv, analysis: a, voice: v, facts: f };
}

function diffSummary(base, cv) {
  const out = [];
  if (base.headline !== cv.headline) out.push(`Headline: "${base.headline}" -> "${cv.headline}"`);
  if (JSON.stringify(base.summary) !== JSON.stringify(cv.summary)) out.push('Summary rewritten for this role');
  const bt = (base.skills || []).map(s => s.title), ct = (cv.skills || []).map(s => s.title);
  if (JSON.stringify(bt) !== JSON.stringify(ct)) out.push(`Skill boxes: ${bt.join(' / ')} -> ${ct.join(' / ')}`);
  const bp = (base.projects || []).map(p => p.title), cp = (cv.projects || []).map(p => p.title);
  if (JSON.stringify(bp) !== JSON.stringify(cp)) out.push(`Projects order: ${cp.join(' / ') || '(none)'}${bp.filter(x => !cp.includes(x)).length ? `; dropped: ${bp.filter(x => !cp.includes(x)).join(', ')}` : ''}`);
  const bb = new Set(strings([base.projects, base.experience])), cb = strings([cv.projects, cv.experience]).filter(s => s.length > 40);
  const added = cb.filter(s => !bb.has(s));
  if (added.length) out.push(`${added.length} bullet(s) swapped in from the master pool or reworded`);
  return out.length ? out : ['No changes from the base CV'];
}

function build(dir) {
  const L = lint(dir);
  if (!L.ok && !args.includes('--force')) { console.log('fix the lint errors first (or --force to render anyway for a look)'); process.exit(1); }
  const a = L.analysis; const cv = L.cv;
  const id = profile.identity || {};
  const [first, ...rest] = String(cv.name || '').split(/\s+/);
  const part = x => String(x || '').normalize('NFKD').replace(/[^\w-]+/g, '').replace(/^./, c => c.toUpperCase());
  const fname = `${[part(id.first_name || first), part(id.last_name || rest.join('-'))].filter(Boolean).join('-') || 'My'}-CV.pdf`;
  const out = path.join(dir, fname);
  let theme = opt('--theme') || profile.cv?.theme;
  let calm = false;
  if (!theme) { const r = recommendTheme(a.role_title || '', a.seniority || ''); theme = r.theme; calm = r.calm; }
  const bargs = [path.join(HERE, 'build.mjs'), '--content', path.join(dir, 'cv.yaml'), '--theme', theme, '--out', out];
  if (args.includes('--bw')) bargs.push('--bw');
  if (calm) bargs.push('--calm');
  const r = spawnSync(process.execPath, bargs, { encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  const base = basePath() ? readYaml(basePath()) : {};
  const rows = (a.must_haves || []).map(m => `| ${m.need} | ${m.gap ? '**GAP**' : ''} ${m.proof || ''} |`);
  const report = `# Tailoring report: ${a.role_title || '(role)'} at ${a.company || '(company)'}

- Seniority: ${a.seniority || '?'} · Domain: ${a.domain || '?'} · Theme: ${theme}${calm ? ' (calm)' : ''}
- File: \`${fname}\` (neutral name; the company is never in the filename)
- ATS check: ${r.status === 0 ? 'PASS' : 'FAIL (see build output)'}

## Must-haves -> proof

| Must-have | Proof in this CV |
|---|---|
${rows.join('\n') || '| (fill jd-analysis.yaml) | |'}

## Gaps (no proof in the master CV; not papered over)

${(a.must_haves || []).filter(m => m.gap).map(m => `- ${m.need}${m.note ? `: ${m.note}` : ''}`).join('\n') || '- none'}

## Nice-to-haves covered

${(a.nice_to_haves || []).map(n => `- ${n.need || n}${n.proof ? `: ${n.proof}` : ''}`).join('\n') || '- (none listed)'}

## What changed from the base CV

${diffSummary(base, cv).map(x => '- ' + x).join('\n')}

## Lint warnings

${[...L.voice.warnings, ...L.facts.warn].map(x => '- ' + x).join('\n') || '- none'}
`;
  fs.writeFileSync(path.join(dir, 'tailoring-report.md'), report);
  // review policy: autonomy decides; default review the first 5 tailored CVs, then every 5th
  const done = fs.readdirSync(path.dirname(dir)).filter(d => fs.existsSync(path.join(path.dirname(dir), d, 'tailoring-report.md'))).length;
  const auto = profile.autonomy === 'submit_within_rules';
  const review = !auto || done <= 5 || done % 5 === 0;
  console.log(`${r.status === 0 ? 'READY' : 'NOT READY'} ${path.relative(ROOT, out)}\nREPORT ${path.relative(ROOT, path.join(dir, 'tailoring-report.md'))}\nUSER REVIEW ${review ? 'REQUIRED (show the PDF and report, wait for OK)' : 'not required (sampled policy)'} [tailored CV #${done}]`);
  process.exit(r.status === 0 ? 0 : 1);
}

async function init() {
  const company = opt('--company'), role = opt('--role');
  if (!company || !role) { console.error('init needs --company and --role'); process.exit(2); }
  const dir = path.join(ROOT, 'out', `${slug(company)}-${slug(role)}`);
  fs.mkdirSync(dir, { recursive: true });
  let jd = opt('--jd-text') || (opt('--jd-file') ? fs.readFileSync(opt('--jd-file'), 'utf8') : '');
  if (!jd && opt('--jd-url')) jd = await fetchJd(opt('--jd-url'));
  fs.writeFileSync(path.join(dir, 'jd.txt'), `${opt('--jd-url') ? 'Source: ' + opt('--jd-url') + '\n\n' : ''}${jd}`);
  const an = path.join(dir, 'jd-analysis.yaml');
  if (!fs.existsSync(an)) fs.writeFileSync(an, YAML.stringify({
    company, role_title: role, seniority: '', domain: '', source_url: opt('--jd-url') || '',
    must_haves: [{ need: '(top 6-8 requirements, in their words)', proof: '(where the CV proves it, or leave empty and set gap: true)', gap: false }],
    nice_to_haves: [{ need: '', proof: '' }],
    vocabulary: ['(their words for the work: reuse them in headline, summary, skill box titles)'],
    headline_family: '(their role-title family, e.g. the exact title or its closest honest version)',
  }));
  const cvp = path.join(dir, 'cv.yaml');
  if (!fs.existsSync(cvp) && basePath()) fs.copyFileSync(basePath(), cvp);
  console.log(`workspace ${path.relative(ROOT, dir)}\n  jd.txt (${jd.length} chars)${jd.length < 400 ? '  WARNING: JD looks thin, read the page in the browser and paste it into jd.txt' : ''}\n  jd-analysis.yaml  <- fill this\n  cv.yaml           <- edit from the master pool (${masterPath() ? path.relative(ROOT, masterPath()) : 'NO MASTER FOUND'})\nthen: node cv/tailor.mjs build ${path.relative(ROOT, dir)}`);
}

if (cmd === 'init') await init();
else if (cmd === 'lint') process.exit(lint(args[1]).ok ? 0 : 1);
else if (cmd === 'build') build(args[1]);
else { console.error('usage: tailor.mjs init|lint|build ...'); process.exit(2); }
