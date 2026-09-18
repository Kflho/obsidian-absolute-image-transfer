/**
 * 逐行扫描的"保护区"判定（纯函数，不依赖 Obsidian API）。
 *
 * 有三类区域，任何排版类功能都不该碰：
 * - **YAML frontmatter**：缩进是语法，而且 YAML 里本来就禁止用 Tab 缩进；
 * - **围栏代码块内部**（``` / ~~~）：缩进、`#标签`、`|` 都是代码本身；
 * - **缩进代码块**（4 个空格或一个 Tab）：同上，见 markIndentedCodeLines。
 *
 * 行首缩进修复、标记排版、标签排版、板块排序四个模块都需要这套判定。
 * 共用一份实现，免得各写一份、各有各的边界 bug（例如未闭合的围栏）。
 */

/** 围栏代码块的围栏：字符 + 长度（``` 与 ```` 是两种不同的围栏） */
interface Fence {
	char: string;
	length: number;
}

/**
 * 标记出哪些行属于"保护区"。
 *
 * 约定与 Obsidian 一致：
 * - frontmatter 只在**第 0 行**是 `---` 时成立，正文中间的 `---` 是分隔线；
 * - 围栏必须同字符、且闭合围栏不短于开始围栏才算闭合，未闭合时后面全部受保护。
 *
 * @param lines 按 `\n` 切好的行
 * @returns 与 lines 等长的布尔数组，true 表示该行不可改动
 */
export function markProtectedLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	let inFrontmatter = false;
	let fence: Fence | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';

		if (i === 0 && /^---[ \t]*\r?$/.test(line)) {
			inFrontmatter = true;
			flags[i] = true;
			continue;
		}
		if (inFrontmatter) {
			flags[i] = true;
			if (/^(?:---|\.\.\.)[ \t]*\r?$/.test(line)) inFrontmatter = false;
			continue;
		}

		const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			flags[i] = true;
			if (fence === null) {
				fence = { char: marker.charAt(0), length: marker.length };
			} else if (fence.char === marker.charAt(0) && marker.length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (fence !== null) flags[i] = true;
	}

	return flags;
}

/** 列表符号：`-` `*` `+` `1.` `1)`，后面跟空白或行尾 */
const LIST_MARKER_RE = /^(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

/** 行内代码：`…` 或 ``…``（成对的同长度反引号） */
const INLINE_CODE_RE = /(`+)([\s\S]*?)\1/g;

/**
 * 一行里所有行内代码的区间（左闭右开）。
 * 行内代码里的 `$$`、`#标签` 都不是语法，公式排版与标签排版都要跳过它们。
 */
export function inlineCodeRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const re = new RegExp(INLINE_CODE_RE.source, 'g');
	let match: RegExpExecArray | null;

	while ((match = re.exec(line)) !== null) {
		ranges.push([match.index, match.index + match[0].length]);
		if (match.index === re.lastIndex) re.lastIndex++;
	}

	return ranges;
}

/**
 * 标记整篇笔记里属于 `$$ … $$` 公式的行（含起止行）。
 *
 * 标签排版不该去动公式里的 `#`（例如 `\textcolor{#fff}{…}`），
 * 板块排序更不能把多行公式拆成一块一块搬走。不成对的 `$$`（未闭合）不标记，
 * 否则会把后面整篇正文都当成公式。
 */
export function markMathLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	const protectedLines = markProtectedLines(lines);

	/** 先配对，再标记：未闭合的 `$$` 不参与 */
	let open = -1;
	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		const line = lines[i] ?? '';
		const codeRanges = inlineCodeRanges(line);

		let count = 0;
		let at = line.indexOf('$$');
		while (at >= 0) {
			const escaped = at > 0 && line.charAt(at - 1) === '\\';
			const inCode = codeRanges.some(([start, end]) => at < end && at + 2 > start);
			if (!escaped && !inCode) count++;
			at = line.indexOf('$$', at + 2);
		}
		if (count === 0) continue;

		if (open < 0) {
			flags[i] = true;
			if (count % 2 === 1) open = i;
			continue;
		}
		flags[i] = true;
		if (count % 2 === 1) open = -1;
	}

	// 没闭合：把这一段标记撤掉（否则后面整篇都会被当成公式）
	if (open >= 0) {
		for (let i = open; i < lines.length; i++) {
			if (!protectedLines[i]) flags[i] = false;
		}
	}

	return flags;
}

/** 缩进代码块的缩进：一个 Tab，或 4 个以上空格 */
const INDENTED_CODE_RE = /^(?:\t[ \t]*| {4,})\S/;

/**
 * 这一行是不是"缩进代码块"的**开头**。
 *
 * 用缩进写代码时，`#fff`（颜色）、`#TODO`（注释）看着就像标签，排版挪了就把代码弄坏了。
 * Markdown 的缩进代码块**不能打断段落**，所以它前面要么是空行、要么就是文档开头；
 * 而列表项里的缩进内容、聊天记录的正文都紧跟在上一行后面 —— 靠这一点把两者分开，
 * 因此聊天记录（哪怕正文缩进设置成 4 个空格）不会被误判成代码。
 */
function isIndentedCodeStart(lines: string[], index: number): boolean {
	const line = lines[index] ?? '';
	if (!INDENTED_CODE_RE.test(line)) return false;

	const previous = lines[index - 1];
	// 开头就是缩进：Markdown 当代码块
	if (previous === undefined) return true;
	// 前面那行不是空行 → 这是上一段 / 列表项的续行，不是代码块
	if (previous.trim() !== '') return false;

	// 空行之上是列表项、引用或本身缩进的内容 → 这段缩进属于那个容器，不是代码
	for (let i = index - 2; i >= 0; i--) {
		const above = lines[i] ?? '';
		if (above.trim() === '') continue;
		return !/^[ \t]/.test(above) && !LIST_MARKER_RE.test(above) && !above.trimStart().startsWith('>');
	}
	return true;
}

/**
 * 标记整篇笔记里属于缩进代码块的行。
 *
 * 代码块里的后续行只看自己判断不出来（上一行是缩进行，看着就像"续行"），
 * 所以从头扫一遍：非缩进行出现之前，缩进行都算代码。
 * 空行不结束代码块（代码里本来就可以有空行），与 Markdown 的规则一致。
 */
export function markIndentedCodeLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	let inCode = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '') continue;

		if (INDENTED_CODE_RE.test(line) && (inCode || isIndentedCodeStart(lines, i))) {
			flags[i] = true;
			inCode = true;
			continue;
		}
		inCode = false;
	}

	return flags;
}
