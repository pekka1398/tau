# Cleanup Branch Working Record

Branch: `cleanup/openrouter-only-tau`
Base checked against: `main` at merge-base `f0c92ce49f933096b4c344c18f9886f949567d36`
Head when written: `02460e58 Clean stale ignore entries`
Date written: 2026-06-25

## Intent

This branch was a cleanup branch for turning the forked PI-shaped monorepo into a simpler Tau product repo.

The main direction was:

- Tau should be a single product, not a multi-package workspace.
- LLM runtime support should be OpenRouter-only.
- Legacy direct providers should be removed: Anthropic, Google, Mistral, OpenAI Responses/direct OpenAI variants, Bedrock, OAuth provider flows, and similar provider-specific code.
- The old `packages/ai`, `packages/agent`, and `packages/tui` split should be folded into the main application source.
- The tracked `packages/` directory should disappear.
- Native macOS/Windows terminal helper support should not be part of the tracked project for now.
- Linux is the only supported runtime target for this cleanup.
- `ai-dash` should remain, but as a root-level dependency rather than inside `packages/`.
- Discord bridge code was intentionally left alone in the later cleanup passes.

## Final Shape

The repository now has the expected root shape:

- `src/` contains the application code, including the former coding-agent, AI, agent loop, and TUI code.
- `test/` contains the unified test suite.
- `docs/`, `examples/`, and `scripts/` sit at root.
- `ai-dash/` sits at root and remains referenced by `package.json` as `file:./ai-dash`.
- No tracked `packages/` directory remains.
- No tracked `native/` directory remains.
- OpenRouter model/provider code is the only supported AI path.
- The old package install subsystem is gone.

Final aggregate diff from `main..HEAD`:

- `740 files changed`
- `13955 insertions`
- `54752 deletions`
- status mix: `35` added, `172` deleted, `523` renamed, `10` modified

Top-level impact by path:

- `src`: 227 changed paths
- `test`: 173 changed paths
- `packages`: 170 removed/renamed-away paths
- `ai-dash`: 105 moved paths
- `docs`: 29 changed paths
- `examples`: 16 changed paths
- `scripts`: 9 changed paths

## Major Work Areas

### 1. OpenRouter-only AI surface

The branch removed or neutralized legacy provider surfaces and tests. The direct-provider cleanup covered OAuth, provider docs, provider fixtures, provider-specific tests, and dynamic provider registration paths.

The remaining chat transport was renamed from `openai-completions` to `openrouter-chat`. This was not just cosmetic: it removed the misleading implication that Tau still had a direct OpenAI provider. The code now treats the OpenRouter-compatible chat transport as the named API surface.

Important edited areas:

- `src/core/ai/providers/openrouter-chat.ts`
- `src/core/ai/providers/register-builtins.ts`
- `src/core/ai/types.ts`
- `src/core/model-registry.ts`
- `src/core/model-resolver.ts`
- `scripts/ai/generate-models.ts`
- `src/core/ai/models.generated.ts`
- AI tests under `test/core/ai/`

### 2. Monorepo removal and package folding

The branch moved toward a single-product layout in stages:

- First, the old packages were renamed and cleaned.
- Then `packages/ai` and `packages/agent` were folded into the coding agent.
- Then `packages/tui` was folded into the coding agent.
- Then the coding-agent package itself was flattened to root.
- Finally, the package install subsystem was removed entirely.

Result:

- Former coding-agent source is now `src/`.
- Former TUI source is now `src/core/tui/`.
- Former AI source is now `src/core/ai/`.
- Former agent package source is now `src/core/agent/`.
- Former package docs/examples/tests are now root `docs/`, `examples/`, and `test/`.

### 3. Package manager removal

The old package install/update/resource subsystem was removed because Tau no longer has a package ecosystem shape.

Removed:

- `src/core/package-manager.ts`
- `src/package-manager-cli.ts`
- `src/utils/git.ts`
- package manager tests
- package manager docs
- package-related settings
- unused `hosted-git-info` dependency

Added/reworked:

- `src/core/resource-resolver.ts`
- `src/management-cli.ts`

The CLI keeps local config/resource management, but no longer advertises or implements external package installation.

### 4. Linux-only simplification

The branch removed unsupported macOS/Windows native terminal helper code and platform fallbacks.

Removed/ignored:

- tracked `native/` helpers
- Darwin modifier native binding paths
- Windows console native binding paths
- Windows self-update helper
- Windows-specific tests/docs
- Termux/mobile docs
- clipboard native helper path

Kept:

- Linux-oriented process, terminal, clipboard, and shell behavior
- `native/` remains ignored in `.gitignore` so local experiments/build outputs do not get tracked

