import { App, PluginSettingTab, Setting } from "obsidian";
import ImageTransferPlugin from "./main";
import type { ChatImageOrder, ChatIndent } from "./chat-log";

export interface ImageTransferSettings {
	attachmentLocation: string;
	customAttachmentFolder: string;
	imageNamePreset: string;
	renameLinkFormat: string;
	// ---- 图片大小 ----
	/** 设置图片大小的默认宽度（像素），空字符串表示不指定 */
	imageSizeWidth: string;
	/** 设置图片大小的默认高度（像素），空字符串表示按比例缩放 */
	imageSizeHeight: string;
	/** 设置图片大小时是否覆盖已有尺寸 */
	imageSizeOverwrite: boolean;
	// ---- 聊天记录排版 ----
	/** 是否在排版结果中保留用户名 */
	chatShowUsername: boolean;
	/** 是否在排版结果中保留日期 (YYYY/MM/DD) */
	chatShowDate: boolean;
	/** 是否在排版结果中保留时间 (HH:mm:ss) */
	chatShowTime: boolean;
	/** 正文缩进方式 */
	chatIndent: ChatIndent;
	/** 图文消息中图片相对文字的位置 */
	chatImageOrder: ChatImageOrder;
	/** 头部信息全部关闭时，是否在相邻消息之间插入空行 */
	chatBlankLineBetweenMessages: boolean;
}

export const DEFAULT_SETTINGS: ImageTransferSettings = {
	attachmentLocation: 'system',
	customAttachmentFolder: 'Attachments',
	imageNamePreset: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}',
	renameLinkFormat: 'full',
	imageSizeWidth: '100',
	imageSizeHeight: '',
	imageSizeOverwrite: true,
	// 以下默认值与旧版本排版结果完全一致，升级后已有笔记不会被改动
	chatShowUsername: true,
	chatShowDate: true,
	chatShowTime: true,
	chatIndent: 'tab',
	chatImageOrder: 'keep',
	chatBlankLineBetweenMessages: false
}

export class ImageTransferSettingTab extends PluginSettingTab {
	plugin: ImageTransferPlugin;

	constructor(app: App, plugin: ImageTransferPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// display() is the standard PluginSettingTab lifecycle method.
	// getSettingDefinitions() (since Obsidian 1.13.0) does not support
	// dynamic conditional UI needed for the attachment folder input.
	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// 头部信息全部关闭时，正文之间没有任何分隔，可选用空行分隔相邻消息
		const headerIsEmpty = !this.plugin.settings.chatShowUsername
			&& !this.plugin.settings.chatShowDate
			&& !this.plugin.settings.chatShowTime;

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

		// --------------------------------------------------------
		// 图片大小
		// --------------------------------------------------------
		new Setting(containerEl).setName('图片大小').setHeading();

		new Setting(containerEl)
			.setName('默认宽度')
			.setDesc('打开设置弹窗时的默认宽度，单位为像素。宽度与高度都留空表示移除已有尺寸')
			.addText(text => text
				.setPlaceholder('100')
				.setValue(this.plugin.settings.imageSizeWidth)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeWidth = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('默认高度')
			.setDesc('可留空，此时图片按宽度等比例缩放')
			.addText(text => text
				.setPlaceholder('留空')
				.setValue(this.plugin.settings.imageSizeHeight)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeHeight = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('覆盖已有尺寸')
			.setDesc('关闭后只给还没有尺寸的图片补上，已有尺寸的图片保持不动')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.imageSizeOverwrite)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeOverwrite = value;
					await this.plugin.saveSettings();
				}));

		// --------------------------------------------------------
		// 聊天记录排版
		// --------------------------------------------------------
		new Setting(containerEl).setName('聊天记录排版').setHeading();

		new Setting(containerEl)
			.setName('显示用户名')
			.setDesc('关闭后每条消息只保留日期与时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowUsername)
				.onChange(async (value) => {
					this.plugin.settings.chatShowUsername = value;
					await this.plugin.saveSettings();
					// 重新渲染，刷新「消息之间插入空行」的可用状态
					this.display();
				}));

		new Setting(containerEl)
			.setName('显示日期')
			.setDesc('日期格式为 {YYYY}/{MM}/{DD}')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowDate)
				.onChange(async (value) => {
					this.plugin.settings.chatShowDate = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('显示时间')
			.setDesc('时间格式为 {HH}:{mm}:{ss}。关闭后排版结果不含时间戳，可避免记录被再次识别为聊天数据')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowTime)
				.onChange(async (value) => {
					this.plugin.settings.chatShowTime = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName('正文缩进')
			.setDesc('控制每条消息正文的缩进方式，可与头部信息区分开')
			.addDropdown(dropdown => dropdown
				.addOption('tab', '制表符 (tab)')
				.addOption('2', '2 个空格')
				.addOption('4', '4 个空格')
				.addOption('none', '不缩进')
				.setValue(this.plugin.settings.chatIndent)
				.onChange(async (value) => {
					this.plugin.settings.chatIndent = value as ChatIndent;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('图文消息中图片的位置')
			.setDesc('一条消息同时含图片和文字时，图片排在文字上方还是下方。选「保持原顺序」则不调整')
			.addDropdown(dropdown => dropdown
				.addOption('keep', '保持原顺序')
				.addOption('above', '图片在上方')
				.addOption('below', '图片在下方')
				.setValue(this.plugin.settings.chatImageOrder)
				.onChange(async (value) => {
					this.plugin.settings.chatImageOrder = value as ChatImageOrder;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('消息之间插入空行')
			.setDesc(headerIsEmpty
				? '头部信息已全部关闭，开启后用空行分隔相邻消息，便于区分说话人'
				: '仅在用户名、日期、时间全部关闭时可用；有头部信息时头部本身已起分隔作用')
			.setDisabled(!headerIsEmpty)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatBlankLineBetweenMessages)
				.onChange(async (value) => {
					this.plugin.settings.chatBlankLineBetweenMessages = value;
					await this.plugin.saveSettings();
				}));
	}
}