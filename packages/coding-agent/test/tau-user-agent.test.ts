import { describe, expect, it } from "vitest";
import { getTauUserAgent } from "../src/utils/tau-user-agent.ts";

describe("getTauUserAgent", () => {
	it("formats the Tau user agent", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getTauUserAgent("1.2.3");

		expect(userAgent).toBe(`tau/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^tau\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
