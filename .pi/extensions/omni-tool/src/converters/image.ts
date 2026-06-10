/**
 * Image converter.
 *
 * Strategy:
 * 1. Extract metadata (dimensions, format, EXIF) with ffprobe
 * 2. Resize if too large for API
 * 3. Send to multimodal API for OCR + description
 *
 * Handles: PNG, JPG, GIF, WebP, BMP, TIFF, HEIC, SVG, ICO
 */

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConverterContext, TranscribeResult } from "../types.ts";
import type { Converter } from "./_interface.ts";

/** Max image dimension (longest side) before resizing. */
const MAX_DIMENSION = 2048;

export const imageConverter: Converter = {
  name: "Image",
  extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".heif", ".svg", ".ico"],

  async convert(filePath: string, ctx: ConverterContext): Promise<TranscribeResult> {
    const warnings: string[] = [];

    // Step 1: Get metadata
    const metadata = await getImageMetadata(filePath);
    warnings.push(`Image: ${metadata.width}x${metadata.height}, format=${metadata.format}`);

    // Step 2: Read and possibly resize
    let imageData = await readFile(filePath);
    let mimeType = toMimeType(metadata.format);

    // SVG is special — convert to PNG first
    if (filePath.toLowerCase().endsWith(".svg")) {
      imageData = await convertSvgToPng(filePath);
      mimeType = "image/png";
      warnings.push("Converted SVG to PNG for API");
    }

    // Resize if too large
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      imageData = await resizeImage(filePath, MAX_DIMENSION);
      mimeType = "image/png";
      warnings.push(`Resized to max ${MAX_DIMENSION}px`);
    }

    // Step 3: Send to API
    const mode = ctx.options.mode ?? "text";
    const prompt = buildImagePrompt(mode, metadata);

    const text = await ctx.callApi(prompt, imageData, mimeType);

    // Prepend metadata
    const metaBlock = [
      `[Image: ${metadata.format}, ${metadata.width}x${metadata.height}]`,
      metadata.exif ? `[EXIF: ${metadata.exif}]` : null,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      text: `${metaBlock}\n\n${text}`,
      format: "image",
      chunks: 1,
      usedApi: true,
      warnings,
    };
  },
};

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  exif?: string;
}

/** Get image metadata using ffprobe. */
function getImageMetadata(filePath: string): Promise<ImageMetadata> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffprobe",
      [
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      (err, stdout) => {
        if (err) {
          // Fallback: return minimal metadata
          resolve({ width: 0, height: 0, format: "unknown" });
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const stream = data.streams?.[0];
          const format = data.format?.format_name ?? "unknown";

          resolve({
            width: stream?.width ?? 0,
            height: stream?.height ?? 0,
            format,
            exif: stream?.tags ? JSON.stringify(stream.tags) : undefined,
          });
        } catch {
          resolve({ width: 0, height: 0, format: "unknown" });
        }
      },
    );
  });
}

/** Convert SVG to PNG using ffmpeg (or rsvg-convert if available). */
function convertSvgToPng(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tmpOut = join(tmpdir(), `omni-svg-${Date.now()}.png`);
    execFile(
      "ffmpeg",
      ["-y", "-i", filePath, "-vf", "scale=2048:-1", tmpOut],
      async (err) => {
        if (err) reject(new Error(`SVG conversion failed: ${err.message}`));
        else {
          const data = await readFile(tmpOut);
          resolve(data);
        }
      },
    );
  });
}

/** Resize image using ffmpeg. */
function resizeImage(filePath: string, maxDim: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tmpOut = join(tmpdir(), `omni-resize-${Date.now()}.png`);
    execFile(
      "ffmpeg",
      ["-y", "-i", filePath, "-vf", `scale=${maxDim}:${maxDim}:force_original_aspect_ratio=decrease`, tmpOut],
      async (err) => {
        if (err) reject(new Error(`Resize failed: ${err.message}`));
        else {
          const data = await readFile(tmpOut);
          resolve(data);
        }
      },
    );
  });
}

function toMimeType(format: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    heic: "image/heic",
  };
  return map[format.toLowerCase()] ?? "image/png";
}

function buildImagePrompt(mode: "text" | "visual", metadata: ImageMetadata): string {
  if (mode === "text") {
    return `This is an image (${metadata.width}x${metadata.height}).
If it contains text (document scan, screenshot, sign, etc.), extract ALL text via OCR.
If it contains data (chart, graph, table), extract the data in a structured format.
If it's a photo or illustration, describe what you see factually.
Always include any visible text, labels, numbers, or captions.`;
  }

  return `This is an image (${metadata.width}x${metadata.height}).
Provide a detailed visual description. Include:
- What is shown (objects, people, scene)
- Any visible text, labels, or numbers
- Colors, layout, and composition
- Any charts, graphs, or data visualizations with their data`;
}
