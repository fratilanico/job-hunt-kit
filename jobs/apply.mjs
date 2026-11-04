#!/usr/bin/env node
// Application-form driver (Playwright, one process per job).
//   node jobs/apply.mjs probe <url> [--click "Apply"] [--out <dir>]      dump every visible field -> state.json + state.png
//   node jobs/apply.mjs run <plan.json>                                  fill; submit only if plan.submit is set
//
// plan.json = { url, out, steps:[...], submit:{click:"Submit application"}|null, success:"regex", waitAfter:12000,
//               headed?:bool, human?:bool, channel?:"chrome", track?:{csv,title,company,vendor}, job?:"Title at Company" }
// steps: {goto} {click:"text"|{selector}|{role,name}} {fill:"Label",value,type?} {select:"Label",option}
//        {combobox:"Label",type?,option?} {check:"Label"} {uncheck:"Label"} {radio:"Question",option}
//        {upload:"Label"|{selector}|{index},path} {press:"Enter"} {wait:ms} {screenshot:"name"} {js:"code"}
//
// Exit codes: 0 ok (dry run clean, or submit confirmed) · 3 a step failed · 4 refused: required field empty
//             5 submitted but success text not seen (read after.png + NETWORK lines before deciding) · 1 fatal
//             7 captcha not solved by the user before the timeout (row logged needs-user-captcha)
//
// CAPTCHA HANDOFF (never solve one). When a visible captcha / bot check is detected:
//   1. headless run -> the whole plan is re-run in a VISIBLE browser window on this computer (fills are idempotent);
//   2. prints a line `CAPTCHA_WAITING {json}` and writes <out>/captcha_waiting.json, so the agent session watching the
//      log can alert the user (Claude Code push notification / Codex task message); macOS banner as a local fallback,
//      Telegram only if configured;
//   3. polls every captcha.poll_seconds until the challenge is gone (default timeout 10 min), then resumes filling and
//      submits; on timeout logs `needs-user-captcha`. The person solves it in the browser window on this computer
//      (or over remote desktop); the phone only alerts them.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const profile = (() => { try { return YAML.parse(fs.readFileSync(process.env.JOBKIT_PROFILE || path.join(ROOT, 'profile/profile.yaml'), 'utf8')) || {}; } catch { return {}; } })();
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const CAP = { handoff: profile.captcha?.handoff !== false, waitMs: (profile.captcha?.wait_minutes ?? 10) * 60000, pollMs: (profile.captcha?.poll_seconds ?? 4) * 1000 };
const NOTIFY = { macos: profile.notify?.macos !== false, telegram: !!profile.notify?.telegram };
const LOCALE = process.env.JOBKIT_LOCALE || 'en-GB', TZ = process.env.JOBKIT_TZ || 'Europe/London';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const COOKIE_DECLINE = /^(necessary only|only necessary|reject all|reject|decline|decline all|deny|deny all|essential only|accept necessary|accept only necessary|refuse|decline all non-necessary cookies|reject non-essential|use necessary cookies only)$/i;

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
let plan;
if (mode === 'probe') plan = { url: args[1], out: opt('--out'), steps: opt('--click') ? [{ click: opt('--click') }] : [], submit: null };
else if (mode === 'run') plan = JSON.parse(fs.readFileSync(args[1], 'utf8'));
else { console.error('usage: apply.mjs probe <url> | run <plan.json>'); process.exit(2); }
plan.out ||= path.resolve(ROOT, profile.paths?.runs_dir || 'runs', new URL(plan.url).hostname + '-' + Date.now());
plan.out = path.resolve(plan.out);
fs.mkdirSync(plan.out, { recursive: true });
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(path.join(plan.out, 'log.txt'), s + '\n'); };
const jobLabel = plan.job || (plan.track ? `${plan.track.title} at ${plan.track.company}` : new URL(plan.url).hostname);

