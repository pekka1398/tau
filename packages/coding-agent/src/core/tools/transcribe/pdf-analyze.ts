/**
 * PDF page analyzer — per-page routing using PyMuPDF via Python subprocess.
 *
 * For each page, detects: images, math fonts, tables, drawings.
 * Returns a routing decision ("text" or "api") with reasons.
 */

import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageAnalysis } from "./types.ts";

/**
 * Analyze all pages of a PDF and return routing decisions.
 * Shells out to Python with PyMuPDF for structural analysis.
 */
export async function analyzePdfPages(filePath: string, pageRange?: string): Promise<PageAnalysis[]> {
	const script = buildPythonScript(filePath, pageRange);
	const stdout = await runPython(script);
	return JSON.parse(stdout) as PageAnalysis[];
}

async function runPython(script: string): Promise<string> {
	const tmpFile = join(tmpdir(), `pdf-analyze-${Date.now()}.py`);
	await writeFile(tmpFile, script, "utf-8");
	return new Promise((resolve, reject) => {
		execFile("python3", [tmpFile], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
			unlink(tmpFile).catch(() => {});
			if (err) reject(new Error(`PyMuPDF analysis failed: ${stderr || err.message}`));
			const cleaned = stdout.split("\n").filter((l) => !l.startsWith("Consider using")).join("\n");
			resolve(cleaned);
		});
	});
}

function buildPythonScript(filePath: string, pageRange?: string): string {
	const escapedPath = filePath.replace(/'/g, "\\'");
	const startPage = pageRange ? parseInt(pageRange.split("-")[0], 10) - 1 : "0";
	const endPage = pageRange ? parseInt(pageRange.split("-")[1], 10) : "len(doc)";

	return `
import fitz, json, sys

MATH_PREFIXES = ["cmr", "cmmi", "cmsy", "cmex", "msam", "msbm"]

doc = fitz.open('${escapedPath}')
start = ${startPage}
end = min(${endPage}, len(doc))
results = []

for pn in range(start, end):
    page = doc[pn]
    reasons = []
    text_len = 0
    math_fonts = set()
    img_count = 0
    table_count = 0
    draw_count = 0

    # Images
    images = page.get_images(True)
    img_count = len(images)
    if img_count > 0:
        reasons.append(f"{img_count} image(s)")

    # Text + fonts
    blocks = page.get_text("dict")["blocks"]
    for b in blocks:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for span in line["spans"]:
                text_len += len(span["text"])
                fl = span["font"].lower()
                if any(p in fl for p in MATH_PREFIXES):
                    math_fonts.add(span["font"])

    if math_fonts:
        reasons.append("math fonts: " + ", ".join(sorted(math_fonts)))

    # Tables
    tables = page.find_tables()
    table_count = len(tables.tables)
    if table_count > 0:
        reasons.append(f"{table_count} table(s)")

    # Drawings
    drawings = page.get_drawings()
    lines = rects = curves = 0
    for d in drawings:
        for item in d["items"]:
            t = item[0]
            if t == "l": lines += 1
            elif t == "re": rects += 1
            elif t in ("c", "qu"): curves += 1
    draw_count = lines + rects + curves
    if draw_count > 5:
        reasons.append(f"drawings: {lines}L {rects}R {curves}C")

    route = "api" if reasons else "text"

    results.append({
        "pageNum": pn + 1,
        "route": route,
        "reasons": reasons,
        "textLength": text_len,
        "imageCount": img_count,
        "mathFonts": sorted(math_fonts),
        "tableCount": table_count,
        "drawingCount": draw_count,
    })

doc.close()
print(json.dumps(results))
`.trim();
}
