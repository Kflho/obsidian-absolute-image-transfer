import { App, PluginSettingTab, Setting } from "obsidian";
import ImageTransferPlugin from "./main";

/**
 * 插件设置接口定义
 */
export interface ImageTransferSettings {
	mySetting: string;
}

/**
 * 插件默认设置
 */
export const DEFAULT_SETTINGS: ImageTransferSettings = {
	mySetting: 'default'
}

/**
 * 插件设置页面选项卡
 */
export class ImageTransferSettingTab extends PluginSettingTab {
	plugin: ImageTransferPlugin;

	constructor(app: App, plugin: ImageTransferPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		// 直接开始添加设置项，移除了所有可能引起报错的冗余标题
		new Setting(containerEl)
			.setName('Sample setting')
			.setDesc('This is a sample setting for your plugin.')
			.addText(text => text
				.setPlaceholder('Enter your value')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}