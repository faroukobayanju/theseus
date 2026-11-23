import AdmZip from "adm-zip";
import type { EvidenceSummary, KaneBugFinding } from "../types.js";

const EMPTY_EVIDENCE: EvidenceSummary = {
  screenshotDataUri: null,
  consoleErrors: [],
  networkErrors: [],
};

function toEntryArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["entries", "logs", "messages", "requests", "bugs", "findings"]) {
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

function extractBugs(parsed: unknown): KaneBugFinding[] {
  const bugs: KaneBugFinding[] = [];
  for (const item of toEntryArray(parsed)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = String(rec.title ?? rec.summary ?? rec.message ?? "").trim();
    if (!title) continue;
    bugs.push({
      title,
      severity: typeof rec.severity === "string" ? rec.severity : undefined,
      detail: typeof rec.detail === "string" ? rec.detail : undefined,
    });
  }
  return bugs;
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

  const images = entries
    .filter((e) => /\.(png|jpe?g)$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  const preferredImages = images.filter(
    (e) => /(^|\/)screenshots\//i.test(e.entryName) || /annotated\.png$/i.test(e.entryName),
  );
  const chosenImage = (preferredImages.length > 0 ? preferredImages : images).at(-1);
  const mime = chosenImage && /\.jpe?g$/i.test(chosenImage.entryName) ? "image/jpeg" : "image/png";
  const screenshotDataUri = chosenImage
    ? `data:${mime};base64,${chosenImage.getData().toString("base64")}`
    : null;

  const consoleErrors: string[] = [];
  const networkErrors: Array<{ url: string; status: number }> = [];
  const bugsDetected: KaneBugFinding[] = [];

  for (const entry of entries) {
    const name = entry.entryName.toLowerCase();
    const isJson = name.endsWith(".json") || name.endsWith(".har");
    const isNdjson = name.endsWith(".ndjson");
    if (!isJson && !isNdjson) continue;

    const raw = entry.getData().toString("utf8");
    const parsedItems: unknown[] = [];

    if (isNdjson) {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          parsedItems.push(JSON.parse(trimmed));
        } catch {
          // ignore malformed line
        }
      }
    } else {
      try {
        parsedItems.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }

    if (name.includes("console")) {
      if (isNdjson) {
        consoleErrors.push(...extractConsoleErrors(parsedItems));
      } else {
        for (const item of parsedItems) consoleErrors.push(...extractConsoleErrors(item));
      }
    } else if (name.includes("network")) {
      for (const item of parsedItems) networkErrors.push(...extractNetworkErrors(item));
    } else if (name.includes("bug")) {
      for (const item of parsedItems) bugsDetected.push(...extractBugs(item));
    }
  }

  return bugsDetected.length > 0
    ? { screenshotDataUri, consoleErrors, networkErrors, bugsDetected }
    : { screenshotDataUri, consoleErrors, networkErrors };
}
