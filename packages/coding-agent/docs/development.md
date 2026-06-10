# Development

See [AGENTS.md](https://github.com/earendil-works/pi-mono/blob/main/AGENTS.md) for additional guidelines.

## Setup

```bash
git clone https://github.com/earendil-works/pi-mono
cd pi-mono
npm install
npm run build
```

Run from source:

```bash
/path/to/pi-mono/pi-test.sh
```

The script can be run from any directory. Pi keeps the caller's current working directory.

## Forking / Rebranding

Configure via `package.json`:

```json
{
  "piConfig": {
    "name": "pi",
    "configDir": ".pi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.pi/agent/pi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```

## Debugging Tool Result Rendering

The bash tool result display involves multiple layers. When debugging rendering issues, trace through each layer:

### Architecture

```
ai-dash (fd3 metadata) 
  → bash tool execute (reads metadata, returns result with details.intent)
    → tool_execution_end event (carries result)
      → ToolExecutionComponent.updateResult(result)
        → rebuildBashResultRenderComponent(component, result, options)
          → intent check → early return or store/display output
            → BashResultRenderComponent.render() → uses collapsedStyledOutput or children
              → TUI doRender() → differential rendering
```

### Debug environment variables

```bash
PI_DEBUG_TOOL_RESULT=1   # Enable all debug logs below
PI_DEBUG_LOADER=1        # Loader state machine transitions
PI_CLEAR_ON_SHRINK=1     # Force full re-render on content shrink
```

### Debug log files (created when PI_DEBUG_TOOL_RESULT=1)

| File | What it logs |
|------|-------------|
| `/tmp/bash-rebuild.log` | Every `rebuildBashResultRenderComponent` call — intent, expanded, isPartial, which branch taken |
| `/tmp/bash-render.log` | Every `BashResultRenderComponent.render()` call — whether collapsedStyledOutput exists, how many lines |
| `/tmp/tool-result-end.log` | `tool_execution_end` event data — hasDetails, hasMetadata, intent, exitCode |
| `/tmp/tui-render.log` | TUI `doRender()` — prev/new line counts, firstChanged/lastChanged, which rendering path taken |
| `/tmp/loader-debug.log` | Loader state machine transitions with elapsed time |

### Key lesson: cached state vs children

`BashResultRenderComponent` has TWO sources of render content:
1. `children` — added by `component.addChild()` in `rebuildBashResultRenderComponent`
2. `state.collapsedStyledOutput` — set when collapsing output, read by `render()` for truncation

When hiding a result via early return, BOTH must be cleared. `component.clear()` only clears children. The cached `collapsedStyledOutput` must be explicitly set to `null`.

### Common debug flow

1. Run with `PI_DEBUG_TOOL_RESULT=1`
2. Check `/tmp/bash-rebuild.log` — did the intent check run? Did it return early?
3. Check `/tmp/bash-render.log` — does `collapsedStyledOutput` still exist after the intent check?
4. Check `/tmp/tui-render.log` — did the TUI re-render after the component was cleared?
5. If the component is empty but content still appears on screen, check for stale cached state
