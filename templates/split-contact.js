import {
  escapeHtml,
  pathAttr,
  renderCerts,
  renderContactBlock,
  renderEducationRows,
  renderJobsStacked,
  renderSkillsInline,
  renderTechnicalSummary,
  richHtml,
  wrapHtmlDocument
} from "./shared.js";

/**
 * Name on the left, contact on the right, short left-bar section labels.
 */
const CSS = `
    @page { size: A4; margin: 12mm 14mm; }

    * { box-sizing: border-box; }

    html, body {
      width: 210mm;
      margin: 0;
      padding: 0;
      font-family: Calibri, "Segoe UI", Arial, sans-serif;
      color: #1a1a1a;
      background: #fff;
      font-size: 10.5pt;
      line-height: 1.25;
    }

    .resume { width: 100%; }

    header.top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin: 0 0 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #d5dbe3;
    }

    h1 {
      margin: 0;
      font-size: 18pt;
      font-weight: 700;
      letter-spacing: 0.3px;
      line-height: 1.05;
      color: #243044;
    }

    .headline {
      margin: 2px 0 0;
      font-size: 10.5pt;
      color: #3d4f66;
    }

    .contact-block {
      flex: 0 0 auto;
      max-width: 46%;
      text-align: right;
      font-size: 9pt;
      line-height: 1.35;
      color: #333;
    }

    a, a:visited { color: #243044; text-decoration: none; }

    section { margin: 0 0 7px; }

    h2 {
      margin: 0 0 3px;
      padding-left: 7px;
      border-left: 3px solid #3d4f66;
      font-size: 10pt;
      font-weight: 700;
      letter-spacing: 0.7px;
      text-transform: uppercase;
    }

    p { margin: 0 0 2px; }

    .tech-summary, .certifications { margin: 0; padding-left: 16px; }

    .job { margin: 0 0 6px; }

    .role-company { margin: 0; font-size: 11pt; font-weight: 700; }

    .role-title { margin: 0; font-size: 10.5pt; }

    .role-meta, .project { margin: 0; font-size: 9.5pt; color: #4b5563; }

    ul { margin: 1px 0 0; padding-left: 15px; }
    li { margin: 0 0 1px; }

    .skill-inline { margin: 0 0 1px; }
    .skill-inline .skill-cat { font-weight: 700; }

    .edu-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin: 0 0 3px;
      align-items: baseline;
    }

    .edu-degree { font-weight: 700; }
    .edu-year { white-space: nowrap; font-weight: 700; }
`;

export const splitContactTemplate = {
  id: "split-contact",
  label: "13 · Split Contact",
  description: "Name left, contact right · short section bars · stacked roles.",
  render(data) {
    const name = String(data.name || "Resume").trim() || "Resume";
    const headline = String(data.headline || "").trim();
    const profile = String(data.profile || "").trim();
    const tech = renderTechnicalSummary(data.technicalSummary);
    const skills = renderSkillsInline(data.skills);
    const jobs = renderJobsStacked(data.experience);
    const edu = renderEducationRows(data.education);
    const certs = (data.certifications || []).length ? renderCerts(data.certifications) : "";
    const contact = renderContactBlock(data, { linkColor: "#243044" });

    return wrapHtmlDocument({
      title: `${name} - Resume`,
      css: CSS,
      body: `<main class="resume">
  <header class="top">
    <div class="identity">
      <h1${pathAttr("name")}>${escapeHtml(name)}</h1>
      ${headline ? `<p class="headline"${pathAttr("headline")}>${richHtml(headline)}</p>` : ""}
    </div>
    ${contact}
  </header>
  ${profile ? `<section><h2>Summary</h2><p${pathAttr("profile")}>${richHtml(profile)}</p></section>` : ""}
  ${skills ? `<section><h2>Skills</h2>${skills}</section>` : ""}
  ${jobs ? `<section><h2>Experience</h2>${jobs}</section>` : ""}
  ${tech ? `<section><h2>Highlights</h2>${tech}</section>` : ""}
  ${edu ? `<section><h2>Education</h2>${edu}</section>` : ""}
  ${certs ? `<section><h2>Certifications</h2>${certs}</section>` : ""}
</main>`
    });
  }
};
