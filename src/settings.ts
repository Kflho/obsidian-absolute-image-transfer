import {App, PluginSettingTab, Setting} from "obsidian";
import ImageTransferPlugin from "./main";

export interface ImageTransferSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: ImageTransferSettings = {
	mySetting: 'default'
}

export class ImageTransferSettingTab extends PluginSettingTab {
	plugin: ImageTransferPlugin;

	constructor(app: App, plugin: ImageTransferPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Settings #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
