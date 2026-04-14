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

async function createPlayOrderFixture(): Promise<string> {
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
    "OEBPS/toc.ncx",
    `<?xml version="1.0"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <navMap>
        <navPoint id="front" playOrder="10">
          <navLabel><text>Front Matter</text></navLabel>
          <content src="text/front.xhtml"/>
        </navPoint>
        <navPoint id="chapter" playOrder="1">
          <navLabel><text>Chapter One</text></navLabel>
          <content src="text/ch1.xhtml"/>
        </navPoint>
      </navMap>
    </ncx>`
  );
  zip.file("OEBPS/text/front.xhtml", "<!doctype html><html><body><p>Front matter.</p></body></html>");
  zip.file("OEBPS/text/ch1.xhtml", "<!doctype html><html><body><h1>One</h1><p>Chapter text.</p></body></html>");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="2.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Play Order Fixture</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="front" href="text/front.xhtml" media-type="application/xhtml+xml"/>
        <item id="chapter" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="ncx">
        <itemref idref="front"/>
        <itemref idref="chapter"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-playorder-"));
  const filePath = path.join(dir, "fixture.epub");
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function createSplitSpineChapterFixture(): Promise<string> {
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
      <li><a href="text/ch1-title.xhtml">Chapter One</a></li>
      <li><a href="text/ch2-title.xhtml">Chapter Two</a></li>
    </ol></nav></body></html>`
  );
  zip.file("OEBPS/text/ch1-title.xhtml", '<!doctype html><html><body><figure><img src="title.jpg" alt=""/></figure></body></html>');
  zip.file("OEBPS/text/ch1-body.xhtml", "<!doctype html><html><body><p>First chapter body text lives in the next spine file.</p></body></html>");
  zip.file("OEBPS/text/ch2-title.xhtml", '<!doctype html><html><body><figure><img src="title.jpg" alt=""/></figure></body></html>');
  zip.file("OEBPS/text/ch2-body.xhtml", "<!doctype html><html><body><p>Second chapter body text lives in the next spine file.</p></body></html>");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Split Spine Fixture</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1title" href="text/ch1-title.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch1body" href="text/ch1-body.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2title" href="text/ch2-title.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2body" href="text/ch2-body.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="ch1title"/>
        <itemref idref="ch1body"/>
        <itemref idref="ch2title"/>
        <itemref idref="ch2body"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-splitspine-"));
  const filePath = path.join(dir, "fixture.epub");
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function createNestedAnchorFixture(): Promise<string> {
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
      <li><a href="text/ch.xhtml#chapter1">Chapter One</a></li>
      <li><a href="text/ch.xhtml#chapter2">Chapter Two</a></li>
    </ol></nav></body></html>`
  );
  zip.file(
    "OEBPS/text/ch.xhtml",
    `<!doctype html><html><body>
      <p class="chapter"><a id="chapter1">1</a></p>
      <p>First chapter text.</p>
      <p class="chapter"><a id="chapter2">2</a></p>
      <p>Second chapter text.</p>
    </body></html>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Nested Anchor Fixture</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="chapter" href="text/ch.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-nested-anchor-"));
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

test("respects NCX playOrder instead of raw XML order", async () => {
  const epubPath = await createPlayOrderFixture();
  const book = await importEpub(epubPath);
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0]?.title, "Chapter One");
  assert.match(book.chapters[0]?.blocks.map((block) => block.text).join(" ") ?? "", /Chapter text/);
});

test("stitches chapters across consecutive spine files until the next toc entry", async () => {
  const epubPath = await createSplitSpineChapterFixture();
  const book = await importEpub(epubPath);
  assert.equal(book.chapters.length, 2);
  assert.equal(book.chapters[0]?.blocks[0]?.type, "heading");
  assert.equal(book.chapters[0]?.blocks[0]?.text, "Chapter One");
  assert.match(book.chapters[0]?.blocks.map((block) => block.text).join(" ") ?? "", /First chapter body text/);
  assert.equal(book.chapters[1]?.blocks[0]?.type, "heading");
  assert.equal(book.chapters[1]?.blocks[0]?.text, "Chapter Two");
  assert.match(book.chapters[1]?.blocks.map((block) => block.text).join(" ") ?? "", /Second chapter body text/);
});

test("splits same-file chapters when anchors are nested inside block elements", async () => {
  const epubPath = await createNestedAnchorFixture();
  const book = await importEpub(epubPath);
  assert.equal(book.chapters.length, 2);
  assert.match(book.chapters[0]?.blocks.map((block) => block.text).join(" ") ?? "", /First chapter text/);
  assert.doesNotMatch(book.chapters[0]?.blocks.map((block) => block.text).join(" ") ?? "", /Second chapter text/);
  assert.match(book.chapters[1]?.blocks.map((block) => block.text).join(" ") ?? "", /Second chapter text/);
});
