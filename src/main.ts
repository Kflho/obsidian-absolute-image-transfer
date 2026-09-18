import { App, Editor, MarkdownView, MarkdownFileInfo, MenuItem, Modal, Notice, Plugin, TFile, TFolder, TAbstractFile, Menu, normalizePath, Platform } from 'obsidian';
import { DEFAULT_SETTINGS, ImageTransferSettings, ImageTransferSettingTab } from "./settings";
import { ChatLogOptions, formatChatLog, resolveIndent } from "./chat-log";
import { applyImageSize, ImageSizeOptions } from "./image-size";
import { ImageSizeModal } from "./ui/image-size-modal";
import { getTargetAttachmentFolder as ensureTargetAttachmentFolder } from "./attachment-folder";
import {
    buildBasenameIndex,
    chooseLinkTarget,
    isImagePath,
    resolveImageLink as resolveImageLinkInVault,
} from "./image-links";
import { organizeNoteImages } from "./image-organizer";
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * MenuItem 的运行时扩展：Obsidian 一直有原生子菜单，只是没写进公开类型定义。
 * 调用 setSubmenu() 后菜单项会获得 `has-submenu` 类，并在最右侧自动画出 › 箭头
 * （`div.menu-item-icon.mod-submenu`，配合 `.menu-item-title { flex: 1 0 0 }` 顶到行尾）。
 * 拿不到时（旧版本 / 未来被移除）回退到"点击后在光标处弹出"，功能不受影响。
 */
type MenuItemWithSubmenu = MenuItem & { setSubmenu?: () => Menu };

export default class ImageTransferPlugin extends Plugin {
    settings!: ImageTransferSettings;
    private statusBarItemEl: HTMLElement | null = null;
    private noticeObserver: MutationObserver | null = null;
    private suppressedElements: Set<HTMLElement> = new Set();
    private restoreTimer: number | null = null;
    private isRenaming = false;
    /** 批次级的全库文件名索引（见 image-links.ts），用于识别同名图片歧义 */
    private batchIndex: Map<string, TFile[]> | null = null;

    async onload() {
        await this.loadSettings();

        // 初始化状态栏进度条目（初始为空）
        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('');

        // --------------------------------------------------------
        // 1. 注册快捷命令
        // --------------------------------------------------------

        this.addCommand({
            id: 'transfer-images-current-note',
            name: '转换当前笔记中的外部图片',
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (this.isRenaming) {
                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                    return;
                }
                this.isRenaming = true;
                this.suppressNotices();
                let finalMsg = '';
                try {
                    if (!ctx.file) {
                        finalMsg = '⚠️ 无法获取当前文件，请确保您打开了一篇笔记！';
                        return;
                    }
                    this.showProgress(0, 1, '📷 外部图片转换');
                    const updated = await this.processNote(ctx.file);
                    if (updated) {
                        this.finishProgress('✅ 转换完成');
                        finalMsg = '✅ 当前笔记外部图片转换完成！';
                    } else {
                        this.clearProgress();
                        finalMsg = '没有发现需要转换的外部本地图片。';
                    }
                } catch (e) {
                    this.clearProgress();
                    console.error(e);
                    finalMsg = '❌ 处理过程中发生意外错误，请检查控制台。';
                } finally {
                    this.restoreNotices(finalMsg);
                    this.isRenaming = false;
                }
            }
        });

        this.addCommand({
            id: 'transfer-images-entire-vault',
            name: '转换整个仓库中的外部图片',
            callback: async () => {
                if (this.isRenaming) {
                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                    return;
                }
                this.isRenaming = true;
                this.suppressNotices();
                let finalMsg = '';
                try {
                    const files = this.app.vault.getMarkdownFiles();
                    let processedCount = 0;
                    const reservedPaths = new Map<string, string>();
                    const reservedBasenames = this.buildVaultBasenameMap();

                    this.showProgress(0, files.length, '📷 外部图片转换');
                    for (let i = 0; i < files.length; i++) {
                        const f = files[i];
                        if (!f) continue;
                        const updated = await this.processNote(f, reservedPaths, reservedBasenames);
                        if (updated) processedCount++;
                        this.showProgress(i + 1, files.length, '📷 外部图片转换');
                    }
                    this.finishProgress('✅ 转换完成');
                    finalMsg = `🎉 全局处理完毕！共更新了 ${processedCount} 篇笔记。`;
                } catch (e) {
                    this.clearProgress();
                    console.error(e);
                    finalMsg = '❌ 全局处理中断，请检查控制台。';
                } finally {
                    this.restoreNotices(finalMsg);
                    this.isRenaming = false;
                }
            }
        });

        this.addCommand({
            id: 'rename-all-images-entire-vault',
            name: '将整个仓库中的所有图片重命名为预设格式',
            callback: async () => {
                try {
                    const files = this.app.vault.getMarkdownFiles();

                    let totalCount = 0;
                    for (const file of files) {
                        totalCount += await this.countAllImages(file);
                    }
                    if (totalCount === 0) {
                        await this.fixAllImageLinkFormats();
                        new Notice('ℹ️ 仓库中没有需要重命名的图片，已检查并修正链接格式。');
                        return;
                    }
                    new ConfirmRenameModal(this.app, totalCount, async () => {
                        if (this.isRenaming) {
                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                            return;
                        }
                        this.isRenaming = true;
                        this.suppressNotices();
                        let finalMsg = '';
                        try {
                            let renamedCount = 0;
                            const reservedPaths = new Map<string, string>();
                            const reservedBasenames = this.buildVaultBasenameMap();
                            const processedFiles = new Set<string>();
                            this.batchIndex = buildBasenameIndex(this.app);
                            this.showProgress(0, files.length, '📷 图片重命名');
                            for (let i = 0; i < files.length; i++) {
                                const f = files[i];
                                if (!f) continue;
                                renamedCount += await this.renameAllImages(f, reservedPaths, reservedBasenames, false, undefined, processedFiles);
                                this.showProgress(i + 1, files.length, '📷 图片重命名');
                            }
                            await this.fixAllImageLinkFormats();
                            this.finishProgress('✅ 重命名完成');
                            finalMsg = `🎉 全局处理完毕！共重命名了 ${renamedCount} 张图片。`;
                        } catch (e) {
                            this.clearProgress();
                            console.error(e);
                            finalMsg = '❌ 重命名中断，请检查控制台。';
                        } finally {
                            this.restoreNotices(finalMsg);
                            this.isRenaming = false;
                        }
                    }).open();
                } catch (e) {
                    this.clearProgress();
                    console.error(e);
                    new Notice('❌ 全局处理中断，请检查控制台。');
                }
            }
        });

