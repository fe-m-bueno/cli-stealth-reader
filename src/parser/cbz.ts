import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import type { CanonicalBlock, CanonicalBook, CanonicalChapter, ImportDiagnostic } from "../types.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

export async function importCbz(filePath: string): Promise<CanonicalBook> {
  const buf = await fs.readFile(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const bookId = crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  const importHash = crypto.createHash("sha256").update(buf).digest("hex");
  const diagnostics: ImportDiagnostic[] = [];

  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    diagnostics.push({ severity: "error", message: `Failed to read CBZ archive: ${err instanceof Error ? err.message : String(err)}` });
    return { id: bookId, title: baseName, author: "Unknown", sourcePath: filePath, importHash, parserVersion: 1, diagnostics, chapters: [] };
  }

  const imageFiles = Object.keys(zip.files)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return IMAGE_EXTENSIONS.has(ext) && !zip.files[name]!.dir;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (imageFiles.length === 0) {
    diagnostics.push({ severity: "warning", message: "No images found in CBZ archive." });
  } else {
    diagnostics.push({
      severity: "warning",
      message: `CBZ imported without OCR — ${imageFiles.length} page(s) shown as image placeholders. No text available.`
    });
  }

  const chapters: CanonicalChapter[] = imageFiles.map((imageName, index) => {
    const pageNum = index + 1;
    const shortName = path.basename(imageName);
    const block: CanonicalBlock = {
      id: `${bookId}-p${pageNum}`,
      type: "image",
      text: `[Page ${pageNum}/${imageFiles.length}: ${shortName}]`,
      imageSource: imageName
    };
    return {
      id: `${bookId}-ch${pageNum}`,
      index,
      title: `Page ${pageNum}`,
      href: imageName,
      depth: 0,
      blocks: [block],
      wordCount: 0
    };
  });

  return {
    id: bookId,
    title: baseName,
    author: "Unknown",
    sourcePath: filePath,
    importHash,
    parserVersion: 1,
    diagnostics,
    chapters
  };
}
