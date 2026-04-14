import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  attributeNamePrefix: "",
  ignoreAttributes: false,
  removeNSPrefix: true,
  allowBooleanAttributes: true,
  trimValues: true
});

export function parseXml<T>(input: string): T {
  return parser.parse(input) as T;
}

export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
