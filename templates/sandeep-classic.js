import { escapeHtml, renderSkills, wrapHtmlDocument } from "./shared.js";

/**
 * Sandeep layout: keeps the master PDF's black-and-white serif/sans mix,
 * uppercase ruled headings, single column and right-aligned dates, but uses a
 * recruiter/ATS-first order — contact, summary, skills, experience, education,
 * certifications — and tighter spacing so a 10-role history stays readable.
 */
const CSS = `
    @page { size: A4; margin: 11mm 12mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: "Lucida Sans Unicode", "Lucida Grande", Arial, Helvetica, sans-serif;
      color: #111;
      background: #fff;
      font-size: 9.8pt;
      line-height: 1.3;
    }

    .resume { width: 100%; margin: 0 auto; }

    header.top {
      text-align: center;
      margin: 0 0 8px;
      padding-bottom: 5px;
      border-bottom: 1.5px solid #111;
    }

    h1 {
      margin: 0 0 1px;
      font-family: "Times New Roman", Times, serif;
      font-size: 21pt;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #000;
      line-height: 1.1;
    }

    .headline {
      margin: 0 0 3px;
      font-size: 10.5pt;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: #111;
    }

    .contact {
      margin: 0;
      font-size: 9.2pt;
      line-height: 1.35;
      color: #111;
      text-align: center;
    }

    .contact span.item { white-space: nowrap; }

    .contact .sep {
      padding: 0 5px;
      color: #555;
    }

    a, a:visited { color: #111; text-decoration: none; }

    section {
      margin: 0 0 7px;
      break-inside: auto;
      page-break-inside: auto;
    }

    h2 {
      margin: 0 0 4px;
      padding-bottom: 2px;
      font-size: 10.2pt;
      font-weight: 700;
      letter-spacing: 0.9px;
      text-transform: uppercase;
      border-bottom: 1px solid #222;
      color: #000;
      break-after: avoid;
      page-break-after: avoid;
    }

    p {
      margin: 0 0 4px;
      text-align: justify;
      hyphens: auto;
      orphans: 2;
      widows: 2;
    }

    /* ---- Skills ---- */

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1px 0 2px;
      table-layout: fixed;
      font-size: 9pt;
    }

    .skills-table thead {
      display: table-header-group;
    }

    .skills-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .skills-table th,
    .skills-table td {
      border: 1px solid #555;
      padding: 2.5px 6px;
      vertical-align: top;
      text-align: left;
      line-height: 1.28;
    }

    .skills-table th {
      font-weight: 700;
      background: #ececec;
      font-size: 8.6pt;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }

    .skills-table .skill-cat { width: 26%; font-weight: 700; }
    .skills-table .skill-items { width: 74%; }

    /* ---- Experience ---- */

    .job {
      margin: 0 0 7px;
      break-inside: auto;
      page-break-inside: auto;
    }

    .job:last-child { margin-bottom: 2px; }

    /* Keep title + company + project together so a role never starts alone. */
    .job-head {
      break-inside: avoid;
      page-break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }

    .job-title-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      font-size: 10pt;
      font-weight: 700;
    }

    .job-title { flex: 1 1 auto; min-width: 0; }

    .job-dates {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9.2pt;
      font-weight: 700;
    }

    .job-company {
      margin: 1px 0 0;
      font-size: 9.2pt;
      line-height: 1.3;
    }

    .company-name {
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }

    .job-location { font-weight: 400; color: #222; }

    .project {
      margin: 1px 0 0;
      font-style: italic;
      font-size: 9pt;
      color: #222;
    }

    ul {
      margin: 2px 0 0;
      padding-left: 15px;
    }

    li {
      margin: 0 0 2px;
      text-align: justify;
      hyphens: auto;
      line-height: 1.28;
      orphans: 2;
      widows: 2;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    /* ---- Education ---- */

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
      align-items: baseline;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .edu-row:last-child { margin-bottom: 1px; }

    .edu-main { flex: 1 1 auto; min-width: 0; }

    .edu-degree { font-weight: 700; }

    .edu-school { margin: 1px 0 0; }

    .edu-details {
      margin: 1px 0 0;
      font-size: 9pt;
      color: #333;
    }

    .edu-year {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9.2pt;
      font-weight: 700;
    }

    /* ---- Certifications ---- */

    .certifications {
      columns: 2;
      column-gap: 20px;
      margin: 2px 0 0;
      padding-left: 15px;
      font-size: 9.2pt;
    }

    .certifications li {
      margin: 0 0 1.5px;
      text-align: left;
      break-inside: avoid;
      page-break-inside: avoid;
    }
`;

