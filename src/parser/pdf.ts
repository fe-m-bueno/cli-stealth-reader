import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import type { CanonicalBlock, CanonicalBook, CanonicalChapter, ImportDiagnostic } from "../types.js";

export async function importPdf(filePath: string): Promise<CanonicalBook> {
  const buf = await fs.readFile(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const bookId = crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  const importHash = crypto.createHash("sha256").update(buf).digest("hex");

  const diagnostics: ImportDiagnostic[] = [];
  let parsed: { pageTexts: string[]; numpages: number; info: Record<string, string> };
  const parser = new PDFParse({ data: buf });

  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    parsed = {
      pageTexts: textResult.pages.map((page) => page.text),
      numpages: textResult.total,
      info: infoResult.info ?? {}
    };
  } catch (err) {
    diagnostics.push({
      severity: "error",
      message: `Failed to parse PDF: ${err instanceof Error ? err.message : String(err)}`
    });
    return {
      id: bookId,
      title: baseName,
      author: "Unknown",
      sourcePath: filePath,
      importHash,
      parserVersion: 1,
      diagnostics,
      chapters: []
    };
  } finally {
    await parser.destroy().catch(() => {});
  }

  const totalPages = parsed.numpages ?? parsed.pageTexts.length;
  const cappedTexts = parsed.pageTexts.slice(0, totalPages);

  const chapters: CanonicalChapter[] = [];
  for (let i = 0; i < totalPages; i++) {
    const rawText = (cappedTexts[i] ?? "").trim();
    const blocks: CanonicalBlock[] = [];

    if (!rawText) {
      diagnostics.push({ severity: "warning", message: `Page ${i + 1} has no extractable text (may be an image-only page).` });
      blocks.push({
        id: `${bookId}-p${i + 1}-empty`,
        type: "paragraph",
        text: `[Page ${i + 1}: no text content]`
      });
    } else {
      const paragraphs = rawText.split(/\n{2,}/).map((p: string) => p.replace(/\n/g, " ").trim()).filter(Boolean);
      for (let j = 0; j < paragraphs.length; j++) {
        blocks.push({
          id: `${bookId}-p${i + 1}-b${j}`,
          type: "paragraph",
          text: paragraphs[j]!
        });
      }
    }

    chapters.push({
      id: `${bookId}-ch${i + 1}`,
      index: i,
      title: `Page ${i + 1}`,
      href: `page-${i + 1}`,
      depth: 0,
      blocks,
      wordCount: rawText.split(/\s+/).filter(Boolean).length
    });
  }

  return {
    id: bookId,
    title: parsed.info?.Title || baseName,
    author: parsed.info?.Author || "Unknown",
    sourcePath: filePath,
    importHash,
    parserVersion: 1,
    diagnostics,
    chapters
  };
}
