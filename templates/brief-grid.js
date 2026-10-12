import {
  contactLine,
  escapeHtml,
  pathAttr,
  renderCerts,
  renderEducationRows,
  renderJobsTitleFirst,
  renderSkills,
  renderTechnicalSummary,
  richHtml,
  wrapHtmlDocument
} from "./shared.js";

/**
 * Borderless skills table and a short mark under the name. Built to stay on one page.
 */
const CSS = `
    @page { size: A4; margin: 11mm 13mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      color: #1a1a1a;
      background: #fff;
      font-size: 10pt;
      line-height: 1.22;
    }

    .resume { width: 100%; }

    header.top { margin: 0 0 6px; }

    h1 {
      margin: 0;
      font-size: 17pt;
      font-weight: 700;
      line-height: 1.05;
    }

    h1::after {
      content: "";
      display: block;
      width: 42px;
      height: 3px;
      margin-top: 4px;
      background: #1f4e79;
    }

    .headline {
      margin: 4px 0 2px;
      font-size: 10.5pt;
      font-weight: 700;
      color: #1f4e79;
    }

    .contact { margin: 0; font-size: 9pt; }

    a, a:visited { color: #1f4e79; text-decoration: none; }

    section { margin: 0 0 6px; }

    h2 {
      margin: 0 0 3px;
      font-size: 9.5pt;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      color: #1f4e79;
    }

    p { margin: 0 0 2px; }

    .tech-summary, .certifications { margin: 0; padding-left: 14px; }

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9.5pt;
    }

    .skills-table th,
    .skills-table td {
      padding: 1px 8px 1px 0;
      vertical-align: top;
      text-align: left;
      border: none;
      border-bottom: 1px solid #e6eaf0;
    }

    .skills-table th {
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #1f4e79;
    }

    .skills-table .skill-cat { width: 26%; font-weight: 700; }
    .skills-table .skill-items { width: 74%; }

    .job { margin: 0 0 5px; }

    .job-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
    }

    .job-title { margin: 0; font-size: 10.5pt; font-weight: 700; }

    .job-dates {
      flex: 0 0 auto;
      white-space: nowrap;
      font-size: 9pt;
      color: #4b5563;
    }

    .job-meta, .project { margin: 0; font-size: 9pt; color: #4b5563; }

    ul { margin: 1px 0 0; padding-left: 14px; }
    li { margin: 0 0 1px; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 2px;
      align-items: baseline;
    }

    .edu-degree { font-weight: 700; }
    .edu-year { white-space: nowrap; font-weight: 700; }
`;

export const briefGridTemplate = {
  id: "brief-grid",
  label: "15 · Brief Grid",
  description: "Short name mark · borderless skill categories · tight experience rows.",
  render(data) {
    const name = String(data.name || "Resume").trim() || "Resume";
    const headline = String(data.headline || "").trim();
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkills(data.skills);
    const jobs = renderJobsTitleFirst(data.experience);
    const edu = renderEducationRows(data.education);
    const certs = (data.certifications || []).length ? renderCerts(data.certifications) : "";

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `<main class="resume">
  <header class="top">
    <h1${pathAttr("name")}>${escapeHtml(name)}</h1>
    ${headline ? `<p class="headline"${pathAttr("headline")}>${richHtml(headline)}</p>` : ""}
    <p class="contact">${contactLine(data)}</p>
  </header>
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${profile ? `<section><h2>Summary</h2><p${pathAttr("profile")}>${richHtml(profile)}</p></section>` : ""}
  ${jobs ? `<section><h2>Experience</h2>${jobs}</section>` : ""}
  ${tech ? `<section><h2>Highlights</h2>${tech}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
