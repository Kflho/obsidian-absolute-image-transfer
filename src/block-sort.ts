/**
 * 内容板块排版（纯函数，除参数外不依赖任何 Obsidian API）。
 *
 * 按首字母给笔记里的"块"排序（中文按拼音、数字按数值，见 collate.ts）。
 * 这一项默认关闭：它会重排正文，只适合"一条一条列出来"的笔记（词条、清单、条目表）。
 *
 * **块**怎么切：
 * - 一行列表项算一块（缩进的子项、懒续行跟着它一起走）；
 * - 一个段落算一块（连续的普通正文行）；
 * - 一个引用块算一块。
 *
 * **锚点**（原地不动，并且把左右两边的排序范围切开，内容不会被搬过锚点）：
 * - 标题 —— 所以排序只发生在"这个标题与下一个标题之间"；
 * - 表格、图片等嵌入、HTML 块、分隔线、frontmatter、代码块、`$$…$$` 公式；
 * - 聊天记录 —— 一条消息一块，排乱了整段对话就毁了，所以整块保持原位。
 *
 * 只在**同类相邻**的块之间排序：一串列表项内部按首字母重排，一串段落内部重排，
 * 段落不会插进列表中间。块与块之间的空行按"位置"保留，紧凑的列表排完仍然紧凑，
 * 有空行分隔的仍然空一行。
 */
import { markProtectedLines, markIndentedCodeLines, markMathLines } from './line-scan';
import { compareByFirstLetter } from './collate';

/** 块的类型；barrier / chat 表示锚点（不参与排序，也切断排序范围） */
type UnitKind = 'paragraph' | 'item' | 'quote' | 'chat' | 'barrier';

interface SortUnit {
	lines: string[];
	kind: UnitKind;
	/** 排序键：去掉缩进 / 引用符号 / 列表符号 / 强调符号后的首行文本 */
	key: string;
}

/** ATX 标题：`#` 后面要有空白，`#标签` 不算 */
const HEADING_RE = /^#{1,6}(?:[ \t]|$)/;

/** 分隔线：`---` / `***` / `___`（可夹空格） */
const THEMATIC_BREAK_RE = /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/;

/** 列表符号：`-` `*` `+` `1.` `1)` */
const LIST_RE = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

/** 排序时要去掉的列表符号 */
const LIST_PREFIX_RE = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]+)/;

/** 有序列表项的编号：`12.` 或 `12)`，后面跟空白 */
const ORDERED_MARKER_RE = /^(\d{1,9})([.)])([ \t]+)/;

/** 聊天记录头部：`14:30:25`，或带发言人 / 日期的 `张三: 2024/01/05 14:30:25` */
const CHAT_HEADER_RE =
	/^(?:[^\s:：]{1,40}[:：][ \t]*)?(?:\d{2,4}[/-]\d{1,2}[/-]\d{1,2}[ \t]+)?\d{1,2}:\d{2}:\d{2}(?:\D|$)/;

/** 脚注定义：`[^1]: 内容` */
const FOOTNOTE_RE = /^\[\^[^\]\s]+\]:/;

/** 剥掉行首缩进与引用标记，得到"内容本身" */
function analyze(line: string): { body: string; quoted: boolean } {
	let rest = line.replace(/^[ \t]*/, '');
	let quoted = false;

	while (rest.startsWith('>')) {
		quoted = true;
		let index = 1;
		while (rest.charAt(index) === ' ' || rest.charAt(index) === '\t') index++;
		rest = rest.substring(index);
	}

	return { body: rest, quoted };
}

