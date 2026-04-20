import { Editor, MarkdownView, MarkdownFileInfo, Notice, Plugin, TFile, TFolder, TAbstractFile, Menu, normalizePath, moment } from 'obsidian';
import { DEFAULT_SETTINGS, ImageTransferSettings, ImageTransferSettingTab } from "./settings";
import * as fs from 'fs/promises';
import * as path from 'path';

export default class LocalImageTransferPlugin extends Plugin {
    settings!: ImageTransferSettings;

    async onload() {
        await this.loadSettings();

        // --------------------------------------------------------
        // 1. 注册快捷命令
        // --------------------------------------------------------

        // 命令一：仅处理当前正在编辑的笔记 (带默认快捷键 Alt + P)
        this.addCommand({
            id: 'transfer-images-current-note',
            name: 'Transfer local images in current note',
            editorCallback: async (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
                if (!ctx.file) {
                    new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
                    return;
                }
                new Notice('正在处理当前笔记的图片...');
                const updated = await this.processNote(ctx.file);
                if (updated) {
                    new Notice('✅ 当前笔记图片转换完成！');
                } else {
                    new Notice('没有发现需要转换的本地图片链接。');
                }
            }
        });

        // 命令二：处理整个仓库内的所有笔记 (全局处理)
        this.addCommand({
            id: 'transfer-images-entire-vault',
            name: 'Transfer all local images in vault',
            callback: async () => {
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
            }
        });

        // --------------------------------------------------------
        // 2. 注册右键菜单 (文件系统 Context Menu)
        // --------------------------------------------------------
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
                // 情况 A: 右键点击的是单个 Markdown 文件
                if (file instanceof TFile && file.extension === 'md') {
                    menu.addItem((item) => {
                        item
                            .setTitle('转换该文件内的本地图片')
                            .setIcon('image') // 使用系统自带的图片图标
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
                // 情况 B: 右键点击的是文件夹
                else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle('转换该文件夹内所有本地图片')
                            .setIcon('images') // 使用多图图标
                            .onClick(async () => {
                                new Notice(`🚀 开始处理文件夹: ${file.name}`);
                                const files = this.app.vault.getMarkdownFiles();
                                let processedCount = 0;
                                
                                // 处理根目录('/')时的特殊路径匹配逻辑
                                const folderPrefix = file.path === '/' ? '' : file.path + '/';

                                // 找出所有路径是以该文件夹开头的 Markdown 文件
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

        // 添加设置面板
        this.addSettingTab(new ImageTransferSettingTab(this.app, this));
    }

    onunload() {
        // 插件卸载时的清理工作
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ImageTransferSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 核心转换逻辑：处理单个 Markdown 文件
     * @param file Obsidian 的 TFile 对象
     * @returns boolean 表示文件内容是否发生了更改
     */
    async processNote(file: TFile): Promise<boolean> {
        let content = await this.app.vault.read(file);
        const originalContent = content;

        // 增强版正则：支持文件名内包含 ()、{}、[] 等变态符号。以 .png/.jpg 等图片后缀作为真正的结束标志
        const regex = /!\[(.*?)\]\((<?(?:file:\/\/\/|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)(?:[ \t]+["'].*?["'])?\)/gi;
        const matches = [...content.matchAll(regex)];

        if (matches.length === 0) return false;

        let attachFolderCreated = false;
        let currentAttachFolder = "";

        // 动态计算当前笔记所在的目录，并设定其专属的 Attachments 路径
        const parentPath = file.parent ? file.parent.path : "/";
        if (parentPath === "/" || parentPath === "") {
            currentAttachFolder = "Attachments";
        } else {
            currentAttachFolder = `${parentPath}/Attachments`;
        }
        // 规范化 Obsidian 路径
        currentAttachFolder = normalizePath(currentAttachFolder);

        for (const match of matches) {
            const fullMatch = match[0];
            const rawPath = match[2]!; 

            // 1. 清理原始物理路径 (先去尖括号，再去 file:///)
            let cleanPath = rawPath.replace(/^</, '').replace(/>$/, '');
            cleanPath = cleanPath.replace(/^file:\/\/\//i, '');

            // 智能 URL 解码。只解码合法的 %XX 序列，忽略像 %_H 这种捣乱的字符
            cleanPath = cleanPath.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
                try {
                    return decodeURIComponent(m);
                } catch {
                    return m;
                }
            });

            // 统一为当前操作系统的标准路径格式
            cleanPath = path.normalize(cleanPath);  

            try {
                // 2. 双重检查本地物理硬盘上是否存在该图片 (对付 Obsidian 的强加转义符)
                let fileFound = false;
                let finalPath = cleanPath;

                try {
                    await fs.access(finalPath);
                    fileFound = true;
                } catch {
                    // 如果找不到，尝试剥离这些“伪装成文件夹”的转义反斜杠，再找一次
                    finalPath = cleanPath.replace(/\\([()[\]{}])/g, '$1');
                    try {
                        await fs.access(finalPath);
                        fileFound = true;
                    } catch {
                        // 两次都找不到，说明文件真的没了
                    }
                }

                if (!fileFound) {
                    throw new Error("物理文件不存在或路径解析失败");
                }
                
                // 3. 确信找到图片后，按需创建当前目录下的 Attachments 文件夹
                if (!attachFolderCreated) {
                    const folderExists = this.app.vault.getAbstractFileByPath(currentAttachFolder);
                    if (!folderExists) {
                        await this.app.vault.createFolder(currentAttachFolder);
                    }
                    attachFolderCreated = true;
                }

                // 4. 解析后缀名，生成原生命名与顺延机制
                const ext = path.extname(finalPath);
                let currentTime = moment(); // 使用 Obsidian 内置的 moment 实例
                let newFileName = "";
                let targetVaultPath = "";

                while (true) {
                    const timeStr = currentTime.format('YYYYMMDDHHmmss');
                    newFileName = `Pasted image ${timeStr}${ext}`;
                    targetVaultPath = normalizePath(`${currentAttachFolder}/${newFileName}`);
                    
                    // 冲突检测：检查库中是否已经有这个命名的图片了
                    if (!this.app.vault.getAbstractFileByPath(targetVaultPath)) {
                        break; // 名字可用，跳出循环
                    }
                    // 名字被占用，顺延 1 秒继续检测
                    currentTime.add(1, 'seconds');
                }

                // 5. 跨环境复制：先用 Node 读取外部数据，再用 Obsidian API 写回仓库
                const fileBuffer = await fs.readFile(finalPath);
                await this.app.vault.createBinary(targetVaultPath, fileBuffer);

                // 6. 纯字符串替换为原生的双链格式
                const newLink = `![[${newFileName}]]`;
                content = content.replace(fullMatch, newLink);

            } catch (err) {
                console.warn(`⚠️ 跳过(未找到物理文件或读取失败): ${cleanPath}`, err);
            }
        }

        // 只有内容发生了真实的替换，才执行磁盘写入，节省性能
        if (content !== originalContent) {
            await this.app.vault.modify(file, content);
            return true;
        }
        
        return false;
    }
}