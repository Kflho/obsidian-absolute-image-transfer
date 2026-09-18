# Absolute Image Transfer

Obsidian desktop plugin that transfers externally-linked images into your vault and renames garbled image files — all through right-click or command palette.

## What this plugin does

### 1. Transfer external images into the vault

Converts absolute-path image links like `file:///D:\Images\photo.png` or `C:\Users\...\pic.jpg` into standard Obsidian `![[...]]` wikilinks. The image file is copied into your vault (respecting your attachment folder settings) and the link is updated automatically.

**Example — before:**
```markdown
![|350](file:///D:\QQ_Data\Image\screenshot.png)
```

**Example — after:**
```markdown
![[Pasted image 20260420123045.png|350]]
```

### 2. Rename garbled images to a clean preset format

Finds images with messy filenames (e.g., `Q)\TN\Q)TNF]S%MRO@AI1(F[I]OYC.gif`, `%01...png`, `123.456.jpg`) and renames them to a configurable clean format. Renames the physical file AND updates all referencing notes across the vault.

**Default preset:** `Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}` → `Pasted image 20260420123045.png`

Customize the format in settings using placeholders: `{YYYY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}`.

### 3. Fix QQ/WeChat chat log formatting

Reformats exported chat logs from messy single-line timestamps into clean, indented format:

**Example — before:**
```
张三 2024/1/5 14:30:25你好，文件收到了吗
```

**Example — after:**
```
张三: 2024/01/05 14:30:25
	你好，文件收到了吗
```

Idempotent — running it multiple times on the same text won't produce duplicate newlines or extra whitespace.

The same command also fixes **broken leading indentation**, which is what copied QQ/WeChat text usually suffers from: a line starts with a space plus a tab (`" \t"`), or tabs with trailing spaces (`"\t\t "`). Indentation should be tabs only, with 4 spaces counting as one tab:

| Before | After | Rule |
|--------|-------|------|
| `" \tmessage"` | `"\tmessage"` | space + tab → tab |
| `"\t\t message"` | `"\t\tmessage"` | stray spaces around tabs removed |
| `"    message"` | `"\tmessage"` | 4 spaces = 1 tab (same column) |
| `"  message"` | `"message"` | 1–3 stray spaces before plain text or an image are dropped |
| `"  - sub item"` | unchanged | a list marker follows, so the indent is real nesting |
| `"  paragraph"` under a list item, after a blank line | unchanged | it is a paragraph inside that list item |