// ---------- captcha detection: VISIBLE challenges only (invisible reCAPTCHA v3 badges are normal and ignored) ----------
async function captchaState(page) {
  const frames = await page.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 30 && r.height > 30 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
    const out = [];
    for (const f of document.querySelectorAll('iframe')) {
      const s = (f.src || '').toLowerCase();
      if (!vis(f)) continue;
      if (/recaptcha\/(api2|enterprise)\/bframe/.test(s)) out.push('recaptcha-challenge');
      else if (/recaptcha\/(api2|enterprise)\/anchor/.test(s) && !/size=invisible/.test(s)) out.push('recaptcha-checkbox');
      else if (/hcaptcha\.com/.test(s) && !/size=invisible/.test(s)) out.push(/frame=challenge|hcaptcha-challenge/.test(s) ? 'hcaptcha-challenge' : 'hcaptcha-checkbox');
      else if (/challenges\.cloudflare\.com/.test(s)) out.push('turnstile');
      else if (/geo\.captcha-delivery|arkoselabs|funcaptcha|perimeterx|px-captcha/.test(s)) out.push('bot-wall');
    }
    const t = (document.title + ' ' + (document.body?.innerText || '').slice(0, 3000)).toLowerCase();
    if (/just a moment|checking your browser|verify you are human|are you a robot|security check|additional verification required|press (and|&) hold/.test(t)) out.push('interstitial');
    if (document.querySelector('#px-captcha, .slider-captcha, [class*="captcha-slider"]')) out.push('slider');
    const tok = [...document.querySelectorAll('textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]')].some(e => e.value && e.value.length > 20);
    return { kinds: out, solvedToken: tok };
  }).catch(() => ({ kinds: [], solvedToken: false }));
  // a ticked checkbox stays visible after solving; a filled response token means it is done
  const blocking = frames.kinds.filter(k => !(/checkbox|turnstile/.test(k) && frames.solvedToken));
  return { present: blocking.length > 0, kinds: blocking };
}

