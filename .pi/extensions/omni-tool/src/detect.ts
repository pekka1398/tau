/**
 * File type detection by extension and magic bytes.
 */

import type { FileFormat } from "./types.ts";

const EXT_MAP: Record<string, FileFormat> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".odt": "docx",
  ".rtf": "docx",
  ".xlsx": "xlsx",
  ".xls": "xlsx",
  ".ods": "xlsx",
  ".csv": "csv",
  ".tsv": "csv",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".bmp": "image",
  ".tiff": "image",
  ".tif": "image",
  ".heic": "image",
  ".heif": "image",
  ".svg": "image",
  ".ico": "image",
  ".mp3": "audio",
  ".wav": "audio",
  ".flac": "audio",
  ".ogg": "audio",
  ".aac": "audio",
  ".m4a": "audio",
  ".wma": "audio",
  ".opus": "audio",
  ".ipynb": "notebook",
};

/**
 * Detect file format from a file path.
 * Uses extension-based detection. Falls back to "unknown".
 */
export function detectFormat(filePath: string): FileFormat {
  const ext = getExtension(filePath).toLowerCase();
  return EXT_MAP[ext] ?? "unknown";
}

/**
 * Get file extension including the dot.
 */
export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (lastDot <= lastSlash) return "";
  return filePath.slice(lastDot);
}

/**
 * Get human-readable format name.
 */
export function formatName(format: FileFormat): string {
  const names: Record<FileFormat, string> = {
    pdf: "PDF",
    docx: "Office Document",
    xlsx: "Spreadsheet",
    csv: "CSV/TSV",
    image: "Image",
    audio: "Audio",
    notebook: "Jupyter Notebook",
    unknown: "Unknown",
  };
  return names[format];
}
