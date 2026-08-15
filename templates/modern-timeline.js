import {
  escapeHtml,
  renderCerts,
  renderEducationRows,
  renderSkillsStacked,
  renderTechnicalSummary,
  wrapHtmlDocument
} from "./shared.js";

const CSS = `
    @page { size: A4; margin: 12mm 14mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: "Segoe UI", Calibri, Arial, Helvetica, sans-serif;
      color: #1c2430;
      background: #fff;
      font-size: 10pt;
      line-height: 1.32;
    }

    .resume { width: 100%; }

    header.top { margin: 0 0 12px; }

    h1 {
      margin: 0;
      font-size: 24pt;
      font-weight: 700;
      letter-spacing: -0.4px;
      line-height: 1.05;
      color: #0e2a4c;
    }

    .headline {
      margin: 3px 0 8px;
      font-size: 11pt;
      font-weight: 600;
      color: #3d4f66;
    }

    .rule {
      height: 3px;
      width: 42px;
      background: #f5c542;
      margin: 0 0 8px;
      border: 0;
    }

    .contact {
      margin: 0;
      font-size: 9pt;
      color: #3d4f66;
    }

    .contact a, .contact a:visited { color: #0e2a4c; text-decoration: none; }

    section { margin: 0 0 11px; }

    h2 {
      margin: 0 0 7px;
      font-size: 9.5pt;
      font-weight: 800;
      letter-spacing: 1.6px;
      text-transform: uppercase;
      color: #0e2a4c;
      border: 0;
    }

    p { margin: 0 0 4px; text-align: justify; }

    .timeline {
      border-left: 2px solid #d7e0ea;
      margin: 0 0 0 4px;
      padding: 0 0 2px 14px;
    }

    .job {
      position: relative;
      margin: 0 0 10px;
    }

    .job::before {
      content: "";
      position: absolute;
      left: -19px;
      top: 5px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f5c542;
      box-shadow: 0 0 0 2px #fff;
    }

    .job-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: baseline;
    }

    .job-title {
      margin: 0;
      font-size: 11pt;
      font-weight: 700;
      color: #0e2a4c;
    }

    .job-dates {
      flex: 0 0 auto;
      font-size: 9pt;
      font-weight: 700;
      color: #5c6d82;
      white-space: nowrap;
    }

    .job-company {
      margin: 0 0 2px;
      font-size: 9.5pt;
      color: #3d4f66;
    }

    .project {
      margin: 0 0 2px;
      font-size: 9pt;
      font-style: italic;
      color: #5c6d82;
    }

    ul { margin: 2px 0 0; padding-left: 16px; }
    li { margin: 0 0 2px; text-align: justify; }

    .skills-stack { display: grid; gap: 5px; }

    .skill-row {
      display: grid;
      grid-template-columns: 28% 1fr;
      gap: 8px;
    }

    .skill-cat {
      font-size: 8.5pt;
      font-weight: 800;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #0e2a4c;
    }

    .skill-items { font-size: 9.5pt; color: #1c2430; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 5px;
    }

    .edu-degree { font-weight: 700; color: #0e2a4c; }
    .edu-year { white-space: nowrap; font-weight: 700; color: #5c6d82; }

    .tech-summary, .certifications { margin: 0; padding-left: 16px; }
`;

function renderContact(data) {
  const parts = [];
  if (data.location) parts.push(escapeHtml(data.location));
  if (data.phone) parts.push(escapeHtml(data.phone));
  if (data.email) {
    const email = String(data.email).replace(/^mailto:/i, "").trim();
    parts.push(`<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`);
  }
  if (data.linkedin) {
    const raw = String(data.linkedin).trim();
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const label = href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    parts.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
  }
  return parts.length ? `<p class="contact">${parts.join(" · ")}</p>` : "";
}

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
      const companyLine = [company, location].filter(Boolean).join(" · ");
      return `<article class="job">
  <div class="job-top">
    <h3 class="job-title">${title}</h3>
    ${dates ? `<span class="job-dates">${dates}</span>` : ""}
  </div>
  ${companyLine ? `<p class="job-company">${companyLine}</p>` : ""}
  ${project ? `<p class="project">${project}</p>` : ""}
  ${bullets ? `<ul>\n${bullets}\n  </ul>` : ""}
</article>`;
    })
    .join("\n");
}

export const modernTimelineTemplate = {
  id: "modern-timeline",
  label: "Brightstar template 6",
  description: "Segoe UI · gold rule · timeline dots on roles · stacked skill rows.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkillsStacked(data.skills);
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
    <div class="rule"></div>
    ${renderContact(data)}
  </header>
  ${profile ? `<section><h2>About</h2><p>${escapeHtml(profile)}</p></section>` : ""}
  ${tech ? `<section><h2>Highlights</h2>${tech}</section>` : ""}
  ${jobs ? `<section><h2>Experience</h2><div class="timeline">${jobs}</div></section>` : ""}
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
