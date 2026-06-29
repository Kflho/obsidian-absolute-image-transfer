import { App, Editor, MarkdownView, MarkdownFileInfo, Modal, Notice, Plugin, TFile, TFolder, TAbstractFile, Menu, normalizePath, Platform } from 'obsidian';
import { DEFAULT_SETTINGS, ImageTransferSettings, ImageTransferSettingTab } from "./settings";
import * as fs from 'fs/promises';
import * as path from 'path';

export default class ImageTransferPlugin extends Plugin {
    settings!: ImageTransferSettings;
    private statusBarItem: HTMLElement | null = null;
    private isRenaming = false;

    async onload() {
        await this.loadSettings();

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
                } finally {
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
                    new Notice(`🎉 全局处理完毕！共更新了 ${processedCount} 篇笔记。`);
                } catch (e) {
                    this.clearProgress();
                    console.error(e);
                    new Notice('❌ 全局处理中断，请检查控制台。');
                } finally {
                    this.restoreNotices();
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
                        try {
                            let renamedCount = 0;
                            const reservedPaths = new Map<string, string>();
                            const reservedBasenames = this.buildVaultBasenameMap();
                            this.showProgress(0, files.length, '📷 图片重命名');
                            for (let i = 0; i < files.length; i++) {
                                const f = files[i];
                                if (!f) continue;
                                renamedCount += await this.renameAllImages(f, reservedPaths, reservedBasenames);
                                this.showProgress(i + 1, files.length, '📷 图片重命名');
                            }
                            await this.fixAllImageLinkFormats();
                            this.finishProgress('✅ 重命名完成');
                            new Notice(`🎉 全局处理完毕！共重命名了 ${renamedCount} 张图片。`);
                        } catch (e) {
                            this.clearProgress();
                            console.error(e);
                            new Notice('❌ 重命名中断，请检查控制台。');
                        } finally {
                            this.restoreNotices();
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
                        try {
                            let renamedCount = 0;
                            const reservedPaths = new Map<string, string>();
                            const reservedBasenames = this.buildVaultBasenameMap();
                            this.showProgress(0, files.length, '📷 图片重命名（强制）');
                            for (let i = 0; i < files.length; i++) {
                                const f = files[i];
                                if (!f) continue;
                                renamedCount += await this.renameAllImages(f, reservedPaths, reservedBasenames, true);
                                this.showProgress(i + 1, files.length, '📷 图片重命名（强制）');
                            }
                            await this.fixAllImageLinkFormats();
                            this.finishProgress('✅ 重命名完成');
                            new Notice(`🎉 全局处理完毕！共重命名了 ${renamedCount} 张图片。`);
                        } catch (e) {
                            this.clearProgress();
                            console.error(e);
                            new Notice('❌ 重命名中断，请检查控制台。');
                        } finally {
                            this.restoreNotices();
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
                                if (this.isRenaming) {
                                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                    return;
                                }
                                this.isRenaming = true;
                                try {
                                    new Notice(`正在处理: ${file.name}`);
                                    const updated = await this.processNote(file);
                                    if (updated) {
                                        new Notice(`✅ ${file.name} 外部图片转换完成！`);
                                    } else {
                                        new Notice(`ℹ️ 该笔记中没有需要转换的外部图片。`);
                                    }
                                } finally {
                                    this.isRenaming = false;
                                }
                            });
                    });

                    // 功能 2：重命名库内已有的乱码双链图片
                    menu.addItem((item) => {
                        item
                            .setTitle('重命名本文件内的乱码图片')
                            .setIcon('image-minus')
                            .onClick(async () => {
                                if (this.isRenaming) {
                                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                    return;
                                }
                                this.isRenaming = true;
                                try {
                                    const count = await this.processGarbledImages(file);
                                    if (count > 0) {
                                        await this.fixAllImageLinkFormats();
                                        new Notice(`✅ 成功重命名 ${count} 张乱码图片！`);
                                    } else {
                                        new Notice(`ℹ️ 未发现乱码图片。`);
                                    }
                                } catch (e) {
                                    this.clearProgress();
                                    console.error(e);
                                    new Notice('❌ 重命名中断，请检查控制台。');
                                } finally {
                                    this.isRenaming = false;
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

                    // 功能 4：全量重命名该文件中的所有图片为预设格式
                    menu.addItem((item) => {
                        item
                            .setTitle('将该文件中的所有图片重命名为预设格式')
                            .setIcon('image')
                            .onClick(async () => {
                                try {
                                    const count = await this.countAllImages(file);
                                    if (count === 0) {
                                        await this.fixAllImageLinkFormats();
                                        new Notice(`ℹ️ ${file.name} 中没有需要重命名的图片，已检查并修正链接格式。`);
                                        return;
                                    }
                                    new ConfirmRenameModal(this.app, count, async () => {
                                        if (this.isRenaming) {
                                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                            return;
                                        }
                                        this.isRenaming = true;
                                        try {
                                            const renamed = await this.renameAllImages(file);
                                            await this.fixAllImageLinkFormats();
                                            new Notice(`✅ ${file.name} 成功重命名 ${renamed} 张图片！`);
                                        } catch (e) {
                                            this.clearProgress();
                                            console.error(e);
                                            new Notice('❌ 重命名中断，请检查控制台。');
                                        } finally {
                                            this.isRenaming = false;
                                        }
                                    }).open();
                                } catch (e) {
                                    console.error(e);
                                    new Notice('❌ 处理中断，请检查控制台。');
                                }
                            });
                    });

                    // 功能 5：强制重命名该文件中的所有图片（包括已符合格式的）
                    menu.addItem((item) => {
                        item
                            .setTitle('强制将该文件中的所有图片重命名为预设格式')
                            .setIcon('image')
                            .onClick(async () => {
                                try {
                                    const count = await this.countAllImagesForce(file);
                                    if (count === 0) {
                                        await this.fixAllImageLinkFormats();
                                        new Notice(`ℹ️ ${file.name} 中没有图片，已检查并修正链接格式。`);
                                        return;
                                    }
                                    new ConfirmRenameModal(this.app, count, async () => {
                                        if (this.isRenaming) {
                                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                            return;
                                        }
                                        this.isRenaming = true;
                                        try {
                                            const renamed = await this.renameAllImages(file, undefined, undefined, true);
                                            await this.fixAllImageLinkFormats();
                                            new Notice(`✅ ${file.name} 成功重命名 ${renamed} 张图片！`);
                                        } catch (e) {
                                            this.clearProgress();
                                            console.error(e);
                                            new Notice('❌ 重命名中断，请检查控制台。');
                                        } finally {
                                            this.isRenaming = false;
                                        }
                                    }).open();
                                } catch (e) {
                                    console.error(e);
                                    new Notice('❌ 处理中断，请检查控制台。');
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
                                if (this.isRenaming) {
                                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                    return;
                                }
                                this.isRenaming = true;
                                this.suppressNotices();
                                try {
                                    const files = this.app.vault.getMarkdownFiles();
                                    let processedCount = 0;
                                    const folderPrefix = file.path === '/' ? '' : file.path + '/';
                                    const folderFiles = files.filter(f => f.path.startsWith(folderPrefix));
                                    const reservedPaths = new Map<string, string>();
                                    const reservedBasenames = this.buildVaultBasenameMap();

                                    this.showProgress(0, folderFiles.length, '📷 外部图片转换');
                                    for (let i = 0; i < folderFiles.length; i++) {
                                        const mdFile = folderFiles[i];
                                        if (!mdFile) continue;
                                        const updated = await this.processNote(mdFile, reservedPaths, reservedBasenames);
                                        if (updated) processedCount++;
                                        this.showProgress(i + 1, folderFiles.length, '📷 外部图片转换');
                                    }
                                    this.finishProgress('✅ 转换完成');
                                    new Notice(`🎉 文件夹 ${file.name} 外部图片处理完毕！共更新了 ${processedCount} 篇笔记。`);
                                } finally {
                                    this.restoreNotices();
                                    this.isRenaming = false;
                                }
                            });
                    });

                    // 功能 2：批量重命名文件夹下的乱码图片
                    menu.addItem((item) => {
                        item
                            .setTitle('重命名该文件夹下的乱码图片')
                            .setIcon('image-minus')
                            .onClick(async () => {
                                if (this.isRenaming) {
                                    new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                    return;
                                }
                                this.isRenaming = true;
                                this.suppressNotices();
                                try {
                                    const allFiles = this.app.vault.getMarkdownFiles();
                                    const folderPrefix = file.path === '/' ? '' : file.path + '/';
                                    const files = allFiles.filter(f => f.path.startsWith(folderPrefix));

                                    this.showProgress(0, files.length, '🔍 乱码图片扫描');
                                    let totalRenamed = 0;
                                    const reservedPaths = new Map<string, string>();
                                    const reservedBasenames = this.buildVaultBasenameMap();
                                    for (let i = 0; i < files.length; i++) {
                                        const f = files[i];
                                        if (!f) continue;
                                        totalRenamed += await this.processGarbledImages(f, reservedPaths, reservedBasenames);
                                        this.showProgress(i + 1, files.length, '🔍 乱码图片扫描');
                                    }
                                    if (totalRenamed > 0) {
                                        await this.fixAllImageLinkFormats();
                                    }
                                    this.finishProgress('✅ 扫描完成');
                                    new Notice(`🎉 扫描完毕！共重命名了 ${totalRenamed} 张乱码图片。`);
                                } catch (e) {
                                    this.clearProgress();
                                    console.error(e);
                                    new Notice('❌ 处理中断，请检查控制台。');
                                } finally {
                                    this.restoreNotices();
                                    this.isRenaming = false;
                                }
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

                    // 功能 4：全量重命名该文件夹下的所有图片为预设格式
                    menu.addItem((item) => {
                        item
                            .setTitle('将该文件夹下的所有图片重命名为预设格式')
                            .setIcon('images')
                            .onClick(async () => {
                                try {
                                    const allFiles = this.app.vault.getMarkdownFiles();
                                    const folderPrefix = file.path === '/' ? '' : file.path + '/';
                                    const files = allFiles.filter(f => f.path.startsWith(folderPrefix));

                                    let totalCount = 0;
                                    for (const mdFile of files) {
                                        totalCount += await this.countAllImages(mdFile);
                                    }
                                    if (totalCount === 0) {
                                        await this.fixAllImageLinkFormats();
                                        new Notice(`ℹ️ 文件夹 ${file.name} 中没有需要重命名的图片，已检查并修正链接格式。`);
                                        return;
                                    }
                                    new ConfirmRenameModal(this.app, totalCount, async () => {
                                        if (this.isRenaming) {
                                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                            return;
                                        }
                                        this.isRenaming = true;
                                        this.suppressNotices();
                                        try {
                                            let totalRenamed = 0;
                                            const reservedPaths = new Map<string, string>();
                                            const reservedBasenames = this.buildVaultBasenameMap();
                                            this.showProgress(0, files.length, '📷 图片重命名');
                                            for (let i = 0; i < files.length; i++) {
                                                const f = files[i];
                                                if (!f) continue;
                                                totalRenamed += await this.renameAllImages(f, reservedPaths, reservedBasenames);
                                                this.showProgress(i + 1, files.length, '📷 图片重命名');
                                            }
                                            await this.fixAllImageLinkFormats();
                                            this.finishProgress('✅ 重命名完成');
                                            new Notice(`🎉 文件夹 ${file.name} 处理完毕！共重命名了 ${totalRenamed} 张图片。`);
                                        } catch (e) {
                                            this.clearProgress();
                                            console.error(e);
                                            new Notice('❌ 重命名中断，请检查控制台。');
                                        } finally {
                                            this.restoreNotices();
                                            this.isRenaming = false;
                                        }
                                    }).open();
                                } catch (e) {
                                    this.clearProgress();
                                    console.error(e);
                                    new Notice('❌ 处理中断，请检查控制台。');
                                }
                            });
                    });

                    // 功能 5：强制重命名该文件夹下的所有图片（包括已符合格式的）
                    menu.addItem((item) => {
                        item
                            .setTitle('强制将该文件夹下的所有图片重命名为预设格式')
                            .setIcon('images')
                            .onClick(async () => {
                                try {
                                    const allFiles = this.app.vault.getMarkdownFiles();
                                    const folderPrefix = file.path === '/' ? '' : file.path + '/';
                                    const files = allFiles.filter(f => f.path.startsWith(folderPrefix));

                                    let totalCount = 0;
                                    for (const mdFile of files) {
                                        totalCount += await this.countAllImagesForce(mdFile);
                                    }
                                    if (totalCount === 0) {
                                        await this.fixAllImageLinkFormats();
                                        new Notice(`ℹ️ 文件夹 ${file.name} 中没有图片，已检查并修正链接格式。`);
                                        return;
                                    }
                                    new ConfirmRenameModal(this.app, totalCount, async () => {
                                        if (this.isRenaming) {
                                            new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
                                            return;
                                        }
                                        this.isRenaming = true;
                                        this.suppressNotices();
                                        try {
                                            let totalRenamed = 0;
                                            const reservedPaths = new Map<string, string>();
                                            const reservedBasenames = this.buildVaultBasenameMap();
                                            this.showProgress(0, files.length, '📷 图片重命名（强制）');
                                            for (let i = 0; i < files.length; i++) {
                                                const f = files[i];
                                                if (!f) continue;
                                                totalRenamed += await this.renameAllImages(f, reservedPaths, reservedBasenames, true);
                                                this.showProgress(i + 1, files.length, '📷 图片重命名（强制）');
                                            }
                                            await this.fixAllImageLinkFormats();
                                            this.finishProgress('✅ 重命名完成');
                                            new Notice(`🎉 文件夹 ${file.name} 处理完毕！共重命名了 ${totalRenamed} 张图片。`);
                                        } catch (e) {
                                            this.clearProgress();
                                            console.error(e);
                                            new Notice('❌ 重命名中断，请检查控制台。');
                                        } finally {
                                            this.restoreNotices();
                                            this.isRenaming = false;
                                        }
                                    }).open();
                                } catch (e) {
                                    this.clearProgress();
                                    console.error(e);
                                    new Notice('❌ 处理中断，请检查控制台。');
                                }
                            });
                    });
                }
            })
        );

        this.addSettingTab(new ImageTransferSettingTab(this.app, this));

        new Notice("Image transfer v1.1.0 reloaded");
    }

    async loadSettings() {
        const data = (await this.loadData()) as ImageTransferSettings | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * 在底部状态栏显示进度指示 (e.g. "📷 图片重命名: 3/36")
     */
    private showProgress(current: number, total: number, label?: string) {
        if (!this.statusBarItem) {
            this.statusBarItem = this.addStatusBarItem();
        }
        const prefix = label ?? '处理进度';
        this.statusBarItem.setText(`${prefix}: ${current}/${total}`);
    }

    /**
     * 进度完成：短暂显示完成信息后自动移除
     */
    private finishProgress(message: string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(message);
            window.setTimeout(() => {
                if (this.statusBarItem) {
                    this.statusBarItem.remove();
                    this.statusBarItem = null;
                }
            }, 5000);
        }
    }

    /**
     * 出错时清除状态栏进度
     */
    private clearProgress() {
        if (this.statusBarItem) {
            this.statusBarItem.remove();
            this.statusBarItem = null;
        }
    }

    /**
     * 屏蔽 Obsidian 通知弹窗（批量操作时避免 "已修改 N 条链接" 刷屏）。
     * 通过给 body 添加 class，配合 styles.css 中的 CSS 规则隐藏 .notice-container。
     */
    private suppressNotices() {
        document.body.classList.add('suppress-notices');
    }

    /**
     * 恢复通知弹窗显示
     */
    private restoreNotices() {
        document.body.classList.remove('suppress-notices');
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
            const rawAttachmentPath = (this.app.vault as unknown as { getConfig: (key: string) => unknown }).getConfig("attachmentFolderPath");
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
     * 根据链接文本解析到仓库中的图片文件。
     * 先尝试 Obsidian 原生的 getFirstLinkpathDest（支持相对路径解析），
     * 若失败且文件名含正则特殊字符（[](){}等），回退为按 basename 全局查找。
     */
    private resolveImageLink(rawLink: string, sourcePath: string): TFile | null {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(rawLink, sourcePath);
        if (resolved instanceof TFile) return resolved;

        // Obsidian 原生解析失败时，回退为全局按 basename 查找
        // （不限于含特殊字符的文件名 —— 纯数字+点号等非标准命名也可能解析失败）
        const escaped = rawLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nameRegex = new RegExp('^' + escaped + '$', 'i');
        const found = this.app.vault.getFiles().find(
            f => f instanceof TFile && nameRegex.test(f.name)
        );
        return (found instanceof TFile) ? found : null;
    }

    /**
     * 重命名乱码双链图片
     */
    async processGarbledImages(file: TFile, reservedPaths?: Map<string, string>, reservedBasenames?: Map<string, string>): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let renamedCount = 0;
        const processedFilePaths = new Set<string>();
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);
        const rp = reservedPaths ?? new Map<string, string>();
        const rbn = reservedBasenames ?? new Map<string, string>();

        for (const match of matches) {
            if (!match[1]) continue;
            const rawLink = match[1].trim();

            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) continue;

            // 乱码检测：特殊字符 / URL 编码残留 / 纯数字+点号命名（明显非人工命名）
            const isGarbled = (() => {
                // 1. 包含常见乱码字符（反斜杠、百分号、括号、方括号、花括号等）
                if (/[\\%{}()[\]~`^]/.test(rawLink)) return true;
                // 2. 包含 URL 编码序列（decodeURIComponent 会改变结果）
                try {
                    if (decodeURIComponent(rawLink) !== rawLink) return true;
                } catch { /* decodeURIComponent throws on malformed input */ }
                // 3. 文件名主干（去扩展名）不含任何字母 → 明显是自动生成/编码残留
                //    （允许数字、点号、空格、连字符、下划线，这些是自动命名常见字符）
                const stem = rawLink.replace(/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i, '');
                if (stem.length > 0 && !/[^\d.\s\-_]/.test(stem)) return true;
                return false;
            })();
            if (!isGarbled) continue;

            // getFirstLinkpathDest 可能对含 [ ] ( ) 等正则特殊字符的文件名解析失败，
            // resolveImageLink 内置了回退为全局按名查找的逻辑
            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) continue;

            if (processedFilePaths.has(linkedFile.path)) continue;
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
     * @returns 成功重命名的图片数量
     */
    async renameAllImages(
        file: TFile,
        reservedPaths?: Map<string, string>,
        reservedBasenames?: Map<string, string>,
        force?: boolean
    ): Promise<number> {
        const content = await this.app.vault.read(file);
        const regex = /!\[\[([^|]+?)(?:\|.+?)?\]\]/gi;
        const matches = Array.from(content.matchAll(regex));

        if (matches.length === 0) return 0;

        let renamedCount = 0;
        const processedFilePaths = new Set<string>();
        const currentAttachFolder = await this.getTargetAttachmentFolder(file);
        const rp = reservedPaths ?? new Map<string, string>();
        const rbn = reservedBasenames ?? new Map<string, string>();

        for (const match of matches) {
            if (!match[1]) continue;
            const rawLink = match[1].trim();

            if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(rawLink)) continue;

            const linkedFile = this.resolveImageLink(rawLink, file.path);
            if (!linkedFile) continue;

            if (processedFilePaths.has(linkedFile.path)) continue;
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
                    continue;
                }
                // 同一文件被多条笔记引用 → 已处理过，跳过
                if (reservedByPath === linkedFile.path) {
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
     * 批量修正全库图片链接格式（重命名完成后调用一次即可）
     * 遍历所有笔记中符合条件的图片链接，按设置统一为"完整路径"或"仅文件名"
     */
    private async fixAllImageLinkFormats() {
        const format = this.settings.renameLinkFormat || 'full';
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
                if (!/\.(png|jpg|jpeg|gif|bmp|webp|heic)$/i.test(linkPath)) continue;

                const resolved = this.resolveImageLink(linkPath, mdFile.path);
                if (!resolved) continue;

                const desiredPath = format === 'filename' ? resolved.name : resolved.path;

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

    /**
     * 核心功能三：修复聊天记录排版逻辑 (回车+缩进 + 格式强制统一版)
     * 终极幂等版：
     * 1. 彻底解决重复运行会导致多出空行的问题（完全幂等，不改变已有排版）。
     * 2. 完美支持空行断开策略：仅将断开前的文本视作聊天内容，断开后作为笔记保留。
     */
    async processChatLog(file: TFile): Promise<boolean> {
        const rawContent = await this.app.vault.read(file);
        const currentYear = new Date().getFullYear().toString();

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

            const textBefore = rawContent.substring(lastProcessedIndex, anchor.start);
            const userMatch = textBefore.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);

            if (userMatch && userMatch[1]) {
                const userName = userMatch[1].trim();
                const userIndexInBefore = userMatch.index ?? 0;
                const absoluteUserStart = lastProcessedIndex + userIndexInBefore;

                // 1. 提取当前聊天记录之前的文本（笔记、空行等）
                let fragment = rawContent.substring(lastProcessedIndex, absoluteUserStart);

                // 核心修复1：重叠换行抵消（防止多次运行导致换行符堆叠生长）
                if (fragment.startsWith('\n') && result.endsWith('\n')) {
                    fragment = fragment.substring(1);
                }

                result += fragment;

                // 确保聊天记录标题独占一行
                if (result.length > 0 && !result.endsWith('\n')) {
                    result += '\n';
                }

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

                result += `${userName}: ${finalTimeStr}\n`;

                // 2. 正文边界计算：支持空行笔记剥离
                let boundary: number;
                const searchStart = anchor.end;

                if (nextAnchor) {
                    const midText = rawContent.substring(searchStart, nextAnchor.start);
                    const nextUserMatch = midText.match(/([^\n[\]\s:|：]+)\s*[:：]?\s*$/);
                    const maxOffset = nextUserMatch ? (nextUserMatch.index ?? midText.length) : midText.length;

                    const potentialContent = midText.substring(0, maxOffset);
                    const doubleNewline = potentialContent.match(/\n\s*\n/);

                    if (doubleNewline && doubleNewline.index !== undefined) {
                        boundary = searchStart + doubleNewline.index;
                    } else {
                        boundary = searchStart + maxOffset;
                    }
                } else {
                    const potentialContent = rawContent.substring(searchStart);
                    const doubleNewline = potentialContent.match(/\n\s*\n/);

                    // 核心修复2：严格定位末条消息内容的实际结束点，防止跳过同行的文字
                    let contentStartOffset = 0;
                    const leadingSpaceMatch = potentialContent.match(/^[\s\n]+/);
                    if (leadingSpaceMatch) {
                        contentStartOffset = leadingSpaceMatch[0].length;
                    }
                    const firstNewline = potentialContent.indexOf('\n', contentStartOffset);

                    if (doubleNewline && doubleNewline.index !== undefined) {
                        boundary = searchStart + doubleNewline.index;
                    } else if (firstNewline !== -1) {
                        boundary = searchStart + firstNewline;
                    } else {
                        boundary = rawContent.length;
                    }
                }

                // 3. 提取正文并施加缩进
                let bodyRaw = rawContent.substring(anchor.end, boundary);
                let bodyClean = bodyRaw.replace(/^[:：]\s*/, "").trim();

                if (bodyClean) {
                    const indentedLines = bodyClean.split('\n').map(line => `\t${line.trim()}`);
                    result += indentedLines.join('\n') + '\n';
                } else {
                    if (!result.endsWith('\n')) result += '\n';
                }

                lastProcessedIndex = boundary;
            } else {
                result += rawContent.substring(lastProcessedIndex, anchor.end);
                lastProcessedIndex = anchor.end;
            }
        }

        if (lastProcessedIndex < rawContent.length) {
            const remaining = rawContent.substring(lastProcessedIndex);
            if (remaining.startsWith('\n') && result.endsWith('\n')) {
                result += remaining.substring(1);
            } else {
                result += remaining;
            }
        }

        // 只有当输出内容发生了真正变化时才会触发生效，解决无限重复触发的Bug
        if (result !== rawContent) {
            await this.app.vault.modify(file, result);
            return true;
        }
        return false;
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