# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Obsidian desktop-only plugin that transfers images with absolute paths (e.g., `file:///D:\...`) into the vault and converts them to internal `![[...]]` links. Also handles garbled-image renaming and QQ/WeChat chat log reformatting.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Watch mode (esbuild --watch)
npm run build            # Type-check then bundle for production (tsc --noEmit + esbuild minified)
npm run lint             # ESLint
npm run version          # Bump manifest.json version + update versions.json (reads from npm_package_version env var)
```

The esbuild config (`esbuild.config.mjs`) bundles `src/main.ts` into `main.js` (CJS, ES2018 target). Obsidian, electron, and CodeMirror packages are marked external.

## Architecture

### Source layout
```
src/
  main.ts        # Plugin entry point + ALL feature logic (~605 lines)
  settings.ts    # ImageTransferSettings interface + SettingTab
main.js          # Bundled output (committed — Obsidian plugins require it at root)
manifest.json    # Plugin metadata
styles.css       # Plugin CSS (minimal, 3 rules)
```

**Note:** Despite the AGENTS.md recommending code splitting, all three core features currently live in `main.ts`. A future refactor could extract each feature into its own module (`src/features/image-transfer.ts`, `src/features/garbled-rename.ts`, `src/features/chat-log.ts`).

### Three core features

1. **External image transfer** (`processNote`) — Regex `!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)` matches absolute-path image links, resolves physical paths via `flexibleProbing`, copies file into vault at the configured attachment folder, replaces link with `![[Pasted image YYYYMMDDHHmmss.ext]]`.

2. **Garbled image renaming** (`processGarbledImages`) — Finds `![[...]]` links where the filename contains special chars (`\%{}()[]~\`^`), checks if the file exists in the vault, renames to clean `Pasted image ...` format via `app.fileManager.renameFile`.

3. **Chat log formatting** (`processChatLog`) — Parses QQ/WeChat-style timestamps + usernames from raw text, reformats into `Username: YYYY/MM/DD HH:mm:ss\n\tmessage content` with tab-indented message bodies. **Must be strictly idempotent** — guarded by `if (result !== rawContent)` before writing. Repeated runs must not produce additional newlines or whitespace changes.

### Path resolution engine (`flexibleProbing`)

Recursively walks the filesystem from a drive root, matching path segments against entries returned by `fs.readdir`. Designed to handle:
- URL-encoded characters (`%01`, `%20`) → decoded with `decodeURIComponent` before comparison
- Markdown escape backslashes (`\(`, `\)`, `\[`, `\]`) → silently skipped during matching
- Case-insensitive matching (Windows filesystem)
- Entries sorted by length descending so longer matches take priority

Returns the first physical file path found, or `null`.

### Settings and attachment folder resolution

`ImageTransferSettings` has two fields:
- `attachmentLocation`: `"system"` | `"root"` | `"current"` | `"subfolder"` | `"custom"`
- `customAttachmentFolder`: used when location is `"subfolder"` or `"custom"`

`getTargetAttachmentFolder(file)` reads the vault's system-level `attachmentFolderPath` config when in `"system"` mode, resolves `./` prefixes relative to the note's parent, and recursively creates folders that don't exist yet.

### Desktop-only constraints

Uses Node.js `fs/promises` and `path` for filesystem access. `isDesktopOnly: true` in manifest. Platform detection via `Platform.isWin` drives path separator logic.

### Supported image formats

`png`, `jpg`, `jpeg`, `gif`, `bmp`, `webp`, `heic` — case-insensitive matching in both transfer and rename features.

## Git workflow

- Branch naming: version-based (e.g., `1.0.5`)
- CI (`.github/workflows/lint.yml`): runs on push/PR, tests Node 20.x and 22.x — `npm ci` → `npm run build` → `npm run lint`
- `version-bump.mjs` reads `npm_package_version`, writes `manifest.json` and `versions.json`
- Releases: tag must match `manifest.json` version (no leading `v`); attach `main.js`, `manifest.json`, `styles.css`
