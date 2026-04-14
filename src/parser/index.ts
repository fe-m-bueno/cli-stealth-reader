import type { CanonicalBook } from "../types.js";
import { importEpub } from "./epub.js";
import { importCbz } from "./cbz.js";
import { importPdf } from "./pdf.js";

export async function importFile(filePath: string): Promise<CanonicalBook> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".epub")) return importEpub(filePath);
  if (lower.endsWith(".cbz")) return importCbz(filePath);
  if (lower.endsWith(".pdf")) return importPdf(filePath);
  throw new Error(`Unsupported format: ${filePath}`);
}
