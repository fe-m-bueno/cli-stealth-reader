import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { importCbz } from "../src/parser/cbz.js";
import { importPdf } from "../src/parser/pdf.js";
import { importFile } from "../src/parser/index.js";
import { discoverBooks } from "../src/discovery.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-cbz-test-"));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function makeCbz(dir: string, name: string, imageNames: string[]): Promise<string> {
  const zip = new JSZip();
  for (const img of imageNames) {
    zip.file(img, Buffer.from(`fake-image-data-${img}`));
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function makeMinimalPdf(dir: string, name: string, text = "Hello World"): string {
  const content = `BT /F1 12 Tf 100 700 Td (${text}) Tj ET\n`;
  const stream = `stream\n${content}endstream`;
  const streamLen = Buffer.byteLength(stream, "utf8");

  const objects = [
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`,
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`,
    `3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>}}endobj`,
    `4 0 obj<</Length ${streamLen}>>\n${stream}\nendobj`
  ];

  let pdf = "%PDF-1.0\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj + "\n";
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, pdf, "utf8");
  return filePath;
}

// ── discoverBooks ─────────────────────────────────────────────────────────────

test("discoverBooks finds .epub, .cbz and .pdf files", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "book.epub"), "");
    fs.writeFileSync(path.join(dir, "comic.cbz"), "");
    fs.writeFileSync(path.join(dir, "doc.pdf"), "");
    fs.writeFileSync(path.join(dir, "image.jpg"), "");
    fs.writeFileSync(path.join(dir, "readme.txt"), "");

    const found = await discoverBooks(dir);
    const names = found.map((f) => f.fileName);
    assert.ok(names.includes("book.epub"));
    assert.ok(names.includes("comic.cbz"));
    assert.ok(names.includes("doc.pdf"));
    assert.ok(!names.includes("image.jpg"));
    assert.ok(!names.includes("readme.txt"));
  });
});

test("discoverBooks returns sorted results", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "z.epub"), "");
    fs.writeFileSync(path.join(dir, "a.cbz"), "");
    fs.writeFileSync(path.join(dir, "m.pdf"), "");

    const found = await discoverBooks(dir);
    const names = found.map((f) => f.fileName);
    assert.deepEqual(names, ["a.cbz", "m.pdf", "z.epub"]);
  });
});

test("discoverBooks returns empty array when no supported files exist", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "notes.txt"), "");
    const found = await discoverBooks(dir);
    assert.equal(found.length, 0);
  });
});

// ── importFile dispatcher ─────────────────────────────────────────────────────

test("importFile dispatcher throws for unsupported formats", async () => {
  await assert.rejects(
    () => importFile("/tmp/file.mobi"),
    /Unsupported format/
  );
});

// ── importCbz ─────────────────────────────────────────────────────────────────

test("importCbz creates one chapter per image file", async () => {
  await withTempDir(async (dir) => {
    const cbzPath = await makeCbz(dir, "comic.cbz", ["001.jpg", "002.jpg", "003.jpg"]);
    const book = await importCbz(cbzPath);

    assert.equal(book.title, "comic");
    assert.equal(book.chapters.length, 3);
    assert.equal(book.chapters[0]?.title, "Page 1");
    assert.equal(book.chapters[1]?.title, "Page 2");
    assert.equal(book.chapters[2]?.title, "Page 3");
  });
});

test("importCbz sorts images numerically", async () => {
  await withTempDir(async (dir) => {
    const cbzPath = await makeCbz(dir, "comic.cbz", ["010.jpg", "002.jpg", "001.jpg"]);
    const book = await importCbz(cbzPath);

    const firstBlock = book.chapters[0]?.blocks[0];
    assert.ok(firstBlock?.text.includes("001.jpg"), `Expected 001.jpg first, got: ${firstBlock?.text}`);
  });
});