        this.addCommand({
            id: 'force-rename-all-images-entire-vault',
            name: '强制重命名整个仓库中的所有图片（包括已符合格式的图片）',
            callback: async () => {
                try {
                    const files = this.app.vault.getMarkdownFiles();

                    let totalCount = 0;
                    for (const file of files) {
                        totalCount += await this.countAllImagesForce(file);
                    }
                    if (totalCount === 0) {
                        await this.fixAllImageLinkFormats();
                        new Notice('ℹ️ 仓库中没有需要重命名的图片，已检查并修正链接格式。');
                        return;
                    }
                    new ConfirmRenameModal(this.app, totalCount, async () => {
                        if (this.isRenaming) {
                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                            return;
                        }
                        this.isRenaming = true;
                        this.suppressNotices();
                        let finalMsg = '';
                        try {
                            let renamedCount = 0;
                            const reservedPaths = new Map<string, string>();
                            const reservedBasenames = this.buildVaultBasenameMap();
                            const processedFiles = new Set<string>();
                            this.batchIndex = buildBasenameIndex(this.app);
                            this.showProgress(0, files.length, '📷 图片重命名（强制）');
                            for (let i = 0; i < files.length; i++) {
                                const f = files[i];
                                if (!f) continue;
                                renamedCount += await this.renameAllImages(f, reservedPaths, reservedBasenames, true, undefined, processedFiles);
                                this.showProgress(i + 1, files.length, '📷 图片重命名（强制）');
                            }
                            await this.fixAllImageLinkFormats();
                            this.finishProgress('✅ 重命名完成');
                            finalMsg = `🎉 全局处理完毕！共重命名了 ${renamedCount} 张图片。`;
                        } catch (e) {
                            this.clearProgress();
                            console.error(e);
                            finalMsg = '❌ 重命名中断，请检查控制台。';
                        } finally {
                            this.restoreNotices(finalMsg);
                            this.isRenaming = false;
                        }
                    }).open();
                } catch (e) {
                    this.clearProgress();
                    console.error(e);
                    new Notice('❌ 全局处理中断，请检查控制台。');
                }
            }
        });