function notify(title, message, url) {
  const line = JSON.stringify({ job: jobLabel, url, title, message, out: plan.out, at: new Date().toISOString() });
  log('CAPTCHA_WAITING ' + line);
  fs.writeFileSync(path.join(plan.out, 'captcha_waiting.json'), line);
  if (NOTIFY.macos && process.platform === 'darwin') {
    try { execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`]); } catch {}
  }
  if (NOTIFY.telegram && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `${title}\n${message}\n${url}` }) }).catch(() => {});
  }
}

function rememberCaptchaHost(url) {
  try {
    const u = new URL(url); const board = (url.match(/(?:for=|greenhouse\.io\/|ashbyhq\.com\/|lever\.co\/)([\w.-]+)/) || [])[1];
    const f = path.resolve(ROOT, profile.paths?.data_dir || 'data', 'captcha_hosts.txt'); fs.mkdirSync(path.dirname(f), { recursive: true });
    const key = (board || u.hostname).toLowerCase();
    const have = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : [];
    if (key && !have.includes(key)) fs.appendFileSync(f, key + '\n');
  } catch {}
}

class CaptchaHeadless extends Error {}
class CaptchaTimeout extends Error {}

// Called at checkpoints. Headless: abort so the plan re-runs headed. Headed: alert the user and wait for them.
async function captchaGate(page, ctx, where) {
  const st = await captchaState(page);
  if (!st.present) return false;
  rememberCaptchaHost(page.url());
  log(`captcha detected (${st.kinds.join(',')}) at ${where}`);
  if (!plan.submit) { log('probe/dry run: captcha present, not handing off (the submit run will)'); return false; }
  if (!ctx.headed) throw new CaptchaHeadless(st.kinds.join(','));
  if (!CAP.handoff) throw new CaptchaTimeout('handoff disabled');
  await page.bringToFront().catch(() => {});
  notify('Captcha needs you', `${jobLabel}: solve the captcha in the browser window on your computer; I'll continue automatically.`, page.url());
  const until = Date.now() + CAP.waitMs; let clear = 0;
  while (Date.now() < until) {
    await page.waitForTimeout(CAP.pollMs);
    const s = await captchaState(page);
    clear = s.present ? 0 : clear + 1;
    if (clear >= 2) { log('captcha cleared by the user, resuming'); fs.rmSync(path.join(plan.out, 'captcha_waiting.json'), { force: true }); return true; }
  }
  throw new CaptchaTimeout(`not solved within ${CAP.waitMs / 60000} min`);
}

async function attempt(headed) {
  // installed Google Chrome by default (plan.channel / CHROME_CHANNEL override; CHROME_CHANNEL= empty forces bundled Chromium)
  const launchOpts = { headless: !headed, args: ['--disable-blink-features=AutomationControlled', `--lang=${LOCALE}`, ...(headed ? ['--window-size=1280,1100'] : [])] };
  const channel = plan.channel ?? process.env.CHROME_CHANNEL ?? 'chrome';
  let browser;
  try { browser = await chromium.launch(channel ? { ...launchOpts, channel } : launchOpts); }
  catch (e) { if (!channel) throw e; log(`Chrome channel "${channel}" not available, using bundled Chromium`); browser = await chromium.launch(launchOpts); }
  const ctx = { headed };
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: headed ? 1000 : 1800 }, locale: LOCALE, timezoneId: TZ });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const pace = async () => { if (plan.human || headed) await page.waitForTimeout(700 + Math.random() * 1400); };

  async function field(label) {
    const cands = [page.getByLabel(label, { exact: true }), page.getByLabel(label, { exact: false }), page.getByPlaceholder(label, { exact: false }),
      page.locator(`[name="${label}"]`), page.locator('#' + label.replace(/[^\w-]/g, '\\$&'))];
    for (const c of cands) { try { const f = c.first(); if (await f.count() && await f.isVisible()) return f; } catch {} }
    const t = page.getByText(label, { exact: false }).first();
    if (await t.count()) { const f = t.locator('xpath=following::*[self::input or self::textarea or self::select or @role="combobox"][1]').first(); if (await f.count()) return f; }
    throw new Error('field not found: ' + label);
  }
  async function declineCookies() {
    for (const b of await page.locator('button, a[role=button]').all()) {
      try { const t = (await b.innerText()).trim(); if (COOKIE_DECLINE.test(t) && await b.isVisible()) { await b.click({ timeout: 2000 }); log('cookies: clicked', t); return; } } catch {}
    }
  }
  async function clickStep(c) {
    if (typeof c === 'string') {
      const cands = [page.getByRole('button', { name: c, exact: true }), page.getByRole('link', { name: c, exact: true }), page.getByRole('button', { name: c }), page.getByText(c, { exact: true }), page.getByText(c)];
      for (const x of cands) { const f = x.first(); if (await f.count() && await f.isVisible().catch(() => false)) { await f.click(); return; } }
      throw new Error('click target not found: ' + c);
    }
    if (c.selector) return page.locator(c.selector).first().click();
    if (c.role) return page.getByRole(c.role, { name: c.name }).first().click();
  }
  async function radio(question, option) {
    const q = page.getByText(question, { exact: false }).first();
    if (!(await q.count())) throw new Error('radio question not found: ' + question);
    const grp = q.locator('xpath=ancestor::*[self::fieldset or @role="group" or @role="radiogroup" or contains(@class,"field") or contains(@class,"question") or contains(@class,"form-group")][1]');
    const scope = (await grp.count()) ? grp.first() : q.locator('xpath=..');
    for (const x of [scope.getByRole('radio', { name: option, exact: true }), scope.getByLabel(option, { exact: true }), scope.getByRole('button', { name: option, exact: true }), scope.getByText(option, { exact: true })]) {
      const f = x.first(); if (await f.count()) { await f.click({ force: true }); return; }
    }
    throw new Error(`radio option not found: ${question} -> ${option}`);
  }
  async function combobox(label, text, option) {
    const f = await field(label);
    await f.click();
    if (text) { await f.fill('').catch(() => {}); await f.pressSequentially(text, { delay: 40 }); }
    await page.waitForTimeout(1500);
    const opts = page.locator('[role=option], [role=listbox] li, .select__option, [id*="option"]');
    const n = await opts.count();
    if (option) {
      for (const exact of [true, false]) for (let i = 0; i < n; i++) {
        const o = opts.nth(i); const t = (await o.innerText().catch(() => '')).trim().toLowerCase();
        if ((exact ? t === option.toLowerCase() : t.includes(option.toLowerCase())) && await o.isVisible()) { await o.click(); return; }
      }
      throw new Error(`combobox option not found: ${label} -> ${option} (saw ${n} options)`);
    }
    if (n) { await opts.first().click(); return; }
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  }
  async function upload(target, file) {
    file = path.resolve(ROOT, file);
    if (!fs.existsSync(file)) throw new Error('upload file missing: ' + file);
    let input;
    if (typeof target === 'object' && target.label) target = target.label;
    if (typeof target === 'object' && target.selector) input = page.locator(target.selector).first();
    else if (typeof target === 'object' && target.index != null) input = page.locator('input[type=file]').nth(target.index);
    else {
      const lab = page.getByLabel(target, { exact: true }).first();
      if (await lab.count() && (await lab.evaluate(e => e.type).catch(() => '')) === 'file') input = lab;
      else {
        for (const t of [page.getByText(target, { exact: true }).first(), page.getByText(target, { exact: false }).first()]) {
          if (await t.count()) { const c = t.locator('xpath=ancestor::*[position()<=4]//input[@type="file"]').first(); if (await c.count()) { input = c; break; } }
        }
        if (!input || !(await input.count())) input = page.locator('input[type=file]').first();
      }
    }
    await input.setInputFiles(file);
    await page.waitForTimeout(2500);
  }
  async function runStep(s) {
    if (s.goto) { await page.goto(s.goto, { waitUntil: 'domcontentloaded', timeout: 45000 }); await page.waitForTimeout(2500); await declineCookies(); return; }
    if (s.click) return clickStep(s.click);
    if (s.fill) { const f = await field(s.fill); await f.click(); if (s.type) { await f.fill(''); await f.pressSequentially(String(s.value), { delay: 25 }); } else await f.fill(String(s.value)); await f.press('Tab').catch(() => {}); return; }
    if (s.select) { const f = await field(s.select); const tag = await f.evaluate(e => e.tagName.toLowerCase()); if (tag === 'select') { await f.selectOption({ label: s.option }).catch(async () => f.selectOption(s.option)); return; } return combobox(s.select, s.type, s.option); }
    if (s.combobox) return combobox(s.combobox, s.type, s.option);
    if (s.check) { const f = await field(s.check); await f.check({ force: true }).catch(() => f.click({ force: true })); return; }
    if (s.uncheck) { const f = await field(s.uncheck); await f.uncheck({ force: true }); return; }
    if (s.radio) return radio(s.radio, s.option);
    if (s.upload) return upload(s.upload, s.path);
    if (s.press) return page.keyboard.press(s.press);
    if (s.wait) return page.waitForTimeout(s.wait);
    if (s.screenshot) return page.screenshot({ path: path.join(plan.out, s.screenshot + '.png'), fullPage: true });
    if (s.js) return page.evaluate(s.js);
    throw new Error('unknown step ' + JSON.stringify(s));
  }
  async function dump(name) {
    const st = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const txt = e => (e ? (e.innerText || e.textContent || '') : '').replace(/\s+/g, ' ').trim();
      const labelOf = e => {
        if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) return txt(l); }
        if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
        const lb = e.getAttribute('aria-labelledby'); if (lb) return lb.split(/\s+/).map(i => txt(document.getElementById(i))).join(' ');
        const cl = e.closest('label'); if (cl) return txt(cl).slice(0, 160);
        let p = e; for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (!p) break; const l = p.querySelector('label, legend, [class*=label], [class*=Label], [class*=question], [class*=title]'); if (l && txt(l)) return txt(l).slice(0, 160); }
        return e.placeholder || e.name || '';
      };
      const out = [];
      for (const e of document.querySelectorAll('input, textarea, select, [role=combobox], [role=radio], [role=checkbox], [role=listbox], [contenteditable=true]')) {
        if (e.type === 'hidden') continue;
        if (!vis(e) && e.type !== 'file') continue;
        const tag = e.tagName.toLowerCase();
        const o = { tag, type: e.type || e.getAttribute('role') || '', name: e.name || '', id: e.id || '', label: labelOf(e), required: !!(e.required || e.getAttribute('aria-required') === 'true'), invalid: e.getAttribute('aria-invalid') === 'true' };
        if (tag === 'select') { o.value = e.options[e.selectedIndex]?.text || ''; o.options = [...e.options].map(x => x.text).slice(0, 40); }
        else if (e.type === 'checkbox' || e.type === 'radio' || e.getAttribute('role') === 'radio' || e.getAttribute('role') === 'checkbox') {
          o.checked = e.checked ?? e.getAttribute('aria-checked') === 'true'; o.optionText = txt(e.closest('label') || e.parentElement).slice(0, 120);
          let p = e.parentElement; for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
            const n = p.querySelectorAll('input[type=radio], input[type=checkbox], [role=radio], [role=checkbox]').length;
            if (p.tagName === 'FIELDSET' || n >= 2 && n >= p.querySelectorAll('input, textarea, select').length) {
              const h = p.querySelector('legend, label:not(:has(input)), [class*=label], [class*=Label], [class*=question], [class*=title], h1, h2, h3, h4, p, span');
              o.group = txt(h).slice(0, 160); if (o.group && o.group !== o.optionText) break; o.group = '';
            }
          }
        }
        else if (e.type === 'file') { o.files = [...(e.files || [])].map(f => f.name); if (!o.files.length) { const c = e.closest('[class*=field], [class*=upload], [class*=file], div'); const chip = c && [...c.querySelectorAll('[class*=file-name], [class*=filename], [class*=fileName], [class*=chip], [class*=attached], a, span')].map(txt).find(t => /\.(pdf|docx?)$/i.test(t)); if (chip) o.files = [chip + ' (chip)']; } }
        else if ((e.getAttribute('role') === 'combobox' || e.getAttribute('aria-autocomplete') === 'list' || /select__input|combobox|autocomplete/i.test(e.className + ' ' + (e.id || ''))) && !e.value) { let sv = null, q = e.parentElement; for (let i = 0; i < 5 && q && !sv; i++, q = q.parentElement) sv = q.querySelector('[class*=single-value], [class*=singleValue]'); o.value = sv ? txt(sv).slice(0, 200) : ''; if (o.value) o.via = 'selected-chip'; }
        else o.value = (e.value ?? e.textContent ?? '').slice(0, 300);
        out.push(o);
      }
      const errs = [...document.querySelectorAll('[class*=error], [class*=Error], [role=alert], .field-error, [class*=invalid]')].map(txt).filter(t => t && t.length < 200);
      const buttons = [...document.querySelectorAll('button, input[type=submit], a[role=button]')].filter(vis).map(b => txt(b) || b.value).filter(Boolean).slice(0, 40);
      return { url: location.href, title: document.title, fields: out, errors: [...new Set(errs)].slice(0, 30), buttons, bodyText: (document.body?.innerText || '').slice(0, 4000) };
    });
    fs.writeFileSync(path.join(plan.out, name + '.json'), JSON.stringify(st, null, 1));
    await page.screenshot({ path: path.join(plan.out, name + '.png'), fullPage: true }).catch(e => log('screenshot skipped: ' + e.message.split('\n')[0]));
    return st;
  }
  function summarize(st) {
    log(`URL ${st.url}\nTITLE ${st.title}\nFIELDS ${st.fields.length}  ERRORS ${st.errors.length}  BUTTONS ${st.buttons.join(' | ')}`);
    for (const f of st.fields) log(`  [${f.group ? f.group + ' :: ' : ''}${f.tag}/${f.type}${f.required ? '*' : ''}${f.invalid ? ' INVALID' : ''}] ${f.label || f.name} => ${f.options ? 'options: ' + f.options.join(' / ') : f.files ? 'files: ' + f.files.join(',') : f.checked != null ? (f.checked ? 'CHECKED' : 'unchecked') + ' (' + f.optionText + ')' : JSON.stringify(f.value)}`);
    if (st.errors.length) log('  ERRORS: ' + st.errors.join(' || '));
  }

  let code = 0, ok = false;
  try {
    await page.goto(plan.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    await captchaGate(page, ctx, 'page load');
    await declineCookies();
    for (const s of plan.steps || []) {
      try { await pace(); await runStep(s); log('ok', JSON.stringify(s).slice(0, 140)); }
      catch (e) { if (e instanceof CaptchaHeadless || e instanceof CaptchaTimeout) throw e; log('STEP FAILED', JSON.stringify(s).slice(0, 140), '->', e.message.split('\n')[0]); code = 3; if (plan.stopOnError !== false) break; }
    }
    if (plan.submit && code === 0) await captchaGate(page, ctx, 'before submit');
    const before = await dump(plan.submit && code === 0 ? 'before' : 'state');
    summarize(before);
    if (plan.submit && code === 0) {
      const reqMissing = before.fields.filter(f => f.required && !f.checked && !(f.files && f.files.length) && f.type !== 'radio' && f.type !== 'checkbox' && (f.value === '' || f.value == null));
      if (reqMissing.length && !plan.force) { log('REFUSING SUBMIT: required fields empty -> ' + reqMissing.map(f => f.label || f.name).join(' | ')); code = 4; }
      else {
        const net = []; const base = new Set((await page.evaluate(() => document.body.innerText).catch(() => '')).split('\n').map(x => x.trim()));
        page.on('response', async r => { const rq = r.request(); if (rq.method() !== 'GET' || r.status() >= 400) { let b = ''; try { b = (await r.text()).slice(0, 400); } catch {} net.push(`${rq.method()} ${r.status()} ${r.url().slice(0, 120)} :: ${b.replace(/\s+/g, ' ')}`); } });
        const rx = plan.success ? new RegExp(plan.success, 'i') : null; const transient = new Set();
        let clicks = 0;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}); await page.waitForTimeout((plan.human || headed) ? 4000 + Math.random() * 3000 : 2500);
          await clickStep(plan.submit.click); clicks++;
          log('submitted: clicked', JSON.stringify(plan.submit.click), 'attempt', attempt + 1);
          const deadline = Date.now() + (plan.waitAfter || 12000); let busy = false, solved = false;
          while (Date.now() < deadline) {
            await page.waitForTimeout(700);
            const t = await page.evaluate(() => document.title + '\n' + document.body.innerText).catch(() => '');
            for (const l of t.split('\n')) { const x = l.trim(); if (x && !base.has(x)) transient.add(x.slice(0, 200)); }
            if (rx && rx.test(t)) { ok = true; break; }
            if (/updating your application|please try again when/i.test(t)) busy = true;
            // a challenge that appears only on submit (hCaptcha on Lever, reCAPTCHA checkbox): hand off, then re-check
            if ((await captchaState(page)).present) { solved = await captchaGate(page, ctx, 'after submit click'); break; }
          }
          if (ok) break;
          if (solved) {
            await page.waitForTimeout(5000);
            const t = await page.evaluate(() => document.title + '\n' + document.body.innerText).catch(() => '');
            if (rx && rx.test(t)) { ok = true; break; }
            const posted = net.some(n => /^POST 20\d/.test(n) && !/recaptcha|hcaptcha|turnstile|analytics|collect|log/i.test(n));
            if (posted) { log('application POST seen after captcha; not clicking submit again'); break; }
            continue; // challenge cleared without a submit: click Submit once more
          }
          if (!busy) break;
          log('form still syncing, waiting before retry'); await page.waitForTimeout(8000);
        }
        if (transient.size) log('NEW-TEXT: ' + [...transient].join(' || '));
        if (net.length) log('NETWORK: ' + net.join('\n  '));
        const after = await dump('after');
        fs.writeFileSync(path.join(plan.out, 'result.json'), JSON.stringify({ ok, clicks, url: after.url, title: after.title, errors: after.errors, snippet: after.bodyText.slice(0, 600) }, null, 1));
        log('RESULT ' + (ok ? 'SUCCESS' : 'UNCONFIRMED') + ' url=' + after.url + ' title=' + after.title + (after.errors.length ? ' errors=' + after.errors.join(' || ') : ''));
        log('AFTER-TEXT: ' + after.bodyText.slice(0, 500).replace(/\n/g, ' | '));
        if (!ok) code = 5;
      }
    }
  } catch (e) {
    if (e instanceof CaptchaHeadless) { await browser.close(); return { code: -1 }; }
    if (e instanceof CaptchaTimeout) { log('CAPTCHA TIMEOUT: ' + e.message); await dump('captcha-timeout').catch(() => {}); await browser.close(); return { code: 7 }; }
    log('FATAL', e.message.split('\n')[0]); code = 1;
  }
  await browser.close();
  return { code, ok };
}