function renderContact(data) {
  const parts = [];
  const location = String(data.location || "").trim();
  const phone = String(data.phone || "").trim();
  const email = String(data.email || "").trim();
  const linkedin = String(data.linkedin || "").trim();

  if (location) parts.push(escapeHtml(location));
  if (phone) parts.push(escapeHtml(phone));
  if (email) {
    parts.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  if (linkedin) {
    const href = /^https?:\/\//i.test(linkedin) ? linkedin : `https://${linkedin}`;
    const label = href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
  }

  if (!parts.length) return "";
  const items = parts.map((part) => `<span class="item">${part}</span>`);
  return `<p class="contact">${items.join('<span class="sep">|</span>')}</p>`;
}

function renderEducation(education) {
  const list = Array.isArray(education)
    ? education
    : education && typeof education === "object"
      ? [education]
      : [];

  return list
    .map((edu) => {
      const school = String(edu?.school || "").trim();
      const degree = String(edu?.degree || "").trim();
      const year = String(edu?.year || "").trim();
      const details = String(edu?.details || edu?.gpa || "").trim();
      if (!school && !degree) return "";
      return `<div class="edu-row">
  <div class="edu-main">
    ${degree ? `<div class="edu-degree">${escapeHtml(degree)}</div>` : ""}
    ${school ? `<div class="edu-school">${escapeHtml(school)}</div>` : ""}
    ${details ? `<div class="edu-details">${escapeHtml(details)}</div>` : ""}
  </div>
  ${year ? `<div class="edu-year">${escapeHtml(year)}</div>` : ""}
</div>`;
    })
    .filter(Boolean)
    .join("\n");
}

/** Title + dates on one row; COMPANY — location beneath; optional project label. */
function renderJobs(jobs) {
  return (jobs || [])
    .map((job) => {
      const company = escapeHtml(String(job?.company || "").trim());
      const location = escapeHtml(String(job?.location || "").trim());
      const title = escapeHtml(String(job?.title || "").trim());
      const dates = escapeHtml(String(job?.dates || "").trim());
      const project = escapeHtml(String(job?.project || "").trim());
      const bullets = (job?.bullets || [])
        .map((b) => String(b || "").trim())
        .filter(Boolean)
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("\n");

      const companyLine = company || location
        ? `<div class="job-company"><span class="company-name">${company}</span>${
            location ? `<span class="job-location"> — ${location}</span>` : ""
          }</div>`
        : "";

      return `<article class="job">
  <div class="job-head">
    <div class="job-title-row">
      <span class="job-title">${title}</span>
      ${dates ? `<span class="job-dates">${dates}</span>` : ""}
    </div>
    ${companyLine}
    ${project ? `<div class="project">Project: ${project}</div>` : ""}
  </div>
  ${bullets ? `<ul>\n${bullets}\n  </ul>` : ""}
</article>`;
    })
    .join("\n");
}

function renderCertifications(certs) {
  const items = (certs || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean)
    .map((c) => `<li>${escapeHtml(c)}</li>`);
  if (!items.length) return "";
  return `<ul class="certifications">\n${items.join("\n")}\n</ul>`;
}

export const sandeepClassicTemplate = {
  id: "sandeep-classic",
  label: "Sandeep Classic (PDF)",
  description:
    "Sandeep master-PDF styling with ATS-first order: contact, summary, skills, experience, education, certifications.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const profile = String(data.profile || "").trim();
    const skillsHtml = renderSkills(data.skills);
    const experienceHtml = renderJobs(data.experience);
    const eduHtml = renderEducation(data.education);
    const certsHtml = renderCertifications(data.certifications);

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `  <main class="resume">
    <header class="top">
      <h1>${name}</h1>
      ${headline ? `<p class="headline">${headline}</p>` : ""}
      ${renderContact(data)}
    </header>

    ${
      profile
        ? `<section>
      <h2>Professional Summary</h2>
      <p>${escapeHtml(profile)}</p>
    </section>`
        : ""
    }

    ${
      skillsHtml
        ? `<section class="skills">
      <h2>Technical Skills</h2>
      ${skillsHtml}
    </section>`
        : ""
    }

    ${
      experienceHtml
        ? `<section>
      <h2>Professional Experience</h2>
      ${experienceHtml}
    </section>`
        : ""
    }

    ${
      eduHtml
        ? `<section>
      <h2>Education</h2>
      ${eduHtml}
    </section>`
        : ""
    }

    ${
      certsHtml
        ? `<section>
      <h2>Certifications</h2>
      ${certsHtml}
    </section>`
        : ""
    }
  </main>`
    });
  }
};