YAML frontmatter and anything inside a fenced code block (``` / ~~~) is never touched — there the indentation is syntax, not layout.

The same command also normalizes the whitespace of **block markers** — blockquotes (comments), lists and headings:

| Before | After | Rule |
|--------|-------|------|
| `" >quote"` | `"> quote"` | 1–3 stray spaces before `>` are dropped, and `>` gets a space before the text |
| `">>quote"` | `"> > quote"` | nested quotes written as one canonical form |
| `">[!note] title"` | `"> [!note] title"` | callout marker followed by a space |
| `"-    item"` | `"- item"` | list marker followed by exactly one space |
| `"1)   item"` | `"1) item"` | ordered list, same rule |
| `"##   heading"` | `"## heading"` | heading marker followed by one space |
| `"#tag"` | unchanged | no space after `#` → it is a tag, not a heading (adding a space would turn it into one) |
| `">   - nested"` | unchanged | indent after `>` means a nested block inside the quote |
| `"- item"` then `"  > quote"` | unchanged | the quote belongs to that list item — its indent is syntax |

The layout is configurable (see **Settings** below):

- Toggle each piece of header info independently — username, date, time
- Choose the body indent — tab, 2 spaces, 4 spaces, or none
- When a message contains both an image and text, choose whether the image goes above or below the text (or keep the original order)
- Choose how aggressively leading indentation is rewritten (off / smart / strict) — this also switches the block-marker fixes on and off
- Turn **tag layout** on to move inline `#tags` to the end of their block, and **tag sorting** to order them alphabetically
- Turn **content block sorting** on to sort a note's blocks by first letter

### 4. Set image size in one click

Replaces the usual find-and-replace chore with a command. Pick an image size once, then apply it to a note, a folder, or the whole vault.

**Example — before → after:**

```
![[photo.png]]              →  ![[photo.png|100]]
![[photo.png|300]]          →  ![[photo.png|100]]
![[photo.png|300x200]]      →  ![[photo.png|100]]
![[photo.png#outline]]      →  ![[photo.png#outline|100]]
![](https://x.com/a.jpg)    →  ![100](https://x.com/a.jpg)
![[photo.png|a caption]]    →  unchanged (alias is a caption, not a size)
![[notes.md]]               →  unchanged (not an image)
```

Why it is safer than a regex replace:

- **Only writes files that actually change.** Sizes that already match are left alone — no save, sync or diff noise from re-running it.
- **Case-insensitive extensions** and full format coverage (`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` `avif` `svg`).
- **Handles `|300x200`**, `#outline` fragments and Markdown images, which a simple `(\|\d+)?` pattern silently skips.
- **Never eats captions.** When the alias holds text instead of a number, the link is left untouched.
- **Preview before applying.** The dialog shows how many links will change and the first few before → after examples, updating live as you type.
- Leave both width and height empty to **remove** existing sizes.

### 5. Organize image locations

After you copy-paste a note, its short links such as `![[photo.png]]` still point at the image in the **original** folder — the note's own attachments folder has no such file. Move, rename or delete that original image and the note loses its pictures.

**Organize image locations** copies those images into the note's own attachment folder and repoints the links:

| Situation | What happens |
|-----------|--------------|
| Image lives elsewhere, nothing local | A copy is placed in the attachment folder, link repointed |
| An **identical** copy is already there | Link is repointed only — nothing duplicated |
| A **different** file with the same name is there | The copy is named `name 2.ext`; nothing is overwritten |
| The link is ambiguous (several files share the name) | Skipped, and the reason is reported |
| Image already sits in the right folder | Untouched |

Image contents are compared byte-for-byte before deciding, so two different pictures are never treated as the same one. When a file name exists in several folders the plugin writes the full path (e.g. `![[folderB/attachments/photo.png]]`) instead of a bare file name, so the link can never resolve to the wrong picture.

Available from the right-click **图片功能 → 整理…图片位置** submenu, and from the command palette (current note / entire vault).

### 6. Tag layout and content block sorting

Two optional layout features, both off by default because they rearrange text:

**Tag layout** — when a block contains both text and tags, the tags are moved to the end of the block, separated from the text by a single space. A paragraph counts as one block, a list item and a heading each count as one, and **a table is handled cell by cell** (moving a tag to the end of the row would shift the columns):

| Before | After |
|--------|-------|
| `"#math today I studied limits"` | `"today I studied limits #math"` |
| `"today I studied #math limits"` | `"today I studied limits #math"` |
| `"a sentence #note."` | `"a sentence. #note"` |
| `"- #tag item text"` | `"- item text #tag"` |
| `"> #tag quoted text"` | `"> quoted text #tag"` |
| `"\| #tag cell \| other \|"` | `"\| cell #tag \| other \|"` |
| `"#tag"` on its own line | unchanged (nothing but tags → position kept) |

**Tag sorting** — multiple tags in one place are ordered by first letter (Chinese by pinyin, numbers numerically): `"text #math #note"` → `"text #note #math"`.

Left untouched: frontmatter, fenced and indented code blocks, inline code, `%%comments%%`, wiki links and Markdown links (`[[note#heading]]`, `[text](url#anchor)`), `C#`, `#123`, and `#` written directly after a character. Rows without a leading `|` (non-standard tables) are also left alone.

**Content block sorting** — sorts a note's blocks by first letter (Chinese by pinyin, numbers numerically). Consecutive list items are sorted among themselves, consecutive paragraphs among themselves, so lists and paragraphs never interleave. Headings split the note into sections and are kept in place — sorting only happens between one heading and the next. Tables, images, horizontal rules, footnotes and chat log messages are anchors: they stay where they are and split the sorting range, so a copied chat log is never scrambled. Ordered lists are renumbered after sorting (only when the original numbers were a consecutive run).

### 7. Formula (LaTeX) layout

Rewrites the LaTeX code of formulas — `$$ … $$` blocks and inline `$…$` — so that **the spaces in the code match the spaces the formula renders with**. Inline formulas only get the spacing rules (commas, operators, braces); they are never split across lines, and `$…$` whose content touches the delimiters on both sides is left alone (which is how Obsidian decides what is inline math at all).

| Before | After | Rule |
|--------|-------|------|
| `$$\dot{x}=f(x, t)$$` | `$$\dot{x} = f(x, t)$$` | operators, relations and logic symbols get one space on each side (rule 1) |
| `$$a&b&c$$` | `$$a & b & c$$` | `&` and `\\` are layout symbols: one space on each side |
| `$$(-x)$$` | `$$(-x)$$` | a sign (`+x`, `-Q`) stays tight against its argument (rule 2) |
| `$$(x-x_e)$$` | `$$(x - x_e)$$` | …while a real subtraction gets spaces |
| `$$\partial f$$` | `$$\partial{f}$$` | a command stays tight against its argument; braces keep the command name intact (rule 6) |
| `$$\sin x$$` / `$$\sin 2x$$` | `$$\sin{x}$$` / `$$\sin2x$$` | braces only where joining would swallow the name (`\sinx` is invalid, `\sin2x` is fine) |
| `$$A_{i}, \quadA_{j}$$` | `$$A_{i}, A_{j}$$` | a spacing command glued to a letter (`\quadA` — LaTeX reads it as an undefined command and the formula errors out) is split: when a comma or another separator is already there, the redundant spacing is dropped; otherwise it becomes `\quad{A}` |
| ``$$ x = 1 $$`` | ``$$x = 1$$`` | no space between `$$` and the content (rule 3) |
| ``$M=1$`` | ``$M = 1$`` | inline formulas get the same spacing rules |
| ``$y_{i,k}=C_ix_{i,k}+D_i u_{i,k}$`` | ``$y_{i, k} = C_ix_{i, k} + D_iu_{i, k}$`` | …and content that is joined in the rendering is joined in the code |
| `$$f(x,y)$$` | `$$f(x, y)$$` | a comma gets no space before it and one after |
| line breaks that are not `\\` | joined into one line | line breaks only where `\\` is (rule 5) |
| `\\`, then a new line | continuation indented one tab deeper | continuation = first line's indent + one tab; `\begin{}` adds nothing (rule 4) |

Example — a matrix inside a list item:

```
	说明$$T = (a, b){\begin{bmatrix}1 \\
		a & b \\
		\end{bmatrix}}$$
```

Untouched: frontmatter, fenced and indented code blocks, inline code, `\text{…}` / `\operatorname{…}` arguments (Chinese text and spaces inside are kept verbatim), formulas containing a `%` comment, and inline formulas containing `\\`. A stray `$$` no longer disables the whole note: a region that looks like prose (blank line, heading, fence, rule, or hundreds of lines) is skipped and the real formulas after it are still formatted.

## How to use

The right-click menu is grouped into two submenus so it stays short: **图片功能** (image tools) and **文本排版** (text layout). Both carry a `›` chevron at the right edge and open on hover or click — they use Obsidian's own submenu, so the parent menu stays open.

| Method | Action |
|--------|--------|
| Right-click a `.md` file | **图片功能**: convert / rename / organize locations / set size · **文本排版**: fix layout (chat log / indent / tags / formulas) |
| Right-click a folder | The same two submenus, applied to every note in that folder |
| Command palette (`Ctrl+P`) | Every menu action is also a command: convert images (current note / entire vault), rename garbled images (current note / entire vault), rename all images vault-wide (normal or forced), organize image locations (current note / entire vault), set image size (current note / entire vault), fix layout — chat log, indent, tags and formulas (current note / entire vault) |

### Settings

- **Attachment location** — where transferred images are stored (system default, vault root, current folder, subfolder, or custom path)
- **Image naming preset** — format for renamed images, supports `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}`
- **Link format after rename** — use full path (`folder/image.png`) or filename only (`image.png`)

Image size:

- **Default width** — pre-filled width in the size dialog, in pixels
- **Default height** — optional; leave empty to scale proportionally
- **Overwrite existing sizes** — when off, only images without a size are filled in

Chat log formatting:

- **Show username** — keep or drop the sender name
- **Show date** / **Show time** — keep or drop the date (`{YYYY}/{MM}/{DD}`) and time (`{HH}:{mm}:{ss}`)
- **Body indent** — tab, 2 spaces, 4 spaces, or none
- **Image position in mixed messages** — image above the text, below the text, or keep the original order
- **Blank line between messages** — only available when username, date and time are all turned off; inserts an empty line between adjacent messages so they stay visually distinct

All defaults reproduce the previous layout exactly, so existing notes are not reformatted until you change a setting.

Blank lines already present in the source text are always preserved.

Text layout fixes (applied by the same command, to the whole note):

- **Leading indent fix** — smart (default: 4 spaces = 1 tab, tab/space mixes normalized, 1–3 stray spaces before plain text or images dropped, while list-item indentation and paragraphs inside list items are kept), strict (tabs only, every leading space dropped), or off. Smart/strict also normalize block markers: `" >quote"` → `"> quote"`, multiple spaces after a list or heading marker collapse to one. Turning it off switches all of these fixes off
- **Tag layout** — move inline `#tags` to the end of their block, one space away from the text. Off by default
- **Tag sorting** — order the tags of one block by first letter (Chinese by pinyin, numbers numerically). Keeps the original order when off
- **Content block sorting** — sort a note's blocks by first letter, section by section. Off by default

Formula layout:

- **Formula layout** — rewrite the LaTeX code inside `$$ … $$` (spacing, line breaks, indentation). Off by default; inline `$…$` is never touched

## Supported formats

`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` (case-insensitive)

## Important

**Do not use Ctrl+Z after renaming images.** This plugin renames physical files on disk. Undoing in the editor reverts the text link but not the filename — causing broken images.

Back up your vault before bulk operations.

## Development

```bash
npm install     # install dependencies
npm run dev     # watch mode
npm run build   # type-check + bundle main.js
npm test        # test suite (no test framework needed)
npm run lint    # eslint
```

Feature logic is split into focused modules so it can be tested without Obsidian:

| Module | Responsibility |
|--------|----------------|
| `src/chat-log.ts` | chat log layout (username / date / time toggles, indent, image order, blank lines) |
| `src/text-pipeline.ts` | runs the layout steps in a fixed order: indent → markers → chat log → formulas → tags → block sorting |
| `src/text-layout.ts` | general layout fixes — leading indentation (4 spaces = 1 tab) |
| `src/markdown-markers.ts` | block marker spacing — blockquotes, lists, headings |
| `src/tags.ts` | tag layout — moving tags to the end of a block, per-cell tables, tag sorting |
| `src/block-sort.ts` | content block sorting — sections, anchors, ordered-list renumbering |
| `src/latex-layout.ts` | formula layout — spacing rules, `$$` delimiters, `\\` line breaks, continuation indent |
| `src/line-scan.ts` | shared protection rules — frontmatter, fenced code, indented code, `$$` formulas |
| `src/collate.ts` | "first letter" comparison (Chinese by pinyin, numbers numerically) |
| `src/image-size.ts` | rewriting `\|100` / `\|100x200` sizes, caption-safe |
| `src/image-links.ts` | link resolution, same-name ambiguity detection, link form choice |
| `src/image-organizer.ts` | copying images into a note's own attachment folder and repointing links |
| `src/attachment-folder.ts` | resolving / creating the attachment folder (shared by several features) |

`npm test` runs expected-output checks, idempotency across every settings combination, blank-line and content-loss invariants, and the safety rules that keep captions, non-image links and same-name images untouched.

`test/commands.test.ts` boots the plugin against a stubbed Obsidian API and audits the entry points: every right-click menu action must have a matching command (and the reverse), command IDs are locked in, and both submenu paths — Obsidian's native `setSubmenu` and the fallback — must produce the same actions.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/Kflho/obsidian-absolute-image-transfer/releases)
2. Place them in `.obsidian/plugins/obsidian-absolute-image-transfer/`
3. Enable the plugin in Settings → Community Plugins

## Changelog

### v1.2.0
- Fixed: a line such as `" >quote"` (a stray leading space before a blockquote) used to be treated as meaningful indentation and skipped — nothing was repaired at all. It is now normalized to `"> quote"`, with a space between the marker and the text
- Fixed: a single stray `$$` used to disable formula formatting for the **whole note** (the `$$` count had to be even). Each `$$` is now paired with the next one that forms a plausible formula region — a region that looks like prose (blank line, heading, fence, rule, hundreds of lines) is skipped and the real formulas after it are still formatted
- Fixed: a vault-wide run stopped at the **first file that failed to read or write**, silently skipping every note after it — which looked like "the whole-vault command doesn't work, the single-note command does". A failing file is now logged and counted, and the run continues to the end; the summary reports how many notes were processed and how many failed
- Fixed: vault-wide runs now write through `vault.process` (atomic read-modify-write) so a note open in the editor with unsaved edits is no longer reverted
- Fixed: leading indent fix no longer treats `#tag` as a heading, so a stray space in front of a tag line is dropped
- New: block markers are normalized as well — nested quotes (`">>quote"` → `"> > quote"`), callouts (`">[!note]"` → `"> [!note]"`), multiple spaces after a list marker (`"-    item"` → `"- item"`) and after a heading marker (`"##   heading"` → `"## heading"`). `#tag` (no space after `#`) stays a tag and is never turned into a heading; indentation inside a list item or after `>` is preserved
- New: **tag layout** — when a block holds both text and tags, the tags move to the end of the block, one space away from the text. A paragraph is one block, a list item and a heading are one block each, and tables are handled **cell by cell** (the row would otherwise shift). Tags alone on a line keep their position. Frontmatter, fenced/indented code, `$$` formulas, inline code, `%%comments%%`, wiki links and Markdown links are left alone
- New: **tag sorting** — the tags of one block are ordered by first letter (Chinese by pinyin, numbers numerically)
- New: **content block sorting** — sorts a note's blocks by first letter. Headings split the note into sections; tables, images, rules, footnotes, formulas and chat log messages are anchors that stay in place and split the sorting range; lists and paragraphs are sorted separately so they never interleave; ordered lists are renumbered after sorting
- New: **formula layout** — rewrites the LaTeX code of `$$ … $$` blocks and inline `$…$` so the code's spaces match what the formula renders: `=` `+` `\le` `&` `\\` get one space on each side, a sign or a modifier command stays tight against its argument (`\delta x` → `\delta{x}`), a spacing command glued to a letter (`\quadA`) is repaired, commas get one space after, `$$` hugs the content, invisible whitespace is dropped, line breaks happen only at `\\`, and every continuation line is indented one tab deeper than the first. Inline formulas get the spacing rules only and are never split; `\text{…}` arguments, code blocks and inline formulas containing `\\` are left alone
- The result notice now reports how many notes were processed, how many failed, and which layout steps are enabled — so "why wasn't this note fixed" (a switch that is off) is visible at a glance
- Command callbacks return their promise, so the batch path can be driven from tests
- New modules `src/markdown-markers.ts`, `src/tags.ts`, `src/block-sort.ts`, `src/latex-layout.ts`, `src/text-pipeline.ts`, `src/line-scan.ts`, `src/collate.ts`, with tests for expected output, safety boundaries (frontmatter / code / links / list nesting / formulas) and idempotency; `test/commands.test.ts` now also covers the vault-wide batch path, including one failing file in the middle of the run

### v1.1.8
- The chat log command (and the **文本排版** submenu entry) now also fixes **broken leading indentation**: a line starting with space + tab (`" \t"`), tabs with trailing spaces (`"\t\t "`), a tab written as 4 spaces, or 1–3 stray spaces in front of plain text/an image is normalized to tabs only. `frontmatter` and fenced code blocks are left untouched, and indentation that carries meaning is preserved (a following list marker / `>` / `#` / `|` / fence, or a paragraph inside a list item after a blank line)
- New setting **Leading indent fix** — smart (default), strict (tabs only, list nesting flattened too), or off
- Fixed: a chat log header line that carried its own indentation (`" \t李四 2024/1/5 14:31:02"`) left that whitespace behind as an empty-looking line between messages; the header's indentation is no longer emitted as message body
- New module `src/text-layout.ts` plus `test/text-layout.test.ts` (expected outputs, safety guards for frontmatter / code blocks / nested lists / list-item paragraphs, idempotency, and idempotency of the combined indent + chat log pipeline)

### v1.1.7
- The **图片功能** / **文本排版** right-click submenus now use Obsidian's own submenu: a `›` chevron sits at the right edge of the entry and the submenu opens beside it on hover or click, with the parent menu staying open (keyboard left/right works too). On versions without that API the previous click-to-open behaviour is kept, with `›` shown in the title
- Fixed: **fix chat log formatting** and **rename garbled images** could only be reached from the right-click menu. Both are now commands as well (current note / entire vault), so every menu action has a command-palette twin
- New regression test: boots the plugin against a stubbed Obsidian API and audits both directions — every menu action has a command, command IDs stay stable, and both submenu paths produce the same actions

### v1.1.6
- New: **organize image locations** — finds images that a note references from *another* folder (the usual result of copy-pasting a note) and brings a copy into that note's own attachment folder, then repoints the link
  - If the attachment folder already holds an identical copy, the link is just repointed — nothing is duplicated
  - If a *different* file with the same name is there, the copy gets a ` 2` suffix instead of overwriting
  - Image content is compared byte-for-byte before deciding, so different images are never treated as the same
- Fixed: **wrong images after renaming / link rewriting.** When two images in different folders shared a file name, the fallback link resolver picked the first match and could rename the wrong file or repoint a link at the other image. It now only resolves when the target is unambiguous, otherwise it skips and says so
- Fixed: the same image, referenced from several notes, was renamed once per note during a vault-wide run (the name kept changing). Each image is now handled once per batch
- Fixed: with **Link format after rename** set to filename only, links were stripped to bare file names even when that name existed in several folders, creating ambiguous links that could display the wrong image. Ambiguous names now keep the full path
- Fixed: `#outline`-style fragments were dropped from links when link formats were normalized
- Fixed: Markdown image links at the end of a message body were split by the chat log sender matcher, which broke the link
- Chat log layout is now configurable: username, date and time can each be toggled independently
- Body indent can be set to tab, 2 spaces, 4 spaces or none
- Image position in mixed image + text messages can be set to above, below, or keep original order
- New option to insert a blank line between adjacent messages when all header info is hidden
- Fixed blank lines growing without bound: a message followed by a blank line and an unparseable sender name added one extra newline on every run
- Chat log layout no longer drops text when the username is hidden (the previous line's text could be consumed as a sender name)
- Right-click menu reorganised into two submenus, **图片功能** and **文本排版**
- New: set image size in one click — replaces the manual find-and-replace regex, with a dialog showing affected count and before → after preview
- Formatting engines extracted into `src/chat-log.ts`, `src/image-size.ts`, `src/image-links.ts`, `src/image-organizer.ts` and `src/attachment-folder.ts` as testable units; `npm test` covers expected outputs, idempotency across every settings combination, and the same-name safety rules

### v1.1.4
- Fixed `restoreNotices()` not clearing inline styles set by MutationObserver, which could permanently hide notice containers and break other plugins' popups (e.g. Image Converter)
- Track all suppressed elements in a `Set<HTMLElement>` and reset their CSS properties on restore
- Notices are now restored after a 5-second delay, allowing suppressed spam notices to expire naturally before unblocking
- Operation result notices (success/error) are now shown after unblocking, ensuring they are never suppressed

### v1.1.2
- Progress indicator uses the built-in status bar (not a floating overlay), updating per-image during single-file operations
- Notice suppression now covers all operation types, including single-file right-click actions
- MutationObserver backup for notice suppression to catch edge cases where CSS alone is insufficient

### v1.1.1
- CSS class `suppress-notices` added to `document.body` during batch operations, hiding system notification popups via `styles.css`
- Status bar progress for vault-wide and folder-wide operations with descriptive labels (e.g. `📷 图片重命名: 33/100`)

### v1.1.0
- Batch operation notice suppression via CSS
- Real-time progress labels in the status bar during transfer and rename operations
- Garbled image detection improvements: pure digit+dot filenames now recognized as auto-generated

### v1.0.9
- Non-greedy wikilink regex to handle filenames with embedded `]` brackets
- Three-layer garbled detection: special chars, URL-encoded residues, auto-generated patterns
- `resolveImageLink()` shared resolver with `getFirstLinkpathDest` fallback to global file search

### v1.0.8
- Vault-wide basename deduplication using pre-scanned `Map<basename, vaultPath>`
- Force rename mode: renames all images including those already matching the preset format
- Operation mutex lock (`isRenaming`) to prevent concurrent operations

### v1.0.6
- Link format setting: choose between full path or filename-only wikilinks after rename
- Images already matching the preset naming format are automatically skipped
- Batch progress shown in status bar instead of repeated notification popups

### v1.0.5
- Custom image naming presets with `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` placeholders
- Right-click menu for renaming all images in a single file, folder, or entire vault
- Batch link format correction after all renames complete

### v1.0.4
- Chat log formatting for QQ/WeChat exported text
- WebP and HEIC format support

### v1.0.3
- Image size syntax preservation (`![|350]`) after conversion
- Hardened path resolution engine for special characters and URL-encoded paths

### v1.0.2
- Respects Obsidian system attachment folder settings
- Auto-creates nested attachment directories

### v1.0.1
- Garbled image detection and renaming for already-imported images
- Vault-wide link auto-update via Obsidian's `fileManager.renameFile` API

### v1.0.0
- Initial release: external image transfer with absolute path resolution

## License

MIT

---

# 中文说明

将笔记中的外部绝对路径图片搬运到 Obsidian 仓库内，并转换为 `![[...]]` 双链。同时提供乱码图片重命名、QQ/微信聊天记录排版修复功能。

## 功能

### 1. 外部图片转入仓库

把 `file:///D:\图片\photo.png` 或 `C:\Users\...\pic.jpg` 这类绝对路径图片复制到仓库的附件目录，并将链接替换为 `![[Pasted image 20260420123045.png]]`。图片存放位置遵循你的 Obsidian 附件设置。

### 2. 乱码图片重命名为预设格式

识别文件名中带特殊字符（`\`、`%`、`[]`、`()` 等）、URL 编码残留、纯数字+点号等自动生成命名的图片，统一重命名为干净格式。物理文件与全库引用链接同步更新。

**默认格式：** `Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}`

可在设置中自定义占位符组合。

### 3. 修复 QQ/微信聊天记录排版

将导出的聊天文本从混乱的单行时间戳格式，转换为带缩进的清晰排版。严格幂等，重复执行不会产生多余空行。

排版样式可在设置中调整：

| 设置项 | 说明 |
|--------|------|
| 显示用户名 | 关闭后每条消息只保留日期与时间 |
| 显示日期 | 格式为 `{YYYY}/{MM}/{DD}` |
| 显示时间 | 格式为 `{HH}:{mm}:{ss}` |
| 正文缩进 | 制表符 (tab) / 2 个空格 / 4 个空格 / 不缩进 |
| 图文消息中图片的位置 | 图片在上方 / 图片在下方 / 保持原顺序 |
| 消息之间插入空行 | 仅当用户名、日期、时间全部关闭时可用；用空行分隔相邻消息，便于区分说话人 |
| 行首缩进修复 | 智能：列表子项保留，其余行首空格删掉（推荐）/ 严格：行首只留 tab，空格全删 / 关闭。开启时同时规范注释（引用）、列表、标题的标记空白 |

以上默认值与原版排版结果完全一致，升级后不改变已有笔记，只有主动修改设置才会生效。源文里本来就有的空行始终会被保留。

同一条命令还会顺手修掉**行首的坏缩进**——从 QQ/微信复制来的文本，行首常常是"空格 + Tab"（`" \t"`）或"Tab 带零散空格"（`"\t\t "`）。规则是**行首只留 tab**，其中 4 个空格算一个 tab：

| 修复前 | 修复后 | 规则 |
|--------|--------|------|
| `" \t消息"` | `"\t消息"` | 空格 + Tab → Tab |
| `"\t\t 消息"` | `"\t\t消息"` | Tab 前后的零散空格删掉 |
| `"    消息"` | `"\t消息"` | 4 个空格 = 1 个 tab（列数不变，渲染层级不变） |
| `"  消息"` | `"消息"` | 正文、图片前手滑多打的 1~3 个空格删掉 |
| `"  - 子项"` | 不动 | 后面跟列表符号，这是真的嵌套缩进 |
| 列表项下方、隔空行的 `"  段落"` | 不动 | 它是该列表项里的段落，缩进有语法含义 |

frontmatter 与代码块（``` / ~~~）内部的缩进属于语法或内容，一律不碰。

同一条命令还会规范**块级标记**的空白 —— 注释（引用）、列表、标题：

| 修复前 | 修复后 | 规则 |
|--------|--------|------|
| `" >引用内容"` | `"> 引用内容"` | 引用标记前手滑多打的 1~3 个空格删掉，`>` 与正文之间补一个空格 |
| `">>引用内容"` | `"> > 引用内容"` | 多级引用连写规范成 `> > ` |
| `">[!note] 标题"` | `"> [!note] 标题"` | callout 标记后补空格 |
| `"-    项目"` | `"- 项目"` | 列表符号后多于一个空格收成一个 |
| `"1)   项目"` | `"1) 项目"` | 有序列表同样处理 |
| `"##   标题"` | `"## 标题"` | 标题符号后多于一个空格收成一个 |
| `"#标签"` | 不动 | 井号后没有空格是标签不是标题，加空格反而会变成标题 |
| `">   - 子项"` | 不动 | 引用里的嵌套块，标记后的缩进有语法含义 |
| `"- 顶层"` 下方的 `"  > 引用"` | 不动 | 这条引用属于该列表项，缩进是语法 |

> 说明：关闭「显示用户名」后头部只剩时间戳，此时聊天记录上方紧邻的其他文字会被原样保留、不参与排版，以免误删内容。

### 4. 一键设置图片大小

把"查找替换正则"换成一条命令：设置里定好尺寸，右键笔记 / 文件夹或命令面板一键应用。

**改写效果：**

```
![[图片.png]]               →  ![[图片.png|100]]
![[图片.png|300]]           →  ![[图片.png|100]]
![[图片.png|300x200]]       →  ![[图片.png|100]]
![[图片.png#outline]]       →  ![[图片.png#outline|100]]
![](https://x.com/a.jpg)    →  ![100](https://x.com/a.jpg)
![[图片.png|一张说明文字]]   →  不动（别名是说明文字，不是尺寸）
![[笔记.md]]                →  不动（不是图片）
```

相比直接跑正则的好处：

- **只写真正变化的文件**：尺寸已经正确的笔记完全不碰，不会产生保存、同步、diff 噪音
- **扩展名不区分大小写**，覆盖 `png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` `avif` `svg`
- **支持 `|300x200`、`#outline` 片段和 Markdown 图片**（这些用 `(\|\d+)?` 正则会静默漏掉）
- **不会吃掉图片说明文字**：别名不是纯数字时一律保留
- **先预览再动手**：弹窗实时显示"将修改 N 处"和前后对比，改数字即时刷新
- 宽度和高度**都留空 = 移除已有尺寸**

### 5. 整理笔记图片位置

复制粘贴笔记后，`![[图.png]]` 这类短链接仍然指向**原文件夹**的图片，本笔记的 attachments 里其实没有这张图 —— 原图一旦被移动、改名或删除，笔记里的图片就没了。

「整理图片位置」会把这类图片**复制**一份到笔记自己的附件夹，并把链接改成指向本地副本：

| 情况 | 处理 |
|------|------|
| 图片在别处，本地附件夹没有 | 复制一份到本地，链接改指本地 |
| 本地已有**内容相同**的副本 | 只改链接，不重复复制 |
| 本地有**同名但内容不同**的文件 | 复制成 `名字 2.ext`，绝不覆盖 |
| 链接同名有歧义、无法确定指向哪张 | 跳过并在提示里说明原因 |
| 图片本来就在本地附件夹 | 完全不动 |

同名图片多的时候，插件会强制写完整路径（如 `![[folderB/attachments/图.png]]`），避免裸文件名指向另一张同名图。入口在右键 **图片功能 → 整理…图片位置**，命令面板也可用（当前笔记 / 整个仓库）。

### 6. 标签排版与内容板块排版

两个会重排正文的排版功能，默认都关闭，需要在设置里主动开启。

**标签排版** —— 一块内容里同时有正文和标签时，标签统一挪到块尾，与正文之间空一格：

| 排版前 | 排版后 |
|--------|--------|
| `"#数学 今天学了极限"` | `"今天学了极限 #数学"` |
| `"今天学了 #数学 极限"` | `"今天学了 极限 #数学"` |
| `"今天学了极限 #数学。"` | `"今天学了极限。 #数学"` |
| `"- #标签 列表项内容"` | `"- 列表项内容 #标签"` |
| `"> #标签 引用内容"` | `"> 引用内容 #标签"` |
| `"\| #标签 单元格 \| 另一格 \|"` | `"\| 单元格 #标签 \| 另一格 \|"` |
| 整行只有标签 | 不动（位置不变，只按需排序） |

**块**的边界：一个段落算一块（标签挪到段落最后一行），一行列表项、一行标题各自算一块。**表格按单元格算块，不是按行** —— 整行算一块会把标签挪到别的列去，表格就毁了。

**标签排序** —— 同一处出现的多个标签按首字母排（中文按拼音、数字按数值）：`"内容 #数学 #笔记"` → `"内容 #笔记 #数学"`。

不碰的地方：frontmatter、围栏代码块与缩进代码块、行内代码、`%%注释%%`、双链与 Markdown 链接（`[[笔记#标题]]`、`[文字](url#锚点)` 里的 `#` 不是标签）、`C#` 这种紧贴字符的井号、纯数字的 `#123`。不带行首竖线的非标准表格（`甲 | 乙 | #标签 丙`）也整行不动。

**内容板块排版** —— 按首字母给笔记里的块排序（中文按拼音、数字按数值）：

- 连续的列表项之间排序、连续的段落之间排序，**列表与段落不会互相穿插**
- 标题是分节锚点：排序只发生在这个标题与下一个标题之间，标题本身不动
- 表格、图片、分隔线、脚注、聊天记录都是锚点：原地不动，并把左右两边的排序范围切开 —— 复制来的聊天记录不会被排乱
- 有序列表排完会顺手把编号写顺（只在原本就是连续编号时才动，手写的 `1. 1. 1.` 保持原样）

相关设置项：

| 设置项 | 说明 |
|--------|------|
| 标签排版 | 默认关闭。开启后把行内 `#标签` 统一移到所在块的句尾，与正文之间空一格 |
| 标签排序 | 默认开启（仅当「标签排版」开启时可用）。关闭后标签归位但保持原有先后顺序 |
| 内容板块排版 | 默认关闭。开启后按首字母对笔记各块内容排序 |

### 7. 公式排版

把数学公式的 LaTeX 代码整理成"**代码里的空格 = 公式渲染出来的空格**"：`$$ … $$` 区块管换行与缩进，行内 `$…$` 只按同一套空格规则整理、**绝不换行**。行内公式的识别与 Obsidian 一致：`$` 内侧紧贴内容才算公式（`$ 5 与 $` 这种不会被误当公式）。

| 排版前 | 排版后 | 规则 |
|--------|--------|------|
| `$$\dot{x}=f(x, t)$$` | `$$\dot{x} = f(x, t)$$` | 运算、关系、逻辑符号左右各一个空格（规则 1） |
| `$$a&b&c$$` | `$$a & b & c$$` | `&`、`\\` 是排版符号，左右各一个空格 |
| `$$(-x)$$` | `$$(-x)$$` | 标正负的加减号与参数贴紧（规则 2） |
| `$$(x-x_e)$$` | `$$(x - x_e)$$` | 真正的减法照旧左右加空格 |
| `$$\partial f$$` | `$$\partial{f}$$` | 修饰符与参数贴紧；花括号保证命令名不被吃掉（规则 6） |
| `$$\sin x$$` / `$$\sin 2x$$` | `$$\sin{x}$$` / `$$\sin2x$$` | 只在"连起来会出错"时加花括号（`\sinx` 非法、`\sin2x` 合法） |
| `$$A_{i}, \quadA_{j}$$` | `$$A_{i}, A_{j}$$` | 间距命令与后面字母粘连（`\quadA` 会被 LaTeX 当成未定义命令，公式直接报错）会拆开：前面已有逗号等分隔就删掉多余的间距，否则写成 `\quad{A}` |
| ``$$ x = 1 $$`` | ``$$x = 1$$`` | `$$` 与内容之间不留空格（规则 3） |
| ``$M=1$`` | ``$M = 1$`` | 行内公式用同一套空格规则 |
| ``$y_{i,k}=C_ix_{i,k}+D_i u_{i,k}$`` | ``$y_{i, k} = C_ix_{i, k} + D_iu_{i, k}$`` | ……渲染里连在一起的内容，代码里也连在一起 |
| `$$f(x,y)$$` | `$$f(x, y)$$` | 逗号前不加、后加一个空格 |
| 不是 `\\` 的换行 | 拼回同一行 | 只在 `\\` 处换行（规则 5） |
| `\\` 之后的下一行 | 比首行多一个 tab | 续行 = 首行缩进 + 1 个 tab；`\begin{}` 不额外缩进（规则 4） |

示例 —— 列表项里的矩阵公式：

```
	说明$$T = (a, b){\begin{bmatrix}1 \\
		a & b \\
		\end{bmatrix}}$$
```

不碰的地方：frontmatter、围栏代码块与缩进代码块、行内代码、`\text{…}` / `\operatorname{…}` 参数里的文字与空格、含 `%` 注释的公式、带 `\\` 的行内公式。**落单的 `$$` 不再让整篇失效** —— 配起来不像公式的区域（含空行 / 标题 / 围栏 / 分隔线）自动跳过，后面的真公式照排。

## 使用方式

右键菜单收进了两个二级栏，顶层不再一长串：**图片功能** 与 **文本排版**。两项右侧带 `›` 箭头，悬停或点击即在旁边展开 —— 用的是 Obsidian 原生子菜单，父菜单不会收起，键盘左右键也能进出子菜单。

| 方式 | 操作 |
|------|------|
| 右键 `.md` 文件 | **图片功能**：转换 / 重命名 / 整理位置 / 设置大小 · **文本排版**：修复排版（聊天记录 / 缩进 / 标签 / 公式） |
| 右键文件夹 | 同样两个二级栏，作用于该文件夹下所有笔记 |
| 命令面板 (`Ctrl+P`) | 菜单里的每个操作都有对应命令：转换图片（当前笔记 / 整个仓库）、重命名乱码图片（当前笔记 / 整个仓库）、重命名全部图片（普通 / 强制）、整理图片位置（当前笔记 / 整个仓库）、设置图片大小（当前笔记 / 整个仓库）、修复排版（聊天记录、缩进、标签与公式，当前笔记 / 整个仓库） |

## 本地开发

```bash
npm install
npm run build   # 类型检查 + 打包 main.js
npm test        # 测试（无需任何测试框架）
npm run lint
```

功能逻辑拆成独立模块，可脱离 Obsidian 测试：

| 模块 | 职责 |
|------|------|
| `src/chat-log.ts` | 聊天记录排版（用户名/日期/时间开关、缩进、图文顺序、空行） |
| `src/text-pipeline.ts` | 按固定顺序串起各排版步骤：缩进 → 标记 → 聊天记录 → 公式 → 标签 → 板块排序 |
| `src/text-layout.ts` | 行首缩进归一（4 空格 = 1 个 tab） |
| `src/markdown-markers.ts` | 块级标记空白：注释（引用）、列表、标题 |
| `src/tags.ts` | 标签排版：标签归位到块尾、表格按单元格、标签排序 |
| `src/block-sort.ts` | 内容板块排序：分节、锚点、有序列表重新编号 |
| `src/latex-layout.ts` | 公式排版：空格规则、`$$` 定界、`\\` 换行、续行缩进 |
| `src/line-scan.ts` | 共用保护区判定：frontmatter、围栏代码块、缩进代码块、公式 |
| `src/collate.ts` | "首字母"比较（中文按拼音、数字按数值） |
| `src/image-size.ts` | 改写 `\|100` / `\|100x200` 尺寸，保护图片说明文字 |
| `src/image-links.ts` | 链接解析、同名歧义识别、链接形式决策 |
| `src/image-organizer.ts` | 把图片复制进笔记自己的附件夹并改写链接 |
| `src/attachment-folder.ts` | 附件文件夹解析与创建（多个功能共用） |

`test/commands.test.ts` 会把插件在 Obsidian API 替身上真的 `onload` 一遍，审计入口是否齐全：右键菜单里的每个操作都必须有对应命令（反向也查），命令 ID 被锁定，且原生子菜单与退化路径产出的操作必须一致。

## 支持的图片格式

`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic`（图片大小功能额外支持 `avif` `svg`）

## 图片大小设置项

| 设置项 | 说明 |
|--------|------|
| 默认宽度 | 弹窗打开时的默认宽度（像素），与高度都留空表示移除已有尺寸 |
| 默认高度 | 可留空，此时按宽度等比例缩放 |
| 覆盖已有尺寸 | 关闭后只给还没有尺寸的图片补上 |

## 注意事项

**重命名图片后请勿使用 Ctrl+Z 撤销。** 插件会修改磁盘上的物理文件名，编辑器的撤销只能回退文本中的链接文字，无法还原文件名，会导致图片无法显示。

批量操作前建议备份仓库。

## 更新日志

### v1.2.0
- 修复：`" >引用"`（引用标记前多打一个空格）以前被当成"缩进有语法含义的引用行"整行放过，排版一点没修。现在会修成 `"> 引用"`，引用标记前的零散空格删掉、标记与正文之间补一个空格
- 修复：一个落单的 `$$` 会让**整篇**公式排版失效（原来要求 `$$` 成对）。现在每个 `$$` 往后找第一个"配起来像公式"的 `$$`，配起来像正文的区域（含空行 / 标题 / 围栏 / 分隔线 / 跨几百行）自动跳过，后面的真公式照排
- 修复：整库批处理遇到**第一篇读不出来的笔记就中断**，后面所有笔记被静默跳过 —— 表现为"整库没修、单篇能修"。现在单篇失败记日志、计入失败数、继续跑完，结果提示里说明处理了多少篇、几篇出错
- 修复：整库写盘改用 `vault.process`（原子读—改—写），不再把编辑器里尚未落盘的改动覆盖掉
- 修复：行首缩进修复不再把 `#标签` 当成标题，标签行前手滑多打的空格会被删掉
- 新增：块级标记的空白规范 —— 多级引用（`">>引用"` → `"> > 引用"`）、callout（`">[!note]"` → `"> [!note]"`）、列表符号后的多个空格（`"-    项目"` → `"- 项目"`）、标题符号后的多个空格（`"##   标题"` → `"## 标题"`）。`#标签` 后面没有空格，是标签不是标题，不会被加空格；列表项里的引用、引用里的嵌套块，缩进有语法含义，一律保留
- 新增：**标签排版** —— 一块内容里同时有正文和标签时，标签统一挪到块尾并与正文空一格。一个段落算一块，一行列表项、一行标题各自算一块，**表格按单元格算块**（整行算一块会把标签挪到别的列）；整行只有标签时位置不动。frontmatter、围栏代码块、缩进代码块、`$$` 公式、行内代码、`%%注释%%`、双链与 Markdown 链接里的 `#` 都不算标签
- 新增：**标签排序** —— 同一处出现的多个标签按首字母排序（中文按拼音、数字按数值）
- 新增：**内容板块排版** —— 按首字母对笔记各块内容排序。标题把笔记切成小节、只在小节内排序；表格、图片、分隔线、脚注、公式、聊天记录是锚点，原地不动并切开排序范围；列表与段落分别排序、互不穿插；有序列表排完顺手把编号写顺
- 新增：**公式排版** —— 整理数学公式的 LaTeX 代码（`$$…$$` 区块与行内 `$…$`，行内只按空格规则、不换行），让代码里的空格与公式渲染出来的空格一致：`=` `+` `\le` `&` `\\` 左右各一个空格；一元正负号与 `\partial` `\delta` `\sin` 这类命令和参数贴紧（`\delta x` → `\delta{x}`）；逗号前不加、后加一个空格；`$$` 与内容贴紧；多余空格与不是 `\\` 的换行全部删掉；只在 `\\` 处换行，续行缩进 = 首行缩进 + 1 个 tab。间距命令与后面字母粘连（`\quadA`，LaTeX 会当成未定义命令报错）会拆开：前面已有逗号等分隔就删掉多余的间距，否则写成 `\quad{A}`。`\text{…}` 里的文字、代码块、带 `\\` 的行内公式都不动
- 结果提示现在会写明**本次处理多少篇、几篇出错、开了哪几步** —— "为什么这篇没修"（某一项开关没开）一眼可见
- 命令回调改为返回 Promise，整库批处理路径可以被测试直接驱动
- 新增模块 `src/markdown-markers.ts`、`src/tags.ts`、`src/block-sort.ts`、`src/latex-layout.ts`、`src/text-pipeline.ts`、`src/line-scan.ts`、`src/collate.ts`，以及对应的期望输出、安全边界与幂等性测试；`test/commands.test.ts` 增加整库批处理的回归测试（含"中间一篇读取失败"的用例）

### v1.1.8
- 聊天记录排版命令（以及右键 **文本排版** 里的那一项）现在还会修掉**行首的坏缩进**：`" \t"`（空格 + Tab）、`"\t\t "`（Tab 带零散空格）、"一个 tab 写成 4 个空格"、以及正文/图片前手滑多打的 1~3 个空格，都会归一成纯 tab。frontmatter 与代码块内部不动；缩进有语法含义的地方也保留（后面跟列表符号 / 引用 / 标题 / 表格，或列表项里隔空行的段落）
- 新增设置项 **行首缩进修复**：智能（默认）/ 严格（行首只留 tab，列表嵌套也压平）/ 关闭
- 修复：头部行自带缩进时（如 `" \t李四 2024/1/5 14:31:02"`），那截缩进会以"看起来是空行"的形式留在两条消息之间；现在不再当成正文输出
- 新增模块 `src/text-layout.ts` 与 `test/text-layout.test.ts`（期望输出、frontmatter / 代码块 / 列表子项 / 列表项段落的安全边界、幂等性，以及"缩进 + 聊天记录"整条链的幂等性）

### v1.1.7
- 右键二级菜单（**图片功能** / **文本排版**）改用 Obsidian 原生子菜单：菜单项最右侧带 `›` 箭头，悬停或点击即在旁边展开，父菜单不收起，键盘左右键也能进出。没有该接口的旧版本退回原行为，标题自带 `›`
- 修复：**修复聊天记录排版** 与 **重命名乱码图片** 之前只能在右键菜单里用，现在都注册了命令（当前笔记 / 整个仓库），菜单里的每个操作在命令面板里都有对应入口
- 新增回归测试：把插件在 Obsidian API 替身上真正加载一遍，双向审计命令注册 —— 菜单操作必须有命令、命令 ID 保持不变、原生与退化两条子菜单路径产出一致

### v1.1.6
- 新增「**整理图片位置**」：找出引用了**别处**图片的链接（复制粘贴笔记后的典型情况），把图片复制一份到本笔记自己的附件夹并改写链接
  - 附件夹里已有完全相同的副本 → 只改链接，不重复复制
  - 附件夹里已有同名但内容不同的文件 → 复制成 `名字 2.ext`，绝不覆盖
  - 判定前会按字节比对图片内容，不同的图绝不会被当成同一张
- 修复：**重命名 / 改写链接后图片显示成别的图**。全库存在同名图片时，旧的兜底解析会取第一个匹配，可能改错文件、把链接指向另一张图。现在只有能唯一确定时才处理，否则跳过并说明原因
- 修复：同一张图被多篇笔记引用时，全库批处理会对它反复重命名（文件名来回跳）。现在每张图每批只处理一次
- 修复：「重命名后链接格式」选「仅文件名」时，即使文件名在全库不唯一也会被剥成裸文件名，制造出有歧义、可能显示错图的链接。现在同名时强制保留完整路径
- 修复：统一链接格式时 `#outline` 这类片段会被抹掉
- 修复：正文以 Markdown 图片链接结尾时，图片路径被聊天记录发言人匹配逻辑切断
- 聊天记录排版可配置：用户名、日期、时间可分别开关
- 正文缩进可选制表符 / 2 空格 / 4 空格 / 不缩进
- 图文消息中图片可设为在上方、下方或保持原顺序
- 头部信息全关时可选在消息之间插入空行
- 修复空行无限累积（消息后跟空行 + 下一条发言人无法识别时，每次执行多一个换行）
- 关闭用户名显示后不再丢失文字（上一行内容曾被误判成发言人丢弃）
- 右键菜单收进「图片功能」「文本排版」两个二级栏
- 新增「一键设置图片大小」，支持 `|100`、`|100x200`、留空移除，且不会吃掉图片说明文字
- 排版引擎拆分为 `src/chat-log.ts`、`src/image-size.ts`、`src/image-links.ts`、`src/image-organizer.ts`、`src/attachment-folder.ts`，`npm test` 覆盖期望输出、全部设置组合的幂等性与同名安全规则

### v1.1.4
- 修复 `restoreNotices()` 未清除 MutationObserver 设置的内联样式，导致 notice 容器被永久隐藏，进而影响其他插件弹窗（如 Image Converter）的问题
- 新增 `Set<HTMLElement>` 追踪所有被隐藏的元素，恢复时重置其 CSS 属性
- 弹窗恢复改为延迟 5 秒执行，等待被屏蔽的刷屏通知自然过期后再解除屏蔽
- 操作结果通知（成功/失败）改为解除屏蔽后弹出，确保不会被一同屏蔽

### v1.1.2
- 进度指示改用 Obsidian 自带状态栏显示，单文件操作时按图片数量逐张更新进度
- 通知屏蔽覆盖所有操作类型，包括单文件右键操作
- 新增 MutationObserver 作为通知屏蔽的兜底方案

### v1.1.1
- 批量操作时向 `document.body` 添加 `suppress-notices` CSS 类，通过 `styles.css` 隐藏系统通知弹窗
- 全库和文件夹批量操作在状态栏显示实时进度

### v1.1.0
- 批量操作通知屏蔽（CSS 方案）
- 状态栏实时进度文字
- 乱码检测改进：纯数字+点号文件名被识别为自动生成

### v1.0.9
- Wikilink 正则改用非贪婪匹配，处理文件名中嵌套 `]` 的情况
- 三层乱码检测：特殊字符、URL 编码残留、自动生成模式
- `resolveImageLink()` 统一文件解析，原生 API 失败时回退为全局查找

### v1.0.8
- 全库 basename 去重，预构建 `Map<basename, vaultPath>` 映射表
- 强制重命名模式：对已符合预设格式的图片也重新命名
- 操作互斥锁，防止并发操作冲突

### v1.0.6
- 链接格式设置：重命名后可选完整路径或仅文件名
- 已符合预设命名的图片自动跳过
- 批量进度从频繁弹窗改为状态栏显示

### v1.0.5
- 自定义图片命名预设，支持 `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}` 占位符
- 右键菜单支持单文件 / 文件夹 / 全库级别的图片重命名
- 全部重命名完成后统一修正链接格式

### v1.0.4
- QQ/微信聊天记录排版修复
- 支持 WebP 和 HEIC 格式

### v1.0.3
- 转换后保留图片尺寸语法（`![|350]`）
- 强化路径解析引擎，处理特殊字符和 URL 编码路径

### v1.0.2
- 遵循 Obsidian 系统附件文件夹设置
- 自动创建嵌套附件目录

### v1.0.1
- 库内乱码图片检测与重命名
- 通过 `fileManager.renameFile` API 自动更新全库引用

### v1.0.0
- 首次发布：外部绝对路径图片转入仓库

## 安装

1. 从 [Releases](https://github.com/Kflho/obsidian-absolute-image-transfer/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `.obsidian/plugins/obsidian-absolute-image-transfer/`
3. 在设置 → 第三方插件中启用
