/**
 * 标签排版（纯函数，除参数外不依赖任何 Obsidian API）。
 *
 * 做两件事：
 * 1. **标签归位**——一块内容里同时有正文和标签时，把标签统一挪到块尾，
 *    与正文之间空一格：`"#数学 今天学了极限"` → `"今天学了极限 #数学"`。
 *    整块只有标签（例如笔记开头的标签行）时位置不动，只按需排序。
 * 2. **标签排序**——同一处出现的多个标签按首字母排（中文按拼音）：
 *    `"内容 #笔记 #数学"` → `"内容 #笔记 #数学"`（笔 b < 数 s）。
 *
 * "块"的边界：
 * - 一个段落（连续的普通正文行）算一块，标签挪到**段落最后一行**的句尾；
 * - 一行列表项、一行标题各自成块，标签挪到该行句尾，列表符号/引用符号留在原地；
 * - **表格按单元格算块，不是按行**——表格整行算一块会把标签挪到别的列去，表格就毁了。
 *
 * 不碰的地方：frontmatter、围栏代码块、缩进代码块（行首 tab 或 4 个空格）、`$$…$$` 公式、
 * 行内代码、`%%注释%%`、双链与 Markdown 链接（`[[笔记#标题]]`、`[文字](url#锚点)` 里的 `#` 不是标签）。
 * 不带行首竖线的"表格"（`甲 | 乙 | #标签 丙`）分不清列边界，整行不动。
 */
import { markProtectedLines, markIndentedCodeLines, markMathLines } from './line-scan';
import { compareByFirstLetter } from './collate';

export interface TagLayoutOptions {
	/** 同一块内的多个标签按首字母排序；关闭则保持原有先后顺序 */
	sort: boolean;
}

/** 默认：排序打开 —— 与设置里「标签排序」的默认值一致 */
export const DEFAULT_TAG_LAYOUT_OPTIONS: TagLayoutOptions = { sort: true };

/**
 * 标签本体：首字符是字母/数字/下划线，后面可跟字母、数字、下划线、连字符、斜杠。
 * 前面必须有空白或位于行首 —— 否则 `C#`、`url#anchor`、`文字#标签` 都会被误判。
 */
const TAG_SOURCE = String.raw`(^|[ \t\u3000])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)`;

/** 行内不该被当成标签的区域：行内代码、双链、Markdown 链接、HTML 注释、Obsidian 注释 */
const PROTECTED_PATTERNS: RegExp[] = [
	/(`+)([\s\S]*?)\1/g,
	/!?\[\[[^\]\n]*\]\]/g,
	/!?\[[^\]\n]*\]\([^)\n]*\)/g,
	/<!--[\s\S]*?-->/g,
	/%%[\s\S]*?%%/g,
];

/** 列表符号 + 后面的空白 */
const LIST_PREFIX_RE = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]+)/;

/**
 * 标签后面紧跟这些标点时，标签前面那处空白也一起摘掉：
 * `"正文 #标签。"` → `"正文。"`（而不是 `"正文 。"`）
 */
const FOLLOWED_BY_PUNCTUATION_RE = /^[.,;:!?，。；：！？、）】》」』”’]/;

/** 标题符号 + 后面的空白（`#标签` 没有空白，不算标题） */
const HEADING_PREFIX_RE = /^#{1,6}(?:[ \t]+)/;

/** 一行拆出来的前缀（缩进 + 引用标记 + 列表/标题符号，原样保留）与正文 */
interface ParsedLine {
	prefix: string;
	body: string;
	/** 行首符号的种类：列表项与标题都各自成块，不能跟相邻正文行连成一段 */
	marker: 'none' | 'item' | 'heading';
}

/** 空行/越界时的占位 */
const EMPTY_LINE: ParsedLine = { prefix: '', body: '', marker: 'none' };

/** 行的种类：决定它跟谁组成一块 */
type LineKind = 'plain' | 'item' | 'solo' | 'table' | 'opaque';

/** 标签：`start`/`end` 是它在正文里的区间（不含前面的空白），`text` 是原样的 `#标签` */
interface TagMatch {
	start: number;
	end: number;
	text: string;
}

/** 行内受保护区间（左闭右开） */
function protectedRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (const pattern of PROTECTED_PATTERNS) {
		const re = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = re.exec(line)) !== null) {
			ranges.push([match.index, match.index + match[0].length]);
			if (match.index === re.lastIndex) re.lastIndex++;
		}
	}
	return ranges;
}

