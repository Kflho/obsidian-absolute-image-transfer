/**
 * Markdown 块级标记排版（纯函数，除参数外不依赖任何 Obsidian API）。
 *
 * 修的是"标记与它后面的正文之间的空白"，不看内容语义：
 *
 * 1. **引用（注释）**——`>` 前面手滑多打的 1~3 个空格删掉，`>` 与正文之间留一个空格。
 *    这是最常踩的坑：`" >正文"` 以前被当成"缩进有语法含义的引用行"整行放过，
 *    结果排版一点没修。引用标记前面本来就不需要缩进，`>` 后面没空格又不规范。
 *    - `" >引用"` → `"> 引用"`
 *    - `">>引用"` → `"> > 引用"`（多级引用规范化）
 *    - 列表项**里面**的引用靠缩进决定归属（`- 项` 下面 `  > 引用`），那种缩进保留。
 * 2. **列表**——符号后面多于一个空格/制表符的收成一个：`"-   项"` → `"- 项"`。
 *    （符号后面没有空格的 `-项` 不是列表，`*斜体*`、`---` 分隔线也都不算，一律不猜。）
 * 3. **标题**——`#` 后面本来就带空白时收成一个：`"##   标题"` → `"## 标题"`。
 *    `#标签` 后面没有空白，属于标签而不是标题，绝不能加空格（加了就变成标题）。
 *
 * 同类行首缩进修复（text-layout.ts）一样，frontmatter 与围栏代码块内部一律不碰。
 * 输出幂等：规范化后的形态再跑一次不会变。
 */
import { markProtectedLines } from './line-scan';

/** 列表符号：`-` `*` `+` `1.` `1)`，后面必须跟空白才算标记（否则 `---`、`**粗体**` 会被误伤） */
const LIST_RE = /^([-*+]|\d{1,9}[.)])([ \t]+)([\s\S]*)$/;

/** ATX 标题：`#` 后面必须已经有空白，`#标签` 不算 */
const HEADING_RE = /^(#{1,6})([ \t]+)([\s\S]*)$/;

/** 引用标记后面若是这些块级结构，缩进有语法含义（引用里的嵌套列表 / 表格 / 标题），空白原样保留 */
const NESTED_AFTER_QUOTE_RE = /^(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|[>#|])/;

/** 列表项行（用于判断"上面的行是不是列表项"） */
const LIST_MARKER_RE = new RegExp("^(?:[-*+](?:[ \\t]|$)|\\d{1,9}[.)](?:[ \\t]|$))");

/** 拆开的引用标记：级别、标记之后的空白、空白之后的内容 */
interface QuoteParts {
	depth: number;
	gap: string;
	rest: string;
}

/** 逐级读引用标记：`> 内容` / `>>内容` / `> >   内容` */
function readQuote(body: string): QuoteParts {
	let index = 0;
	let depth = 0;
	let gap = '';

	while (body.charAt(index) === '>') {
		depth++;
		index++;
		gap = '';
		while (body.charAt(index) === ' ' || body.charAt(index) === '\t') {
			gap += body.charAt(index);
			index++;
		}
	}

	return { depth, gap, rest: body.substring(index) };
}

/**
 * 规范引用标记。
 *
 * 多级引用一律写成 `> > `，标记与正文之间一个空格；空引用行（`>` / `> >`）不留尾空格。
 * 唯独标记后面跟的是列表 / 表格这类需要缩进的块级结构时保留原有空白 ——
 * 那儿的多余空格可能正是"引用里的嵌套块"，不猜。
 */
function canonicalQuote(parts: QuoteParts): string {
	const markers = new Array<string>(parts.depth).fill('>').join(' ');
	if (parts.rest === '') return markers;
	if (NESTED_AFTER_QUOTE_RE.test(parts.rest)) return markers + (parts.gap === '' ? ' ' : parts.gap);
	return markers + ' ';
}

/** 列表符号 / 标题符号后面的空白收成一个（没有空白就不动，避免把 `-项`、`#标签` 猜成标记） */
function normalizeMarkerSpace(text: string): string {
	const list = LIST_RE.exec(text);
	if (list) {
		const gap = list[2] ?? '';
		const body = list[3] ?? '';
		// 空列表项 `- ` 保持原样：改成 `-` 只是来回删尾空格，没有意义
		if (body !== '' && gap !== ' ') return `${list[1] ?? ''} ${body}`;
		return text;
	}

	const heading = HEADING_RE.exec(text);
	if (heading) {
		const gap = heading[2] ?? '';
		const body = heading[3] ?? '';
		if (body !== '' && gap !== ' ') return `${heading[1] ?? ''} ${body}`;
		return text;
	}

	return text;
}

/**
 * 这一行的缩进是否"属于列表内容"——上面最近的非空行是列表项，或本身就是缩进内容。
 * 是的话缩进决定它归哪个列表项，不能删（`- 项` 下面的 `  > 引用` 就是列表项里的引用）。
 */
function isInsideList(lines: string[], index: number): boolean {
	for (let i = index - 1; i >= 0; i--) {
		const line = lines[i];
		if (line === undefined) return false;
		// 空行割不断列表项与它内容的从属关系
		if (line.trim() === '') continue;
		if (/^[ \t]/.test(line)) return true;
		return LIST_MARKER_RE.test(line);
	}
	return false;
}

/**
 * 修复整篇笔记的块级标记排版：引用、列表、标题。
 *
 * 幂等：输出的每行引用标记都是 `> ` 形态、标记后的空白都是单个空格，
 * 再次执行不会产生新的改动。
 *
 * @param content 笔记原文
 * @returns 修复后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function fixBlockMarkers(content: string): string {
	if (content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		if (protectedLines[i]) continue;

		const indentMatch = /^[ \t]*/.exec(line);
		const indent = indentMatch ? indentMatch[0] : '';
		const rest = line.substring(indent.length);

		let newIndent = indent;
		let newRest = rest;

		if (rest.startsWith('>')) {
			const parts = readQuote(rest);
			// 引用标记前面那 1~3 个空格是手滑多打的：`" >引用"` 该修成 `"> 引用"`。
			// 但列表项里的引用靠缩进决定归属，那种缩进保留。
			if (/^ {1,3}$/.test(indent) && !isInsideList(lines, i)) {
				newIndent = '';
			}
			newRest = canonicalQuote(parts) + normalizeMarkerSpace(parts.rest);
		} else {
			newRest = normalizeMarkerSpace(rest);
		}

		const fixed = newIndent + newRest;
		if (fixed !== line) {
			lines[i] = fixed;
			changed = true;
		}
	}

	return changed ? lines.join('\n') : content;
}
