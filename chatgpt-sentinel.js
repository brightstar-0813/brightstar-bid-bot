/**
 * ChatGPT sentinel proof-of-work for the logged-in account conversation API.
 * Classic script: chrome.scripting.executeScript injects it, then the page
 * reads globalThis.__brightstarSentinel. No import/export.
 *
 * The conversation endpoint returns HTTP 403 "unusual activity" unless the
 * request carries the chat-requirements token and a solved proof token.
 * Algorithm matches the public chatgpt.com sentinel solver (SHA3-512).
 */
(function brightstarSentinel(root) {
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  const ROT = [
    0, 1, 62, 28, 27,
    36, 44, 6, 55, 20,
    3, 10, 43, 25, 39,
    41, 45, 15, 21, 8,
    18, 2, 61, 56, 14
  ];
  const MASK64 = (1n << 64n) - 1n;

  function rotl(x, n) {
    if (!n) return x;
    const s = BigInt(n);
    return ((x << s) | (x >> (64n - s))) & MASK64;
  }

  function keccakF(a) {
    for (let round = 0; round < 24; round++) {
      const c = new Array(5);
      for (let x = 0; x < 5; x++) {
        c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
      }
      const d = new Array(5);
      for (let x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let i = 0; i < 25; i++) a[i] ^= d[i % 5];
      const b = new Array(25);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
        }
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          a[x + 5 * y] = b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y]) & b[((x + 2) % 5) + 5 * y]) & MASK64;
        }
      }
      a[0] = (a[0] ^ RC[round]) & MASK64;
    }
  }

  function xorRate(state, block) {
    for (let i = 0; i < block.length; i += 8) {
      let lane = 0n;
      for (let b = 0; b < 8 && i + b < block.length; b++) lane |= BigInt(block[i + b]) << BigInt(8 * b);
      const idx = i >> 3;
      state[idx] = (state[idx] ^ lane) & MASK64;
    }
  }

  function sha3_512(data) {
    const msg = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const rate = 72;
    const state = new Array(25).fill(0n);
    let offset = 0;
    while (offset + rate <= msg.length) {
      xorRate(state, msg.subarray(offset, offset + rate));
      keccakF(state);
      offset += rate;
    }
    const last = new Uint8Array(rate);
    last.set(msg.subarray(offset));
    last[msg.length - offset] ^= 0x06;
    last[rate - 1] ^= 0x80;
    xorRate(state, last);
    keccakF(state);
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i++) out[i] = Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
    return out;
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function comparePrefix(hash, target) {
    const n = Math.min(hash.length, target.length);
    for (let i = 0; i < n; i++) {
      if (hash[i] !== target[i]) return hash[i] < target[i] ? -1 : 1;
    }
    return hash.length === target.length ? 0 : hash.length < target.length ? -1 : 1;
  }

  function compact(arr, start, end) {
    return JSON.stringify(arr.slice(start, end == null ? arr.length : end)).slice(1, -1);
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function parseTime() {
    const now = new Date(Date.now() - 5 * 3600 * 1000);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => String(n).padStart(2, "0");
    return `${days[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} GMT-0500 (Eastern Standard Time)`;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function buildConfig(userAgent) {
    const nav = [
      "hardwareConcurrency−8",
      "language−en-US",
      "webdriver−false",
      "vendor−Google Inc.",
      "pdfViewerEnabled−true"
    ];
    return [
      pick([3000, 4000, 3120, 4160]),
      parseTime(),
      4294705152,
      0,
      userAgent || "Mozilla/5.0",
      "",
      "",
      "en-US",
      "en-US,en",
      0,
      pick(nav),
      "location",
      "document",
      (typeof performance !== "undefined" ? performance.now() : 12),
      (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000"),
      "",
      pick([8, 16, 24, 32]),
      Date.now()
    ];
  }

  function generateAnswer(seed, diff, config) {
    const target = hexToBytes(String(diff || ""));
    const sliceLen = String(diff || "").length;
    const part1 = `[${compact(config, 0, 3)},`;
    const part2 = `,${compact(config, 4, 9)},`;
    const part3 = `,${compact(config, 10)}]`;
    const seedText = String(seed);
    for (let i = 0; i < 500000; i++) {
      const finalStr = part1 + String(i) + part2 + String(i >> 1) + part3;
      const baseEncoded = toBase64(finalStr);
      const hash = sha3_512(seedText + baseEncoded);
      if (comparePrefix(hash.subarray(0, sliceLen), target) <= 0) return baseEncoded;
    }
    return `wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D${toBase64(JSON.stringify(seedText))}`;
  }

  function solvePow(seed, difficulty, userAgent) {
    const config = buildConfig(userAgent);
    return `gAAAAAB${generateAnswer(seed, difficulty, config)}`;
  }

  function getRequirementsToken(userAgent) {
    const config = buildConfig(userAgent);
    return `gAAAAAC${generateAnswer(String(Math.random()), "0fffff", config)}`;
  }

  const api = { sha3_512, solvePow, getRequirementsToken };
  root.__brightstarSentinel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