### 5. Tau naming and PI cleanup

The branch replaced many user-facing and test-facing PI references with Tau terminology:

- package names
- config directory references
- docs links
- SDK examples
- settings and startup strings
- tests using temporary directories and fixture names
- version check expectations
- auth/storage labels

Not every PI string in fixture history was rewritten. Historical fixture logs under `test/fixtures/` intentionally still contain old session text because they are captured historical data, not live product surface.

### 6. Prompt and docs cleanup

The system prompt was simplified and canonicalized around the markdown source. Provider docs were narrowed to OpenRouter-only. Legacy docs for custom providers, packages, OAuth, and unsupported platforms were removed or rewritten.

Edited areas:

- `src/core/prompts/static-system-prompt.md`
- `src/core/prompts/static-prompt.ts`
- `docs/`
- `README.md`
- `CHANGELOG.md`
- `examples/sdk/`

### 7. Tests and verification

Tests were updated to match the new structure, OpenRouter-only model rules, Tau naming, and Linux-only behavior.

Notable test changes:

- model registry tests rewritten for OpenRouter assumptions
- provider-specific tests removed
- package manager tests removed
- direct-provider fixture tests removed
- stale PI test names cleaned
- branch navigation e2e timeout relaxed from `180000` to `300000` after a full-suite timeout

Final verification performed during cleanup:

- `bun run check` passed
- `bun run test` passed after the timeout adjustment
- targeted stale-reference scans passed for tracked files
- final `git status --short --branch` was clean

## Commit History Read

The full branch-only commit history from `main..HEAD` was read in chronological order. Below is the complete list with short stats.

1. `add9f1ed` - empty subject
   - 8 files changed, 203 insertions, 68 deletions
   - Early work touching OpenAI-compatible completion provider, compaction/session code, static prompt, SDK/session manager, and an edit redirect tool.

2. `ca97ec45` - Prune ai package to OpenRouter surface
   - 78 files changed, 557 insertions, 17093 deletions
   - Removed most direct-provider AI tests and narrowed the old AI package toward the OpenRouter path.

3. `9d14f679` - Remove legacy AI OAuth and docs
   - 13 files changed, 104 insertions, 1825 deletions
   - Removed old AI OAuth CLI/utils/docs and adjusted auth/model registry tests and config.

4. `7f03c344` - Simplify Tau system prompt
   - 2 files changed, 21 insertions, 433 deletions
   - Replaced the old large prompt with a much smaller Tau-focused prompt.

5. `800c564b` - Align docs and settings with OpenRouter-only Tau
   - 12 files changed, 118 insertions, 489 deletions
   - Updated README/docs/settings/model selector behavior for OpenRouter-only operation.

6. `b6f10974` - Prune legacy provider documentation
   - 9 files changed, 94 insertions, 1305 deletions
   - Removed custom-provider docs and OAuth-oriented examples.

7. `4ad28a2d` - Resolve Tau context and CLI naming
   - 9 files changed, 135 insertions, 392 deletions
   - Cleaned Tau naming in CLI/resource/trust/todo paths.

8. `75daed9e` - Remove legacy npm shrinkwrap hygiene
   - 11 files changed, 26 insertions, 2618 deletions
   - Removed coding-agent shrinkwrap flow and related scripts/docs.

9. `ca132eed` - Rename workspace packages for Tau
   - 181 files changed, 724 insertions, 721 deletions
   - Broad rename pass across workspace package names, docs, examples, tests, and code.

10. `7cd70c56` - Clean legacy Pi and provider references
    - 56 files changed, 307 insertions, 340 deletions
    - Cleaned many PI/provider references across docs, code, tests, and metadata. This also touched the old `packages/ai-dash` before it was later moved to root.

11. `3a2e37da` - Update SDK examples for Tau naming
    - 3 files changed, 12 insertions, 11 deletions
    - Small SDK example naming cleanup.

12. `1602871e` - Remove stale provider entrypoints and vendor easter egg
    - 8 files changed, 2 insertions, 185 deletions
    - Removed stale provider entrypoint files and one old vendor-themed UI element.

13. `f6af687c` - Update AI tests for Tau env names
    - 2 files changed, 7 insertions, 7 deletions
    - Updated AI tests to use Tau environment variable names.

14. `91bf3e9b` - Use markdown as canonical Tau prompt source
    - 2 files changed, 1 insertion, 3 deletions
    - Made markdown the canonical prompt source.

15. `4683d436` - Fix non-mutating root check gate
    - 20 files changed, 142 insertions, 46 deletions
    - Fixed root checking behavior and adjusted related tests.

