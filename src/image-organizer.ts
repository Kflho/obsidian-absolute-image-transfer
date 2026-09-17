import { App, TFile, TFolder } from 'obsidian';
import { ensureFolder, parentPathOf, resolveAttachmentFolder, AttachmentLocationSettings } from './attachment-folder';
import {
	addToBasenameIndex,
	buildCopyName,
	chooseLinkTarget,
	isImagePath,
	resolveImageLink,
} from './image-links';

/**
 * 整理笔记里的图片位置。
 *
 * 解决的问题：复制粘贴笔记后，`![[图.png]]` 这类裸文件名链接仍然解析到**原文件夹**的图片，
 * 本次笔记自己的附件夹里其实没有这张图。笔记一旦移动、原图一旦被删或被改名，图片就没了。
 *
 * 处理方式（逐条链接）：
 *   1. 图片已经在笔记自己的附件夹里 → 不动
 *   2. 附件夹里已有同内容的副本 → 只把链接指过去（不重复复制）
 *   3. 否则把图片**复制**一份到附件夹（源文件保留，别的笔记可能还在用），再改写本笔记的链接
 *
 * 链接写成文件名还是完整路径由 chooseLinkTarget 决定：
 * 全库同名时强制写完整路径，避免裸文件名指向另一张同名图片。
 */

const WIKI_IMAGE_RE = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;

/** 比较内容时的体积上限，超过则视为不同，避免把大文件整个读进内存 */
const MAX_COMPARE_BYTES = 32 * 1024 * 1024;

export interface OrganizeResult {
	/** 改写后的笔记内容（无改动时与输入相同） */
	content: string;
	/** 内容是否真的发生了变化 */
	changed: boolean;
	/** 复制进附件夹的图片数 */
	copied: number;
	/** 复用附件夹里已有副本、仅改写链接的数量 */
	relinked: number;
	/** 因无法确定目标而跳过的链接数 */
	skipped: number;
	/** 跳过原因（去重后的说明） */
	reasons: string[];
}

export interface OrganizeSettings extends AttachmentLocationSettings {
	/** 链接形式：full 完整路径 / filename 仅文件名 */
	renameLinkFormat: string;
}

/** 目标文件夹里现有的文件名（小写），用于挑一个不冲突的新名字 */
function collectFolderNames(app: App, folderPath: string): Set<string> {
	const names = new Set<string>();
	const folder = folderPath === '/'
		? app.vault.getRoot()
		: app.vault.getAbstractFileByPath(folderPath);

	if (folder instanceof TFolder) {
		for (const child of folder.children) {
			if (child instanceof TFile) names.add(child.name.toLowerCase());
		}
	}
	return names;
}

function joinPath(folderPath: string, name: string): string {
	return folderPath === '/' ? name : `${folderPath}/${name}`;
}

/** 两张图片内容是否完全一致（先比大小，再比字节） */
async function sameContent(app: App, a: TFile, b: TFile): Promise<boolean> {
	const sizeA = a.stat?.size;
	const sizeB = b.stat?.size;
	if (typeof sizeA === 'number' && typeof sizeB === 'number') {
		if (sizeA !== sizeB) return false;
		if (sizeA > MAX_COMPARE_BYTES) return false;
	}

	const [bufA, bufB] = await Promise.all([app.vault.readBinary(a), app.vault.readBinary(b)]);
	const bytesA = new Uint8Array(bufA);
	const bytesB = new Uint8Array(bufB);
	if (bytesA.length !== bytesB.length) return false;
	for (let i = 0; i < bytesA.length; i++) {
		if (bytesA[i] !== bytesB[i]) return false;
	}
	return true;
}

function pushReason(reasons: string[], reason: string): void {
	if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * 整理单篇笔记的图片位置。
 *
 * @param index 全库文件名索引（由 buildBasenameIndex 建立，调用方持有，新建的文件会登记回去）
 */
export async function organizeNoteImages(
	app: App,
	settings: OrganizeSettings,
	note: TFile,
	index: Map<string, TFile[]>
): Promise<OrganizeResult> {
	const content = await app.vault.read(note);
	const targetFolder = resolveAttachmentFolder(app, settings, note);
	const targetKey = targetFolder.toLowerCase();
	const existingNames = collectFolderNames(app, targetFolder);

	let result = '';
	let lastIndex = 0;
	let copied = 0;
	let relinked = 0;
	let skipped = 0;
	const reasons: string[] = [];

	WIKI_IMAGE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = WIKI_IMAGE_RE.exec(content)) !== null) {
		const rawTarget = (match[1] ?? '').trim();
		const alias = match[2];
		if (!isImagePath(rawTarget)) continue; // 不是图片链接，原样保留

		const { file: source, ambiguous } = resolveImageLink(app, note.path, rawTarget, index);
		if (!source) {
			skipped++;
			pushReason(reasons, ambiguous ? '存在同名图片，无法确定指向哪一张' : '找不到对应的图片文件');
			continue;
		}

		// 已经在笔记自己的附件夹里，不需要搬运
		if (parentPathOf(source).toLowerCase() === targetKey) continue;

		// 附件夹里是否已有同内容的副本
		const candidate = app.vault.getAbstractFileByPath(joinPath(targetFolder, source.name));
		let destination: TFile | null = null;

		if (candidate instanceof TFile && await sameContent(app, source, candidate)) {
			destination = candidate;
			relinked++;
		} else {
			const destName = buildCopyName(existingNames, source.name);
			const destPath = joinPath(targetFolder, destName);
			try {
				await ensureFolder(app, targetFolder);
				const data = await app.vault.readBinary(source);
				const created = await app.vault.createBinary(destPath, data);
				existingNames.add(destName.toLowerCase());
				addToBasenameIndex(index, created);
				destination = created;
				copied++;
			} catch (e) {
				console.error(`[ImageTransfer] 复制图片失败: ${source.path} → ${destPath}`, e);
				skipped++;
				pushReason(reasons, '复制图片失败，详见控制台');
				continue;
			}
		}

		const fragmentIndex = rawTarget.indexOf('#');
		const fragment = fragmentIndex >= 0 ? rawTarget.substring(fragmentIndex) : '';
		const target = chooseLinkTarget(destination, index, settings.renameLinkFormat) + fragment;
		const link = `![[${target}${alias === undefined ? '' : '|' + alias}]]`;

		result += content.substring(lastIndex, match.index) + link;
		lastIndex = match.index + match[0].length;
	}

	result += content.substring(lastIndex);

	return { content: result, changed: result !== content, copied, relinked, skipped, reasons };
}
