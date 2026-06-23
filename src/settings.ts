import { App, PluginSettingTab, Setting } from "obsidian";
import ImageTransferPlugin from "./main";

export interface ImageTransferSettings {
	attachmentLocation: string;
	customAttachmentFolder: string;
	imageNamePreset: string;
	renameLinkFormat: string;
}

export const DEFAULT_SETTINGS: ImageTransferSettings = {
	attachmentLocation: 'system',
	customAttachmentFolder: 'Attachments',
	imageNamePreset: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}',
	renameLinkFormat: 'full'
}

export class ImageTransferSettingTab extends PluginSettingTab {
	plugin: ImageTransferPlugin;

	constructor(app: App, plugin: ImageTransferPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('附件存储位置')
			.addDropdown(dropdown => dropdown
				.addOption('system', '跟随系统设置 (默认)')
				.addOption('root', '仓库的根目录')
				.addOption('current', '当前文件所在的文件夹')
				.addOption('subfolder', '当前文件所在文件夹下指定的子文件夹')
				.addOption('custom', '指定的附件文件夹')
				.setValue(this.plugin.settings.attachmentLocation)
				.onChange(async (value) => {
					this.plugin.settings.attachmentLocation = value;
					await this.plugin.saveSettings();
					// 重新渲染设置页面，以动态显示或隐藏下方的输入框
					this.display(); 
				}));

		// 只有当用户选择了需要输入文件夹名称的选项时，才显示此输入框
		if (this.plugin.settings.attachmentLocation === 'subfolder' || this.plugin.settings.attachmentLocation === 'custom') {
			new Setting(containerEl)
				.setName('附件文件夹名称')
				.addText(text => text
					.setPlaceholder('Attachments')
					.setValue(this.plugin.settings.customAttachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.customAttachmentFolder = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('图片命名预设')
			.setDesc('支持占位符: {YYYY} {MM} {DD} {HH} {mm} {ss}')
			.addText(text => text
				.setPlaceholder('Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}')
				.setValue(this.plugin.settings.imageNamePreset)
				.onChange(async (value) => {
					this.plugin.settings.imageNamePreset = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('重命名后链接格式')
			.setDesc('控制图片重命名后，笔记内链接使用完整路径还是仅文件名')
			.addDropdown(dropdown => dropdown
				.addOption('full', '完整路径')
				.addOption('filename', '仅文件名')
				.setValue(this.plugin.settings.renameLinkFormat)
				.onChange(async (value) => {
					this.plugin.settings.renameLinkFormat = value;
					await this.plugin.saveSettings();
				}));
	}
}