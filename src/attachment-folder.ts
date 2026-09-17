import { App, TFile, TFolder, normalizePath } from 'obsidian';

/**
 * 附件文件夹定位（从 main.ts 抽出，供图片转换、图片整理等多处复用）。
 *
 * 拆成「只算路径」与「按需创建」两步：
 * - resolveAttachmentFolder 纯计算，不产生副作用 —— 只读的规划阶段可以放心调用
 * - ensureFolder 只在真的要写入时才创建，避免给没有图片的笔记凭空建出空文件夹
 */

/** 只依赖这两个设置项，避免与 settings.ts 产生循环依赖 */
export interface AttachmentLocationSettings {
	attachmentLocation: string;
	customAttachmentFolder: string;
}

/** 递归创建多级文件夹 */
export async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const target = normalizePath(folderPath);
	if (target === '/' || target === '') return;

	const parts = target.split('/');
	let current = '';

	for (const part of parts) {
		if (!part) continue;
		current = current === '' ? part : `${current}/${part}`;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				console.warn(`[ImageTransfer] 创建文件夹失败或已存在: ${current}`, e);
			}
		}
	}
}

/**
 * 按插件设置推断某篇笔记的附件目标文件夹（纯计算，不创建）。
 */
export function resolveAttachmentFolder(app: App, settings: AttachmentLocationSettings, file: TFile): string {
	const location = settings.attachmentLocation;
	const customName = settings.customAttachmentFolder || 'Attachments';
	const parentPath = file.parent ? file.parent.path : '/';

	let targetFolder = '/';

	if (location === 'system') {
		const rawAttachmentPath = (app.vault as unknown as { getConfig: (key: string) => unknown }).getConfig('attachmentFolderPath');
		let attachmentPath = '/';

		if (typeof rawAttachmentPath === 'string' && rawAttachmentPath.trim() !== '') {
			attachmentPath = rawAttachmentPath;
		}

		if (attachmentPath === '/') {
			targetFolder = '/';
		} else if (attachmentPath.startsWith('./')) {
			const subFolder = attachmentPath.substring(2);
			targetFolder = subFolder ? (parentPath === '/' ? subFolder : `${parentPath}/${subFolder}`) : parentPath;
		} else {
			targetFolder = attachmentPath;
		}
	} else if (location === 'root') {
		targetFolder = '/';
	} else if (location === 'current') {
		targetFolder = parentPath;
	} else if (location === 'subfolder') {
		targetFolder = parentPath === '/' ? customName : `${parentPath}/${customName}`;
	} else if (location === 'custom') {
		targetFolder = customName;
	}

	return normalizePath(targetFolder);
}

/**
 * 推断附件文件夹并在必要时创建（图片转换功能沿用这个入口）。
 */
export async function getTargetAttachmentFolder(
	app: App,
	settings: AttachmentLocationSettings,
	file: TFile
): Promise<string> {
	const folder = resolveAttachmentFolder(app, settings, file);
	if (folder !== '/' && !app.vault.getAbstractFileByPath(folder)) {
		await ensureFolder(app, folder);
	}
	return folder;
}

/** 取文件所在文件夹路径（根目录统一返回 `/`） */
export function parentPathOf(file: TFile): string {
	const parent = file.parent;
	if (!(parent instanceof TFolder)) return '/';
	return normalizePath(parent.path);
}