/** 判断一行属于哪类块 */
function classify(line: string): UnitKind {
	const { body, quoted } = analyze(line);
	// 引用块整体算一块：里面的列表、嵌套引用都跟着走，不会散架
	if (quoted) return 'quote';

	const text = body.trim();
	if (text === '') return 'barrier';
	if (HEADING_RE.test(body)) return 'barrier';
	if (THEMATIC_BREAK_RE.test(text)) return 'barrier';
	// 表格 / 嵌入（图片）/ HTML 块：位置通常有含义，当锚点
	if (text.startsWith('|') || text.startsWith('!') || text.startsWith('<')) return 'barrier';
	// 聊天记录：一条消息一块（头部 + 正文），整块原地不动，排乱了整段对话就毁了
	if (CHAT_HEADER_RE.test(text)) return 'chat';
	// 脚注定义：渲染时本来就固定在文末，别在正文里搬来搬去
	if (FOOTNOTE_RE.test(text)) return 'barrier';
	if (LIST_RE.test(body)) return 'item';
	return 'paragraph';
}

/** 排序键：去掉缩进、引用符号、列表符号、任务框、强调符号后的文本 */
function sortKey(line: string): string {
	let text = analyze(line).body.replace(/^[ \t]+/, '');
	text = text.replace(LIST_PREFIX_RE, '');
	text = text.replace(/^\[[ xX]\][ \t]*/, '');
	text = text.replace(/^[#>*_~`]+/, '');
	return text.trim();
}

/** 从 start 行开始读一个块，返回块本身与下一块的起点 */
function readUnit(
	lines: string[],
	protectedLines: boolean[],
	start: number
): { unit: SortUnit; next: number } {
	const first = lines[start] ?? '';
	const kind = classify(first);
	const collected = [first];
	let index = start + 1;

	if (kind === 'chat') {
		// 聊天记录：头部后面紧贴的正文行都算这条消息，整条一起当锚点
		while (index < lines.length && !protectedLines[index] && (lines[index] ?? '').trim() !== '') {
			const candidate = lines[index] ?? '';
			if (classify(candidate) === 'chat') break;
			collected.push(candidate);
			index++;
		}
	} else if (kind !== 'barrier') {
		while (index < lines.length && !protectedLines[index] && (lines[index] ?? '').trim() !== '') {
			const candidate = lines[index] ?? '';
			const nextKind = classify(candidate);
			if (nextKind === 'barrier') break;

			if (kind === 'quote') {
				// 引用块：后面的引用行、以及紧贴着的懒续行都算它的一部分
				if (nextKind === 'item') break;
			} else if (kind === 'item') {
				// 顶格的列表项另起一块；缩进的子项与懒续行归上一项
				if (nextKind === 'item' && !/^[ \t]/.test(candidate)) break;
			} else if (nextKind !== 'paragraph') {
				// 段落：列表项、引用行都打断它
				break;
			}

			collected.push(candidate);
			index++;
		}
	}

	return { unit: { lines: collected, kind, key: sortKey(first) }, next: index };
}

/**
 * 有序列表重排后重新编号。
 *
 * Markdown 渲染时编号是自动的，但源文件里出现 `2.` 在 `1.` 前面还是很难看，
 * 所以排序完顺手把编号写顺。只在**整组都是有序列表、同一种编号风格、编号本身是连续的一段**
 * 时才动手 —— 作者特意写的 `1. 1. 1.` 或 `3. 5. 8.` 一律保持原样。
 *
 * @param ordered 排好序之后该位置上的块（按输出顺序）
 * @returns 编号是否有改动
 */
function renumberRun(ordered: SortUnit[]): boolean {
	const markers: Array<{ style: string; start: number; rest: string }> = [];

	for (const unit of ordered) {
		// 多行块（带子项的列表项）只改第一行的编号，子项不动
		const first = unit.lines[0] ?? '';
		const match = ORDERED_MARKER_RE.exec(first);
		if (!match) return false;
		markers.push({
			style: match[2] ?? '.',
			start: Number.parseInt(match[1] ?? '', 10),
			rest: first.substring(match[0].length),
		});
	}

	const style = markers[0]?.style;
	const numbers = markers.map(marker => marker.start).sort((a, b) => a - b);
	const base = numbers[0] ?? 1;
	for (let i = 0; i < markers.length; i++) {
		// 编号风格要一致、编号本身要是 base..base+n-1 这一段
		if (markers[i]?.style !== style || numbers[i] !== base + i) return false;
	}

	let changed = false;
	for (let i = 0; i < ordered.length; i++) {
		const unit = ordered[i];
		const marker = markers[i];
		if (!unit || !marker) continue;
		const line = `${base + i}${marker.style} ${marker.rest}`;
		if (unit.lines[0] !== line) {
			unit.lines[0] = line;
			changed = true;
		}
	}
	return changed;
}

/**
 * 给笔记里的内容块排序。
 *
 * 幂等：排好序的块再排一次顺序不变，块之间的空行也按位置保留，不会越排越乱。
 *
 * @param content 笔记原文
 * @returns 排序后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function sortContentBlocks(content: string): string {
	if (content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);
	// `$$…$$` 公式整块当锚点：多行公式不能被拆成一块一块搬走
	const mathLines = markMathLines(lines);
	/** 这一行不该被排序碰 */
	const isOpaque = (at: number): boolean =>
		protectedLines[at] === true || codeLines[at] === true || mathLines[at] === true;
	const units: SortUnit[] = [];
	/** 每个位置之前的空行（gaps[0] 是正文开头的空行） */
	const gaps: string[][] = [];
	let pending: string[] = [];

	const push = (unit: SortUnit) => {
		units.push(unit);
		gaps.push(pending);
		pending = [];
	};

	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? '';
		// frontmatter / 围栏代码块 / 缩进代码块 / 公式：整段当锚点
		if (isOpaque(index)) {
			const run: string[] = [line];
			index++;
			while (index < lines.length && isOpaque(index)) {
				run.push(lines[index] ?? '');
				index++;
			}
			push({ lines: run, kind: 'barrier', key: '' });
			continue;
		}
		if (line.trim() === '') {
			pending.push(line);
			index++;
			continue;
		}

		const { unit, next } = readUnit(lines, protectedLines, index);
		push(unit);
		index = next;
	}

	// 只在同类相邻的块之间排序，锚点把排序范围切开
	const order = units.map((_, position) => position);
	let cursor = 0;

	while (cursor < units.length) {
		const kind = units[cursor]?.kind;
		// 锚点（标题、表格、图片、聊天记录……）原地不动，也把左右两边隔开
		if (kind === 'barrier' || kind === 'chat') {
			cursor++;
			continue;
		}
		let end = cursor + 1;
		while (end < units.length && units[end]?.kind === kind) end++;

		if (end - cursor > 1) {
			const slice = order.slice(cursor, end);
			slice.sort((a, b) => {
				const left = units[a]?.key ?? '';
				const right = units[b]?.key ?? '';
				// 首字母相同时按原有先后排（稳定），保证幂等
				return compareByFirstLetter(left, right) || a - b;
			});
			for (let i = 0; i < slice.length; i++) {
				order[cursor + i] = slice[i] ?? cursor + i;
			}
			// 有序列表：排完把编号写顺（无序列表、作者手动编号的列表都不受影响）
			if (kind === 'item') {
				const reordered: SortUnit[] = [];
				for (const position of slice) {
					const unit = units[position];
					if (unit) reordered.push(unit);
				}
				renumberRun(reordered);
			}
		}
		cursor = end;
	}

	// 按"位置"重新拼装：第 k 位放哪一块，就沿用第 k 位原来的空行
	const out: string[] = [];
	for (let position = 0; position < units.length; position++) {
		for (const blank of gaps[position] ?? []) out.push(blank);
		const unit = units[order[position] ?? position];
		if (unit) for (const line of unit.lines) out.push(line);
	}
	for (const blank of pending) out.push(blank);

	const result = out.join('\n');
	return result === content ? content : result;
}
