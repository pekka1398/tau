/**
 * Chunking strategies for different file formats.
 *
 * Core principle: never send too much to the API at once.
 * Gemini summarizes/omits when input is too large, even within its context window.
 */

import type { Chunk } from "./types.ts";

/** Default chunk sizes. Tuned from real-world Gemini hallucination patterns. */
export const DEFAULTS = {
  PDF_PAGES_PER_CHUNK: 10,
  AUDIO_MINUTES_PER_CHUNK: 10,
  CSV_ROWS_PER_CHUNK: 500,
  XLSX_ROWS_PER_CHUNK: 200,
  NOTEBOOK_CELLS_PER_CHUNK: 20,
} as const;

/**
 * Split an array of text lines into page-based chunks.
 * Used for text extracted from PDFs.
 */
export function chunkByPages(fullText: string, pagesPerPage: number = DEFAULTS.PDF_PAGES_PER_CHUNK): Chunk[] {
  // pdftotext uses form feed (\f) as page separator
  const pages = fullText.split("\f");
  const chunks: Chunk[] = [];

  for (let i = 0; i < pages.length; i += pagesPerPage) {
    const pageSlice = pages.slice(i, i + pagesPerPage);
    const startPage = i + 1;
    const endPage = Math.min(i + pagesPerPage, pages.length);
    chunks.push({
      index: chunks.length,
      label: `pages ${startPage}-${endPage}`,
      text: pageSlice.join("\n"),
      needsApi: false, // text already extracted
    });
  }

  return chunks;
}

/**
 * Split scanned PDF page images into chunks.
 * Each page is a separate image; group them into batches.
 */
export function chunkPdfImages(
  pageImages: Array<{ pageNum: number; data: Buffer }>,
  pagesPerChunk: number = DEFAULTS.PDF_PAGES_PER_CHUNK,
): Chunk[] {
  const chunks: Chunk[] = [];

  for (let i = 0; i < pageImages.length; i += pagesPerChunk) {
    const slice = pageImages.slice(i, i + pagesPerChunk);
    const startPage = slice[0].pageNum;
    const endPage = slice[slice.length - 1].pageNum;

    // For multi-page chunks, we send them as separate data items
    // The API wrapper will handle combining them
    for (const page of slice) {
      chunks.push({
        index: chunks.length,
        label: `page ${page.pageNum}`,
        data: page.data,
        mimeType: "image/png",
        needsApi: true,
      });
    }
  }

  return chunks;
}

/**
 * Split audio into time-based chunks.
 * Returns chunk metadata; actual splitting is done by ffmpeg.
 */
export function chunkAudio(
  durationSeconds: number,
  minutesPerChunk: number = DEFAULTS.AUDIO_MINUTES_PER_CHUNK,
): Array<{ startSec: number; endSec: number; label: string }> {
  const chunkSec = minutesPerChunk * 60;
  const chunks: Array<{ startSec: number; endSec: number; label: string }> = [];

  for (let start = 0; start < durationSeconds; start += chunkSec) {
    const end = Math.min(start + chunkSec, durationSeconds);
    chunks.push({
      startSec: start,
      endSec: end,
      label: `${formatTime(start)}-${formatTime(end)}`,
    });
  }

  return chunks;
}

/**
 * Split CSV rows into chunks with headers repeated.
 */
export function chunkCsvRows(
  rows: string[][],
  headerRow: string[],
  rowsPerChunk: number = DEFAULTS.CSV_ROWS_PER_CHUNK,
): Chunk[] {
  const chunks: Chunk[] = [];

  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    const slice = rows.slice(i, i + rowsPerChunk);
    // Reconstruct as text with header
    const lines = [headerRow.join(","), ...slice.map((r) => r.join(","))];
    chunks.push({
      index: chunks.length,
      label: `rows ${i + 1}-${Math.min(i + rowsPerChunk, rows.length)}`,
      text: lines.join("\n"),
      needsApi: false,
    });
  }

  return chunks;
}

/**
 * Split notebook cells into chunks.
 */
export function chunkNotebookCells(
  cells: Array<{ type: string; source: string; outputs?: string[] }>,
  cellsPerChunk: number = DEFAULTS.NOTEBOOK_CELLS_PER_CHUNK,
): Chunk[] {
  const chunks: Chunk[] = [];

  for (let i = 0; i < cells.length; i += cellsPerChunk) {
    const slice = cells.slice(i, i + cellsPerChunk);
    const text = slice
      .map((cell, idx) => {
        const num = i + idx + 1;
        const header = `[Cell ${num}] ${cell.type === "code" ? "Code" : "Markdown"}`;
        const body = cell.source;
        const outputs =
          cell.outputs && cell.outputs.length > 0 ? `\n[Output]\n${cell.outputs.join("\n")}` : "";
        return `${header}\n${body}${outputs}`;
      })
      .join("\n\n---\n\n");

    chunks.push({
      index: chunks.length,
      label: `cells ${i + 1}-${Math.min(i + cellsPerChunk, cells.length)}`,
      text,
      needsApi: false,
    });
  }

  return chunks;
}

/** Format seconds as HH:MM:SS. */
function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
