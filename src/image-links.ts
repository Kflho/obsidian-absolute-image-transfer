import { App, TFile } from 'obsidian';

/**
 * 图片链接共用的解析工具。
 *
 * 这里集中解决两个功能的共同根因 —— **同名图片歧义**：
 * 全库存在多张同名图片时，裸文件名链接 `![[图.png]]` 到底指向哪一张并不确定，
 * 旧实现「全局按文件名取第一个匹配」的兜底逻辑可能返回另一张图，
 * 于是插件会去改错文件、把链接指向别的图片。
 *
 * 现在统一为：能确定才返回文件，不能确定就返回 null 并标记歧义，由调用方跳过。
 */

/** 支持的图片扩展名（大小写不敏感） */
export const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|bmp|webp|heic|avif|svg)$/i;

/** 判断链接目标是否为图片（忽略 `#片段`） */
export function isImagePath(path: string): boolean {
	return IMAGE_EXT_RE.test(path.split('#')[0] ?? path);
}

/** 取路径中的文件名部分（链接里可能带文件夹或片段） */
export function linkBasename(rawLink: string): string {
	const withoutFragment = rawLink.split('#')[0] ?? rawLink;
	const parts = withoutFragment.split('/');
	return (parts[parts.length - 1] ?? withoutFragment).trim();
}

/**
 * 建立「小写文件名 → 同名的所有文件」索引。
 * 值用数组而不是单个文件，正是为了能判断"同名有几张"。
 */
export function buildBasenameIndex(app: App): Map<string, TFile[]> {
	const index = new Map<string, TFile[]>();
	for (const file of app.vault.getFiles()) {
		const key = file.name.toLowerCase();
		const list = index.get(key);
		if (list) {
			list.push(file);
		} else {
			index.set(key, [file]);
		}
	}
	return index;
}

/** 把新建 / 改名的文件登记进索引，保证同一次任务内的判断是最新的 */
export function addToBasenameIndex(index: Map<string, TFile[]>, file: TFile): void {
	const key = file.name.toLowerCase();
	const list = index.get(key);
	if (list) {
		if (!list.some(f => f.path === file.path)) list.push(file);
	} else {
		index.set(key, [file]);
	}
}

export interface LinkResolution {
	/** 解析到的文件；null 表示无法确定 */
	file: TFile | null;
	/** 全库是否存在同名文件（即裸文件名链接有歧义） */
	ambiguous: boolean;
}

/**
 * 解析图片链接到具体文件。
 *
 * 1. 优先用 Obsidian 原生解析 —— 这正是笔记里实际渲染的那张图，所见即所得
 * 2. 原生解析失败时（文件名含特殊字符等），只有全库唯一同名时才接受，
 *    有多个同名文件就放弃：宁可跳过，也不能改错文件
 */
export function resolveImageLink(
	app: App,
	sourcePath: string,
	rawLink: string,
	index: Map<string, TFile[]>
): LinkResolution {
	const native = app.metadataCache.getFirstLinkpathDest(rawLink, sourcePath);
	if (native instanceof TFile) {
		const sameName = index.get(native.name.toLowerCase()) ?? [];
		return { file: native, ambiguous: sameName.length > 1 };
	}

	// 链接自带路径（本插件的「完整路径」模式就会产出这种链接）：
	// 原生解析失败时按路径直接找，不能退化成按文件名猜
	const withoutFragment = (rawLink.split('#')[0] ?? rawLink).replace(/^\.\//, '');
	if (withoutFragment.includes('/')) {
		const direct = app.vault.getAbstractFileByPath(withoutFragment);
		if (direct instanceof TFile) return { file: direct, ambiguous: false };

		// 路径可能只是末几级（如 attachments/图.png），按后缀唯一匹配
		const suffix = `/${withoutFragment.toLowerCase()}`;
		const matched = app.vault.getFiles().filter(f => f.path.toLowerCase().endsWith(suffix));
		if (matched.length === 1) return { file: matched[0] ?? null, ambiguous: false };
		return { file: null, ambiguous: matched.length > 1 };
	}

	const candidates = index.get(linkBasename(rawLink).toLowerCase()) ?? [];
	const only = candidates.length === 1 ? candidates[0] : undefined;
	return { file: only ?? null, ambiguous: candidates.length > 1 };
}

/** 链接目标的路径形式 */
export type LinkFormat = 'full' | 'filename';

/**
 * 决定链接里写文件名还是完整路径。
 *
 * 关键安全线：文件名在全库不唯一时**必须**写完整路径，
 * 否则「仅文件名」会把链接变成有歧义的裸文件名 —— 笔记就可能显示成另一张同名图。
 */
export function chooseLinkTarget(file: { name: string; path: string }, index: Map<string, TFile[]>, format: string): string {
	const sameName = index.get(file.name.toLowerCase()) ?? [];
	const uniqueInVault = sameName.length <= 1;
	if (format === 'filename' && uniqueInVault) return file.name;
	return file.path;
}

/**
 * 在目标文件夹里找一个不冲突的文件名。
 * 同名时依次尝试 `名字 2.ext`、`名字 3.ext`…
 */
export function buildCopyName(takenLowercase: Set<string>, name: string): string {
	if (!takenLowercase.has(name.toLowerCase())) return name;

	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.substring(0, dot) : name;
	const ext = dot > 0 ? name.substring(dot) : '';

	for (let i = 2; i < 1000; i++) {
		const candidate = `${stem} ${i}${ext}`;
		if (!takenLowercase.has(candidate.toLowerCase())) return candidate;
	}
	// 极端情况：加时间戳兜底
	return `${stem} ${Date.now()}${ext}`;
}