function track(code, ok) {
  if (!plan.track?.csv || !plan.submit) return;
  const status = code === 7 ? 'needs-user-captcha' : ok ? 'submitted' : code === 4 ? 'failed-required-empty' : code === 3 ? 'failed-step' : code === 5 ? 'retry-unconfirmed' : 'failed-driver';
  const q = s => /[",\n]/.test(String(s ?? '')) ? `"${String(s).replace(/"/g, '""')}"` : String(s ?? '');
  const note = `${plan.track.note || ''}${plan.track.note ? '; ' : ''}run ${path.relative(ROOT, plan.out)}${code === 5 ? '; read after.png + NETWORK before retrying' : ''}`;
  const row = [plan.track.title, plan.track.company, plan.track.vendor || '', plan.url, status, new Date().toISOString().slice(0, 10), note].map(q).join(',');
  fs.mkdirSync(path.dirname(path.resolve(ROOT, plan.track.csv)), { recursive: true });
  fs.appendFileSync(path.resolve(ROOT, plan.track.csv), row + '\n');
  log('TRACKED ' + status);
}

let headed = !!(plan.headed || process.env.HEADED === '1');
let r = await attempt(headed);
if (r.code === -1) {
  log(CAP.handoff ? 'captcha on a headless run: re-running this plan in a visible window for the handoff' : 'captcha on a headless run and handoff is off');
  r = CAP.handoff ? await attempt(true) : { code: 7 };
}
track(r.code, r.ok);
log('OUT ' + plan.out);
process.exit(r.code);
