export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanEmail(value) {
  // Prefer the visible label for [email](mailto:email); fall back to mailto target.
  const raw = String(value || "").trim();
  const md = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (md) {
    const label = md[1].trim();
    const target = md[2].replace(/^mailto:/i, "").trim();
    return (label.includes("@") ? label : target).replace(/^mailto:/i, "").trim();
  }
  return raw.replace(/^mailto:/i, "").replace(/[[\]]/g, "").trim();
}

function cleanUrl(value) {
  let url = String(value || "").trim();
  const md = url.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (md) url = md[2] || md[1] || url;
  url = url.replace(/[[\]]/g, "").trim();
  const match = url.match(/https?:\/\/[^\s"'<>\\]+/i);
  if (match) url = match[0];
  return url.replace(/[),.]+$/g, "").replace(/\/+$/, "").trim();
}

export function contactLine(data, { linkColor } = {}) {
  const parts = [];
  if (data.location) parts.push(escapeHtml(data.location));
  if (data.phone) parts.push(escapeHtml(data.phone));
  if (data.email) {
    const email = cleanEmail(data.email);
    parts.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  if (data.linkedin) {
    const url = cleanUrl(data.linkedin);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
  }
  const style = linkColor ? ` style="color:${linkColor}"` : "";
  if (style) {
    return parts
      .map((part) => (part.startsWith("<a ") ? part.replace("<a ", `<a${style} `) : part))
      .join(" | ");
  }
  return parts.join(" | ");
}

/** Stacked contact block (left column under name/headline). */
export function renderContactBlock(data, { linkColor = "#000" } = {}) {
  const lines = [];
  if (data.location) lines.push(`<div>${escapeHtml(data.location)}</div>`);
  if (data.phone) lines.push(`<div>${escapeHtml(data.phone)}</div>`);
  if (data.email) {
    const email = cleanEmail(data.email);
    lines.push(
      `<div><a href="mailto:${escapeHtml(email)}" style="color:${linkColor}">${escapeHtml(email)}</a></div>`
    );
  }
  if (data.linkedin) {
    const url = cleanUrl(data.linkedin);
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    lines.push(
      `<div><a href="${escapeHtml(href)}" style="color:${linkColor}">${escapeHtml(href)}</a></div>`
    );
  }
  return lines.length ? `<div class="contact-block">${lines.join("\n")}</div>` : "";
}

/** Two-column skills table: Category | Technologies (ATS-friendly HTML table). */
export function renderSkills(skills) {
  const rows = (skills || [])
    .map((row) => {
      const category = String(row?.category || "").trim();
      const items = String(row?.items || "").trim();
      if (!category && !items) return "";
      return `<tr>
  <td class="skill-cat">${escapeHtml(category)}</td>
  <td class="skill-items">${escapeHtml(items)}</td>
</tr>`;
    })
    .filter(Boolean);

  if (!rows.length) return "";

  return `<table class="skills-table" role="table">
  <thead>
    <tr>
      <th scope="col">Category</th>
      <th scope="col">Technologies / Skills</th>
    </tr>
  </thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

export function renderCerts(certs, { listClass = "certifications" } = {}) {
  const items = (certs || [])
    .map((c) => `<li>${escapeHtml(c)}</li>`)
    .join("\n");
  return `<ul class="${listClass}">${items}</ul>`;
}

/** Technical Summary: array of highlight bullets (strings). */
export function renderTechnicalSummary(items) {
  const list = Array.isArray(items)
    ? items
    : typeof items === "string" && items.trim()
      ? items.split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, "").trim())
      : [];
  const bullets = list
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .map((s) => `<li>${escapeHtml(s)}</li>`);
  if (!bullets.length) return "";
  return `<ul class="tech-summary">\n${bullets.join("\n")}\n</ul>`;
}

/**
 * Salesforce-style hexagonal cert badges for the resume header.
 * Maps known certification names → short label + colors.
 */
const CERT_BADGE_DEFS = [
  {
    match: /platform\s*developer\s*ii|pdii|pd\s*ii/i,
    label: "Platform\nDeveloper II",
    top: "#2a1f6e",
    bottom: "#5b4db8"
  },
  {
    match: /platform\s*developer\s*i(?!\s*i)|pdi(?!\s*i)|pd\s*i(?!\s*i)/i,
    label: "Platform\nDeveloper I",
    top: "#1f3b8a",
    bottom: "#6b7fd7"
  },
  {
    match: /service\s*cloud\s*consultant/i,
    label: "Service Cloud\nConsultant",
    top: "#5b2d8e",
    bottom: "#e8a317"
  },
  {
    match: /sales\s*cloud\s*consultant/i,
    label: "Sales Cloud\nConsultant",
    top: "#1a3a7a",
    bottom: "#e8a317"
  },
  {
    match: /application\s*architect|system\s*architect|data\s*architect|sharing\s*and\s*visibility|development\s*lifecycle|deployment\s*architect/i,
    label: "Architect",
    top: "#0d3b66",
    bottom: "#3d7ea6"
  },
  {
    match: /business\s*analyst/i,
    label: "Business\nAnalyst",
    top: "#1f5f8b",
    bottom: "#5dade2"
  },
  {
    match: /app\s*builder|platform\s*app\s*builder/i,
    label: "Platform\nApp Builder",
    top: "#0e6655",
    bottom: "#48c9b0"
  },
  {
    match: /administrator|admin\b/i,
    label: "Administrator",
    top: "#1f4e79",
    bottom: "#5dade2"
  },
  {
    match: /associate/i,
    label: "Associate",
    top: "#2874a6",
    bottom: "#85c1e9"
  },
  {
    match: /agentforce|ai\s*associate|ai\s*specialist/i,
    label: "AI /\nAgentforce",
    top: "#6c3483",
    bottom: "#bb8fce"
  }
];

function resolveCertBadge(certText) {
  const text = String(certText || "").trim();
  if (!text) return null;
  for (const def of CERT_BADGE_DEFS) {
    if (def.match.test(text)) {
      return { ...def, source: text };
    }
  }
  return null;
}

function sfCloudIcon() {
  // Simple white Salesforce-like cloud glyph
  return `<path fill="#fff" d="M18.2 14.2c-.3-2.2-2.2-3.9-4.5-3.9-1.1 0-2.1.4-2.9 1-.7-2.5-3-4.3-5.7-4.3-3.3 0-6 2.6-6.1 5.8C-.8 13.5 0 15.2 1.6 16.1c.5.3 1 .4 1.6.4h14.1c1.8 0 3.2-1.4 3.2-3.1 0-1.5-1.1-2.8-2.3-3.2z"/>`;
}

function certBadgeSvg({ label, top, bottom }, index = 0) {
  const lines = String(label).split("\n");
  const lineStarts = lines.length === 1 ? [78] : lines.length === 2 ? [72, 86] : [68, 80, 92];
  const textEls = lines
    .map(
      (line, i) =>
        `<text x="50" y="${lineStarts[i]}" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="${lines.length > 2 ? 8.5 : 9.5}" font-weight="700">${escapeHtml(line)}</text>`
    )
    .join("");

  return `<svg class="cert-badge" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110" width="58" height="64" aria-hidden="true">
  <polygon points="50,2 95,28 95,82 50,108 5,82 5,28" fill="${top}"/>
  <polygon points="8,74 92,74 95,82 50,108 5,82" fill="${bottom}"/>
  <g transform="translate(31,14) scale(0.95)">${sfCloudIcon()}</g>
  <text x="50" y="58" text-anchor="middle" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="9" font-weight="800" letter-spacing="0.5">CERTIFIED</text>
  ${textEls}
</svg>`;
}

/**
 * Render up to `limit` Salesforce cert badges from certification strings.
 * Prefer higher-signal certs (PDII, consultants, architects) when many are present.
 */
export function renderCertBadges(certs, { limit = 5 } = {}) {
  const list = Array.isArray(certs) ? certs : [];
  const resolved = [];
  const seen = new Set();

  for (const cert of list) {
    const badge = resolveCertBadge(cert);
    if (!badge) continue;
    const key = badge.label;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(badge);
  }

  // Prefer order similar to the reference screenshot when possible
  const preferred = [
    /Administrator/i,
    /Developer I(?!\s*I)/i,
    /Developer II/i,
    /Service Cloud/i,
    /Sales Cloud/i,
    /Architect/i,
    /App Builder/i,
    /Business/i
  ];
  resolved.sort((a, b) => {
    const ai = preferred.findIndex((re) => re.test(a.label));
    const bi = preferred.findIndex((re) => re.test(b.label));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const chosen = resolved.slice(0, limit);
  if (!chosen.length) return "";

  return `<div class="cert-badges" aria-label="Salesforce certifications">
${chosen.map((b, i) => certBadgeSvg(b, i)).join("\n")}
</div>`;
}

/** Flex header: company (location) — title | dates on the right. */
export function renderJobsFlex(jobs) {
  return (jobs || [])
    .map((job) => {
      const company = escapeHtml(job.company || "");
      const location = escapeHtml(job.location || "");
      const title = escapeHtml(job.title || "");
      const dates = escapeHtml(job.dates || "");
      const project = escapeHtml(job.project || "");
      const bullets = (job.bullets || [])
        .filter(Boolean)
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("\n");

      return `<article class="job">
  <div class="job-header">
    <span class="company">${company}${location ? ` (${location})` : ""} — ${title}</span>
    <span class="date">${dates}</span>
  </div>
  ${project ? `<p class="project">${project}</p>` : ""}
  <ul>
${bullets}
  </ul>
</article>`;
    })
    .join("\n");
}

/**
 * Experience header style (reference):
 *   Company                  (bold)
 *   Job Title                (bold)
 *   Location | Mode | Dates  (normal)
 */
export function renderJobsStacked(jobs) {
  return (jobs || [])
    .map((job) => {
      const company = escapeHtml(job.company || "");
      const location = String(job.location || "").trim();
      const title = escapeHtml(job.title || "");
      const dates = String(job.dates || "").trim();
      const project = escapeHtml(job.project || "");
      const metaParts = [location, dates].filter(Boolean);
      const meta = escapeHtml(metaParts.join(" | "));
      const bullets = (job.bullets || [])
        .filter(Boolean)
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("\n");

      return `<article class="job">
  <h3 class="role-company">${company}</h3>
  <p class="role-title">${title}</p>
  ${meta ? `<p class="role-meta">${meta}</p>` : ""}
  ${project ? `<p class="project">${project}</p>` : ""}
  <ul>
${bullets}
  </ul>
</article>`;
    })
    .join("\n");
}

export function educationList(education) {
  const list = Array.isArray(education)
    ? education
    : education && typeof education === "object"
      ? [education]
      : [];
  return list.filter(
    (edu) => String(edu?.school || "").trim() || String(edu?.degree || "").trim()
  );
}

/** Degree + school on the left, year on the right. */
export function renderEducationRows(education) {
  return educationList(education)
    .map((edu) => {
      const school = escapeHtml(edu.school || "");
      const degree = escapeHtml(edu.degree || "");
      const year = escapeHtml(edu.year || "");
      const details = escapeHtml(edu.details || edu.gpa || "");
      return `<div class="edu-row">
  <div class="edu-main">
    ${degree ? `<div class="edu-degree">${degree}</div>` : ""}
    ${school ? `<div class="edu-school">${school}</div>` : ""}
    ${details ? `<div class="edu-details">${details}</div>` : ""}
  </div>
  ${year ? `<div class="edu-year">${year}</div>` : ""}
</div>`;
    })
    .join("\n");
}

/** Category / items as stacked rows (no table borders). */
export function renderSkillsStacked(skills) {
  const rows = (skills || [])
    .map((row) => {
      const category = String(row?.category || "").trim();
      const items = String(row?.items || "").trim();
      if (!category && !items) return "";
      return `<div class="skill-row"><span class="skill-cat">${escapeHtml(
        category
      )}</span><span class="skill-items">${escapeHtml(items)}</span></div>`;
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<div class="skills-stack">${rows.join("\n")}</div>`;
}

export function wrapHtmlDocument({ title, css, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
${body}
</body>
</html>`;
}
