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
                                // 修复 unused-vars 警告，将 processedCount 加入提示中
                                new Notice(`🎉 文件夹 ${file.name} 外部图片处理完毕！共更新了 ${processedCount} 篇笔记。`);
                            });
                    });

                    // 功能 2：批量重命名文件夹下的乱码双链图片
                    menu.addItem((item) => {
                        item
                            .setTitle('重命名该文件夹下的乱码图片')
                            .setIcon('images')
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
                    if (char === '\\' && nextChar !== undefined && !/[\\/]/.test(nextChar)) {
                        continue; 
                    }
                    
                    normalizedMatch += char;
                    if (normalizedMatch.toLowerCase() === entry.toLowerCase()) {
                        consumedCount = i + 1;
                        break;
                    }
                    if (normalizedMatch.length > entry.length) break;
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

    private async resolvePhysicalPath(rawPath: string): Promise<string | null> {
        let clean = rawPath.replace(/^<?file:\/\/\//i, '').replace(/>?$/, '');

        clean = clean.replace(/(%[0-9A-Fa-f]{2})+/g, (match) => {
            try {
                return decodeURIComponent(match);
            } catch {
                return match;
            }
        });

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
     * 核心功能一：处理外部绝对路径图片并引入 Vault
     */
    async processNote(file: TFile): Promise<boolean> {
        let content = await this.app.vault.read(file);
        const originalContent = content;

        const regex = /!\[(.*?)\]\((<?(?:file:\/\/\/|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return false;

        const parentPath = file.parent ? file.parent.path : "/";
        const currentAttachFolder = normalizePath((parentPath === "/" || parentPath === "") ? "Attachments" : `${parentPath}/Attachments`);

        for (const match of matches) {
            const fullMatch = match[0];
            const rawLink = match[2] || ""; 

            const finalPhysicalPath = await this.resolvePhysicalPath(rawLink);

            if (!finalPhysicalPath) {
                console.warn(`⚠️ 弹性探测未果: ${rawLink}`);
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

    /**
     * 核心功能二：扫描并重命名已被引入库内的乱码双链图片（如 QQ 导入图片）
     * 返回成功重命名的数量
     */
    async processGarbledImages(file: TFile): Promise<number> {
        const content = await this.app.vault.read(file);
        
        // 匹配原生双链语法，提取出文件名部分，忽略别名（例如 ![[乱码.gif|100]] 提取出 乱码.gif）
        const regex = /!\[\[(.*?)(?:\|.*?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let renamedCount = 0;
        const processedFilePaths = new Set<string>(); // 防重复处理同一张图

        const parentPath = file.parent ? file.parent.path : "/";
        const currentAttachFolder = normalizePath((parentPath === "/" || parentPath === "") ? "Attachments" : `${parentPath}/Attachments`);

        for (const match of matches) {
            // 增加非空判断，解决 TS2532 错误
            if (!match[1]) continue;
            
            const rawLink = match[1].trim();

            // 过滤非图片后缀
            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) {
                continue;
            }

            // 乱码判定逻辑：包含反斜杠、百分号、各种括号或反引号等非常规文件字符
            // 修复 no-useless-escape：去除字符集中不必要的反斜杠
            const isGarbled = /[\\%{}()[\]~`^]/g.test(rawLink);
            if (!isGarbled) {
                continue;
            }

            // 通过缓存查找该图片在 Obsidian 库中的真实 TFile 对象
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(rawLink, file.path);
            if (!linkedFile || !(linkedFile instanceof TFile)) {
                continue; // 库里找不到这个文件（可能已经被删除了或本身是个死链）
            }

            if (processedFilePaths.has(linkedFile.path)) {
                continue; // 这张图已经被重命名过了，跳过
            }
            processedFilePaths.add(linkedFile.path);

            try {
                if (!this.app.vault.getAbstractFileByPath(currentAttachFolder)) {
                    await this.app.vault.createFolder(currentAttachFolder);
                }

                const ext = `.${linkedFile.extension}`;
                const currentTime = window.moment();
                let newFileName = "";
                let targetVaultPath = "";

                // 生成防冲突的干净文件名
                while (true) {
                    const timeStr = currentTime.format('YYYYMMDDHHmmss');
                    newFileName = `Pasted image ${timeStr}${ext}`;
                    targetVaultPath = normalizePath(`${currentAttachFolder}/${newFileName}`);
                    if (!this.app.vault.getAbstractFileByPath(targetVaultPath)) break;
                    currentTime.add(1, 'seconds');
                }

                // 重点：使用 Obsidian 自带的 renameFile 方法！
                // 这不仅会重命名硬盘上的物理文件，Obsidian 还会在后台自动遍历库，把所有关联的 ![[乱码.gif]] 瞬间替换成 ![[Pasted image ... .gif]]
                await this.app.fileManager.renameFile(linkedFile, targetVaultPath);
                renamedCount++;

            } catch (err) {
                console.error(`❌ 重命名乱码图片失败: ${linkedFile.path}`, err);
            }
        }

        return renamedCount;
    }
}