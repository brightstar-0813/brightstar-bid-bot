/**
 * Load master resume from pasted text or uploaded .txt / .md / .pdf / .docx.
 * Returns plain text for {MASTER_RESUME} — never expects resume JSON.
 */

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

async function inflateRaw(compressed) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress DOCX. Paste resume text instead.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([compressed]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Minimal ZIP reader for DOCX (finds word/document.xml).
 * @param {ArrayBuffer} arrayBuffer
 */
async function unzipFindFile(arrayBuffer, wantedName) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const compression = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decodeUtf8(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    const data = bytes.subarray(dataStart, dataEnd);

    if (name === wantedName || name.endsWith("/" + wantedName)) {
      if (compression === 0) return data;
      if (compression === 8) return inflateRaw(data);
      throw new Error(`Unsupported ZIP compression (${compression}) in DOCX.`);
    }

    offset = dataEnd;
  }

  throw new Error(`Could not find ${wantedName} inside the DOCX.`);
}

function stripXmlToText(xml) {
  return String(xml || "")
    .replace(/<w:tab[^/]*\/>/gi, "\t")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<w:br[^/]*\/>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractDocxText(arrayBuffer) {
  const xmlBytes = await unzipFindFile(arrayBuffer, "word/document.xml");
  return stripXmlToText(decodeUtf8(xmlBytes));
}

/**
 * Best-effort PDF text extraction (works for many text-based PDFs).
 * Scanned/image PDFs will yield little text — user can paste manually.
 */
function extractPdfText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let raw = "";
  // Latin-1 decode keeps binary stream markers readable for regex
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i]);
  }

  const chunks = [];

  // Uncompressed stream objects
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(raw))) {
    const body = m[1];
    // Tj / TJ string operators
    const tjRe = /\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ/g;
    let tj;
    while ((tj = tjRe.exec(body))) {
      const token = tj[0];
      if (token.endsWith("Tj")) {
        const inner = token.slice(1, token.lastIndexOf(")"));
        chunks.push(unescapePdfString(inner));
      } else {
        const arr = token.slice(1, token.indexOf("]"));
        const parts = [];
        const strRe = /\((?:\\.|[^\\)])*\)/g;
        let s;
        while ((s = strRe.exec(arr))) {
          parts.push(unescapePdfString(s[0].slice(1, -1)));
        }
        chunks.push(parts.join(""));
      }
    }
  }

  // Also catch literal strings outside streams (rare)
  if (!chunks.length) {
    const loose = raw.match(/\((?:\\.|[^\\)]){3,}\)\s*Tj/g) || [];
    for (const token of loose) {
      const inner = token.slice(1, token.lastIndexOf(")"));
      chunks.push(unescapePdfString(inner));
    }
  }

  const text = chunks
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length < 40) {
    throw new Error(
      "Could not extract enough text from this PDF (it may be scanned). Paste the resume as text, or upload a .txt / .docx instead."
    );
  }
  return text;
}

function unescapePdfString(s) {
  return String(s || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/**
 * @param {File} file
 * @returns {Promise<{ text: string, fileName: string }>}
 */
export async function extractMasterResumeFromFile(file) {
  if (!file) throw new Error("No file selected.");
  const name = file.name || "resume";
  const lower = name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".rtf")) {
    const text = decodeUtf8(new Uint8Array(buf)).trim();
    if (!text) throw new Error("The text file is empty.");
    return { text, fileName: name };
  }

  if (lower.endsWith(".docx")) {
    const text = await extractDocxText(buf);
    if (!text) throw new Error("No text found in the DOCX.");
    return { text, fileName: name };
  }

  if (lower.endsWith(".pdf")) {
    const text = extractPdfText(buf);
    return { text, fileName: name };
  }

  if (lower.endsWith(".doc")) {
    throw new Error(
      "Old .doc format is not supported. Save as .docx, .pdf, or .txt, or paste the resume text."
    );
  }

  // Unknown extension: try as UTF-8 text
  const asText = decodeUtf8(new Uint8Array(buf)).trim();
  if (asText.length > 40 && !asText.includes("\u0000")) {
    return { text: asText, fileName: name };
  }

  throw new Error("Unsupported file. Use .txt, .md, .docx, or .pdf — or paste resume text.");
}

export const MASTER_RESUME_ACCEPT = ".txt,.md,.rtf,.pdf,.docx,text/plain,application/pdf";
