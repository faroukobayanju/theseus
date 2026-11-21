import AdmZip from "adm-zip";
import type { EvidenceSummary } from "../types.js";

const EMPTY_EVIDENCE: EvidenceSummary = {
  screenshotDataUri: null,
  consoleErrors: [],
  networkErrors: [],
};

function toEntryArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["entries", "logs", "messages", "requests"]) {
      if (Array.isArray(obj[key])) return obj[key];
    }
    const log = obj.log;
    if (log && typeof log === "object" && Array.isArray((log as Record<string, unknown>).entries)) {
      return (log as Record<string, unknown>).entries as unknown[];
    }
  }
  return [];
}

function extractConsoleErrors(parsed: unknown): string[] {
  const errors: string[] = [];
  for (const item of toEntryArray(parsed)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const level = String(rec.level ?? rec.type ?? "").toLowerCase();
    if (level !== "error") continue;
    const msg = rec.message ?? rec.text;
    errors.push(typeof msg === "string" ? msg : JSON.stringify(msg ?? rec));
  }
  return errors;
}

function extractNetworkErrors(parsed: unknown): Array<{ url: string; status: number }> {
  const errors: Array<{ url: string; status: number }> = [];
  for (const item of toEntryArray(parsed)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const response = rec.response && typeof rec.response === "object"
      ? (rec.response as Record<string, unknown>)
      : undefined;
    const request = rec.request && typeof rec.request === "object"
      ? (rec.request as Record<string, unknown>)
      : undefined;
    const status = Number(rec.status ?? rec.statusCode ?? response?.status);
    if (!Number.isFinite(status) || status < 400) continue;
    const url = String(rec.url ?? request?.url ?? "");
    errors.push({ url, status });
  }
  return errors;
}

export async function extractEvidence(evidenceZipPath: string | null): Promise<EvidenceSummary> {
  if (!evidenceZipPath) {
    return { ...EMPTY_EVIDENCE, consoleErrors: [], networkErrors: [] };
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(evidenceZipPath);
  } catch {
    return { ...EMPTY_EVIDENCE, consoleErrors: [], networkErrors: [] };
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  const pngs = entries
    .filter((e) => e.entryName.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  const preferredPngs = pngs.filter((e) => /(^|\/)screenshots\//i.test(e.entryName));
  const chosenPng = (preferredPngs.length > 0 ? preferredPngs : pngs).at(-1);
  const screenshotDataUri = chosenPng
    ? `data:image/png;base64,${chosenPng.getData().toString("base64")}`
    : null;

  const consoleErrors: string[] = [];
  const networkErrors: Array<{ url: string; status: number }> = [];

  for (const entry of entries) {
    const name = entry.entryName.toLowerCase();
    if (!name.endsWith(".json")) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.getData().toString("utf8"));
    } catch {
      continue;
    }

    if (name.includes("console")) {
      consoleErrors.push(...extractConsoleErrors(parsed));
    } else if (name.includes("network")) {
      networkErrors.push(...extractNetworkErrors(parsed));
    }
  }

  return { screenshotDataUri, consoleErrors, networkErrors };
}
