export function getTauUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `tau/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
