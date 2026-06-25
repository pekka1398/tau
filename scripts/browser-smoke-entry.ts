import { Agent } from "../src/core/agent/index.ts";
import { getModel, getProviders, Type } from "../src/core/ai/index.ts";

// Keep this entry browser-safe. It is bundled by scripts/check-browser-smoke.mjs
// to catch accidental Node-only runtime imports in browser-facing package exports.
const model = getModel("openrouter", "google/gemini-2.5-flash");
const schema = Type.Object({ prompt: Type.String() });

const agent = new Agent({ initialState: { model } });
agent.steer({ role: "user", content: [{ type: "text", text: "queued" }], timestamp: 0 });

console.log(model.id, getProviders().length, schema.type, agent.hasQueuedMessages());