/** 区间是否落在受保护区域内 */
function insideRanges(ranges: Array<[number, number]>, start: number, end: number): boolean {
	for (const [rangeStart, rangeEnd] of ranges) {
		if (start < rangeEnd && end > rangeStart) return true;
	}
	return false;
}

/** 找出一行里所有标签 */
function findTags(text: string): TagMatch[] {
	const ranges = protectedRanges(text);
	const re = new RegExp(TAG_SOURCE, 'gu');
	const matches: TagMatch[] = [];
	let match: RegExpExecArray | null;

	while ((match = re.exec(text)) !== null) {
		if (match.index === re.lastIndex) re.lastIndex++;
		const lead = match[1] ?? '';
		// 结尾的 `-` / `/` 多半是标点而不是标签的一部分
		const name = (match[2] ?? '').replace(/[-/]+$/, '');
		// Obsidian 规则：标签至少含一个非数字字符，`#123` 不是标签
		if (!/\p{L}/u.test(name)) continue;

		const start = match.index + lead.length;
		const end = start + 1 + name.length;
		if (insideRanges(ranges, start, end)) continue;
		matches.push({ start, end, text: `#${name}` });
	}

	return matches;
}

/**
 * 摘掉一行里的标签。
 *
 * 标签连同它前面的一处空白一起摘掉，剩下的空白收成一个 ——
 * 这样 `"今天 #数学 很好"` 摘完是 `"今天 很好"` 而不是 `"今天  很好"`。
 * 标签后面紧跟标点时（`"正文 #标签。"`），连标签前面那处空白一起吃掉，
 * 标点直接接回正文：`"正文。"`，而不是留下 `"正文 。"` 这种孤零零的空格。
 */
function stripTags(body: string): { text: string; tags: string[] } {
	const matches = findTags(body);
	if (matches.length === 0) return { text: body, tags: [] };

	let text = '';
	let cursor = 0;
	for (const match of matches) {
		const before = body.substring(cursor, match.start);
		const after = body.charAt(match.end);
		text += FOLLOWED_BY_PUNCTUATION_RE.test(after) ? before.replace(/[ \t\u3000]+$/, '') : before;
		cursor = match.end;
	}
	text += body.substring(cursor);

	// CRLF 文件的 `\r` 属于行尾符，不参与 trim，否则会把它删掉（同一篇笔记里行尾就乱了）
	const eol = text.endsWith('\r') ? '\r' : '';
	const core = eol ? text.substring(0, text.length - 1) : text;

	return {
		text: core.replace(/[ \t\u3000]{2,}/g, ' ').trim() + eol,
		tags: matches.map(match => match.text),
	};
}

/** 摘掉标签之后这一行还剩不剩正文（纯空白、只剩 `\r` 都算空） */
function hasText(text: string): boolean {
	return !/^[ \t\u3000\r]*$/.test(text);
}

/** 按设置给一组标签排序（首字母；中文按拼音，数字按数值） */
function orderTags(tags: string[], options: TagLayoutOptions): string[] {
	if (!options.sort) return tags;
	// Array.prototype.sort 是稳定排序：同名标签保持原有先后
	return [...tags].sort((a, b) => compareByFirstLetter(a, b));
}

/** 去重，保持原有先后 */
function dedupe(tags: string[]): string[] {
	const result: string[] = [];
	for (const tag of tags) {
		if (!result.includes(tag)) result.push(tag);
	}
	return result;
}

/** 拆出"缩进 + 引用标记"前缀 */
function splitQuotePrefix(line: string): { prefix: string; body: string } {
	const indentMatch = /^[ \t]*/.exec(line);
	const indent = indentMatch ? indentMatch[0] : '';
	let rest = line.substring(indent.length);
	let prefix = indent;

	while (rest.startsWith('>')) {
		let index = 1;
		while (rest.charAt(index) === ' ' || rest.charAt(index) === '\t') index++;
		prefix += rest.substring(0, index);
		rest = rest.substring(index);
	}

	return { prefix, body: rest };
}

