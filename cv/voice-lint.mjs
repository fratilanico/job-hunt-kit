#!/usr/bin/env node
// Voice lint for CVs and cover letters. Exit 1 on errors.
//   node cv/voice-lint.mjs profile/cv.yaml letters/acme.txt ...
// Errors: em dashes, slop phrases, vanity counts. Warnings: activity verbs without an outcome, long bullets.
import fs from 'node:fs';

export const SLOP = [
  'proven track record', 'results-driven', 'results driven', 'leveraged', 'leverage', 'spearheaded', 'spearhead', 'passionate',
  'dynamic', 'synergy', 'synergies', 'go-getter', 'self-starter', 'detail-oriented', 'team player', 'think outside the box',
  'best-in-class', 'world-class', 'cutting-edge', 'robust', 'seamless', 'seamlessly', 'holistic', 'empower', 'empowered',
  'delve', 'navigate the', 'landscape', 'tapestry', 'thrive', 'journey', 'game-changer', 'game changing', 'paradigm',
  'utilize', 'utilise', 'utilized', 'utilised', 'furthermore', 'moreover', 'additionally', 'notably', 'crucial', 'pivotal',
  'comprehensive', 'excited to', 'thrilled', 'i am writing to express', 'hit the ground running', 'wear many hats',
  'key takeaway', 'mission-aligned', 'in today\'s fast-paced', 'fast-paced environment', 'ensure', 'ensuring',
  'track record of success', 'responsible for', 'duties included', 'helped to', 'ats', 'audited claims',
];
// vanity counts: engineering output numbers that are not outcomes ("1,000 automated tests", "500 commits", "2M tokens")
export const VANITY = /\b\d[\d,.]*\s*(\+\s*)?(automated )?(tests?|commits?|pull requests|prs|tokens|lines of code|loc|schemas?|tables|endpoints|microservices|prompts|agents)\b/i;
const ACTIVITY_ONLY = /^(\*\*[^*]+\*\*\s*)?(responsible for|worked on|involved in|participated in|assisted with|helped)\b/i;

export function lintText(text, where = '') {
  const errors = [], warnings = [];
  const lines = String(text).split(/\n/);
  lines.forEach((l, i) => {
    const at = `${where}:${i + 1}`;
    if (/^\s*#/.test(l)) return; // yaml / shell comments are not CV text
    if (/—/.test(l)) errors.push(`${at} em dash (use a comma, colon or full stop)`);
    const low = l.toLowerCase();
    for (const p of SLOP) {
      const rx = new RegExp(`(^|[^a-z])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (rx.test(low)) (p === 'ats' ? (/\bats\b/i.test(l) && errors.push(`${at} says "ATS": never mention ATS on a CV or letter`)) : errors.push(`${at} slop phrase "${p}"`));
    }
    if (VANITY.test(l)) errors.push(`${at} vanity count "${l.match(VANITY)[0]}": say what changed for the business instead`);
    const bullet = l.replace(/^\s*-\s*"?|"\s*$/g, '');
    if (ACTIVITY_ONLY.test(bullet)) warnings.push(`${at} activity, not outcome: "${bullet.slice(0, 60)}"`);
    if (/^\s*-\s*"/.test(l) && bullet.length > 260) warnings.push(`${at} bullet over ~2 lines (${bullet.length} chars)`);
  });
  return { errors, warnings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const f of process.argv.slice(2)) {
    const { errors, warnings } = lintText(fs.readFileSync(f, 'utf8'), f);
    for (const e of errors) console.log('ERROR ' + e);
    for (const w of warnings) console.log('warn  ' + w);
    bad += errors.length;
    if (!errors.length) console.log(`ok ${f}${warnings.length ? ` (${warnings.length} warnings)` : ''}`);
  }
  process.exit(bad ? 1 : 0);
}
