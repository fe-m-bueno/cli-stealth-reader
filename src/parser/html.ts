import { parse } from "parse5";
import type { CanonicalBlock } from "../types.js";

const BLOCK_NAMES = new Set(["p", "blockquote", "li", "h1", "h2", "h3", "h4", "h5", "h6", "img", "hr"]);
const SKIP_TEXT_TAGS = new Set(["script", "style", "svg", "title", "head", "noscript"]);
const CHAPTER_ID_PATTERNS = [/^capitulo\d+$/i, /^chapter\d+$/i, /^ch\d+$/i, /^cap\d+$/i];

type TreeNode = {
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: TreeNode[];
  value?: string;
};

function getAttr(element: TreeNode, name: string): string | undefined {
  return element.attrs?.find((attr) => attr.name === name)?.value;
}

function collectText(node: TreeNode): string {
  if (node.tagName && SKIP_TEXT_TAGS.has(node.tagName)) {
    return "";
  }
  if (node.tagName === "br") {
    return "\n";
  }
  if ("value" in node) {
    return node.value ?? "";
  }
  if (!node.childNodes) {
    return "";
  }
  return node.childNodes.map((child) => collectText(child)).join("");
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isDecorativeText(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }
  return /^[\p{P}\p{S}\uE000-\uF8FF]+$/u.test(normalized);
}

function isDecorativeImageAlt(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }
  return /^(image|cover|img\d*|.+\.(?:png|jpe?g|gif|svg|webp))$/i.test(normalized);
}

function pushAnchorIfPresent(blocks: CanonicalBlock[], element: TreeNode, prefix: string, counter: { value: number }): void {
  const id = getAttr(element, "id");
  if (!id) {
    return;
  }
  blocks.push({
    id: `${prefix}-anchor-${counter.value++}`,
    type: "anchor",
    text: "",
    anchorId: id
  });
}

function pushDescendantAnchors(blocks: CanonicalBlock[], node: TreeNode, prefix: string, counter: { value: number }): void {
  for (const child of node.childNodes ?? []) {
    pushAnchorIfPresent(blocks, child, prefix, counter);
    pushDescendantAnchors(blocks, child, prefix, counter);
  }
}

function visitNode(
  node: TreeNode,
  blocks: CanonicalBlock[],
  prefix: string,
  counter: { value: number }
): void {
  const tagName = node.tagName;
  if (typeof tagName !== "string") {
    return;
  }
  if (SKIP_TEXT_TAGS.has(tagName)) {
    return;
  }
  const element = node as TreeNode & { tagName: string };
  pushAnchorIfPresent(blocks, element, prefix, counter);

  if (BLOCK_NAMES.has(tagName)) {
    pushDescendantAnchors(blocks, element, prefix, counter);
    if (tagName === "img") {
      const alt = normalizeText(getAttr(element, "alt") ?? "");
      if (isDecorativeImageAlt(alt)) {
        return;
      }
      blocks.push({
        id: `${prefix}-block-${counter.value++}`,
        type: "image",
        text: alt,
        imageSource: getAttr(element, "src")
      });
      return;
    }
    if (tagName === "hr") {
      blocks.push({
        id: `${prefix}-block-${counter.value++}`,
        type: "scene-break",
        text: "Scene break"
      });
      return;
    }
    const text = normalizeText(collectText(element));
    if (isDecorativeText(text)) {
      return;
    }
    const type =
      tagName === "blockquote"
        ? "blockquote"
        : tagName === "li"
          ? "list-item"
          : tagName.startsWith("h")
            ? "heading"
            : "paragraph";
    blocks.push({
      id: `${prefix}-block-${counter.value++}`,
      type,
      text,
      level: type === "heading" ? Number(tagName.slice(1)) : undefined
    });
    return;
  }

  if (!element.childNodes) {
    return;
  }
  for (const child of element.childNodes) {
    visitNode(child, blocks, prefix, counter);
  }
}

function findBody(document: TreeNode): TreeNode {
  const html = document.childNodes?.find((node) => node.tagName === "html");
  if (!html) {
    return document;
  }
  const body = html.childNodes?.find((node) => node.tagName === "body");
  return body ?? html;
}

export function extractBlocksFromHtml(htmlSource: string, prefix: string): CanonicalBlock[] {
  const document = parse(htmlSource) as unknown as TreeNode;
  const body = findBody(document);
  const blocks: CanonicalBlock[] = [];
  const counter = { value: 1 };
  for (const child of body.childNodes ?? []) {
    visitNode(child, blocks, prefix, counter);
  }
  return blocks;
}

export function parseNavToc(htmlSource: string): Array<{ href: string; label: string; depth: number }> {
  const document = parse(htmlSource) as unknown as TreeNode;

  function findNavToc(node: TreeNode): TreeNode | null {
    if (node.tagName === "nav") {
      const epubType = getAttr(node, "epub:type") ?? getAttr(node, "type") ?? "";
      const id = getAttr(node, "id") ?? "";
      if (epubType.includes("toc") || id === "toc") {
        return node;
      }
    }
    for (const child of node.childNodes ?? []) {
      const found = findNavToc(child);
      if (found) return found;
    }
    return null;
  }

  const items: Array<{ href: string; label: string; depth: number }> = [];

  function collect(node: TreeNode, depth: number): void {
    if (node.tagName === "a") {
      const href = getAttr(node, "href");
      if (href) {
        items.push({ href, label: normalizeText(collectText(node)) || "Untitled chapter", depth });
      }
      return;
    }
    for (const child of node.childNodes ?? []) {
      const nextDepth = node.tagName === "li" && child.tagName === "ol" ? depth + 1 : depth;
      collect(child, nextDepth);
    }
  }

  const navToc = findNavToc(document);
  if (navToc) {
    collect(navToc, 0);
  }
  return items;
}

export function sliceBlocksByAnchors(
  blocks: CanonicalBlock[],
  startAnchor?: string,
  endAnchor?: string
): CanonicalBlock[] {
  let startIndex = 0;
  let endIndex = blocks.length;

  if (startAnchor) {
    const located = blocks.findIndex((block) => block.type === "anchor" && block.anchorId === startAnchor);
    if (located >= 0) {
      startIndex = located;
    }
  }
  if (endAnchor) {
    const located = blocks.findIndex((block, index) => index > startIndex && block.type === "anchor" && block.anchorId === endAnchor);
    if (located >= 0) {
      endIndex = located;
    }
  }

  return blocks
    .slice(startIndex, endIndex)
    .filter((block) => block.type !== "anchor")
    .map((block, index) => ({ ...block, id: `${block.id}-${index}` }));
}

export function findFirstChapterAnchor(blocks: CanonicalBlock[]): string | undefined {
  const anchor = blocks.find((block) => {
    if (block.type !== "anchor" || typeof block.anchorId !== "string") {
      return false;
    }
    const anchorId = block.anchorId;
    return CHAPTER_ID_PATTERNS.some((pattern) => pattern.test(anchorId));
  });
  return anchor?.anchorId;
}
