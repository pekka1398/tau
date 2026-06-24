import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
			alias: [
				{ find: /^@earendil-works\/tau-ai$/, replacement: aiSrcIndex },
				{ find: /^@earendil-works\/tau-agent-core$/, replacement: agentSrcIndex },
				{ find: /^@mariozechner\/tau-ai$/, replacement: aiSrcIndex },
				{ find: /^@mariozechner\/tau-agent-core$/, replacement: agentSrcIndex },
			],
	},
});
