import {
  escapeHtml,
  renderCertBadges,
  renderCerts,
  renderContactBlock,
  renderJobsStacked,
  renderSkills,
  renderTechnicalSummary,
  wrapHtmlDocument
} from "./shared.js";

const CSS = `
    @page { size: A4; margin: 10mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: "Times New Roman", Times, serif;
      color: #000;
      background: #fff;
      font-size: 10.8pt;
      line-height: 1.18;
    }

    .resume {
      width: 100%;
      margin: 0 auto;
    }

    header.top {
      text-align: center;
      margin-bottom: 4px;
      padding-bottom: 2px;
    }

    h1 {
      margin: 0 0 2px;
      font-size: 22.5pt;
      font-weight: 700;
      letter-spacing: 0;
      color: #000;
      text-align: center;
    }

    .headline {
      margin: 0 0 4px;
      font-size: 11pt;
      font-weight: 700;
      text-align: center;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      text-align: left;
      margin-top: 2px;
    }

    .contact-block {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 10pt;
      line-height: 1.28;
      text-align: left;
    }

    .contact-block div {
      margin: 0;
    }

    .cert-badges {
      flex: 0 0 auto;
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: flex-end;
      gap: 3px;
      max-width: 55%;
    }

    .cert-badge {
      display: block;
      width: 54px;
      height: 59px;
      flex-shrink: 0;
    }

    a, a:visited {
      color: #000;
      text-decoration: underline;
    }

    /* Compact sections — avoid huge empty gaps from forced page breaks */
    section {
      margin: 3px 0 4px;
      break-inside: auto;
      page-break-inside: auto;
    }

    h2 {
      margin: 6px 0 3px;
      padding-bottom: 2px;
      font-size: 11pt;
      font-weight: 700;
      border-bottom: 1.5px solid #000;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #000;
    }

    h3.role-company {
      margin: 5px 0 0;
      font-size: 11pt;
      color: #000;
      font-weight: 700;
    }

    p.role-title {
      margin: 0;
      font-size: 10.8pt;
      font-weight: 700;
      color: #000;
      font-style: normal;
    }

    p.role-meta {
      margin: 0 0 2px;
      font-size: 10pt;
      font-weight: 400;
      font-style: italic;
      color: #000;
    }

    p {
      margin: 0 0 2px;
      white-space: pre-wrap;
      text-align: justify;
      text-justify: inter-word;
    }

    .skills-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1px 0 2px;
      table-layout: fixed;
      font-size: 10pt;
    }

    .skills-table th,
    .skills-table td {
      border: 1px solid #000;
      padding: 3px 6px;
      vertical-align: top;
      text-align: left;
    }

    .skills-table th {
      font-weight: 700;
      background: #e8e8e8;
      font-size: 9.5pt;
    }

    .skills-table .skill-cat {
      width: 32%;
      font-weight: 700;
      white-space: nowrap;
    }

    .skills-table .skill-items {
      width: 68%;
      text-align: left;
    }

    .certifications,
    .tech-summary {
      margin: 1px 0 2px;
      padding-left: 16px;
    }

    .certifications li,
    .tech-summary li {
      margin: 0 0 1.5px;
      text-align: justify;
    }

    .job {
      margin: 0 0 4px;
      break-inside: auto;
      page-break-inside: auto;
    }

    .project {
      margin: 0 0 1px;
      font-style: italic;
      font-size: 10pt;
    }

    ul {
      margin: 1px 0 2px;
      padding-left: 16px;
    }

    li {
      margin: 0 0 1.5px;
      text-align: justify;
      text-justify: inter-word;
      line-height: 1.16;
    }

    h2 + p, h2 + ul, h2 + div, h2 + h3, h2 + table { margin-top: 2px; }
    .role-title + .role-meta { margin-top: 0; }
    .role-meta + ul, .project + ul { margin-top: 2px; }
`;

export const timesClassicTemplate = {
  id: "times-classic",
  label: "1 · US Times Classic",
  description: "Times serif · cert badges · traditional US senior-engineer resume.",
  render(data) {
    const name = escapeHtml(data.name || "Resume");
    const headline = escapeHtml(data.headline || "");
    const eduList = Array.isArray(data.education)
      ? data.education
      : data.education
        ? [data.education]
        : [];
    const eduHtml = eduList
      .map((edu) => {
        const school = escapeHtml(edu?.school || "");
        const degree = escapeHtml(edu?.degree || "");
        const year = escapeHtml(edu?.year || "");
        const details = escapeHtml(edu?.details || "");
        if (!school && !degree) return "";
        // Keep this on one line: p uses white-space: pre-wrap, so any source
        // indentation would render as leading blank space.
        const rest = [degree, year, details].filter(Boolean).join("<br>");
        return `<p><strong>${school}</strong>${rest ? `<br>${rest}` : ""}</p>`;
      })
      .filter(Boolean)
      .join("\n");
    const badges = renderCertBadges(data.certifications, { limit: 5 });
    const contact = renderContactBlock(data, { linkColor: "#000" });
    const techSummaryHtml = renderTechnicalSummary(data.technicalSummary);

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `  <main class="resume">
    <header class="top">
      <h1>${name}</h1>
      ${headline ? `<p class="headline">${headline}</p>` : ""}
      <div class="header-row">
        ${contact}
        ${badges}
      </div>
    </header>

    <section>
      <h2>Profile</h2>
      <p>${escapeHtml(data.profile || "")}</p>
    </section>

    ${
      techSummaryHtml
        ? `<section>
      <h2>Technical Summary</h2>
      ${techSummaryHtml}
    </section>`
        : ""
    }

    <section>
      <h2>Education</h2>
      ${eduHtml || "<p></p>"}
    </section>

    <section>
      <h2>Certifications</h2>
      ${renderCerts(data.certifications)}
    </section>

    <section class="skills">
      <h2>Skills</h2>
      ${renderSkills(data.skills)}
    </section>

    <section>
      <h2>Experience</h2>
      ${renderJobsStacked(data.experience)}
    </section>
  </main>`
    });
  }
};
