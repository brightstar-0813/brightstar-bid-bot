import {
  contactLine,
  escapeHtml,
  renderCerts,
  renderEducationRows,
  renderSkills,
  renderTechnicalSummary,
  wrapHtmlDocument
} from "./shared.js";

const CSS = `
    @page { size: A4; margin: 14mm 16mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Georgia, "Times New Roman", Times, serif;
      color: #111;
      background: #fff;
      font-size: 10.5pt;
      line-height: 1.28;
    }

    .resume { width: 100%; }

    header.top {
      text-align: center;
      margin: 0 0 10px;
      padding-bottom: 8px;
      border-bottom: 2.2px solid #111;
    }

    h1 {
      margin: 0;
      font-size: 22pt;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      line-height: 1.1;
    }

    .headline {
      margin: 3px 0 4px;
      font-size: 11pt;
      font-style: italic;
      font-weight: 400;
    }

    .contact {
      margin: 0;
      font-size: 9.2pt;
      font-family: Calibri, Arial, sans-serif;
    }

    a, a:visited { color: #111; text-decoration: underline; }

    section { margin: 0 0 8px; }

    h2 {
      margin: 0 0 4px;
      padding: 0 0 2px;
      font-size: 10.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      border-bottom: 0.75px solid #111;
    }

    p { margin: 0 0 4px; text-align: justify; }

    .tech-summary, .certifications {
      margin: 0;
      padding-left: 16px;
    }

    .job { margin: 0 0 8px; }

    .job-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
    }

    .job-company {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
    }

    .job-loc {
      flex: 0 0 auto;
      font-size: 10pt;
      font-style: italic;
      white-space: nowrap;
    }

    .job-title {
      margin: 0;
      font-size: 10.5pt;
      font-weight: 700;
    }

    .job-dates {
      flex: 0 0 auto;
      font-size: 10pt;
      white-space: nowrap;
    }

    .project {
      margin: 0 0 2px;
      font-size: 10pt;
      font-style: italic;
    }

    ul { margin: 2px 0 0; padding-left: 16px; }

    li {
      margin: 0 0 1.5px;
      text-align: justify;
    }

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9.5pt;
      font-family: Calibri, Arial, sans-serif;
    }

    .skills-table th, .skills-table td {
      border: 1px solid #333;
      padding: 3px 6px;
      vertical-align: top;
      text-align: left;
    }

    .skills-table th { font-weight: 700; background: #f3f3f3; }
    .skills-table .skill-cat { width: 30%; font-weight: 700; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 4px;
      align-items: baseline;
    }

    .edu-degree { font-weight: 700; }
    .edu-school { font-style: italic; }
    .edu-year { white-space: nowrap; font-weight: 700; }
`;

function renderJobs(jobs) {
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
  <div class="job-row">
    <h3 class="job-company">${company}</h3>
    ${location ? `<span class="job-loc">${location}</span>` : ""}
  </div>
  <div class="job-row">
    <p class="job-title">${title}</p>
    ${dates ? `<span class="job-dates">${dates}</span>` : ""}
  </div>
  ${project ? `<p class="project">${project}</p>` : ""}
  ${bullets ? `<ul>\n${bullets}\n  </ul>` : ""}
</article>`;
    })
    .join("\n");
}

export const consultingClassicTemplate = {
  id: "consulting-classic",
  label: "3 · US Consulting",
  description: "Georgia · US Big 4 / McKinsey-style · senior consultant and architect.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkills(data.skills);
    const jobs = renderJobs(data.experience);
    const edu = renderEducationRows(data.education);
    const certs = (data.certifications || []).length ? renderCerts(data.certifications) : "";

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `<main class="resume">
  <header class="top">
    <h1>${name}</h1>
    ${headline ? `<p class="headline">${headline}</p>` : ""}
    <p class="contact">${contactLine(data)}</p>
  </header>
  ${profile ? `<section><h2>Summary</h2><p>${escapeHtml(profile)}</p></section>` : ""}
  ${tech ? `<section><h2>Selected Highlights</h2>${tech}</section>` : ""}
  ${jobs ? `<section><h2>Experience</h2>${jobs}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
