import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { importEpub } from "../src/parser/epub.js";

async function createFixture(): Promise<string> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<!doctype html><html><body><nav epub:type="toc"><ol>
      <li><a href="text/ch1.xhtml#start">Chapter One</a></li>
      <li><a href="text/ch1.xhtml#middle">Chapter Two</a></li>
    </ol></nav></body></html>`
  );
  zip.file(
    "OEBPS/text/ch1.xhtml",
    `<!doctype html><html><body>
      <h1 id="start">One</h1>
      <p>First chapter begins here.</p>
      <h2 id="middle">Two</h2>
      <p>Second chapter begins here.</p>
    </body></html>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Fixture Book</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="chapter" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-"));
  const filePath = path.join(dir, "fixture.epub");
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function createSameFileFrontmatterFixture(): Promise<string> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<!doctype html><html><body><nav epub:type="toc"><ol>
      <li><a href="text/ch1.xhtml">Chapter One</a></li>
      <li><a href="text/ch1.xhtml#chapter2">Chapter Two</a></li>
    </ol></nav></body></html>`
  );
  zip.file(
    "OEBPS/text/ch1.xhtml",
    `<!doctype html><html><body>
      <img alt="Cover image" src="cover.jpg" />
      <p>Front matter that should not appear in chapter one.</p>
      <h1 id="chapter1">One</h1>
      <p>First chapter begins here.</p>
      <h2 id="chapter2">Two</h2>
      <p>Second chapter begins here.</p>
    </body></html>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Frontmatter Fixture</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="chapter" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-frontmatter-"));
  const filePath = path.join(dir, "fixture.epub");
  await fs.writeFile(filePath, buffer);
  return filePath;
}

test("imports epub and splits same-file anchor chapters", async () => {
  const epubPath = await createFixture();
  const book = await importEpub(epubPath);
  assert.equal(book.title, "Fixture Book");
  assert.equal(book.chapters.length, 2);
  assert.match(book.chapters[0].blocks.map((block) => block.text).join(" "), /First chapter/);
  assert.match(book.chapters[1].blocks.map((block) => block.text).join(" "), /Second chapter/);
});

test("skips front matter before the first chapter anchor when toc starts at file root", async () => {
  const epubPath = await createSameFileFrontmatterFixture();
  const book = await importEpub(epubPath);
  assert.equal(book.chapters.length, 2);
  const firstChapterText = book.chapters[0].blocks.map((block) => block.text).join(" ");
  assert.doesNotMatch(firstChapterText, /Front matter/);
  assert.doesNotMatch(firstChapterText, /Cover image/);
  assert.match(firstChapterText, /First chapter begins here/);
});
