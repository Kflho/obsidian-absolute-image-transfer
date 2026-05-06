import { Editor, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile, TFolder, TAbstractFile, Menu, normalizePath, Platform } from 'obsidian';
import { DEFAULT_SETTINGS, ImageTransferSettings, ImageTransferSettingTab } from "./settings";
import * as fs from 'fs/promises';
import * as path from 'path';

export default class ImageTransferPlugin extends Plugin {
    settings!: ImageTransferSettings;

    async onload() {
        await this.loadSettings();

        // --------------------------------------------------------
        // 1. 注册快捷命令
        // --------------------------------------------------------

        this.addCommand({
            id: 'transfer-images-current-note',
            name: '转换当前笔记中的外部图片',
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                try {
                    if (!ctx.file) {
                        new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                        return;
                    }
                    new Notice('正在处理当前笔记的图片...');
                    const updated = await this.processNote(ctx.file);
                    if (updated) {
                        new Notice('✅ 当前笔记外部图片转换完成！');
                    } else {
                        new Notice('没有发现需要转换的外部本地图片。');
                    }
                } catch (e) {
                    console.error(e);
                    new Notice('❌ 处理过程中发生意外错误，请检查控制台。');
                }
            }
        });

        this.addCommand({
            id: 'transfer-images-entire-vault',
            name: '转换整个仓库中的外部图片',
            callback: async () => {
                try {
                    new Notice('🚀 开始全局批量处理，请稍候...');
                    const files = this.app.vault.getMarkdownFiles();
                    let processedCount = 0;
                    
                    for (const file of files) {
                        const updated = await this.processNote(file);
                        if (updated) {
                            processedCount++;
                        }
                    }
                    new Notice(`🎉 全局处理完毕！共更新了 ${processedCount} 篇笔记。`);
                } catch (e) {
                    console.error(e);
                    new Notice('❌ 全局处理中断，请检查控制台。');
                }
            }
        });

