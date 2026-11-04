// Theme catalogue + recommendTheme(role, seniority). Shared by build.mjs and the onboarding skill.
export const THEMES = {
  terminal: { label: 'Terminal', ground: 'dark', for: 'engineering, AI, data, technical roles' },
  editorial: { label: 'Editorial', ground: 'light', for: 'communications, marketing, content, PR, director-level comms' },
  boardroom: { label: 'Boardroom', ground: 'light', for: 'finance, consulting, legal, operations, executive roles' },
  studio: { label: 'Studio', ground: 'light', for: 'product, design, creative, startup roles' },
  clarity: { label: 'Clarity', ground: 'light', for: 'healthcare, public sector, education, HR, people roles' },
};

const FAMILIES = [
  ['terminal', /engineer|developer|software|data (scien|engin|analy)|machine learning|\bml\b|\bai\b|devops|sre\b|platform|architect|security|cloud|technical|\bit\b|infrastructure|qa\b|analytics/i],
  ['editorial', /communicat|comms\b|\bpr\b|public relations|press|media|content|copy|editor|journalis|marketing|brand|social media|campaign|writer|publish|events?/i],
  ['boardroom', /financ|account|audit|tax|bank|invest|consult|strategy|legal|lawyer|solicitor|counsel|compliance|risk|operations|procurement|chief|ceo|cfo|coo|board|partner|executive|business analyst|programme|project manager|transformation/i],
  ['studio', /product|design|ux|ui\b|creative|art director|founder|startup|growth|brand designer|illustrat|animator|motion|game/i],
  ['clarity', /health|nurse|clinic|care\b|nhs|medical|pharma|public sector|government|council|charity|education|teacher|school|universit|lecturer|hr\b|human resources|people|talent|recruit|learning|wellbeing|social work/i],
];
const SENIOR = /senior|lead|head|principal|director|vp\b|vice president|chief|partner|executive|c-suite|cxo/i;

// Returns { theme, calm, why }. calm = fewer accent uses for senior / director roles.
export function recommendTheme(role = '', seniority = '') {
  const text = `${role} ${seniority}`;
  let theme = 'clarity', why = 'no strong role-family signal, so the most readable light theme';
  for (const [name, rx] of FAMILIES) {
    const m = role.match(rx);
    if (m) { theme = name; why = `"${m[0]}" in the role points to ${THEMES[name].for}`; break; }
  }
  const calm = SENIOR.test(text) && /director|head|chief|vp\b|vice president|partner|executive/i.test(text);
  if (calm) why += '; senior title, so the calm variant (accent used only on rules and headings)';
  return { theme, calm, why };
}
