import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const mode = process.argv[2] ?? "runtime";

function copyFile(source, target) {
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target);
}

function copyDir(source, target) {
	if (!existsSync(source)) return;
	mkdirSync(dirname(target), { recursive: true });
	cpSync(source, target, { recursive: true });
}

function copyFiles(sourceDir, targetDir, extensions) {
	mkdirSync(targetDir, { recursive: true });
	for (const entry of readdirSync(sourceDir)) {
		if (extensions.some((ext) => entry.endsWith(ext))) {
			copyFile(join(sourceDir, entry), join(targetDir, entry));
		}
	}
}

function copyRuntimeAssets() {
	copyFiles(join(root, "src/modes/interactive/theme"), join(dist, "modes/interactive/theme"), [".json"]);
	copyFiles(join(root, "src/modes/interactive/assets"), join(dist, "modes/interactive/assets"), [".png"]);
	copyFiles(join(root, "src/core/prompts"), join(dist, "core/prompts"), [".md"]);
}

function findPhotonWasm() {
	const candidates = [
		join(root, "node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"),
		join(root, "node_modules/.bun/@silvia-odwyer+photon-node@0.3.4/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm"),
	];
	return candidates.find((candidate) => existsSync(candidate));
}

function copyBinaryAssets() {
	copyFile(join(root, "package.json"), join(dist, "package.json"));
	copyFile(join(root, "README.md"), join(dist, "README.md"));
	copyFile(join(root, "CHANGELOG.md"), join(dist, "CHANGELOG.md"));
	copyFiles(join(root, "src/modes/interactive/theme"), join(dist, "theme"), [".json"]);
	copyFiles(join(root, "src/modes/interactive/assets"), join(dist, "assets"), [".png"]);
	copyDir(join(root, "docs"), join(dist, "docs"));
	copyDir(join(root, "examples"), join(dist, "examples"));
	const photonWasm = findPhotonWasm();
	if (photonWasm) {
		copyFile(photonWasm, join(dist, basename(photonWasm)));
	} else {
		console.warn("WARN: photon_rs_bg.wasm not found");
	}
	copyFiles(join(root, "src/core/prompts"), join(dist, "core/prompts"), [".md"]);
	copyFile(join(root, "ai-dash/bin/ai-dash"), join(dist, "ai-dash"));
}

if (mode === "runtime") {
	copyRuntimeAssets();
} else if (mode === "binary") {
	copyBinaryAssets();
} else {
	console.error(`Unknown asset copy mode: ${mode}`);
	process.exit(1);
}