/**
 * 把行首的块级符号（引用 → 列表 / 标题 → 任务复选框）划进前缀：
 * 标签归位时符号必须留在原地（`- #标签 内容` → `- 内容 #标签`，而不是 `#标签 - 内容`）。
 *
 * 同时记下这是列表项还是标题 —— 相邻列表项的前缀完全一样（都是 `- `），
 * 光看前缀会把一整串列表项当成一个段落，标签就串行了。
 */
function parseLine(line: string): ParsedLine {
	const quoted = splitQuotePrefix(line);

	const listMatch = LIST_PREFIX_RE.exec(quoted.body);
	if (listMatch) {
		let prefix = quoted.prefix + listMatch[0];
		let body = quoted.body.substring(listMatch[0].length);
		// 任务列表的 `[ ]` / `[x]` 也算行首符号
		const taskMatch = /^\[[ xX]\][ \t]+/.exec(body);
		if (taskMatch) {
			prefix += taskMatch[0];
			body = body.substring(taskMatch[0].length);
		}
		return { prefix, body, marker: 'item' };
	}

	const headingMatch = HEADING_PREFIX_RE.exec(quoted.body);
	if (headingMatch) {
		return {
			prefix: quoted.prefix + headingMatch[0],
			body: quoted.body.substring(headingMatch[0].length),
			marker: 'heading',
		};
	}

	return { prefix: quoted.prefix, body: quoted.body, marker: 'none' };
}

/** 取某行的解析结果（noUncheckedIndexedAccess 下的兜底） */
function parsedAt(parsed: ParsedLine[], index: number): ParsedLine {
	return parsed[index] ?? EMPTY_LINE;
}

/** 行属于哪一类块 */
function lineKind(parsed: ParsedLine): LineKind {
	if (parsed.marker === 'item') return 'item';
	if (parsed.marker === 'heading') return 'solo';

	const body = parsed.body;
	if (body.trimStart().startsWith('|')) return 'table';
	// 不带行首竖线、但竖线很多的写法（非标准表格）：分不清列边界，整行不动最安全
	if ((body.match(/\|/g) ?? []).length >= 2) return 'opaque';
	return 'plain';
}

/**
 * 表格行：逐个单元格排版。
 *
 * 表格整行算一块是错的 —— 标签会被挪到行尾，那一行的列数就对不上了。
 * 单元格两侧的填充空格原样保留，只动单元格里面的内容。
 */
function layoutTableRow(row: string, options: TagLayoutOptions): string {
	// 转义的 `\|` 是单元格内容，不是分隔符
	const ESCAPED = '\u0000';
	const cells = row.replace(/\\\|/g, ESCAPED).split('|');
	if (cells.length < 3) return row;

	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i] ?? '';
		const parts = /^([ \t]*)([\s\S]*?)([ \t]*)$/.exec(cell);
		if (!parts) continue;
		const inner = parts[2] ?? '';
		if (!inner.includes('#')) continue;

		const { text, tags } = stripTags(inner);
		if (tags.length === 0) continue;

		const ordered = orderTags(dedupe(tags), options);
		const next = text === '' ? ordered.join(' ') : `${text} ${ordered.join(' ')}`;
		if (next !== inner) cells[i] = (parts[1] ?? '') + next + (parts[3] ?? '');
	}

	return cells.join('|').replace(new RegExp(ESCAPED, 'g'), '\\|');
}

/**
 * 排一个块（1 行或多行），返回这个块输出后的行。
 * 返回的行数可能少于输入 —— 中间那些只装了标签的行被抽空后直接删掉。
 */
