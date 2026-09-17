/**
 * 图片尺寸引擎：把笔记里的图片链接统一改成指定大小。
 *
 * 纯函数实现，不依赖 Obsidian API，便于单独测试（见 test/image-size.test.ts）。
 *
 * 支持的写法（与 Obsidian 官方语法一致）：
 *   ![[图片.png]]            → ![[图片.png|100]]        仅宽度，按比例缩放
 *   ![[图片.png|300]]        → ![[图片.png|100]]        覆盖已有尺寸
 *   ![[图片.png|300x200]]    → ![[图片.png|100x200]]    宽 x 高
 *   ![[图片.png#outline]]    → ![[图片.png#outline|100]] 保留 #片段
 *   ![300](url.png)          → ![100](url.png)          Markdown 图片（尺寸占 alt 槽位）
 *
 * 刻意不碰的情况：
 *   ![[图片.png|一段说明文字]]  别名不是纯尺寸时视为 alt 文字，原样保留
 *   ![风景照](url.png)         Markdown 图片的 alt 槽位已有文字，无法与尺寸共存，跳过
 *   ![[笔记.md]] / ![[文档.pdf]]  非图片扩展名，完全不处理
 */

/** 参与改写的图片扩展名（大小写不敏感） */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|bmp|webp|heic|avif|svg)$/i;

/** 纯尺寸别名：`100` 或 `100x200` */
const SIZE_ALIAS_RE = /^\d+(?:x\d+)?$/;

/** Obsidian 双链嵌入：目标（可含 #片段）与可选别名 */
const WIKI_EMBED_RE = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;

/** Markdown 图片：方括号槽位既是 alt 文字也是尺寸 */
const MD_IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g;

/** 弹窗预览最多展示多少条改动 */
const MAX_SAMPLES = 5;

export interface ImageSizeOptions {
	/** 目标宽度（像素）。空字符串表示不指定宽度（即移除尺寸模式） */
	width: string;
	/** 目标高度（像素）。空字符串表示只设宽度、按比例缩放 */
	height: string;
	/** 是否覆盖已有尺寸；关闭时只给还没有尺寸的图片补上 */
	overwriteExisting: boolean;
}

export interface ImageSizeSample {
	before: string;
	after: string;
}

export interface ImageSizeResult {
	/** 改写后的内容；无改动时与输入完全相同 */
	content: string;
	/** 被修改的图片链接数 */
	changed: number;
	/** 因保护 alt 文字或未开启覆盖而跳过的图片链接数 */
	skipped: number;
	/** 改动示例，供弹窗预览 */
	samples: ImageSizeSample[];
}

/**
 * 校验宽度/高度输入。合法返回 null，否则返回给用户看的错误信息。
 */
export function validateImageSize(width: string, height: string): string | null {
	const w = width.trim();
	const h = height.trim();

	if (w !== '' && !/^\d+$/.test(w)) return '宽度只能填数字';
	if (h !== '' && !/^\d+$/.test(h)) return '高度只能填数字';
	if (w === '' && h !== '') return '请先填写宽度：只填高度无法生效';
	if (w === '0' || h === '0') return '尺寸需要大于 0';
	return null;
}

/**
 * 目标尺寸字符串：`100`、`100x200`；空字符串表示移除已有尺寸。
 */
export function toSizeString(width: string, height: string): string {
	const w = width.trim();
	const h = height.trim();
	if (w === '') return '';
	return h === '' ? w : `${w}x${h}`;
}

/** 去掉 `#片段` 后判断是否为图片文件 */
function isImageTarget(target: string): boolean {
	const withoutFragment = target.split('#')[0] ?? target;
	return IMAGE_EXT_RE.test(withoutFragment);
}

/** 去掉 `?查询` / `#片段` 后判断是否为图片地址 */
function isImageUrl(url: string): boolean {
	const cleaned = url.split(/[?#]/)[0] ?? url;
	return IMAGE_EXT_RE.test(cleaned);
}

/**
 * 把内容里所有图片链接的尺寸统一为目标值。
 * 尺寸已经正确的链接不会被改写，因此重复执行不会产生任何变化。
 */
export function applyImageSize(rawContent: string, options: ImageSizeOptions): ImageSizeResult {
	const targetSize = toSizeString(options.width, options.height);
	const samples: ImageSizeSample[] = [];
	let changed = 0;
	let skipped = 0;

	/** 在原文上按正则逐段改写，只拼接真正发生变化的片段 */
	function rewrite(content: string, re: RegExp, build: (match: RegExpExecArray) => string | null): string {
		let result = '';
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		re.lastIndex = 0;

		while ((match = re.exec(content)) !== null) {
			if (match.index === re.lastIndex) re.lastIndex++;

			const replacement = build(match);
			result += content.substring(lastIndex, match.index);

			if (replacement !== null && replacement !== match[0]) {
				result += replacement;
				changed++;
				if (samples.length < MAX_SAMPLES) {
					samples.push({ before: match[0], after: replacement });
				}
			} else {
				result += match[0];
			}
			lastIndex = match.index + match[0].length;
		}

		result += content.substring(lastIndex);
		return result;
	}

	// ---- Obsidian 双链嵌入 ----
	const afterWiki = rewrite(rawContent, WIKI_EMBED_RE, match => {
		const target = match[1] ?? '';
		if (!isImageTarget(target)) return null;

		const alias = match[2];
		const link = (size: string) => (size === '' ? `![[${target}]]` : `![[${target}|${size}]]`);

		if (alias === undefined || alias === '') {
			// 没有尺寸：补上；移除模式下顺手清掉多余的空别名
			if (targetSize === '') return alias === '' ? link('') : null;
			return link(targetSize);
		}

		if (!SIZE_ALIAS_RE.test(alias)) {
			// 别名是说明文字，不能当成尺寸覆盖掉
			skipped++;
			return null;
		}

		if (!options.overwriteExisting) {
			skipped++;
			return null;
		}
		if (alias === targetSize) return null; // 幂等：已经正确
		return link(targetSize);
	});

	// ---- Markdown 图片（尺寸写在方括号槽位） ----
	const afterMarkdown = rewrite(afterWiki, MD_IMAGE_RE, match => {
		const alt = match[1] ?? '';
		const url = match[2] ?? '';
		if (!isImageUrl(url)) return null;

		if (alt === '') {
			if (targetSize === '') return null;
			return `![${targetSize}](${url})`;
		}

		if (!SIZE_ALIAS_RE.test(alt)) {
			// 槽位里是 alt 文字，与尺寸无法共存，跳过以免丢文字
			skipped++;
			return null;
		}

		if (!options.overwriteExisting) {
			skipped++;
			return null;
		}
		if (alt === targetSize) return null;
		return targetSize === '' ? `![](${url})` : `![${targetSize}](${url})`;
	});

	return { content: afterMarkdown, changed, skipped, samples };
}
