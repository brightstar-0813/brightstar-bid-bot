/**
 * Store-only DOCX writer for a saved resume JSON.
 * Same emphasis, font, and size as the preview. One column. No images or colors.
 */

import { personOutputNameToken } from "./resume-profile.js";
import { plainTextFromRich, sanitizeRichHtml, decodeRichEntities } from "./resume-rich.js";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

function u16(n) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, n, true);
  return bytes;
}

function u32(n) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n >>> 0, true);
  return bytes;
}

function concat(parts) {
  const list = parts.filter(Boolean);
  const len = list.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of list) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ])
    );
    offset += local.length;
  }
  const central = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0)
  ]);
  return concat([...locals, central, eocd]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readStyle(attrs, prop) {
  const match = String(attrs || "").match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i"));
  return match ? match[1].trim() : "";
}

/**
 * Turn sanitized HTML into paragraphs of runs.
 * @param {string} html
 * @param {{ bold?: boolean, italic?: boolean, size?: number, font?: string }} [defaults]
 */
export function richHtmlToParagraphs(html, defaults = {}) {
  const clean = sanitizeRichHtml(html);
  const paragraphs = [];
  let runs = [];
  const style = {
    bold: Boolean(defaults.bold),
    italic: Boolean(defaults.italic),
    underline: false,
    font: defaults.font || "",
    size: defaults.size || 0,
    align: "left"
  };
  const stack = [];

  function pushText(text) {
    const value = decodeRichEntities(text);
    if (!value) return;
    runs.push({
      text: value,
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      font: style.font,
      size: style.size
    });
  }

  function flush() {
    if (!runs.length) return;
    paragraphs.push({ align: style.align, runs });
    runs = [];
  }

  const re = /<\/?([a-zA-Z]+)\b([^>]*)>|([^<]+)/g;
  let match;
  while ((match = re.exec(clean))) {
    if (match[3] != null) {
      pushText(match[3]);
      continue;
    }
    const name = match[1].toLowerCase();
    const close = match[0].startsWith("</");
    if (close) {
      if (name === "p" || name === "div") flush();
      const prev = stack.pop();
      if (prev) Object.assign(style, prev);
      continue;
    }
    if (name === "br") {
      flush();
      continue;
    }
    if (name === "b" || name === "i" || name === "u" || name === "span" || name === "p" || name === "div") {
      stack.push({ ...style });
      if (name === "b") style.bold = true;
      if (name === "i") style.italic = true;
      if (name === "u") style.underline = true;
      if (name === "span") {
        const font = readStyle(match[2], "font-family");
        const size = readStyle(match[2], "font-size").match(/([0-9.]+)/);
        if (font) style.font = font;
        if (size) style.size = Number(size[1]);
      }
      if (name === "p" || name === "div") {
        const nextAlign = readStyle(match[2], "text-align").toLowerCase();
        if (nextAlign === "center" || nextAlign === "left") style.align = nextAlign;
      }
    }
  }
  flush();
  if (!paragraphs.length) paragraphs.push({ align: "left", runs: [{ text: "" }] });
  return paragraphs;
}

function runXml(run) {
  const props = [];
  if (run.bold) props.push("<w:b/>");
  if (run.italic) props.push("<w:i/>");
  if (run.underline) props.push('<w:u w:val="single"/>');
  if (run.font) {
    const font = xmlEscape(run.font);
    props.push(`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`);
  }
  if (run.size) {
    const half = Math.round(Number(run.size) * 2);
    props.push(`<w:sz w:val="${half}"/>`, `<w:szCs w:val="${half}"/>`);
  }
  const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
}

function paragraphXml(paragraph, { after = 80 } = {}) {
  const align = paragraph.align === "center" ? "center" : "left";
  const runs = (paragraph.runs || []).map(runXml).join("");
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
}

function fieldParagraphs(html, defaults, after) {
  const text = plainTextFromRich(html);
  if (!text) return "";
  return richHtmlToParagraphs(html, defaults)
    .map((paragraph) => paragraphXml(paragraph, { after }))
    .join("");
}

function plainParagraph(text, defaults, after) {
  const value = String(text || "").trim();
  if (!value) return "";
  return paragraphXml(
    { align: "left", runs: [{ text: value, ...defaults }] },
    { after }
  );
}

export function resumeDocumentXml(resume = {}) {
  const headingAlign = resume.headingAlign === "center" ? "center" : "left";
  const chunks = [];
  chunks.push(
    plainParagraph(resume.name, { bold: true, size: 16, font: "Calibri" }, 40)
  );
  chunks.push(fieldParagraphs(resume.headline, { size: 12, font: "Calibri" }, 80));
  const contact = [resume.location, resume.phone, resume.email, resume.linkedin]
    .map((part) => plainTextFromRich(part))
    .filter(Boolean)
    .join("  |  ");
  chunks.push(plainParagraph(contact, { size: 10, font: "Calibri" }, 160));
  chunks.push(fieldParagraphs(resume.profile, { size: 11, font: "Calibri" }, 160));

  const sections = [];
  if (Array.isArray(resume.skills) && resume.skills.length) {
    sections.push(["Skills", skillLines(resume.skills)]);
  }
  if (Array.isArray(resume.experience) && resume.experience.length) {
    sections.push(["Experience", experienceLines(resume.experience)]);
  }
  if (Array.isArray(resume.education) && resume.education.length) {
    sections.push(["Education", educationLines(resume.education)]);
  }
  if (Array.isArray(resume.certifications) && resume.certifications.length) {
    sections.push(["Certifications", certLines(resume.certifications)]);
  }
  if (Array.isArray(resume.technicalSummary) && resume.technicalSummary.length) {
    sections.push(["Technical summary", summaryLines(resume.technicalSummary)]);
  }

  for (const [title, body] of sections) {
    if (!body) continue;
    chunks.push(
      paragraphXml(
        {
          align: headingAlign,
          runs: [{ text: title, bold: true, size: 12, font: "Calibri" }]
        },
        { after: 60 }
      )
    );
    chunks.push(body);
  }

  const body = chunks.filter(Boolean).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function skillLines(skills) {
  return skills
    .map((row) => {
      const category = plainTextFromRich(row?.category);
      const items = String(row?.items || "");
      if (!category && !plainTextFromRich(items)) return "";
      const label = category ? `${category}: ` : "";
      return fieldParagraphs(
        category ? `${label}${items}` : items,
        { size: 11, font: "Calibri" },
        40
      );
    })
    .join("");
}

function experienceLines(jobs) {
  return jobs
    .map((job) => {
      const title = [job?.title, job?.company].filter((part) => plainTextFromRich(part)).join(" — ");
      const meta = [plainTextFromRich(job?.location), plainTextFromRich(job?.dates)]
        .filter(Boolean)
        .join("  |  ");
      const bits = [
        fieldParagraphs(title, { bold: true, size: 11, font: "Calibri" }, 20),
        plainParagraph(meta, { size: 10, font: "Calibri" }, 40),
        fieldParagraphs(job?.project, { italic: true, size: 11, font: "Calibri" }, 40),
        ...(Array.isArray(job?.bullets) ? job.bullets : []).map((bullet) =>
          fieldParagraphs(bullet, { size: 11, font: "Calibri" }, 40)
        )
      ];
      return bits.filter(Boolean).join("");
    })
    .join("");
}

function educationLines(rows) {
  return rows
    .map((row) => {
      const line = [row?.degree, row?.school, row?.year, row?.location]
        .filter((part) => plainTextFromRich(part))
        .join(" — ");
      return fieldParagraphs(line, { size: 11, font: "Calibri" }, 40);
    })
    .join("");
}

function certLines(certs) {
  return certs
    .map((cert) => {
      const label =
        cert && typeof cert === "object"
          ? cert.name || cert.title || cert.label || ""
          : cert;
      return fieldParagraphs(label, { size: 11, font: "Calibri" }, 40);
    })
    .join("");
}

function summaryLines(items) {
  return items
    .map((item) => fieldParagraphs(item, { size: 11, font: "Calibri" }, 40))
    .join("");
}

export function resumeDocxFileName(resume = {}) {
  const token = personOutputNameToken({ name: resume?.name || "" });
  const safe = String(token || "Applicant").replace(/[^A-Za-z0-9]+/g, "") || "Applicant";
  return `${safe}_Resume.docx`;
}

/** @returns {Uint8Array} */
export function buildResumeDocx(resume = {}) {
  const encoder = new TextEncoder();
  return zipStore([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(RELS) },
    { name: "word/document.xml", data: encoder.encode(resumeDocumentXml(resume)) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(DOC_RELS) }
  ]);
}
