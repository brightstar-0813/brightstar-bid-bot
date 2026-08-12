import {
  contactLine,
  escapeHtml,
  renderCerts,
  renderSkills,
  wrapHtmlDocument
} from "./shared.js";

/**
 * Sandeep master-PDF layout:
 * centered name → Personal Details → Profile → Education → Experience
 * (title + dates row, company/location row) → Skills → Certificates.
 * Fonts approximate the Word/PDF source (Lucida Sans + Times).
 */
const CSS = `
    @page { size: A4; margin: 12mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: "Lucida Sans Unicode", "Lucida Grande", Arial, Helvetica, sans-serif;
      color: #111;
      background: #fff;
      font-size: 10pt;
      line-height: 1.32;
    }

    .resume {
      width: 100%;
      margin: 0 auto;
    }

    header.top {
      text-align: center;
      margin-bottom: 10px;
      padding-bottom: 4px;
    }

    h1 {
      margin: 0 0 2px;
      font-family: "Times New Roman", Times, serif;
      font-size: 22pt;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #000;
    }

    .headline {
      margin: 0;
      font-size: 10.5pt;
      font-weight: 700;
      color: #222;
    }

    a, a:visited {
      color: #111;
      text-decoration: underline;
    }

    section {
      margin: 8px 0 6px;
    }

    h2 {
      margin: 0 0 5px;
      padding-bottom: 2px;
      font-size: 10.5pt;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      border-bottom: 1px solid #222;
      color: #000;
    }

    .personal-details {
      margin: 0;
      font-size: 9.5pt;
      line-height: 1.4;
      text-align: left;
    }

    .personal-details div {
      margin: 0 0 1px;
    }

    p {
      margin: 0 0 4px;
      text-align: justify;
    }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 6px;
      align-items: flex-start;
    }

    .edu-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .edu-year {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9.5pt;
      font-weight: 700;
    }

    .edu-school {
      font-weight: 700;
    }

    .edu-degree {
      margin: 1px 0 0;
    }

    .edu-details {
      margin: 1px 0 0;
      font-size: 9pt;
      color: #333;
    }

    .job {
      margin: 0 0 8px;
      break-inside: auto;
      page-break-inside: auto;
    }

    .job-title-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
      font-weight: 700;
      font-size: 10pt;
    }

    .job-title {
      flex: 1 1 auto;
      min-width: 0;
    }

    .job-dates {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9.5pt;
      font-weight: 700;
    }

    .job-company {
      margin: 1px 0 3px;
      font-size: 9.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }

    .project {
      margin: 0 0 2px;
      font-style: italic;
      font-size: 9.2pt;
      font-weight: 400;
      text-transform: none;
    }

    ul {
      margin: 2px 0 0;
      padding-left: 16px;
    }

    li {
      margin: 0 0 2.5px;
      text-align: justify;
      line-height: 1.28;
    }

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      margin: 2px 0 4px;
      table-layout: fixed;
      font-size: 9.2pt;
    }

    .skills-table th,
    .skills-table td {
      border: 1px solid #444;
      padding: 3px 6px;
      vertical-align: top;
      text-align: left;
    }

    .skills-table th {
      font-weight: 700;
      background: #efefef;
      font-size: 9pt;
    }

    .skills-table .skill-cat {
      width: 30%;
      font-weight: 700;
    }

    .skills-table .skill-items {
      width: 70%;
    }

    .certifications {
      columns: 1;
      margin: 2px 0 0;
      padding-left: 16px;
    }

    .certifications li {
      margin: 0 0 2px;
      break-inside: avoid;
    }
`;

function renderEducation(education) {
  const list = Array.isArray(education)
    ? education
    : education && typeof education === "object"
      ? [education]
      : [];

  const rows = list
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
    .filter(Boolean);

  return rows.join("\n");
}

/** Title + dates on one row; COMPANY, location under it (matches master PDF). */
function renderJobsSandeep(jobs) {
  return (jobs || [])
    .map((job) => {
      const company = escapeHtml(job.company || "");
      const location = String(job.location || "").trim();
      const title = escapeHtml(job.title || "");
      const dates = escapeHtml(job.dates || "");
      const project = escapeHtml(job.project || "");
      const companyLine = [company, location].filter(Boolean).join(", ");
      const bullets = (job.bullets || [])
        .filter(Boolean)
        .map((b) => `<li>${escapeHtml(b)}</li>`)
        .join("\n");

      return `<article class="job">
  <div class="job-title-row">
    <span class="job-title">${title}</span>
    ${dates ? `<span class="job-dates">${dates}</span>` : ""}
  </div>
  <div class="job-company">${companyLine}${project ? `<div class="project">${project}</div>` : ""}</div>
  <ul>
${bullets}
  </ul>
</article>`;
    })
    .join("\n");
}

function renderPersonalDetails(data) {
  const lines = [];
  if (data.location) lines.push(`<div>${escapeHtml(data.location)}</div>`);
  const contactBits = [];
  if (data.email) {
    const email = String(data.email || "").trim();
    contactBits.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  if (data.phone) contactBits.push(escapeHtml(data.phone));
  if (contactBits.length) lines.push(`<div>${contactBits.join(", ")}</div>`);
  if (data.linkedin) {
    const raw = String(data.linkedin || "").trim();
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const label = href.replace(/^https?:\/\/(www\.)?/i, "");
    lines.push(
      `<div>LinkedIn: <a href="${escapeHtml(href)}">${escapeHtml(label)}</a></div>`
    );
  }
  return lines.length ? `<div class="personal-details">${lines.join("\n")}</div>` : "";
}

export const sandeepClassicTemplate = {
  id: "sandeep-classic",
  label: "Sandeep Classic (PDF)",
  description:
    "Matches Sandeep master PDF: Personal Details, Profile, Education, title/date experience rows, Skills, Certificates.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const eduHtml = renderEducation(data.education);

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `  <main class="resume">
    <header class="top">
      <h1>${name}</h1>
      ${headline ? `<p class="headline">${headline}</p>` : ""}
    </header>

    <section>
      <h2>Personal Details</h2>
      ${renderPersonalDetails(data) || `<p class="personal-details">${contactLine(data)}</p>`}
    </section>

    <section>
      <h2>Profile</h2>
      <p>${escapeHtml(data.profile || "")}</p>
    </section>

    ${
      eduHtml
        ? `<section>
      <h2>Education</h2>
      ${eduHtml}
    </section>`
        : ""
    }

    <section>
      <h2>Professional Experience</h2>
      ${renderJobsSandeep(data.experience)}
    </section>

    <section class="skills">
      <h2>Skills</h2>
      ${renderSkills(data.skills)}
    </section>

    <section>
      <h2>Certificates</h2>
      ${renderCerts(data.certifications)}
    </section>
  </main>`
    });
  }
};
