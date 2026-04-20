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
            name: 'Transfer local images in current note',
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                try {
                    if (!ctx.file) {
                        new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                        return;
                    }
                    new Notice('正在处理当前笔记的图片...');
                    const updated = await this.processNote(ctx.file);
                    if (updated) {
                        new Notice('✅ 当前笔记图片转换完成！');
                    } else {
                        new Notice('没有发现需要转换本地图片。');
                    }
                } catch (e) {
                    console.error(e);
                    new Notice('❌ 处理过程中发生意外错误，请检查控制台。');
                }
            }
        });

        this.addCommand({
            id: 'transfer-images-entire-vault',
            name: 'Transfer all local images in vault',
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
                    menu.addItem((item) => {
                        item
                            .setTitle('Transfer local images in this file')
                            .setIcon('image')
                            .onClick(async () => {
                                new Notice(`正在处理: ${file.name}`);
                                const updated = await this.processNote(file);
                                if (updated) {
                                    new Notice(`✅ ${file.name} 转换完成！`);
                                } else {
                                    new Notice(`ℹ️ 该笔记中没有需要转换的图片。`);
                                }
                            });
                    });
                }
                else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle('Transfer local images in this folder')
                            .setIcon('images')
                            .onClick(async () => {
                                new Notice(`🚀 开始处理文件夹: ${file.name}`);
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
                                new Notice(`🎉 文件夹 ${file.name} 处理完毕！共更新了 ${processedCount} 篇笔记。`);
                            });
                    });
                }
            })
        );

        this.addSettingTab(new ImageTransferSettingTab(this.app, this));

        // 提示插件重载成功，方便开发调试
        new Notice("Image transfer reloaded!");
    }

    async loadSettings() {
        const data = (await this.loadData()) as ImageTransferSettings | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 弹性路径解析：针对包含变态符号和转义符的路径。
     * 它不再预先拆分片段，而是尝试从根部开始，匹配硬盘上真实存在的路径前缀。
     */
    private async flexibleProbing(base: string, remaining: string): Promise<string | null> {
        // 清理当前剩余路径的前导斜杠
        const target = remaining.replace(/^[\\/]+/, '');
        if (!target) {
            try {
                const stats = await fs.stat(base);
                return stats.isFile() ? base : null;
            } catch { return null; }
        }

        try {
            const entries = await fs.readdir(base);
            // 优先尝试长匹配，防止短路径片段误匹配
            entries.sort((a, b) => b.length - a.length);

            for (const entry of entries) {
                // 核心匹配逻辑：
                // 1. 忽略目标字符串中的反斜杠（将其视为转义符）
                // 2. 检查硬盘实体名是否为目标字符串的前缀
                let consumedCount = 0;
                let normalizedMatch = "";
                
                // 模拟消耗 target 字符串的字符，直到其字面内容（不含转义符）等于 entry 名
                for (let i = 0; i < target.length; i++) {
                    const char = target[i];
                    const nextChar = target[i + 1];
                    // 如果遇到反斜杠且不是路径分隔符，暂时跳过它进行内容比对
                    // 修复 TS2345: 显式检查 nextChar 是否存在以满足类型检查
                    if (char === '\\' && nextChar !== undefined && !/[\\/]/.test(nextChar)) {
                        continue; 
                    }
                    
                    normalizedMatch += char;
                    if (normalizedMatch.toLowerCase() === entry.toLowerCase()) {
                        consumedCount = i + 1;
                        break;
                    }
                    // 如果长度已经超过，说明匹配失败
                    if (normalizedMatch.length > entry.length) break;
                }

                if (consumedCount > 0) {
                    const nextBase = path.join(base, entry);
                    // 递归探测，注意要消费掉 target 中对应的部分
                    const found = await this.flexibleProbing(nextBase, target.substring(consumedCount));
                    if (found) return found;
                }
            }
        } catch { return null; }
        
        return null;
    }

    /**
     * 核心路径解析：使用正则表达式进行安全解码，防止 URI malformed 崩溃
     */
    private async resolvePhysicalPath(rawPath: string): Promise<string | null> {
        // 1. 去除尖括号和 file:///
        let clean = rawPath.replace(/^<?file:\/\/\//i, '').replace(/>?$/, '');

        // 2. 安全解码逻辑：只解码合法的 %XX 序列，防止原生 decodeURI 崩溃
        clean = clean.replace(/(%[0-9A-Fa-f]{2})+/g, (match) => {
            try {
                return decodeURIComponent(match);
            } catch {
                return match;
            }
        });

        // 3. 提取根路径
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

        // 4. 执行递归弹性匹配探测（比之前的分段拆分更鲁棒）
        return await this.flexibleProbing(driveRoot, pathBody);
    }

    async processNote(file: TFile): Promise<boolean> {
        let content = await this.app.vault.read(file);
        const originalContent = content;

        // 正则增强：捕获包含复杂符号的绝对路径链接
        const regex = /!\[(.*?)\]\((<?(?:file:\/\/\/|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return false;

        const parentPath = file.parent ? file.parent.path : "/";
        const currentAttachFolder = normalizePath((parentPath === "/" || parentPath === "") ? "Attachments" : `${parentPath}/Attachments`);

        for (const match of matches) {
            const fullMatch = match[0];
            const rawLink = match[2] || ""; 

            // 调用弹性探测逻辑
            const finalPhysicalPath = await this.resolvePhysicalPath(rawLink);

            if (!finalPhysicalPath) {
                console.warn(`⚠️ 弹性探测未果 (已尝试逐字符匹配方案): ${rawLink}`);
                continue;
            }

            try {
                if (!this.app.vault.getAbstractFileByPath(currentAttachFolder)) {
                    await this.app.vault.createFolder(currentAttachFolder);
                }

                const ext = path.extname(finalPhysicalPath);
                const currentTime = window.moment();
                let newFileName = "";
                let targetVaultPath = "";

                while (true) {
                    const timeStr = currentTime.format('YYYYMMDDHHmmss');
                    newFileName = `Pasted image ${timeStr}${ext}`;
                    targetVaultPath = normalizePath(`${currentAttachFolder}/${newFileName}`);
                    if (!this.app.vault.getAbstractFileByPath(targetVaultPath)) break;
                    currentTime.add(1, 'seconds');
                }

                const fileBuffer = await fs.readFile(finalPhysicalPath);
                const arrayBuffer = fileBuffer.buffer.slice(
                    fileBuffer.byteOffset, 
                    fileBuffer.byteOffset + fileBuffer.byteLength
                );
                
                await this.app.vault.createBinary(targetVaultPath, arrayBuffer);

                const newLink = `![[${newFileName}]]`;
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
}