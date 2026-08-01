/**
 * Shared helpers for Play Console GCS CSV exports (gzip + UTF-16LE).
 */
import zlib from "node:zlib";

export function decodePlayCsvBody(data) {
  let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let text = buf.toString("utf16le");
  if (!text.includes("Date") && !text.includes("Package Name")) {
    text = buf.toString("utf8");
  }
  return text;
}

export function parseCsvLine(line) {
  const cols = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}