16. `05208a5f` - Clarify OpenRouter-only provider docs
    - 10 files changed, 28 insertions, 27 deletions
    - Tightened provider docs around OpenRouter-only support.

17. `cc5e3428` - Prune legacy OAuth and provider test fixtures
    - 32 files changed, 234 insertions, 678 deletions
    - Removed or neutralized stale OAuth/provider fixtures.

18. `7809ae0a` - Document ignored local reference directories
    - 1 file changed, 2 insertions
    - Documented ignored local reference directories in `.gitignore`.

19. `d14a789f` - Rewrite model registry tests for OpenRouter
    - 1 file changed, 339 insertions, 1337 deletions
    - Replaced broad provider model registry tests with OpenRouter-focused ones.

20. `26c1550b` - Neutralize legacy provider fixtures
    - 3 files changed, 44 insertions, 73 deletions
    - Cleaned remaining provider fixture assumptions.

21. `1b0a3fa4` - Remove legacy API names from tests
    - 3 files changed, 10 insertions, 14 deletions
    - Removed old API names in tests.

22. `b9535ebf` - Clarify AI compatibility metadata comments
    - 1 file changed, 4 insertions, 4 deletions
    - Comment cleanup for compatibility metadata.

23. `734021c0` - Align version check tests with Tau branding
    - 2 files changed, 6 insertions, 6 deletions
    - Tau branding in version checks.

24. `68ea55a5` - Prune legacy prompt flag tests
    - 1 file changed, 8 insertions, 23 deletions
    - Removed obsolete prompt flag tests.

25. `cc4d285c` - Remove legacy prompt flag docs
    - 1 file changed, 3 insertions, 3 deletions
    - Removed obsolete prompt flag documentation.

26. `2f6c7f28` - Fix compaction test expectations
    - 1 file changed, 6 insertions, 6 deletions
    - Updated compaction tests after prompt/runtime changes.

27. `02ffde21` - Tolerate partial extension records
    - 1 file changed, 20 insertions, 12 deletions
    - Made extension record handling more tolerant.

28. `8da4f731` - Fix Tau package manager project paths
    - 2 files changed, 28 insertions, 28 deletions
    - Interim path cleanup before the package manager was later removed.

29. `ced92719` - Restore Tau extension runtime
    - 10 files changed, 3444 insertions, 399 deletions
    - Restored extension runtime code after earlier pruning so extensions still worked.

30. `6ee524e6` - Align coding-agent tests with Tau runtime
    - 11 files changed, 86 insertions, 540 deletions
    - Adjusted tests for the Tau runtime.

31. `c6fd822e` - Prune stale coding-agent tests
    - 28 files changed, 43 insertions, 3449 deletions
    - Removed stale tests that no longer matched the simplified runtime.

32. `b70f74bc` - Replace PI-era changelogs with Tau entries
    - 5 files changed, 17 insertions, 7248 deletions
    - Replaced long PI-era changelog content with Tau-specific entries.

33. `5f9263a6` - Remove PI theme global alias
    - 1 file changed, 2 deletions
    - Removed old global theme alias.

34. `bd284d37` - Remove stale extension docs
    - 9 files changed, 33 insertions, 180 deletions
    - Removed outdated extension documentation.

35. `0d25faea` - Clarify Bun workspace hygiene
    - 2 files changed, 5 insertions, 4 deletions
    - Small workspace/dependency hygiene documentation cleanup.

36. `8877da8a` - Remove stale direct-provider test references
    - 3 files changed, 12 insertions, 23 deletions
    - Removed lingering direct-provider expectations in tests.

37. `1d61472c` - Consolidate AI and agent into coding agent
    - 177 files changed, 4612 insertions, 8538 deletions
    - Moved AI and agent packages into the coding-agent package.

38. `91bea633` - Fold TUI into coding agent
    - 141 files changed, 259 insertions, 1198 deletions
    - Moved TUI package source/tests into coding-agent.

39. `fc8c800a` - Flatten project layout
    - 567 files changed, 214 insertions, 425 deletions
    - Moved coding-agent files to the root project layout. This is the commit that made `src/`, `test/`, `docs/`, `examples/`, and `scripts/` root-level.

40. `c303f153` - Stop tracking native terminal helpers
    - 8 files changed, 16 insertions, 140 deletions
    - Removed tracked Darwin/Windows native terminal helper sources and binaries, and ignored `native/`.

41. `b16ca01e` - Trim dead native support cleanup
    - 27 files changed, 5830 insertions, 222 deletions
    - Removed native modifier utility paths and Windows self-update. Also moved AI/agent tests into their new root locations.