        this.addCommand({
            id: 'set-image-size-current-note',
            name: '设置当前笔记的图片大小',
            editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (!ctx.file) {
                    new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                    return;
                }
                this.openImageSizeModal([ctx.file], '当前笔记');
            }
        });

        this.addCommand({
            id: 'set-image-size-entire-vault',
            name: '设置整个仓库的图片大小',
            callback: () => {
                this.openImageSizeModal(this.app.vault.getMarkdownFiles(), '整个仓库');
            }
        });

        this.addCommand({
            id: 'organize-images-current-note',
            name: '整理当前笔记的图片位置',
            editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (!ctx.file) {
                    new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                    return;
                }
                void this.runOrganizeImages([ctx.file], '当前笔记');
            }
        });

        this.addCommand({
            id: 'organize-images-entire-vault',
            name: '整理整个仓库的图片位置',
            callback: () => {
                void this.runOrganizeImages(this.app.vault.getMarkdownFiles(), '整个仓库');
            }
        });

        this.addCommand({
            id: 'rename-garbled-images-current-note',
            name: '重命名当前笔记中的乱码图片',
            editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (!ctx.file) {
                    new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                    return;
                }
                void this.runGarbledRename([ctx.file], '本文件内');
            }
        });

        this.addCommand({
            id: 'rename-garbled-images-entire-vault',
            name: '重命名整个仓库中的乱码图片',
            callback: () => {
                void this.runGarbledRename(this.app.vault.getMarkdownFiles(), '整个仓库');
            }
        });

        this.addCommand({
            id: 'format-chat-log-current-note',
            name: '修复当前笔记的聊天记录排版',
            editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (!ctx.file) {
                    new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                    return;
                }
                void this.runChatLog([ctx.file], '本文件内');
            }
        });

        this.addCommand({
            id: 'format-chat-log-entire-vault',
            name: '修复整个仓库的聊天记录排版',
            callback: () => {
                void this.runChatLog(this.app.vault.getMarkdownFiles(), '整个仓库');
            }
        });

        // --------------------------------------------------------
        // 2. 注册右键菜单（图片功能 / 文本排版 两个二级菜单）
        //    菜单里的每个操作都在上面有对应命令，两条路走同一套实现
        // --------------------------------------------------------
        this.registerFileMenu();

        this.addSettingTab(new ImageTransferSettingTab(this.app, this));

        new Notice(`Image transfer v${this.manifest.version} reloaded`);
    }

    async loadSettings() {
        const data = (await this.loadData()) as ImageTransferSettings | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 在右下角状态栏显示进度指示 (e.g. "📷 图片重命名: 3/36")
     */
    private showProgress(current: number, total: number, label?: string) {
        if (this.statusBarItemEl) {
            const prefix = label ?? '处理进度';
            this.statusBarItemEl.setText(`${prefix}: ${current}/${total}`);
        }
    }

    /**
     * 进度完成：短暂显示完成信息后清空
     */
    private finishProgress(message: string) {
        if (this.statusBarItemEl) {
            this.statusBarItemEl.setText(message);
            window.setTimeout(() => {
                if (this.statusBarItemEl) {
                    this.statusBarItemEl.setText('');
                }
            }, 5000);
        }
    }

    /**
     * 出错时清除状态栏进度
     */
    private clearProgress() {
        if (this.statusBarItemEl) {
            this.statusBarItemEl.setText('');
        }
    }

    /**
     * 屏蔽 Obsidian 通知弹窗（批量操作时避免 "已修改 N 条链接" 刷屏）。
     * 双层策略：
     * 1. body class + styles.css 中的 !important 规则 — 零延迟，无闪烁
     * 2. MutationObserver 兜底 — 捕获 CSS 遗漏的元素
     */
    private suppressNotices() {
        // 取消上一次尚未触发的恢复定时器，避免前后两次操作竞态
        if (this.restoreTimer !== null) {
            clearTimeout(this.restoreTimer);
            this.restoreTimer = null;
        }
        const hadClass = document.body.classList.contains('suppress-notices');
        document.body.classList.add('suppress-notices');
        console.debug('[ImageTransfer] suppressNotices called, body had class:', hadClass);

        if (!this.noticeObserver) {
            console.debug('[ImageTransfer] Creating MutationObserver');
            this.noticeObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const nodes = Array.from(mutation.addedNodes);
                    for (const node of nodes) {
                        if (node instanceof HTMLElement) {
                            const classes = Array.from(node.classList);
                            if (classes.some(c => c.includes('notice'))) {
                                console.debug('[ImageTransfer] MutationObserver hiding:', classes.join(' '));
                                node.setCssProps({
                                    display: 'none',
                                    visibility: 'hidden',
                                    opacity: '0',
                                    'pointer-events': 'none',
                                });
                                this.suppressedElements.add(node);
                            }
                        }
                    }
                }
            });
        }
        this.noticeObserver.observe(document.body, { childList: true, subtree: true });
        console.debug('[ImageTransfer] MutationObserver started observing');
    }

    /**
     * 恢复通知弹窗显示。
     * 延迟 5 秒等待被屏蔽的刷屏弹窗自然过期（Obsidian 默认 notice 时长），
     * 然后解除屏蔽，最后弹出操作结果通知。
     * @param finalMessage 操作结果消息，解除屏蔽后显示；空字符串则不显示
     */
    private restoreNotices(finalMessage?: string) {
        this.restoreTimer = window.setTimeout(() => {
            this.restoreTimer = null;
            document.body.classList.remove('suppress-notices');
            if (this.noticeObserver) {
                this.noticeObserver.disconnect();
                console.debug('[ImageTransfer] MutationObserver disconnected');
            }
            // 恢复所有被 MutationObserver 隐藏的元素的内联样式
            // 否则如果 Observer 捕获到了 .notice-container 等持久容器，
            // 其内联 display:none 会永久生效，导致其他插件（如 Image Converter）的弹窗也消失
            for (const el of this.suppressedElements) {
                el.setCssProps({
                    display: '',
                    visibility: '',
                    opacity: '',
                    'pointer-events': '',
                });
            }
            this.suppressedElements.clear();

            if (finalMessage) {
                new Notice(finalMessage);
            }
        }, 5000);
    }

    /**
     * 弹性路径解析：针对特殊字符路径的递归搜索
     */
    /**
     * 核心功能：读取插件配置，推断附件应存放的目标文件夹。
     * 具体规则见 attachment-folder.ts，与图片整理功能共用同一套逻辑。
     */
    private async getTargetAttachmentFolder(file: TFile): Promise<string> {
        return await ensureTargetAttachmentFolder(this.app, this.settings, file);
    }
    private async flexibleProbing(base: string, remaining: string): Promise<string | null> {
        const target = remaining.replace(/^[\\/]+/, '');
        if (!target) {
            try {
                const stats = await fs.stat(base);
                return stats.isFile() ? base : null;
            } catch { return null; }
        }

        try {
            const entries = await fs.readdir(base);
            entries.sort((a, b) => b.length - a.length);

            for (const entry of entries) {
                let consumedCount = 0;
                let normalizedMatch = "";

                for (let i = 0; i < target.length; i++) {
                    const char = target[i];
                    const nextChar = target[i + 1];
                    const isMarkdownEscape = /[[\]()\s]/.test(nextChar || "");
                    if (char === '\\' && nextChar !== undefined && isMarkdownEscape) {
                        continue;
                    }

                    normalizedMatch += char;
                    const decodedMatch = (() => {
                        try { return decodeURIComponent(normalizedMatch); }
                        catch { return normalizedMatch; }
                    })();

                    if (normalizedMatch.toLowerCase() === entry.toLowerCase() ||
                        decodedMatch.toLowerCase() === entry.toLowerCase()) {
                        consumedCount = i + 1;
                        break;
                    }
                    if (normalizedMatch.length > entry.length + 10) break;
                }

                if (consumedCount > 0) {
                    const nextBase = path.join(base, entry);
                    const found = await this.flexibleProbing(nextBase, target.substring(consumedCount));
                    if (found) return found;
                }
            }
        } catch { return null; }

        return null;
    }

    /**
     * 将原始链接解析为物理磁盘路径
     */
    private async resolvePhysicalPath(rawPath: string): Promise<string | null> {
        let clean = rawPath.replace(/^<?file:\/+/i, '').replace(/>?$/, '');
        let driveRoot = "";
        let pathBody = clean;

        if (Platform.isWin && /^[a-zA-Z]:/.test(clean)) {
            driveRoot = clean.substring(0, 2).toUpperCase() + path.sep;
            pathBody = clean.substring(2);
        } else if (clean.startsWith('/')) {
            driveRoot = path.sep;
            pathBody = clean.substring(1);
        }

        if (!driveRoot) return null;
        return await this.flexibleProbing(driveRoot, pathBody);
    }

    /**
     * 根据预设格式生成图片文件名
     * 支持占位符: {YYYY} {MM} {DD} {HH} {mm} {ss}
     */
    private formatImageName(preset: string, ext: string, momentObj?: moment.Moment): string {
        const m = momentObj ?? window.moment();
        const replacements: Record<string, string> = {
            '{YYYY}': m.format('YYYY'),
            '{MM}':   m.format('MM'),
            '{DD}':   m.format('DD'),
            '{HH}':   m.format('HH'),
            '{mm}':   m.format('mm'),
            '{ss}':   m.format('ss'),
        };
        let name = preset;
        for (const [placeholder, value] of Object.entries(replacements)) {
            name = name.split(placeholder).join(value);
        }
        return name + ext;
    }

    /**
     * 扫描仓库中所有图片文件，构建 basename → vaultPath 映射。
     * 这是跨文件夹去重的数据基础 —— 不依赖元数据缓存，直接读取文件列表。
     * 若同一 basename 对应多个文件，只保留最先扫描到的那一个（后续文件会在 renameAllImages 中被检测为冲突并强制重命名）。
     */
    private buildVaultBasenameMap(): Map<string, string> {
        const map = new Map<string, string>();
        for (const f of this.app.vault.getFiles()) {
            if (/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(f.name)) {
                if (!map.has(f.name)) {
                    map.set(f.name, f.path);
                }
                // 同名文件：不覆盖，第一个保留，后续的会在 renameAllImages 中触发冲突重命名
            }
        }
        return map;
    }

    /**
     * 生成唯一的目标路径。
     * 四层检查确保仓库内所有图片 basename 唯一：
     * ①目标路径是否已有文件  ②批次内是否已预留完整路径
     * ③批次/pre-scan内是否已预留 basename  ④pre-scan 仓库 basename 映射
     */
    private async generateUniqueTargetPath(
        currentAttachFolder: string,
        ext: string,
        startTime: moment.Moment,
        reservedPaths: Map<string, string>,
        reservedBasenames: Map<string, string>
    ): Promise<{ newFileName: string; targetVaultPath: string }> {
        const currentTime = startTime.clone();
        const MAX_ATTEMPTS = 100000;
        let attempts = 0;
        while (attempts < MAX_ATTEMPTS) {
            const newFileName = this.formatImageName(this.settings.imageNamePreset, ext, currentTime);
            const targetVaultPath = normalizePath(
                currentAttachFolder === "/" ? `/${newFileName}` : `${currentAttachFolder}/${newFileName}`
            );
            // ①目标路径是否已有文件
            if (this.app.vault.getAbstractFileByPath(targetVaultPath)) {
                currentTime.add(1, 'seconds'); attempts++; continue;
            }
            // ②批次内是否已预留该完整路径
            if (reservedPaths.has(targetVaultPath)) {
                currentTime.add(1, 'seconds'); attempts++; continue;
            }
            // ③批次内是否已预留该 basename（跨文件夹去重）
            if (reservedBasenames.has(newFileName)) {
                currentTime.add(1, 'seconds'); attempts++; continue;
            }
            reservedPaths.set(targetVaultPath, '');
            reservedBasenames.set(newFileName, '');  // '' = auto-generated name
            return { newFileName, targetVaultPath };
        }
        throw new Error('无法生成唯一文件名：超过最大尝试次数');
    }

    /**
     * 处理外部绝对路径图片并引入 Vault
     */
    async processNote(file: TFile, reservedPaths?: Map<string, string>, reservedBasenames?: Map<string, string>): Promise<boolean> {
        let content = await this.app.vault.read(file);
        const originalContent = content;

        const regex = /!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return false;
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);
        const rp = reservedPaths ?? new Map<string, string>();
        const rbn = reservedBasenames ?? new Map<string, string>();

        for (const match of matches) {
            const fullMatch = match[0];
            const altPartRaw = match[1] || "";
            const rawLink = match[2] || "";
            const finalPhysicalPath = await this.resolvePhysicalPath(rawLink);

            if (!finalPhysicalPath) continue;

            try {
                const ext = path.extname(finalPhysicalPath);
                const { newFileName, targetVaultPath } = await this.generateUniqueTargetPath(
                    currentAttachFolder, ext, window.moment(), rp, rbn
                );

                const fileBuffer = await fs.readFile(finalPhysicalPath);
                const arrayBuffer = fileBuffer.buffer.slice(
                    fileBuffer.byteOffset,
                    fileBuffer.byteOffset + fileBuffer.byteLength
                );

                await this.app.vault.createBinary(targetVaultPath, arrayBuffer);

                let altText = altPartRaw;
                if (altText.startsWith('|')) {
                    altText = altText.substring(1);
                }
                const newLink = `![[${newFileName}${altText ? "|" + altText : ""}]]`;
                content = content.replace(fullMatch, newLink);

            } catch (err) {
                console.error(`❌ 处理图片时出错: ${finalPhysicalPath}`, err);
            }
        }

        if (content !== originalContent) {
            await this.app.vault.modify(file, content);
            return true;
        }
        return false;
    }

    /**
     * 重命名乱码双链图片
     * @param onProgress 可选进度回调 (当前处理数, 总数)
     */
    /**
     * 解析图片链接到具体文件。
     *
     * 安全线：全库存在同名图片且原生解析失败时返回 null（而不是猜一张）。
     * 旧实现取"全局第一个同名文件"，同名图片多的时候可能对**另一张图**执行重命名、
     * 改写链接，表现为图片显示错乱、文件名乱跳。
     */
    private resolveImageLink(rawLink: string, sourcePath: string): TFile | null {
        const index = this.batchIndex ?? buildBasenameIndex(this.app);
        return resolveImageLinkInVault(this.app, sourcePath, rawLink, index).file;
    }
    async processGarbledImages(
        file: TFile,
        reservedPaths?: Map<string, string>,
        reservedBasenames?: Map<string, string>,
        onProgress?: (current: number, total: number) => void
    ): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        // 预统计图片链接总数用于进度
        const imageMatches = matches.filter(m => m[1] && /\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(m[1].trim()));
        const totalImages = imageMatches.length;

        let renamedCount = 0;
        let processedCount = 0;
        const processedFilePaths = new Set<string>();
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);
        const rp = reservedPaths ?? new Map<string, string>();
        const rbn = reservedBasenames ?? new Map<string, string>();

        for (const match of imageMatches) {
            const rawLink = match[1]!.trim();

            // 乱码检测：特殊字符 / URL 编码残留 / 纯数字+点号命名（明显非人工命名）
            const isGarbled = (() => {
                if (/[\\%{}()[\]~`^]/.test(rawLink)) return true;
                try {
                    if (decodeURIComponent(rawLink) !== rawLink) return true;
                } catch { /* decodeURIComponent throws on malformed input */ }
                const stem = rawLink.replace(/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i, '');
                if (stem.length > 0 && !/[^\d.\s\-_]/.test(stem)) return true;
                return false;
            })();

            if (!isGarbled) {
                processedCount++;
                if (onProgress) onProgress(processedCount, totalImages);
                continue;
            }

            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) {
                processedCount++;
                if (onProgress) onProgress(processedCount, totalImages);
                continue;
            }

            if (processedFilePaths.has(linkedFile.path)) {
                processedCount++;
                if (onProgress) onProgress(processedCount, totalImages);
                continue;
            }
            processedFilePaths.add(linkedFile.path);

            try {
                const ext = `.${linkedFile.extension}`;
                const { targetVaultPath } = await this.generateUniqueTargetPath(
                    currentAttachFolder, ext, window.moment(), rp, rbn
                );

                await this.app.fileManager.renameFile(linkedFile, targetVaultPath);
                renamedCount++;
            } catch (err) {
                console.error(`❌ 重命名乱码图片失败: ${linkedFile.path}`, err);
            }
            processedCount++;
            if (onProgress) onProgress(processedCount, totalImages);
        }
        return renamedCount;
    }

    /**
     * 扫描并统计文件中所有图片链接的数量（不修改任何内容）
     * 跳过已符合预设命名格式的图片
     */
    private async countAllImages(file: TFile): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let count = 0;
        const processedFilePaths = new Set<string>();

        for (const match of matches) {
            if (!match[1]) continue;
            const rawLink = match[1].trim();

            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) continue;

            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) continue;

            if (processedFilePaths.has(linkedFile.path)) continue;
            processedFilePaths.add(linkedFile.path);

            if (this.matchesNamePreset(linkedFile.name)) continue;

            count++;
        }
        return count;
    }

    /**
     * 强制模式计数：统计文件中所有图片链接（包括已符合格式的图片）
     */
    private async countAllImagesForce(file: TFile): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let count = 0;
        const processedFilePaths = new Set<string>();

        for (const match of matches) {
            if (!match[1]) continue;
            const rawLink = match[1].trim();

            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) continue;

            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) continue;

            if (processedFilePaths.has(linkedFile.path)) continue;
            processedFilePaths.add(linkedFile.path);

            count++;
        }
        return count;
    }

    /**
     * 全量重命名文件中所有图片链接为预设格式。
     * @param file 笔记文件
     * @param reservedPaths 批次内已预留的完整路径（targetPath → sourcePath）
     * @param reservedBasenames 仓库级 basename 注册表（basename → sourcePath），
     *   由 buildVaultBasenameMap() 初始化，运行中持续更新
     * @param force 为 true 时跳过 matchesNamePreset 检查，强制重命名所有图片
     * @param onProgress 可选进度回调 (当前处理数, 总数)
     * @returns 成功重命名的图片数量
     */
    async renameAllImages(
        file: TFile,
        reservedPaths?: Map<string, string>,
        reservedBasenames?: Map<string, string>,
        force?: boolean,
        onProgress?: (current: number, total: number) => void,
        processedFiles?: Set<string>
    ): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        // 预统计有效图片总数，用于进度条
        let totalImages = 0;
        const imageMatches: RegExpExecArray[] = [];
        for (const m of matches) {
            if (!m[1]) continue;
            const link = m[1].trim();
            if (/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(link)) {
                totalImages++;
                imageMatches.push(m);
            }
        }

        let renamedCount = 0;
        let processedCount = 0;
        // 批次级去重：同一张图被多篇笔记引用时只处理一次。
        // 否则全库批处理会对同一张图反复重命名，文件名来回跳。
        const processedFilePaths = processedFiles ?? new Set<string>();
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);
        const rp = reservedPaths ?? new Map<string, string>();
        const rbn = reservedBasenames ?? new Map<string, string>();

        for (const match of imageMatches) {
            const rawLink = match[1]!.trim();

            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) { processedCount++; if (onProgress) onProgress(processedCount, totalImages); continue; }

            if (processedFilePaths.has(linkedFile.path)) { processedCount++; if (onProgress) onProgress(processedCount, totalImages); continue; }
            processedFilePaths.add(linkedFile.path);

            // 非强制模式：检查已符合预设格式的图片是否需要保留原名还是因冲突而重命名
            if (!force && this.matchesNamePreset(linkedFile.name)) {
                const existingTargetPath = normalizePath(
                    currentAttachFolder === "/"
                        ? `/${linkedFile.name}`
                        : `${currentAttachFolder}/${linkedFile.name}`
                );
                const reservedByPath = rp.get(existingTargetPath);
                const reservedByName = rbn.get(linkedFile.name);

                // 完整路径未被预留，且 basename 未被其他文件占用（或就是本文件自己）→ 保留原名
                if (reservedByPath === undefined &&
                    (reservedByName === undefined || reservedByName === linkedFile.path)) {
                    rp.set(existingTargetPath, linkedFile.path);
                    if (reservedByName === undefined) {
                        rbn.set(linkedFile.name, linkedFile.path);
                    }
                    processedCount++;
                    if (onProgress) onProgress(processedCount, totalImages);
                    continue;
                }
                // 同一文件被多条笔记引用 → 已处理过，跳过
                if (reservedByPath === linkedFile.path) {
                    processedCount++;
                    if (onProgress) onProgress(processedCount, totalImages);
                    continue;
                }
                // 不同文件映射到同一路径或同名 basename → 冲突，强制重命名
            }

            try {
                const ext = `.${linkedFile.extension}`;
                const { targetVaultPath } = await this.generateUniqueTargetPath(
                    currentAttachFolder, ext, window.moment(), rp, rbn
                );

                await this.app.fileManager.renameFile(linkedFile, targetVaultPath);
                renamedCount++;
            } catch (err) {
                console.error(`❌ 重命名图片失败: ${linkedFile.path}`, err);
            }
            processedCount++;
            if (onProgress) onProgress(processedCount, totalImages);
        }
        return renamedCount;
    }

    /**
     * 检查文件名是否已匹配预设命名格式，避免重复重命名
     */
    private matchesNamePreset(fileName: string): boolean {
        const preset = this.settings.imageNamePreset;
        if (!preset) return false;

        const parts = preset.split(/(\{YYYY\}|\{MM\}|\{DD\}|\{HH\}|\{mm\}|\{ss\})/);
        let pattern = '^';
        for (const part of parts) {
            switch (part) {
                case '{YYYY}': pattern += '\\d{4}'; break;
                case '{MM}':   pattern += '\\d{2}'; break;
                case '{DD}':   pattern += '\\d{2}'; break;
                case '{HH}':   pattern += '\\d{2}'; break;
                case '{mm}':   pattern += '\\d{2}'; break;
                case '{ss}':   pattern += '\\d{2}'; break;
                default:
                    pattern += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
        }
        pattern += '\\.\\w+$';

        try {
            const regex = new RegExp(pattern, 'i');
            return regex.test(fileName);
        } catch {
            return false;
        }
    }

    /**
     * 核心功能三：修复聊天记录排版
     * 算法实现见 chat-log.ts（纯函数，脱离 Obsidian 可独立验证幂等性），此处只负责读写文件。
     */
    /**
     * 批量修正全库图片链接格式（重命名完成后调用一次即可）
     *
     * 安全线：目标文件名在全库不唯一时，即使设置为「仅文件名」也写完整路径 ——
     * 否则裸文件名会变成有歧义的链接，笔记可能显示成另一张同名图片。
     */
    private async fixAllImageLinkFormats() {
        const format = this.settings.renameLinkFormat || 'full';
        // 重命名后文件名已经变化，这里重新建索引，保证歧义判断是最新的
        const index = buildBasenameIndex(this.app);
        const allMdFiles = this.app.vault.getMarkdownFiles();

        for (const mdFile of allMdFiles) {
            const content = await this.app.vault.read(mdFile);
            const regex = /!\[\[([^|]+?)(\|.+?)?\]\]/g;
            let newContent = content;
            let offset = 0;
            let modified = false;

            let match: RegExpExecArray | null;
            while ((match = regex.exec(content)) !== null) {
                if (!match[1]) continue;
                const linkPath = match[1].trim();
                const alias = match[2] || '';

                // 仅处理图片链接
                if (!isImagePath(linkPath)) continue;

                const resolved = resolveImageLinkInVault(this.app, mdFile.path, linkPath, index).file;
                if (!resolved) continue;

                // 保留 #片段（如 ![[图.png#outline]]），否则会被当成"格式不对"而抹掉
                const fragmentIndex = linkPath.indexOf('#');
                const fragment = fragmentIndex >= 0 ? linkPath.substring(fragmentIndex) : '';
                const desiredPath = chooseLinkTarget(resolved, index, format) + fragment;

                // 格式已经正确则跳过，保证幂等
                if (linkPath === desiredPath) continue;

                const replacement = `![[${desiredPath}${alias}]]`;
                const start = match.index + offset;
                const end = start + match[0].length;
                newContent = newContent.substring(0, start) + replacement + newContent.substring(end);
                offset += replacement.length - match[0].length;
                modified = true;
            }

            if (modified) {
                await this.app.vault.modify(mdFile, newContent);
            }
        }
    }
    async processChatLog(file: TFile): Promise<boolean> {
        const rawContent = await this.app.vault.read(file);
        const result = formatChatLog(rawContent, this.getChatLogOptions());

        // 只有当输出内容发生了真正变化时才会触发生效，解决无限重复触发的Bug
        if (result !== rawContent) {
            await this.app.vault.modify(file, result);
            return true;
        }
        return false;
    }

    /**
     * 把插件设置转换为聊天记录排版选项
     */
    private getChatLogOptions(): ChatLogOptions {
        return {
            showUsername: this.settings.chatShowUsername,
            showDate: this.settings.chatShowDate,
            showTime: this.settings.chatShowTime,
            indent: resolveIndent(this.settings.chatIndent),
            imageOrder: this.settings.chatImageOrder,
            blankLineBetweenMessages: this.settings.chatBlankLineBetweenMessages,
        };
    }

    /**
     * 打开图片大小设置弹窗
     * @param files 参与改写的笔记
     * @param scopeLabel 影响范围描述，显示在弹窗里
     */
    private openImageSizeModal(files: TFile[], scopeLabel: string) {
        if (files.length === 0) {
            new Notice('ℹ️ 没有可以处理的笔记。');
            return;
        }

        new ImageSizeModal(this.app, {
            scopeLabel,
            files,
            read: (file) => this.app.vault.read(file),
            initialWidth: this.settings.imageSizeWidth,
            initialHeight: this.settings.imageSizeHeight,
            initialOverwrite: this.settings.imageSizeOverwrite,
            onConfirm: (options) => this.runImageSize(files, options, scopeLabel),
        }).open();
    }

    /**
     * 整理图片位置：把引用了别处图片的链接，改为指向笔记自己附件夹里的副本。
     *
     * 解决复制粘贴笔记后的典型问题 —— 本地附件夹里没有这张图，链接仍然指向原文件夹，
     * 一旦原图被移动、改名或删除，笔记里的图片就没了。
     */
    private async runOrganizeImages(files: TFile[], where: string) {
        if (this.isRenaming) {
            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
            return;
        }
        this.isRenaming = true;
        this.suppressNotices();

        // 全库文件名索引：整批共用，新建的副本会登记回去
        const index = buildBasenameIndex(this.app);
        this.batchIndex = index;

        let finalMsg = '';
        try {
            let touched = 0;
            let copied = 0;
            let relinked = 0;
            let skipped = 0;
            const reasons: string[] = [];

            this.showProgress(0, files.length, '🧹 整理图片位置');
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file) {
                    const result = await organizeNoteImages(this.app, this.settings, file, index);
                    copied += result.copied;
                    relinked += result.relinked;
                    skipped += result.skipped;
                    for (const reason of result.reasons) {
                        if (!reasons.includes(reason)) reasons.push(reason);
                    }
                    if (result.changed) {
                        await this.app.vault.modify(file, result.content);
                        touched++;
                    }
                }
                this.showProgress(i + 1, files.length, '🧹 整理图片位置');
            }

            if (touched > 0) {
                this.finishProgress('✅ 整理完成');
                const parts = [`🎉 ${where}共整理 ${touched} 篇笔记`, `复制 ${copied} 张`, `改写 ${relinked} 处链接`];
                if (skipped > 0) parts.push(`跳过 ${skipped} 处`);
                finalMsg = parts.join('，') + '。';
            } else {
                this.clearProgress();
                finalMsg = 'ℹ️ 没有需要整理的图片位置。';
            }
            if (skipped > 0 && reasons.length > 0) {
                finalMsg += `（${reasons.join('；')}）`;
            }
        } catch (e) {
            this.clearProgress();
            console.error(e);
            finalMsg = '❌ 整理图片位置中断，请检查控制台。';
        } finally {
            this.batchIndex = null;
            this.restoreNotices(finalMsg);
            this.isRenaming = false;
        }
    }

    /**
     * 按指定尺寸改写笔记中的图片链接。
     * 只写真正发生变化的文件 —— 尺寸已经正确的笔记完全不碰，避免无谓的保存与同步。
     */
    private async runImageSize(files: TFile[], options: ImageSizeOptions, scopeLabel: string) {
        if (this.isRenaming) {
            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
            return;
        }
        this.isRenaming = true;
        this.suppressNotices();
        let finalMsg = '';
        try {
            let changedFiles = 0;
            let changedLinks = 0;
            this.showProgress(0, files.length, '🖼️ 设置图片大小');

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file) {
                    const content = await this.app.vault.read(file);
                    const result = applyImageSize(content, options);
                    if (result.changed > 0 && result.content !== content) {
                        await this.app.vault.modify(file, result.content);
                        changedFiles++;
                        changedLinks += result.changed;
                    }
                }
                this.showProgress(i + 1, files.length, '🖼️ 设置图片大小');
            }

            if (changedLinks > 0) {
                this.finishProgress('✅ 尺寸设置完成');
                finalMsg = `🎉 ${scopeLabel}处理完毕！共修改 ${changedLinks} 处图片尺寸（${changedFiles} 篇笔记）。`;
            } else {
                this.clearProgress();
                finalMsg = 'ℹ️ 没有需要修改的图片尺寸。';
            }
        } catch (e) {
            this.clearProgress();
            console.error(e);
            finalMsg = '❌ 设置图片大小中断，请检查控制台。';
        } finally {
            this.restoreNotices(finalMsg);
            this.isRenaming = false;
        }
    }

    /**
     * 注册文件 / 文件夹右键菜单。
     *
     * 顶层只放「图片功能」与「文本排版」两个二级栏入口，避免菜单过长。
     * 文件与文件夹共用同一套实现，只靠 files / where / label 三个参数区分。
     */
    private registerFileMenu() {
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.addImageSubmenu(menu, [file], '本文件内', file.name);
                    this.addTextSubmenu(menu, [file], '本文件内');
                } else if (file instanceof TFolder) {
                    const prefix = file.path === '/' ? '' : file.path + '/';
                    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
                    this.addImageSubmenu(menu, files, '该文件夹下', `文件夹 ${file.name}`);
                    this.addTextSubmenu(menu, files, '该文件夹下');
                }
            })
        );
    }

    /**
     * 往父菜单里添加一个二级栏入口。
     *
     * 优先使用 Obsidian 的原生子菜单（MenuItem.setSubmenu）：它负责在菜单项最右边
     * 画出 › 箭头，并在悬停/点击时于旁边展开子菜单，父菜单保持打开 —— 与系统菜单一致，
     * 用户一眼就能看出"这里还有下一级"。
     *
     * 该接口没有写进公开类型定义，所以运行时探测；万一某天没了，就退回到旧做法：
     * 点击后在光标处弹出子菜单，标题自带 › 以免看不出层级。
     */
    private addSubmenuEntry(parent: Menu, title: string, icon: string, build: (menu: Menu) => void) {
        parent.addItem((item) => {
            const nativeSetSubmenu = (item as MenuItemWithSubmenu).setSubmenu;
            const hasNativeSubmenu = typeof nativeSetSubmenu === 'function';

            // 原生子菜单的箭头由 Obsidian 自己画，只有退化路径需要手工补 ›
            item.setTitle(hasNativeSubmenu ? title : `${title} ›`).setIcon(icon);

            if (hasNativeSubmenu) {
                build(nativeSetSubmenu.call(item));
                return;
            }

            item.onClick((evt: MouseEvent | KeyboardEvent) => {
                const submenu = new Menu();
                build(submenu);
                // 用坐标判断而不是 instanceof MouseEvent：弹出窗口里的 MouseEvent
                // 与主窗口不是同一个构造器，instanceof 会误判成键盘事件
                const pointer = evt as MouseEvent;
                if (typeof pointer.clientX === 'number' && typeof pointer.clientY === 'number') {
                    submenu.showAtMouseEvent(pointer);
                } else {
                    // 键盘触发时没有坐标，退化为在窗口中上部弹出
                    submenu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
                }
            });
        });
    }

    /**
     * 图片功能二级菜单
     * @param files 参与处理的笔记
     * @param where 菜单文案片段（「本文件内」/「该文件夹下」）
     * @param label 弹窗里的影响范围描述
     */
    private addImageSubmenu(parent: Menu, files: TFile[], where: string, label: string) {
        this.addSubmenuEntry(parent, '图片功能', 'image', (menu) => {
            menu.addItem((item) => {
                item
                    .setTitle(`转换${where}的外部图片`)
                    .setIcon('image-plus')
                    .onClick(async () => {
                        const reservedPaths = new Map<string, string>();
                        const reservedBasenames = this.buildVaultBasenameMap();
                        await this.runPerFile(
                            '📷 外部图片转换',
                            files,
                            async (file) => (await this.processNote(file, reservedPaths, reservedBasenames)) ? 1 : 0,
                            (count) => `🎉 ${where}共更新了 ${count} 篇笔记。`
                        );
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle(`重命名${where}的乱码图片`)
                    .setIcon('image-minus')
                    .onClick(async () => {
                        await this.runGarbledRename(files, where);
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle(`将${where}的所有图片重命名为预设格式`)
                    .setIcon('image')
                    .onClick(async () => {
                        await this.runRenameAllImages(files, where, false);
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle(`强制将${where}的所有图片重命名为预设格式`)
                    .setIcon('image')
                    .onClick(async () => {
                        await this.runRenameAllImages(files, where, true);
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle(`整理${where}图片位置`)
                    .setIcon('folder')
                    .onClick(async () => {
                        await this.runOrganizeImages(files, where);
                    });
            });

            menu.addItem((item) => {
                item
                    .setTitle(`设置${where}图片的大小`)
                    .setIcon('image')
                    .onClick(() => {
                        this.openImageSizeModal(files, label);
                    });
            });
        });
    }

    /** 文本排版二级菜单 */
    private addTextSubmenu(parent: Menu, files: TFile[], where: string) {
        this.addSubmenuEntry(parent, '文本排版', 'message-square', (menu) => {
            menu.addItem((item) => {
                item
                    .setTitle(`修复${where}的聊天记录排版`)
                    .setIcon('message-square')
                    .onClick(async () => {
                        await this.runChatLog(files, where);
                    });
            });
        });
    }

    /**
     * 批量处理外壳：互斥锁 + 通知屏蔽 + 状态栏进度 + 结果通知。
     *
     * @param label 状态栏进度标签
     * @param files 待处理笔记
     * @param handle 单篇处理函数，返回本篇产生的改动数量（0 表示没有变化）
     * @param success 汇总消息，参数为改动总数
     * @param after 全部处理完成后的收尾工作（如统一修正链接格式）
     */
    private async runPerFile(
        label: string,
        files: TFile[],
        handle: (file: TFile) => Promise<number>,
        success: (total: number) => string,
        after?: () => Promise<void>
    ) {
        if (this.isRenaming) {
            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
            return;
        }
        this.isRenaming = true;
        this.suppressNotices();
        // 整批共用一个文件名索引：解析链接时才能识别同名歧义
        this.batchIndex = buildBasenameIndex(this.app);
        let finalMsg = '';
        try {
            let total = 0;
            this.showProgress(0, files.length, label);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file) {
                    total += await handle(file);
                }
                this.showProgress(i + 1, files.length, label);
            }
            if (after) {
                await after();
            }

            if (total > 0) {
                this.finishProgress('✅ 处理完成');
                finalMsg = success(total);
            } else {
                this.clearProgress();
                finalMsg = 'ℹ️ 没有需要处理的笔记。';
            }
        } catch (e) {
            this.clearProgress();
            console.error(e);
            finalMsg = '❌ 处理中断，请检查控制台。';
        } finally {
            this.batchIndex = null;
            this.restoreNotices(finalMsg);
            this.isRenaming = false;
        }
    }

    /**
     * 重命名乱码图片：命令面板与右键菜单共用同一条路径。
     *
     * 全库预扫描文件名 + 批次内预留，保证重命名出来的名字在仓库里唯一；
     * 收尾统一修正链接格式（重命名由 Obsidian 原生接口改写引用，这里只做格式归一）。
     */
    private async runGarbledRename(files: TFile[], where: string) {
        const reservedPaths = new Map<string, string>();
        const reservedBasenames = this.buildVaultBasenameMap();
        await this.runPerFile(
            '🔍 乱码图片扫描',
            files,
            (file) => this.processGarbledImages(file, reservedPaths, reservedBasenames),
            (count) => `🎉 ${where}共重命名了 ${count} 张乱码图片。`,
            async () => {
                await this.fixAllImageLinkFormats();
            }
        );
    }

    /**
     * 修复聊天记录排版：命令面板与右键菜单共用同一条路径。
     * formatChatLog 是纯函数且严格幂等，只有内容真正变化时才写回。
     */
    private async runChatLog(files: TFile[], where: string) {
        await this.runPerFile(
            '💬 聊天记录排版',
            files,
            async (file) => (await this.processChatLog(file)) ? 1 : 0,
            (count) => `🎉 ${where}共修复了 ${count} 篇笔记的聊天记录。`
        );
    }

    /**
     * 全量重命名：先统计数量并让用户确认，再逐篇重命名，最后统一修正链接格式
     * @param force 为 true 时连已符合预设格式的图片也重命名
     */
    private async runRenameAllImages(files: TFile[], where: string, force: boolean) {
        let total = 0;
        for (const file of files) {
            total += force ? await this.countAllImagesForce(file) : await this.countAllImages(file);
        }

        if (total === 0) {
            await this.fixAllImageLinkFormats();
            new Notice(`ℹ️ ${where}没有需要重命名的图片，已检查并修正链接格式。`);
            return;
        }

        new ConfirmRenameModal(this.app, total, async () => {
            const reservedPaths = new Map<string, string>();
            const reservedBasenames = this.buildVaultBasenameMap();
            const processedFiles = new Set<string>();
            this.batchIndex = buildBasenameIndex(this.app);
            await this.runPerFile(
                force ? '📷 图片重命名（强制）' : '📷 图片重命名',
                files,
                (file) => this.renameAllImages(file, reservedPaths, reservedBasenames, force, undefined, processedFiles),
                (count) => `🎉 ${where}共重命名了 ${count} 张图片。`,
                async () => {
                    await this.fixAllImageLinkFormats();
                }
            );
        }).open();
    }
}

/**
 * 批量重命名确认对话框
 */
class ConfirmRenameModal extends Modal {
    private imageCount: number;
    private onConfirm: () => Promise<void>;

    constructor(app: App, imageCount: number, onConfirm: () => Promise<void>) {
        super(app);
        this.imageCount = imageCount;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '确认批量重命名' });
        contentEl.createEl('p', {
            text: `发现 ${this.imageCount} 张图片将被重命名为预设格式，确认执行？`
        });
        contentEl.createEl('p', {
            text: '⚠️ 此操作会调用 Obsidian 原生接口，自动更新全库所有引用链接，不会产生断链。',
            cls: 'mod-warning'
        });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = buttonContainer.createEl('button', { text: '确认重命名', cls: 'mod-cta' });
        confirmBtn.addEventListener('click', () => {
            this.close();
            void this.onConfirm();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}