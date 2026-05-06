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
     * 终极修复版：
     * 1. 解决用户名标题行被误识别为上一条消息正文并缩进的问题。
     * 2. 解决重复运行会导致多出空行的问题（幂等性修复）。
     * 3. 严格规范 [用户名: 时间] \n \t [内容] 的层级结构。
     */
    async processChatLog(file: TFile): Promise<boolean> {
        const rawContent = await this.app.vault.read(file);
        const currentYear = new Date().getFullYear().toString();
        
        // 匹配多种时间格式的正则锚点
        const timeAnchorRegex = /(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}:\d{2}:\d{2})/g;
        
        const anchors: { start: number, end: number, timeStr: string }[] = [];
        let m;
        while ((m = timeAnchorRegex.exec(rawContent)) !== null) {
            anchors.push({ start: m.index, end: m.index + m[0].length, timeStr: m[0] });
        }

        if (anchors.length === 0) return false;

        let result = "";
        let lastProcessedIndex = 0;

        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            const nextAnchor = anchors[i + 1];
            if (!anchor) continue;

            // 1. 定位当前条目的用户名起始点
            const textBefore = rawContent.substring(lastProcessedIndex, anchor.start);
            // 匹配紧邻时间戳之前的非空字符作为用户名
            const userMatch = textBefore.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);

            if (userMatch && userMatch[1]) {
                const userName = userMatch[1].trim();
                const userIndexInBefore = userMatch.index ?? 0;
                const absoluteUserStart = lastProcessedIndex + userIndexInBefore;

                // 写入用户名之前的无关文本（如笔记或空行）
                const fragment = rawContent.substring(lastProcessedIndex, absoluteUserStart);
                result += fragment;
                
                // 确保新的一条消息标题行独立占行，且不产生重复空行
                if (result.length > 0 && !result.endsWith('\n')) {
                    result += '\n';
                }

                // 2. 时间规范化 (YYYY/MM/DD HH:mm:ss)
                let rawTime = anchor.timeStr.trim().replace(/-/g, '/');
                const timePartMatch = rawTime.match(/(\d{1,2}:\d{2}:\d{2})$/);
                const datePartStr = rawTime.replace(/\s*(\d{1,2}:\d{2}:\d{2})$/, "").trim();
                
                let dateVal = datePartStr;
                if (!dateVal) {
                    const d = new Date();
                    dateVal = `${currentYear}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;
                } else if (dateVal.split('/').length === 2) {
                    dateVal = `${currentYear}/${dateVal}`;
                }
                const dParts = dateVal.split('/');
                if (dParts.length === 3) {
                    const y = (dParts[0]?.length === 2 ? `20${dParts[0]}` : dParts[0]) || currentYear;
                    const mm = (dParts[1] || "").padStart(2, '0');
                    const dd = (dParts[2] || "").padStart(2, '0');
                    dateVal = `${y}/${mm}/${dd}`;
                }

                const timeVal: string = (timePartMatch && timePartMatch[1]) ? timePartMatch[1] : "00:00:00";
                const tParts = timeVal.split(':');
                const finalTimeStr = `${dateVal} ${(tParts[0] || "00").padStart(2, '0')}:${(tParts[1] || "00").padStart(2, '0')}:${(tParts[2] || "00").padStart(2, '0')}`;

                // 3. 写入标题行
                result += `${userName}: ${finalTimeStr}\n`;

                // 4. 正文边界计算：精准识别“消息内容”与“下一条消息的用户名”
                let boundary: number;
                const searchStart = anchor.end;
                
                if (nextAnchor) {
                    const midText = rawContent.substring(searchStart, nextAnchor.start);
                    const nextUserMatch = midText.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);
                    if (nextUserMatch) {
                        boundary = searchStart + (nextUserMatch.index ?? midText.length);
                    } else {
                        boundary = nextAnchor.start;
                    }
                } else {
                    const potentialContent = rawContent.substring(searchStart);
                    const firstNewline = potentialContent.indexOf('\n');
                    const doubleNewline = potentialContent.match(/\n\s*\n/);
                    
                    if (doubleNewline) {
                        boundary = searchStart + (doubleNewline.index ?? potentialContent.length);
                    } else if (firstNewline !== -1) {
                        boundary = searchStart + firstNewline;
                    } else {
                        boundary = rawContent.length;
                    }
                }

                // 5. 提取正文并施加缩进
                let bodyRaw = rawContent.substring(anchor.end, boundary);
                // 仅移除开头残余的冒号
                let bodyClean = bodyRaw.replace(/^[:：]\s*/, "").trim();

                if (bodyClean) {
                    // 每一行内容都要加 Tab 缩进
                    const indentedLines = bodyClean.split('\n').map(line => `\t${line.trim()}`);
                    result += indentedLines.join('\n') + '\n';
                } else {
                    // 如果正文为空，至少保留一个换行，但不要产生重复换行
                    if (!result.endsWith('\n')) result += '\n';
                }
                
                lastProcessedIndex = boundary;
            } else {
                result += rawContent.substring(lastProcessedIndex, anchor.end);
                lastProcessedIndex = anchor.end;
            }
        }

        // 6. 追加剩余未处理文本
        if (lastProcessedIndex < rawContent.length) {
            const remaining = rawContent.substring(lastProcessedIndex);
            // 避免在衔接处产生多余空行
            if (remaining.startsWith('\n') && result.endsWith('\n')) {
                result += remaining.substring(1);
            } else {
                result += remaining;
            }
        }
        
        if (result !== rawContent) {
            await this.app.vault.modify(file, result);
            return true;
        }
        return false;
    }
}