42. `d16baf2e` - Clean up stale paths and build assets
    - 9 files changed, 89 insertions, 24 deletions
    - Updated build asset copying and stale path references.

43. `2658511d` - Simplify clipboard and platform docs
    - 21 files changed, 94 insertions, 460 deletions
    - Removed Windows docs/native clipboard path and simplified clipboard behavior.

44. `3c67cfc5` - Narrow platform runtime to Linux
    - 23 files changed, 67 insertions, 611 deletions
    - Removed Termux docs and cross-platform runtime branches.

45. `da4793e2` - Remove unsupported terminal platform fallbacks
    - 6 files changed, 14 insertions, 142 deletions
    - Removed terminal key/image/platform fallback behavior that was for unsupported targets.

46. `17cff391` - Remove legacy platform compatibility paths
    - 8 files changed, 20 insertions, 303 deletions
    - Further simplified path/file/terminal compatibility code.

47. `4b9df6cf` - Clean stale package and install path references
    - 7 files changed, 35 insertions, 90 deletions
    - Cleaned docs/config/tests that still pointed at package/install paths.

48. `c107eb28` - Drop legacy PI package manifest naming
    - 6 files changed, 15 insertions, 16 deletions
    - Removed PI manifest naming in extension/package-adjacent paths.

49. `2a4c3d19` - Refresh OpenRouter model metadata
    - 1 file changed, 5 insertions, 5 deletions
    - Regenerated OpenRouter model metadata.

50. `aa133d9e` - Restrict models config to OpenRouter
    - 4 files changed, 23 insertions, 42 deletions
    - Removed non-OpenRouter model config behavior.

51. `a6ea3999` - Remove extension provider registration API
    - 11 files changed, 75 insertions, 452 deletions
    - Removed extension ability to register arbitrary providers.

52. `3db29e4d` - Constrain runtime provider registration to OpenRouter
    - 8 files changed, 100 insertions, 122 deletions
    - Tightened runtime model/provider handling around OpenRouter.

53. `2e8c71c4` - Clean stale PI-facing labels
    - 10 files changed, 44 insertions, 43 deletions
    - Cleaned remaining user-facing PI labels.

54. `2d3063bd` - Remove package install subsystem
    - 33 files changed, 1181 insertions, 7761 deletions
    - Removed the package manager, package CLI, git helper dependency, package docs/tests, and package settings. Added local resource resolver and management CLI.

55. `62f2c2bb` - Remove unused git package dependency
    - 2 files changed, 8 deletions
    - Removed `hosted-git-info` after package manager removal.

56. `5e22dcdb` - Rename chat transport for OpenRouter
    - 39 files changed, 702 insertions, 821 deletions
    - Renamed `openai-completions` transport/tests to `openrouter-chat`, updated model metadata and docs.

57. `3a3a1b4f` - Clean stale PI test names
    - 33 files changed, 112 insertions, 112 deletions
    - Replaced stale PI names in tests, temp paths, and fixture expectations.

58. `db6ee8fb` - Relax branch navigation e2e timeout
    - 1 file changed, 1 insertion, 1 deletion
    - Increased one e2e timeout after a full-suite timeout.

59. `02460e58` - Clean stale ignore entries
    - 1 file changed, 1 insertion, 3 deletions
    - Removed stale ignore entries for old package/generated paths and renamed `pi-*.html` scratch ignore to `tau-*.html`.

## Notable Things To Remember

- The branch intentionally performs large renames. A raw diff looks huge mostly because `packages/coding-agent`, `packages/tui`, `packages/ai`, and `packages/agent` were collapsed into root locations.
- `ai-dash` is still present and tracked at root. Earlier in the branch it was moved out of `packages/`; later cleanup avoided touching its internals.
- Discord bridge remains present. Later cleanup explicitly avoided changing it.
- `note/`, `dist/`, `node_modules/`, and `reference-repo/` are ignored local/scratch paths.
- Some old PI strings remain only in historical fixture logs. Those are not active product references.
- The final root spread is normal for a TypeScript/Bun project: root config files are intentionally left at root because tools expect them there.

## Final Opinion

This branch completed the agreed cleanup direction: Tau is now a single-product OpenRouter-only repo with the old monorepo/package/provider/platform complexity removed.

The next cleanup, if any, should be a separate decision pass rather than continuing this one. Good candidates would be:

- audit docs/examples for product accuracy after the structural cleanup
- decide whether the SDK/docs surface should remain broad or become more private/internal
- decide whether Discord bridge remains a supported feature or becomes a separate optional integration
- decide whether `ai-dash` should stay vendored in this repo long term

