import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { ensureArray, parseXml } from "./xml.js";
import { extractBlocksFromHtml, sliceBlocksByAnchors } from "./html.js";
import type { CanonicalBook, CanonicalChapter, CanonicalBlock, ImportDiagnostic } from "../types.js";

interface ContainerXml {
  container: {
    rootfiles: {
      rootfile: {
        "full-path": string;
      };
    };
  };
}

interface PackageXml {
  package: {
    metadata?: {
      title?: string | { "#text"?: string };
      creator?: string | { "#text"?: string };
      meta?: unknown;
    };
    manifest?: {
      item?: Array<{ id: string; href: string; "media-type"?: string; properties?: string }> | { id: string; href: string; "media-type"?: string; properties?: string };
    };
    spine?: {
      itemref?: Array<{ idref: string }> | { idref: string };
      toc?: string;
    };
  };
}

interface NcxNavPoint {
  navLabel?: { text?: string };
  content?: { src?: string };
  navPoint?: NcxNavPoint[] | NcxNavPoint;
}

interface NcxXml {
  ncx: {
    navMap?: {
      navPoint?: NcxNavPoint[] | NcxNavPoint;
    };
  };
}

interface TocItem {
  label: string;
  href: string;
  depth: number;
}

function getTextValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: string })["#text"];
    return text ?? "";
  }
  return "";
}

function normalizeHref(baseDir: string, href: string): string {
  return path.posix.normalize(path.posix.join(baseDir, href));
}

function splitHref(href: string): { basePath: string; fragment?: string } {
  const [basePath, fragment] = href.split("#");
  return { basePath, fragment };
}

function wordCount(blocks: CanonicalBlock[]): number {
  return blocks.reduce((sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length, 0);
}

async function readZipText(zip: JSZip, zipPath: string): Promise<string> {
  const file = zip.file(zipPath);
  if (!file) {
    throw new Error(`Missing archive entry: ${zipPath}`);
  }
  return file.async("text");
}

function flattenNavPoints(points: NcxNavPoint[] | NcxNavPoint | undefined, depth: number): TocItem[] {
  const list = ensureArray(points);
  const items: TocItem[] = [];
  for (const point of list) {
    const href = point.content?.src;
    if (!href) {
      continue;
    }
    items.push({
      label: point.navLabel?.text?.trim() || "Untitled chapter",
      href,
      depth
    });
    if (point.navPoint) {
      items.push(...flattenNavPoints(point.navPoint, depth + 1));
    }
  }
  return items;
}

function collectNavAnchors(htmlSource: string): TocItem[] {
  const matches = Array.from(htmlSource.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis));
  return matches.map((match) => ({
    href: match[1],
    label: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "Untitled chapter",
    depth: 0
  }));
}

export async function importEpub(epubPath: string): Promise<CanonicalBook> {
  const raw = await fs.readFile(epubPath);
  const importHash = crypto.createHash("sha256").update(raw).digest("hex");
  const zip = await JSZip.loadAsync(raw);
  const diagnostics: ImportDiagnostic[] = [];

  const mimetype = await readZipText(zip, "mimetype").catch(() => "");
  if (mimetype.trim() !== "application/epub+zip") {
    diagnostics.push({
      severity: "warning",
      message: "Archive mimetype is missing or not application/epub+zip.",
      context: "mimetype"
    });
  }

  const container = parseXml<ContainerXml>(await readZipText(zip, "META-INF/container.xml"));
  const opfPath = container.container.rootfiles.rootfile["full-path"];
  const opfDir = path.posix.dirname(opfPath);
  const opf = parseXml<PackageXml>(await readZipText(zip, opfPath));
  const metadata = opf.package.metadata ?? {};
  const title = getTextValue(metadata.title) || path.basename(epubPath, ".epub");
  const author = getTextValue(metadata.creator) || "Unknown author";
  const manifestItems = ensureArray(opf.package.manifest?.item);
  const manifestMap = new Map(manifestItems.map((item) => [item.id, item]));
  const spine = ensureArray(opf.package.spine?.itemref);

  let tocItems: TocItem[] = [];
  const navItem = manifestItems.find((item) => item.properties?.includes("nav"));
  if (navItem) {
    const navHtml = await readZipText(zip, normalizeHref(opfDir, navItem.href));
    tocItems = collectNavAnchors(navHtml);
  } else {
    const tocId = opf.package.spine?.toc;
    const ncxItem = tocId ? manifestMap.get(tocId) : manifestItems.find((item) => item["media-type"]?.includes("ncx"));
    if (ncxItem) {
      const ncx = parseXml<NcxXml>(await readZipText(zip, normalizeHref(opfDir, ncxItem.href)));
      tocItems = flattenNavPoints(ncx.ncx.navMap?.navPoint, 0);
    }
  }

  if (tocItems.length === 0) {
    diagnostics.push({
      severity: "warning",
      message: "Navigation document is missing or unreadable. Falling back to spine order.",
      context: "navigation"
    });
    tocItems = spine.flatMap((item, index) => {
      const manifest = manifestMap.get(item.idref);
      if (!manifest) {
        return [];
      }
      return [{
        label: `Chapter ${index + 1}`,
        href: manifest.href,
        depth: 0
      }];
    });
  }

  const normalizedToc = tocItems.map((item) => ({
    ...item,
    href: normalizeHref(opfDir, item.href)
  }));

  const fileBlocks = new Map<string, CanonicalBlock[]>();
  async function getBlocksForFile(basePath: string): Promise<CanonicalBlock[]> {
    const cached = fileBlocks.get(basePath);
    if (cached) {
      return cached;
    }
    const html = await readZipText(zip, basePath);
    const blocks = extractBlocksFromHtml(html, crypto.createHash("md5").update(basePath).digest("hex").slice(0, 8));
    fileBlocks.set(basePath, blocks);
    return blocks;
  }

  const chapters: CanonicalChapter[] = [];
  for (let index = 0; index < normalizedToc.length; index += 1) {
    const item = normalizedToc[index];
    const current = splitHref(item.href);
    const next = normalizedToc[index + 1] ? splitHref(normalizedToc[index + 1].href) : undefined;
    const baseBlocks = await getBlocksForFile(current.basePath);
    let blocks = baseBlocks;
    if (current.fragment || (next && next.basePath === current.basePath && next.fragment)) {
      blocks = sliceBlocksByAnchors(baseBlocks, current.fragment, next?.basePath === current.basePath ? next.fragment : undefined);
    } else {
      blocks = baseBlocks.filter((block) => block.type !== "anchor").map((block, blockIndex) => ({ ...block, id: `${block.id}-${blockIndex}` }));
    }
    if (blocks.length === 0) {
      diagnostics.push({
        severity: "warning",
        message: `Chapter "${item.label}" resolved to empty content.`,
        context: item.href
      });
    }
    chapters.push({
      id: crypto.createHash("sha1").update(`${item.href}:${index}`).digest("hex"),
      index,
      title: item.label,
      href: item.href,
      depth: item.depth,
      blocks,
      wordCount: wordCount(blocks)
    });
  }

  if (chapters.length === 0) {
    diagnostics.push({
      severity: "error",
      message: "No readable chapters were extracted from the EPUB.",
      context: epubPath
    });
    throw new Error("Failed to extract readable chapters from EPUB");
  }

  const bookId = crypto.createHash("sha1").update(path.resolve(epubPath)).digest("hex");
  return {
    id: bookId,
    title,
    author,
    sourcePath: path.resolve(epubPath),
    importHash,
    diagnostics,
    chapters
  };
}