        // --------------------------------------------------------
        // 2. 注册右键菜单
        // --------------------------------------------------------
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
                if (file instanceof TFile && file.extension === 'md') {
                    // 功能 1：转换外部绝对路径图片
                    menu.addItem((item) => {
                        item
                            .setTitle('转换本文件内的外部图片')
                            .setIcon('image-plus')
                            .onClick(async () => {
                                new Notice(`正在处理: ${file.name}`);
                                const updated = await this.processNote(file);
                                if (updated) {
                                    new Notice(`✅ ${file.name} 外部图片转换完成！`);
                                } else {
                                    new Notice(`ℹ️ 该笔记中没有需要转换的外部图片。`);
                                }
                            });
                    });

                    // 功能 2：重命名库内已有的乱码双链图片
                    menu.addItem((item) => {
                        item
                            .setTitle('重命名本文件内的乱码图片')
                            .setIcon('image-minus')
                            .onClick(async () => {
                                new Notice(`正在扫描乱码图片: ${file.name}`);
                                const count = await this.processGarbledImages(file);
                                if (count > 0) {
                                    new Notice(`✅ 成功重命名 ${count} 张乱码图片！`);
                                } else {
                                    new Notice(`ℹ️ 未发现乱码图片。`);
                                }
                            });
                    });

                    // 新增功能 3：修复聊天记录排版
                    menu.addItem((item) => {
                        item
                            .setTitle('修复聊天记录排版')
                            .setIcon('message-square')
                            .onClick(async () => {
                                const updated = await this.processChatLog(file);
                                if (updated) {
                                    new Notice(`✅ ${file.name} 聊天记录修复完成！`);
                                } else {
                                    new Notice(`ℹ️ 未发现符合格式的聊天记录。`);
                                }
                            });
                    });
                }
                else if (file instanceof TFolder) {
                    // 功能 1：批量转换文件夹下的外部图片
                    menu.addItem((item) => {
                        item
                            .setTitle('转换该文件夹下的外部图片')
                            .setIcon('images')
                            .onClick(async () => {
                                new Notice(`🚀 开始处理文件夹外部图片: ${file.name}`);
                                const files = this.app.vault.getMarkdownFiles();
                                let processedCount = 0;
                                const folderPrefix = file.path === '/' ? '' : file.path + '/';

                                for (const mdFile of files) {
                                    if (mdFile.path.startsWith(folderPrefix)) {
                                        const updated = await this.processNote(mdFile);
                                        if (updated) {
                                            processedCount++;
                                        }
                                    }
                                }
                                new Notice(`🎉 文件夹 ${file.name} 外部图片处理完毕！共更新了 ${processedCount} 篇笔记。`);
                            });
                    });

                    // 功能 2：批量重命名文件夹下的乱码图片
                    menu.addItem((item) => {
                        item
                            .setTitle('重命名该文件夹下的乱码图片')
                            .setIcon('image-minus')
                            .onClick(async () => {
                                new Notice(`🚀 开始扫描文件夹乱码图片: ${file.name}`);
                                const files = this.app.vault.getMarkdownFiles();
                                let totalRenamed = 0;
                                const folderPrefix = file.path === '/' ? '' : file.path + '/';

                                for (const mdFile of files) {
                                    if (mdFile.path.startsWith(folderPrefix)) {
                                        totalRenamed += await this.processGarbledImages(mdFile);
                                    }
                                }
                                new Notice(`🎉 扫描完毕！共重命名了 ${totalRenamed} 张乱码图片。`);
                            });
                    });

                    // 新增功能 3：批量修复文件夹下的聊天记录
                    menu.addItem((item) => {
                        item
                            .setTitle('修复文件夹下所有聊天记录排版')
                            .setIcon('message-square')
                            .onClick(async () => {
                                new Notice(`🚀 正在修复文件夹聊天记录: ${file.name}`);
                                const files = this.app.vault.getMarkdownFiles();
                                let totalFixed = 0;
                                const folderPrefix = file.path === '/' ? '' : file.path + '/';

                                for (const mdFile of files) {
                                    if (mdFile.path.startsWith(folderPrefix)) {
                                        const updated = await this.processChatLog(mdFile);
                                        if (updated) totalFixed++;
                                    }
                                }
                                new Notice(`🎉 处理完毕！共修复了 ${totalFixed} 篇笔记。`);
                            });
                    });
                }
            })
        );

        this.addSettingTab(new ImageTransferSettingTab(this.app, this));

        new Notice("Image transfer v1.0.4 reloaded");
    }

    async loadSettings() {
        const data = (await this.loadData()) as ImageTransferSettings | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 辅助功能：递归创建多级文件夹
     */
    private async createFolderRecursive(folderPath: string) {
        if (folderPath === "/" || folderPath === "") return;
        const parts = folderPath.split('/');
        let currentPath = '';
        
        for (const part of parts) {
            if (!part) continue;
            currentPath = currentPath === '' ? part : `${currentPath}/${part}`;
            if (!this.app.vault.getAbstractFileByPath(currentPath)) {
                try {
                    await this.app.vault.createFolder(currentPath);
                } catch (e) {
                    console.warn(`[ImageTransfer] 创建文件夹失败或已存在: ${currentPath}`, e);
                }
            }
        }
    }

    /**
     * 核心功能：读取插件配置，推断附件应存放的目标文件夹
     */
    private async getTargetAttachmentFolder(file: TFile): Promise<string> {
        const location = this.settings.attachmentLocation;
        const customName = this.settings.customAttachmentFolder || "Attachments"; 
        const parentPath = file.parent ? file.parent.path : "/";
        let targetFolder = "/";

        if (location === "system") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const rawAttachmentPath = (this.app.vault as any).getConfig("attachmentFolderPath");
            let attachmentPath = "/";
            
            if (typeof rawAttachmentPath === "string" && rawAttachmentPath.trim() !== "") {
                attachmentPath = rawAttachmentPath;
            }

            if (attachmentPath === "/") {
                targetFolder = "/";
            } else if (attachmentPath.startsWith("./")) {
                const subFolder = attachmentPath.substring(2);
                if (subFolder) {
                    targetFolder = parentPath === "/" ? subFolder : `${parentPath}/${subFolder}`;
                } else {
                    targetFolder = parentPath;
                }
            } else {
                targetFolder = attachmentPath;
            }
        } else if (location === "root") {
            targetFolder = "/";
        } else if (location === "current") {
            targetFolder = parentPath;
        } else if (location === "subfolder") {
            targetFolder = parentPath === "/" ? customName : `${parentPath}/${customName}`;
        } else if (location === "custom") {
            targetFolder = customName;
        }

        targetFolder = normalizePath(targetFolder);
        
        if (targetFolder !== "/" && !this.app.vault.getAbstractFileByPath(targetFolder)) {
            await this.createFolderRecursive(targetFolder);
        }

        return targetFolder;
    }

    /**
     * 弹性路径解析：针对特殊字符路径的递归搜索
     */
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
     * 处理外部绝对路径图片并引入 Vault
     */
    async processNote(file: TFile): Promise<boolean> {
        let content = await this.app.vault.read(file);
        const originalContent = content;

        const regex = /!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return false;
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);

        for (const match of matches) {
            const fullMatch = match[0];
            const altPartRaw = match[1] || ""; 
            const rawLink = match[2] || ""; 
            const finalPhysicalPath = await this.resolvePhysicalPath(rawLink);

            if (!finalPhysicalPath) continue;

            try {
                const ext = path.extname(finalPhysicalPath);
                const currentTime = window.moment();
                let newFileName = "";
                let targetVaultPath = "";

                while (true) {
                    const timeStr = currentTime.format('YYYYMMDDHHmmss');
                    newFileName = `Pasted image ${timeStr}${ext}`;
                    targetVaultPath = normalizePath(currentAttachFolder === "/" ? `/${newFileName}` : `${currentAttachFolder}/${newFileName}`);
                    if (!this.app.vault.getAbstractFileByPath(targetVaultPath)) break;
                    currentTime.add(1, 'seconds');
                }

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
     */
    async processGarbledImages(file: TFile): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let renamedCount = 0;
        const processedFilePaths = new Set<string>();
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);

        for (const match of matches) {
            if (!match[1]) continue;
            const rawLink = match[1].trim(); 
            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) continue;

            const isGarbled = /[\\%{}()[\]~`^]/g.test(rawLink);
            if (!isGarbled) continue;

            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(rawLink, file.path);
            if (!linkedFile || !(linkedFile instanceof TFile)) continue; 

            if (processedFilePaths.has(linkedFile.path)) continue; 
            processedFilePaths.add(linkedFile.path);

            try {
                const ext = `.${linkedFile.extension}`;
                const currentTime = window.moment();
                let newFileName = "";
                let targetVaultPath = "";

                while (true) {
                    const timeStr = currentTime.format('YYYYMMDDHHmmss');
                    newFileName = `Pasted image ${timeStr}${ext}`;
                    targetVaultPath = normalizePath(currentAttachFolder === "/" ? `/${newFileName}` : `${currentAttachFolder}/${newFileName}`);
                    if (!this.app.vault.getAbstractFileByPath(targetVaultPath)) break;
                    currentTime.add(1, 'seconds');
                }

                await this.app.fileManager.renameFile(linkedFile, targetVaultPath);
                renamedCount++;
            } catch (err) {
                console.error(`❌ 重命名乱码图片失败: ${linkedFile.path}`, err);
            }
        }
        return renamedCount;
    }

/**
     * 核心功能三：修复聊天记录排版逻辑 (回车+缩进 + 格式强制统一版)
     * 优化说明：
     * 1. 强制补全与对齐：无论原始格式（2026/5/6 或 05-06），统一强制输出为 YYYY/MM/DD HH:mm:ss。
     * 2. 智能补零：通过正则表达式精确捕获月、日、时、分、秒并执行 padStart(2, '0')。
     * 3. 结构化排版：严格执行 [用户名: 时间] \n \t [内容]。
     * 4. 间距保留：保留聊天记录块之间的原始空行。
     */
    async processChatLog(file: TFile): Promise<boolean> {
        const rawContent = await this.app.vault.read(file);
        
        // 1. 定义时间戳特征锚点：匹配包含日期和时间的各种组合
        const timeAnchorRegex = /(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}:\d{2}:\d{2})/g;
        
        const anchors: { start: number, end: number, timeStr: string }[] = [];
        let m;
        while ((m = timeAnchorRegex.exec(rawContent)) !== null) {
            anchors.push({ start: m.index, end: m.index + m[0].length, timeStr: m[0] });
        }

        if (anchors.length === 0) return false;

        const currentYear = new Date().getFullYear().toString();
        let result = "";
        let lastProcessedIndex = 0;

        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            if (!anchor) continue;

            const textBefore = rawContent.substring(lastProcessedIndex, anchor.start);
            // 匹配用户名：找紧邻时间戳前的连续字符
            const userMatch = textBefore.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);

            if (userMatch && userMatch[1]) {
                const userName = userMatch[1].trim();
                const userIndexInBefore = userMatch.index ?? 0;
                const absoluteUserStart = lastProcessedIndex + userIndexInBefore;

                // --- 1. 追加用户名之前的文本 ---
                result += rawContent.substring(lastProcessedIndex, absoluteUserStart);
                
                if (result.length > 0 && !result.endsWith('\n')) {
                    result += '\n';
                }

                // --- 2. 核心：时间格式强制规范化 (补年 + 补零) ---
                let rawTime = anchor.timeStr.trim().replace(/-/g, '/');
                let finalTimeStr = "";

                // 解析日期和时间部分
                const timePartMatch = rawTime.match(/(\d{1,2}:\d{2}:\d{2})$/);
                const datePartMatch = rawTime.replace(/\s*(\d{1,2}:\d{2}:\d{2})$/, "").trim();
                
                const timeVal = timePartMatch ? timePartMatch[1] : "00:00:00";
                let dateVal = datePartMatch;

                // 如果没有日期部分，默认补上今日日期
                if (!dateVal) {
                    const today = new Date();
                    dateVal = `${currentYear}/${today.getMonth() + 1}/${today.getDate()}`;
                } 
                // 如果日期不包含年份（如 5/6 或 05/06）
                else if (dateVal.split('/').length === 2) {
                    dateVal = `${currentYear}/${dateVal}`;
                }

                // 统一执行补零逻辑 (YYYY/MM/DD)
                const dParts = dateVal.split('/');
                if (dParts.length === 3 && dParts[0] && dParts[1] && dParts[2]) {
                    const y = dParts[0].length === 2 ? `20${dParts[0]}` : dParts[0];
                    const mm = dParts[1].padStart(2, '0');
                    const dd = dParts[2].padStart(2, '0');
                    dateVal = `${y}/${mm}/${dd}`;
                }

                // 统一时间部分补零 (HH:mm:ss)
                if (timeVal) {
                    const tParts = timeVal.split(':');
                    if (tParts.length === 3 && tParts[0] && tParts[1] && tParts[2]) {
                        const hh = tParts[0].padStart(2, '0');
                        const min = tParts[1].padStart(2, '0');
                        const ss = tParts[2].padStart(2, '0');
                        finalTimeStr = `${dateVal} ${hh}:${min}:${ss}`;
                    } else {
                        finalTimeStr = `${dateVal} ${timeVal}`;
                    }
                } else {
                    finalTimeStr = `${dateVal} 00:00:00`;
                }

                // 写入标题行
                result += `${userName}: ${finalTimeStr}`;

                // --- 3. 截取正文 ---
                const nextAnchor = anchors[i + 1];
                let searchEnd = nextAnchor ? nextAnchor.start : rawContent.length;
                let messageBodyFull = rawContent.substring(anchor.end, searchEnd);
                
                const nextUserMatch = messageBodyFull.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);
                let messageActualEnd = messageBodyFull.length;
                if (nextUserMatch) {
                    messageActualEnd = nextUserMatch.index ?? messageBodyFull.length;
                }
                
                let messageContent = messageBodyFull.substring(0, messageActualEnd).trim();
                messageContent = messageContent.replace(/^[:：]\s*/, "");

                // --- 4. 排版：换行 + Tab ---
                if (messageContent) {
                    const indentedBody = messageContent.replace(/\n+/g, '\n\t');
                    result += `\n\t${indentedBody}\n`;
                } else {
                    result += '\n';
                }

                lastProcessedIndex = anchor.end + messageActualEnd;
            } else {
                result += rawContent.substring(lastProcessedIndex, anchor.end);
                lastProcessedIndex = anchor.end;
            }
        }

        result += rawContent.substring(lastProcessedIndex);
        
        if (result !== rawContent) {
            await this.app.vault.modify(file, result);
            return true;
        }
        return false;
    }
}