function layoutBlock(
	block: number[],
	parsed: ParsedLine[],
	lines: string[],
	options: TagLayoutOptions
): string[] {
	// 表格：逐单元格处理，不参与"整块归位"；分不清列边界的写法整行不动
	const kind = lineKind(parsedAt(parsed, block[0] ?? 0));
	if (kind === 'table') {
		return block.map(index => {
			const line = parsedAt(parsed, index);
			return line.prefix + layoutTableRow(line.body, options);
		});
	}
	if (kind === 'opaque') return block.map(index => lines[index] ?? '');

	const texts: string[] = [];
	const tags: string[] = [];
	for (const index of block) {
		const { text, tags: lineTags } = stripTags(parsedAt(parsed, index).body);
		texts.push(text);
		for (const tag of lineTags) tags.push(tag);
	}

	const unique = dedupe(tags);
	// 没有标签：原样返回原文行（不做任何重建，避免无意中改动）
	if (unique.length === 0) return block.map(index => lines[index] ?? '');

	const ordered = orderTags(unique, options);

	// 整块只有标签：标签本来就该待在这儿，位置不动，只按需排序
	if (!texts.some(text => hasText(text))) {
		return block.map(index => {
			const line = parsedAt(parsed, index);
			const own = orderTags(dedupe(findTags(line.body).map(match => match.text)), options);
			return line.prefix + own.join(' ');
		});
	}

	// 有正文：标签挂到块尾
	const lastIndex = texts.length - 1;
	// 末行本来就是"只有标签"的行 → 标签已经在块尾，用排好序的完整标签串替换它
	const lastIsTagsOnly = !hasText(texts[lastIndex] ?? '');
	const out: string[] = [];

	for (let n = 0; n < block.length; n++) {
		const line = parsedAt(parsed, block[n] ?? 0);
		const text = texts[n] ?? '';
		if (n === lastIndex && lastIsTagsOnly) {
			out.push(line.prefix + ordered.join(' '));
			continue;
		}
		// 中间被抽空的纯标签行：删掉，免得留下空行把段落切成两半
		if (!hasText(text)) continue;
		out.push(line.prefix + text);
	}

	if (!lastIsTagsOnly && out.length > 0) {
		const last = out.length - 1;
		const current = out[last] ?? '';
		// 行尾的 `\r`（CRLF 文件）要留在最后面
		const eol = current.endsWith('\r') ? '\r' : '';
		const core = eol ? current.substring(0, current.length - 1) : current;
		out[last] = `${core} ${ordered.join(' ')}${eol}`;
	}

	return out;
}

/**
 * 标签排版：把标签挪到块尾，并按需排序。
 *
 * 幂等：输出里每个块要么没有标签、要么标签已经在块尾且顺序固定，
 * 再次执行不会产生新的改动。
 *
 * @param content 笔记原文
 * @param options 标签排版选项
 * @returns 排版后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function formatTags(content: string, options: TagLayoutOptions = DEFAULT_TAG_LAYOUT_OPTIONS): string {
	if (content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);
	// `$$…$$` 里的 `#` 不是标签（例如 \textcolor{#fff}{…}），整块不动
	const mathLines = markMathLines(lines);
	const parsed = lines.map(line => parseLine(line));
	const out: string[] = [];
	let changed = false;
	let index = 0;

	/** 这一行不该被标签排版碰：frontmatter / 代码块 / 缩进代码 / 公式 */
	const isOpaque = (at: number): boolean =>
		protectedLines[at] === true || codeLines[at] === true || mathLines[at] === true;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		const current = parsedAt(parsed, index);

		// 保护区、缩进代码、公式、空行、只有引用标记的行：原样输出，也顺手切断"块"
		if (isOpaque(index) || current.body.trim() === '') {
			out.push(line);
			index++;
			continue;
		}

		// 收集一个块：普通正文行按"前缀相同 + 中间没有空行"连成一段，其余行各自成块
		const kind = lineKind(current);
		const block = [index];
		if (kind === 'plain') {
			let next = index + 1;
			while (next < lines.length && !isOpaque(next)) {
				const candidate = parsedAt(parsed, next);
				if (candidate.body.trim() === '') break;
				if (candidate.prefix !== current.prefix) break;
				if (lineKind(candidate) !== 'plain') break;
				block.push(next);
				next++;
			}
		}

		const blockOut = layoutBlock(block, parsed, lines, options);
		if (blockOut.length !== block.length) changed = true;
		for (const fixed of blockOut) out.push(fixed);

		index = (block[block.length - 1] ?? index) + 1;
	}

	const result = out.join('\n');
	return changed || result !== content ? result : content;
}
