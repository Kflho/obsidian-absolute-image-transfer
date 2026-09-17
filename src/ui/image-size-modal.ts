import { App, Modal, Setting, TFile } from 'obsidian';
import { applyImageSize, ImageSizeOptions, ImageSizeSample, validateImageSize } from '../image-size';

export interface ImageSizeModalOptions {
	/** 影响范围描述，如「当前笔记」「文件夹 聊天记录」「整个仓库」 */
	scopeLabel: string;
	/** 参与改写的笔记 */
	files: TFile[];
	/** 读取笔记内容（由插件注入，便于测试与复用） */
	read: (file: TFile) => Promise<string>;
	initialWidth: string;
	initialHeight: string;
	initialOverwrite: boolean;
	/** 用户点「确定」后回调 */
	onConfirm: (options: ImageSizeOptions) => void | Promise<void>;
}

/**
 * 图片大小设置弹窗。
 *
 * 打开时先把目标笔记读进内存，之后每次改输入都只在内存里重算，
 * 因此切换「覆盖已有尺寸」、改宽度都能立刻看到影响数量与前后对比。
 */
export class ImageSizeModal extends Modal {
	private readonly config: ImageSizeModalOptions;
	private entries: Array<{ file: TFile; content: string }> = [];
	private loading = true;

	private width: string;
	private height: string;
	private overwrite: boolean;

	private previewEl: HTMLElement | null = null;
	private confirmBtn: HTMLButtonElement | null = null;
	private refreshTimer: number | null = null;

	constructor(app: App, config: ImageSizeModalOptions) {
		super(app);
		this.config = config;
		this.width = config.initialWidth;
		this.height = config.initialHeight;
		this.overwrite = config.initialOverwrite;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ait-image-size-modal');

		contentEl.createEl('h2', { text: '设置图片大小' });
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: `影响范围：${this.config.scopeLabel}，共 ${this.config.files.length} 篇笔记`,
		});

		new Setting(contentEl)
			.setName('宽度')
			.setDesc('单位为像素。宽度和高度都留空表示移除已有尺寸')
			.addText(text => text
				.setPlaceholder('100')
				.setValue(this.width)
				.onChange(value => {
					this.width = value;
					this.scheduleRefresh();
				}));

		new Setting(contentEl)
			.setName('高度')
			.setDesc('可留空，此时图片按宽度等比例缩放')
			.addText(text => text
				.setPlaceholder('留空')
				.setValue(this.height)
				.onChange(value => {
					this.height = value;
					this.scheduleRefresh();
				}));

		new Setting(contentEl)
			.setName('覆盖已有尺寸')
			.setDesc('关闭后只给还没有尺寸的图片补上，已有尺寸的图片保持不动')
			.addToggle(toggle => toggle
				.setValue(this.overwrite)
				.onChange(value => {
					this.overwrite = value;
					this.scheduleRefresh();
				}));

		this.previewEl = contentEl.createDiv({ cls: 'ait-size-preview' });

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => this.close());

		this.confirmBtn = buttonContainer.createEl('button', { text: '确定', cls: 'mod-cta' });
		this.confirmBtn.addEventListener('click', () => {
			const options = this.buildOptions();
			if (!options) return;
			this.close();
			void this.config.onConfirm(options);
		});

		this.renderPreview();
		void this.loadContents();
	}

	onClose(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.contentEl.empty();
	}

	/** 载入所有目标笔记内容，之后的重算都在内存里进行 */
	private async loadContents(): Promise<void> {
		const loaded: Array<{ file: TFile; content: string }> = [];
		for (const file of this.config.files) {
			try {
				loaded.push({ file, content: await this.config.read(file) });
			} catch (e) {
				console.error(`[ImageTransfer] 读取失败: ${file.path}`, e);
			}
		}
		this.entries = loaded;
		this.loading = false;
		this.renderPreview();
	}

	/** 输入变化时防抖重算，避免大仓库里每个按键都全量扫描 */
	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.renderPreview();
		}, 150);
	}

	private buildOptions(): ImageSizeOptions | null {
		if (validateImageSize(this.width, this.height) !== null) return null;
		return { width: this.width, height: this.height, overwriteExisting: this.overwrite };
	}

	private setConfirmEnabled(enabled: boolean): void {
		if (!this.confirmBtn) return;
		this.confirmBtn.disabled = !enabled;
		this.confirmBtn.toggleClass('mod-muted', !enabled);
	}

	private renderPreview(): void {
		const el = this.previewEl;
		if (!el) return;
		el.empty();

		if (this.loading) {
			el.createDiv({ cls: 'setting-item-description', text: '正在统计…' });
			this.setConfirmEnabled(false);
			return;
		}

		const error = validateImageSize(this.width, this.height);
		if (error) {
			el.createDiv({ cls: 'mod-warning', text: `⚠️ ${error}` });
			this.setConfirmEnabled(false);
			return;
		}

		const options = this.buildOptions();
		if (!options) {
			this.setConfirmEnabled(false);
			return;
		}

		let changed = 0;
		let skipped = 0;
		const samples: ImageSizeSample[] = [];
		for (const entry of this.entries) {
			const result = applyImageSize(entry.content, options);
			changed += result.changed;
			skipped += result.skipped;
			for (const sample of result.samples) {
				if (samples.length < 5) samples.push(sample);
			}
		}

		const summary = skipped > 0 ? `将修改 ${changed} 处，跳过 ${skipped} 处` : `将修改 ${changed} 处`;
		el.createDiv({ cls: 'setting-item-description', text: summary });

		if (samples.length > 0) {
			const list = el.createDiv({ cls: 'ait-size-samples' });
			for (const sample of samples) {
				const row = list.createDiv({ cls: 'ait-size-sample' });
				row.createEl('code', { text: sample.before });
				row.createSpan({ text: ' → ' });
				row.createEl('code', { text: sample.after });
			}
		}

		if (changed === 0) {
			const hint = this.width.trim() === '' && !this.overwrite && skipped > 0
				? '移除尺寸需要开启「覆盖已有尺寸」'
				: '没有需要修改的图片尺寸';
			el.createDiv({ cls: 'setting-item-description', text: hint });
		}

		this.setConfirmEnabled(changed > 0);
	}
}
