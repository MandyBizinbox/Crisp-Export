import fs from "node:fs";
import { stringify } from "node:querystring";

/** extremely small CSV helper (no extra deps) */
export function writeCSV(filepath, rows) {
  const fh = fs.openSync(filepath, "w");
  try {
    const headers = buildHeaders(rows);
    if (headers.length) {
      fs.writeFileSync(fh, headers.join(",") + "\n");
      for (const row of rows) {
        const line = headers.map((h) => csvCell(row[h]));
        fs.writeFileSync(fh, line.join(",") + "\n");
      }
    }
  } finally {
    fs.closeSync(fh);
  }
  return filepath;
}

function buildHeaders(rows) {
  const set = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) set.add(k);
  }
  return Array.from(set);
}

function csvCell(val) {
  if (val === null || typeof val === "undefined") return "";
  if (typeof val === "string") return quoteIfNeeded(val);
  return quoteIfNeeded(JSON.stringify(val));
}

function quoteIfNeeded(s) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