test("importCbz ignores non-image entries", async () => {
  await withTempDir(async (dir) => {
    const zip = new JSZip();
    zip.file("001.jpg", "fake-image");
    zip.file("readme.txt", "text");
    zip.file("meta.xml", "<xml/>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const cbzPath = path.join(dir, "test.cbz");
    fs.writeFileSync(cbzPath, buf);

    const book = await importCbz(cbzPath);
    assert.equal(book.chapters.length, 1);
  });
});

test("importCbz creates image blocks with correct text", async () => {
  await withTempDir(async (dir) => {
    const cbzPath = await makeCbz(dir, "test.cbz", ["page01.png", "page02.jpg"]);
    const book = await importCbz(cbzPath);

    const block0 = book.chapters[0]?.blocks[0];
    assert.ok(block0?.text.includes("Page 1/2"), `block text: ${block0?.text}`);
    assert.ok(block0?.text.includes("page01.png"), `block text: ${block0?.text}`);
    assert.equal(block0?.type, "image");
  });
});

test("importCbz with empty archive warns and returns 0 chapters", async () => {
  await withTempDir(async (dir) => {
    const zip = new JSZip();
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const cbzPath = path.join(dir, "empty.cbz");
    fs.writeFileSync(cbzPath, buf);

    const book = await importCbz(cbzPath);
    assert.equal(book.chapters.length, 0);
    const hasWarning = book.diagnostics.some((d) => d.severity === "warning" && d.message.toLowerCase().includes("no images"));
    assert.ok(hasWarning, "Expected a warning diagnostic for empty archive");
  });
});

test("importCbz handles non-ZIP file gracefully with error diagnostic", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "fake.cbz");
    fs.writeFileSync(filePath, "this is not a zip file");

    const book = await importCbz(filePath);
    assert.equal(book.chapters.length, 0);
    const hasError = book.diagnostics.some((d) => d.severity === "error");
    assert.ok(hasError, "Expected an error diagnostic for invalid ZIP");
  });
});

test("importCbz sets importHash based on file content", async () => {
  await withTempDir(async (dir) => {
    const path1 = await makeCbz(dir, "a.cbz", ["001.jpg"]);
    const path2 = await makeCbz(dir, "b.cbz", ["002.jpg"]);

    const book1 = await importCbz(path1);
    const book2 = await importCbz(path2);

    assert.notEqual(book1.importHash, book2.importHash);
  });
});

test("importCbz with no images does not generate the OCR diagnostic", async () => {
  await withTempDir(async (dir) => {
    const zip = new JSZip();
    zip.file("readme.txt", "no images here");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const cbzPath = path.join(dir, "text-only.cbz");
    fs.writeFileSync(cbzPath, buf);

    const book = await importCbz(cbzPath);
    const ocrDiag = book.diagnostics.find((d) => d.message.includes("OCR"));
    assert.ok(!ocrDiag, "OCR diagnostic should not appear for empty archive");
  });
});

// ── importPdf ─────────────────────────────────────────────────────────────────

test("importPdf handles unreadable file with error diagnostic", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "broken.pdf");
    fs.writeFileSync(filePath, "not a pdf at all");

    const book = await importPdf(filePath);
    assert.equal(book.chapters.length, 0);
    const hasError = book.diagnostics.some((d) => d.severity === "error");
    assert.ok(hasError, "Expected error diagnostic for invalid PDF");
  });
});

test("importPdf sets title from filename when metadata is absent", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "broken.pdf");
    fs.writeFileSync(filePath, "not a pdf");
    const book = await importPdf(filePath);
    assert.equal(book.title, "broken");
  });
});

test("importPdf sets sourcePath to the file path", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "document.pdf");
    fs.writeFileSync(filePath, "not a pdf");
    const book = await importPdf(filePath);
    assert.equal(book.sourcePath, filePath);
  });
});

test("importPdf returns unique importHash based on content", async () => {
  await withTempDir(async (dir) => {
    const p1 = path.join(dir, "a.pdf");
    const p2 = path.join(dir, "b.pdf");
    fs.writeFileSync(p1, "content A");
    fs.writeFileSync(p2, "content B");
    const book1 = await importPdf(p1);
    const book2 = await importPdf(p2);
    assert.notEqual(book1.importHash, book2.importHash);
  });
});
