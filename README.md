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

## How to use

| Method | Action |
|--------|--------|
| Right-click a `.md` file | Convert / rename / fix chat logs for that note |
| Right-click a folder | Batch process all notes in that folder |
| Command palette (`Ctrl+P`) | Convert images in current note or entire vault; rename all images vault-wide |

### Settings

- **Attachment location** — where transferred images are stored (system default, vault root, current folder, subfolder, or custom path)
- **Image naming preset** — format for renamed images, supports `{YYYY}` `{MM}` `{DD}` `{HH}` `{mm}` `{ss}`
- **Link format after rename** — use full path (`folder/image.png`) or filename only (`image.png`)

## Supported formats

`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic` (case-insensitive)

## Important

**Do not use Ctrl+Z after renaming images.** This plugin renames physical files on disk. Undoing in the editor reverts the text link but not the filename — causing broken images.

Back up your vault before bulk operations.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/Kflho/obsidian-absolute-image-transfer/releases)
2. Place them in `.obsidian/plugins/obsidian-absolute-image-transfer/`
3. Enable the plugin in Settings → Community Plugins

## Changelog

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

## 使用方式

| 方式 | 操作 |
|------|------|
| 右键 `.md` 文件 | 转换、重命名、修复聊天记录 |
| 右键文件夹 | 批量处理文件夹下所有笔记 |
| 命令面板 (`Ctrl+P`) | 转换当前笔记 / 全库转换 / 全库重命名 |

## 支持的图片格式

`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic`

## 注意事项

**重命名图片后请勿使用 Ctrl+Z 撤销。** 插件会修改磁盘上的物理文件名，编辑器的撤销只能回退文本中的链接文字，无法还原文件名，会导致图片无法显示。

批量操作前建议备份仓库。

## 更新日志

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
