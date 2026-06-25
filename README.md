# Absolute Image Transfer

An Obsidian desktop plugin that transfers externally-linked images (absolute paths) into your vault and converts them to clean `![[...]]` internal links. Also handles garbled-image renaming and QQ/WeChat chat log reformatting.

**Repository:** https://github.com/Kflho/obsidian-absolute-image-transfer

## Why This Plugin?

When you paste Markdown notes from QQ, WeChat, or local editors like Typora into Obsidian, you typically face two frustrating problems:

1. **Fragile absolute paths:** Pasted images use links like `!(file:///D:\...\xxx.gif)`. The images never enter your vault, and if you clean your chat cache, all images in your notes instantly break (File not found).

2. **Garbled filenames:** QQ generates absurd filenames like `Q)\TN\Q)TNF]S%MRO@AI1(F[I]OYC.gif`, sometimes containing control characters (`%01`) or folder names with backslashes and brackets like `C]\GU`. Obsidian's renderer chokes on these — it can't distinguish paths from garbage, leading to blank screens or errors.

Most similar plugins (e.g., Local Images Plus) fail on these extreme edge cases. This plugin uses a hardened path-resolution engine to reliably extract, rename, and convert your local images into clean Obsidian wikilinks.

## Installation

### Manual Installation

1. Download `main.js` and `manifest.json` from the [Releases](https://github.com/Kflho/obsidian-absolute-image-transfer/releases) page.
2. In your Obsidian vault, navigate to `.obsidian/plugins/`.
3. Create a folder named `obsidian-absolute-image-transfer` and place both files inside.
4. Restart Obsidian, go to **Settings → Community Plugins**, disable Safe Mode, and enable **Absolute Image Transfer**.

> **⚠️ IMPORTANT: Do NOT use Ctrl+Z / Undo after renaming images!**
>
> This plugin modifies physical files on disk (not just note text). If you rename garbled images and then press Ctrl+Z in the editor:
> - The text will revert to the old `![[garbled_name.png]]` link
> - But the file on disk has already been renamed
> - Result: broken image (File not found)
>
> **Recommendation:** Back up your vault (Git or cloud) before batch operations on large folders.

## Quick Start

### 1. Right-Click Context Menu (Recommended)

- **Single note:** Right-click any `.md` file → **Convert external images in this file** or **Rename garbled images in this file**.
- **Entire folder:** Right-click a folder → **Convert external images under this folder** to recursively process all notes.
- **Fix chat logs:** Right-click a note or folder → **Fix chat log formatting** to convert messy QQ/WeChat timestamps into clean indented format.

### 2. Command Palette

Open the command palette (`Ctrl/Cmd + P`) and search for:
- **Convert external images in current note**
- **Convert external images in entire vault**
- **Rename all images in vault to preset format**

### 3. Global Batch Processing

Use **Convert external images in entire vault** from the command palette when migrating an entire workspace (e.g., from Typora) into Obsidian.

## Features

- **One-click transfer:** Auto-detects `file:///` or `C:\` absolute paths, copies images into vault, replaces links with `![[Pasted image YYYYMMDDHHmmss.ext]]`.
- **Image size preservation (v1.0.3+):** Retains Markdown image size syntax (`![|350]` or `![[image.png|425]]`) after conversion.
- **Hardened path resolution engine:** Handles URL-encoded characters (`%01`, `%20`), markdown escape backslashes, and special characters in folder names (`C]\GU`).
- **Respects Obsidian attachment settings (v1.0.2+):** Follows your system attachment folder configuration. Auto-creates nested directories as needed.
- **Garbled image renaming:** One-click cleanup of internally-linked images with garbled names — renames files AND auto-updates all referencing notes.
- **Custom naming presets (v1.0.5+):** Define your own filename format with `{YYYY} {MM} {DD} {HH} {mm} {ss}` placeholders.
- **Link format control (v1.0.6+):** Choose between full-path or filename-only wikilinks after renaming.
- **Chat log formatter (v1.0.4+):** Reformats QQ/WeChat exported text into `Username: YYYY/MM/DD HH:mm:ss` with tab-indented messages. Strictly idempotent.
- **WebP & HEIC support:** All image operations support png, jpg, jpeg, gif, bmp, webp, and heic formats.

## Supported Image Formats

`png`, `jpg`, `jpeg`, `gif`, `bmp`, `webp`, `heic` — case-insensitive.

## License

MIT License.

---

# 中文说明 / Chinese README

开发这个插件的初衷非常简单：天下苦 QQ/微信 等软件的导出图片久矣！

当你从这些社交软件（或者 Typora 等本地编辑器）直接复制 Markdown 笔记到 Obsidian 时，通常会面临两个让人崩溃的问题：

脆弱的物理链接：粘贴进来的图片格式往往是 !(file:///D:\...\xxx.gif)。这不仅意味着图片根本没存进你的 Obsidian 仓库，而且只要你稍微清理一下聊天记录缓存，笔记里的图片瞬间全部失效（File not found）。

极其阴间的乱码命名：某些版本的 QQ 命名简直反人类，比如 Q)\TN\Q)TNF]S%MRO@AI1(F[I]OYC.gif，甚至包含 %01 这种控制字符或者像 C]\GU 这样带反斜杠和括号的文件夹名。这会导致 Obsidian 的渲染引擎彻底懵逼——它分不清哪个是路径、哪个是乱码，最终直接白屏或报错。

市面上常见的同类插件（如 Local Images Plus）遇到这种”变态”路径基本都会直接报错罢工。
因此，我写了这个插件。它的目标只有一个：用最硬核的算法，把你笔记里的本地图片无论如何都安全地拔下来、重命名，并转换为最干净的 Obsidian 原生双链。

📂 项目地址：https://github.com/Kflho/obsidian-absolute-image-transfer

✨ 核心特性

一键提取与原生转换：自动解析形如 file:/// 或 C:\ 的外部绝对路径，将图片物理搬运至仓库内，并将链接替换为原生的 ![[Pasted image 2026xxxx.png]]。

图像缩放尺寸保留 (v1.0.3)：如果你在转换前给图片设置了显示大小（例如 ![|350](file://...) 或 ![[乱码图.png|425]]），插件在转换 and 重命名后会为你完美保留这个缩放参数。

究极防御的路径探测引擎 (v1.0.3)：

完美兼容空格及中文字符。

双轨匹配算法：无视路径中混杂的 URL 编码（如 %01、%20）、无视 Obsidian 强加的转义反斜杠 \、无视括号 () [] 等特殊符号。只要这张图还在你的硬盘上，哪怕在 C]\GU 这种奇葩文件夹里，插件掘地三尺也能把它找出来拷走。

完全顺从你的附件设置 (v1.0.2)：插件不会强行把图片丢在当前目录。它会精准读取并遵循你 Obsidian 系统设置中的“附件默认存放路径”。无论你是设置在根目录、当前目录、还是指定的 Assets 文件夹，深层目录不存在时还会自动为你递归创建。

库内乱码文件大清洗：如果图片已经进了仓库，但名字还是 ![[7A\6...gif]] 这种阴间格式。没关系，直接右键一键洗白，重命名文件的同时，全库所有引用该图片的笔记链接都会瞬间自动更新。

聊天记录排版修复 (v1.0.4)：专门针对从 QQ/微信 直接粘贴的文本。自动识别“用户名 时间”这种乱序或单行排版，并强制修复为标准格式：标题行展示“用户名: 标准时间”，消息内容自动换行并添加 Tab 缩进，视觉体验拉满。

🚀 快速上手

插件安装后，无需复杂配置，直接开箱即用。以下是三种最常用的场景：

1. 右键菜单 (Context Menu) —— 强烈推荐！

洗白单篇笔记：在左侧文件树中，右键点击任意 .md 文件，选择 转换本文件内的外部图片 或 重命名本文件内的乱码图片。

批量处理整个文件夹：整理别人的库或刚导出一大批笔记？右键点击那个文件夹，选择 转换该文件夹下的外部图片，插件会帮你自动遍历所有子文件夹，喝口水的功夫，几百张图片就全进仓库了。

修复聊天记录：右键点击笔记或文件夹，选择 修复聊天记录排版，即可瞬间将凌乱的聊天记录转换为整齐的带缩进格式。

2. 快捷键 & 命令面板

打开一篇正在编辑的笔记，按下 Ctrl/Cmd + P 呼出命令面板，搜索 转换当前笔记中的外部图片 即可执行。你可以为它绑定一个顺手的快捷键。

3. 全局暴力兜底

命令面板搜索 转换整个仓库中的外部图片。如果你刚把整个 Typora 的工作区迁移过来，按这个就对了。

📸 效果演示

转换前 (脆弱且无法渲染的外部链接):

这里是一段笔记内容。
![|350](file:///D:\QQ_Data\Tencent%20Files\Image\58`7R\(F{BB37HFZ7$@FL%_H.png)


转换后 (干净的 Obsidian 原生双链，缩放参数依然保留):

这里是一段笔记内容。
![[Pasted image 20260420123045.png|350]]


📦 安装说明

手动安装

从本仓库的 Releases 页面下载最新版本的 main.js 和 manifest.json。

在你的 Obsidian 仓库中，进入 .obsidian/plugins/ 目录。

新建一个名为 obsidian-absolute-image-transfer 的文件夹，把上面两个文件扔进去。

重启 Obsidian，在设置 -> 第三方插件中关闭安全模式，并启用本插件。

⚠️ 极其重要的警告：严禁使用 Ctrl + Z 撤销！

由于本插件不仅仅是修改文本，它还会对你硬盘上的物理文件进行移动和重命名。
如果你在执行了“乱码图片重命名”后，习惯性地在笔记里按了 Ctrl + Z 试图撤销：

Obsidian 的编辑器会乖乖把文本变回那个 ![[乱码名字.png]]。

但是，硬盘上的文件名字早就变成 Pasted image... 了，不会跟着变回去！

这会导致你的笔记试图读取一个已经不存在的旧名字，图片直接显示破损 (File not found)。

建议：在对包含大量笔记的文件夹执行批量操作前，建议先用 Git 或云盘备份一下仓库。操作完就让它过去，千万别撤销。

📄 更新日志

🎉 v1.0.6：链接格式控制与批量优化

新增：设置项「重命名后链接格式」，提供"完整路径"与"仅文件名"两种模式。重命名图片后自动统一修正全库链接格式，即使图片名已符合预设也会检查并修正链接。

新增：已符合预设命名格式的图片自动跳过，避免无效的重复重命名操作。

优化：批量重命名时，右上角频繁弹出的进度通知改为右下角状态栏显示（格式：当前序号/总数），完成后显示 ✓ 并 3 秒后自动消失。出错时自动清除状态栏，仅弹出单条错误提示。

优化：链接格式修正改为一次性批量扫描，所有重命名完成后统一处理全库图片链接，避免逐文件重复扫描。

🎉 v1.0.5：自定义命名与全量转换

新增：自定义图片命名预设。支持 {YYYY} {MM} {DD} {HH} {mm} {ss} 时间戳占位符，用户可在设置中自由定义转换后图片的文件名格式（如 `Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}`）。

新增：右键菜单「全量图片重命名」功能。支持单文件、文件夹及整个仓库三个层级，将库内所有图片统一重命名为预设格式。通过 Obsidian 原生 `app.fileManager.renameFile` API 执行，自动同步更新全库所有 Markdown 引用链接，确保不产生断链。

🎉 v1.0.4：QQ/微信排版救星

新增：智能聊天记录修复引擎。支持自动补全缺失的年份（如 QQ 消息），并将单数字月份/日期（5/6）统一强制补零对齐（05/06），确保 YYYY/MM/DD HH:mm:ss 格式美观统一。

优化：强制执行 [用户名: 时间] \n \t [内容] 排版逻辑，并完美保留原始笔记中的空行间距，绝不乱删空行。

🎉 v1.0.3：尺寸保留与硬核解构引擎

新增：支持识别并保留 Markdown 图片大小语法（如 ![|350] 或双链 |425），转换后图片大小不走样。

加强：重写了底层路径解析引擎，采用“双轨探测”。彻底攻克形如 C]\GU 的奇葩目录以及包含 %01 字面量的极端乱码路径，容错率拉满。

🎉 v1.0.2：原生附件存储体系深度融合

告别硬编码的 Attachments 文件夹！全面接管并 100% 遵守 Obsidian 官方的附件存放设置，图片该去哪就去哪。支持自动递归建立不存在的多层目录。

🎉 v1.0.1：库内乱码图片一键清洗

针对已经导入库内但名字极其诡异的双链图片（带斜杠、括号、乱码），提供了一键清理重命名功能，并调用系统 API 实现全库引用无感自动更新。

📄 许可证

本项目基于 MIT License 开源。