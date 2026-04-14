import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { ensureArray, parseXml } from "./xml.js";
import { extractBlocksFromHtml, findFirstChapterAnchor, sliceBlocksByAnchors, parseNavToc } from "./html.js";
import type { CanonicalBook, CanonicalChapter, CanonicalBlock, ImportDiagnostic } from "../types.js";

export const EPUB_PARSER_VERSION = 2;

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
  id?: string;
  playOrder?: string;
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
  playOrder: number;
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

function stripAnchors(blocks: CanonicalBlock[]): CanonicalBlock[] {
  return blocks.filter((block) => block.type !== "anchor");
}

function relabelBlockIds(blocks: CanonicalBlock[], prefix: string): CanonicalBlock[] {
  return blocks.map((block, index) => ({ ...block, id: `${prefix}-${index}` }));
}

function looksLikeBodyParagraph(block: CanonicalBlock): boolean {
  return block.type === "paragraph" && wordCount([block]) >= 12;
}

function looksLikeHeadingCandidate(block: CanonicalBlock): boolean {
  if (block.type !== "paragraph") {
    return false;
  }
  const words = wordCount([block]);
  return words > 0 && words <= 12 && block.text.length <= 90 && !/[.!?]$/.test(block.text);
}

function promoteLeadingHeadings(blocks: CanonicalBlock[]): CanonicalBlock[] {
  const firstBodyIndex = blocks.findIndex((block) => looksLikeBodyParagraph(block));
  if (firstBodyIndex <= 0) {
    return blocks;
  }
  const limit = Math.min(firstBodyIndex, 3);
  return blocks.map((block, index) => {
    if (index >= limit || !looksLikeHeadingCandidate(block)) {
      return block;
    }
    return { ...block, type: "heading", level: 2 };
  });
}

function finalizeChapterBlocks(blocks: CanonicalBlock[]): CanonicalBlock[] {
  const withoutAnchors = stripAnchors(blocks);
  const trimmed = withoutAnchors.filter((block, index) => !(index === 0 && block.type === "image"));
  return promoteLeadingHeadings(trimmed);
}

function withSyntheticChapterHeading(blocks: CanonicalBlock[], label: string, prefix: string): CanonicalBlock[] {
  const normalizedLabel = normalizeLabel(label);
  if (!normalizedLabel) {
    return blocks;
  }
  const first = blocks[0];
  if (first?.type === "heading" && normalizeLabel(first.text) === normalizedLabel) {
    return blocks;
  }
  return [
    {
      id: `${prefix}-heading`,
      type: "heading",
      text: label,
      level: 1
    },
    ...blocks
  ];
}

function normalizeLabel(label: string): string {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isFrontMatterLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return [
    /^capa$/,
    /^cover$/,
    /^pagina de titulo$/,
    /^title page$/,
    /^folha de rosto$/,
    /^pagina de creditos$/,
    /^creditos$/,
    /^copyright$/,
    /^sumario$/,
    /^contents?$/,
    /^indice$/,
    /^rosto$/,
    /^dedicatoria$/,
    /^epigrafe$/,
    /^edicoes\b/
  ].some((pattern) => pattern.test(normalized));
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
      depth,
      playOrder: Number(point.playOrder) || Number.POSITIVE_INFINITY
    });
    if (point.navPoint) {
      items.push(...flattenNavPoints(point.navPoint, depth + 1));
    }
  }
  return items;
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
  const spinePaths = spine
    .map((item) => manifestMap.get(item.idref)?.href)
    .filter((href): href is string => Boolean(href))
    .map((href) => normalizeHref(opfDir, href));
  const spineIndex = new Map(spinePaths.map((href, index) => [href, index]));

  let tocItems: TocItem[] = [];
  const navItem = manifestItems.find((item) => item.properties?.includes("nav"));
  if (navItem) {
    const navHtml = await readZipText(zip, normalizeHref(opfDir, navItem.href));
    tocItems = parseNavToc(navHtml).map((item, index) => ({ ...item, playOrder: index + 1 }));
  } else {
    const tocId = opf.package.spine?.toc;
    const ncxItem = tocId ? manifestMap.get(tocId) : manifestItems.find((item) => item["media-type"]?.includes("ncx"));
    if (ncxItem) {
      const ncx = parseXml<NcxXml>(await readZipText(zip, normalizeHref(opfDir, ncxItem.href)));
      tocItems = flattenNavPoints(ncx.ncx.navMap?.navPoint, 0);
      tocItems.sort((left, right) => left.playOrder - right.playOrder);
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
        depth: 0,
        playOrder: index + 1
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
    const chapterPrefix = crypto.createHash("md5").update(`${item.href}:${index}`).digest("hex").slice(0, 8);
    let blocks: CanonicalBlock[];
    let shouldInjectHeading = false;
    if (current.fragment || (next && next.basePath === current.basePath && next.fragment)) {
      const baseBlocks = await getBlocksForFile(current.basePath);
      const endAnchor = next?.basePath === current.basePath ? next.fragment : undefined;
      const startAnchor = current.fragment ?? (endAnchor ? findFirstChapterAnchor(baseBlocks) : undefined);
      blocks = sliceBlocksByAnchors(baseBlocks, startAnchor, endAnchor);
    } else if (spineIndex.has(current.basePath)) {
      const currentIndex = spineIndex.get(current.basePath) ?? 0;
      const nextIndex = next ? spineIndex.get(next.basePath) : undefined;
      const rangeEnd = nextIndex != null && nextIndex > currentIndex ? nextIndex : spinePaths.length;
      const chapterPaths = spinePaths.slice(currentIndex, rangeEnd);
      const collected: CanonicalBlock[] = [];
      for (const [pathIndex, chapterPath] of chapterPaths.entries()) {
        const fileBlocks = await getBlocksForFile(chapterPath);
        if (pathIndex === 0 && stripAnchors(fileBlocks).length === 0 && chapterPaths.length > 1) {
          shouldInjectHeading = true;
        }
        collected.push(...stripAnchors(fileBlocks));
      }
      blocks = collected;
    } else {
      const baseBlocks = await getBlocksForFile(current.basePath);
      blocks = baseBlocks.filter((block) => block.type !== "anchor").map((block, blockIndex) => ({ ...block, id: `${block.id}-${blockIndex}` }));
    }
    blocks = finalizeChapterBlocks(blocks);
    if (shouldInjectHeading) {
      blocks = withSyntheticChapterHeading(blocks, item.label, chapterPrefix);
    }
    blocks = relabelBlockIds(blocks, chapterPrefix);
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

  const readableChapters = chapters
    .filter((chapter) => chapter.blocks.length > 0 && !isFrontMatterLabel(chapter.title))
    .map((chapter, index) => ({ ...chapter, index }));

  if (readableChapters.length === 0) {
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
    parserVersion: EPUB_PARSER_VERSION,
    diagnostics,
    chapters: readableChapters
  };
}
