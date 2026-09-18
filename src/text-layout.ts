/**
 * 通用文本排版修复（纯函数，除参数外不依赖任何 Obsidian API，可脱离 Obsidian 验证）。
 *
 * 与 chat-log.ts 的分工：
 * - chat-log.ts 认内容（发言人、时间戳），重排每一条消息的头部与正文；
 * - 这里只看行首，不看语义，修的是"不管什么内容都该修"的排版毛病。
 *
 * 目前包含一项：**行首缩进归一化**。
 * 聊天记录多是从 QQ/微信复制、或经中间工具二次处理来的，行首常常混着空格与 Tab
 * （`" \t"`、`" \t\t "`、`"\t "`），渲染出来的缩进层级对不齐。目标形态是行首只有
 * Tab，其中 **4 个空格算一个 Tab**（与 Obsidian 编辑器的制表位一致）——
 * 这样整行文字所在的列数不变，只是把"用空格写的 Tab"换回 Tab、把零散空格去掉。
 *
 * 两类行首一律不碰，因为缩进在那儿是内容或语法：
 * - YAML frontmatter（缩进是语法，且 YAML 里禁止用 Tab 缩进）
 * - 围栏代码块内部（``` / ~~~，缩进是代码本身）
 *
 * 这两类区域由 line-scan.ts 统一判定，与标记排版、标签排版、板块排序共用。
 */
import { markProtectedLines } from './line-scan';

/** 行首缩进修复的力度 */
export type LeadingIndentMode =
	/** 不处理行首缩进 */
	| 'off'
	/**
	 * 智能（默认）：Tab 与空格混用、4 的整数倍个空格一律归一成 Tab；
	 * 1~3 个纯空格只在"缩进有语法含义"时保留 —— 后面跟列表符号等块级结构，
	 * 或该行是列表项里的续行段落；其余（正文、图片嵌入）删掉，那是手滑多打的空格。
	 */
	| 'smart'
	/** 严格：行首只留 Tab，4 个空格算一个 Tab，其余空格一律删掉（连列表子项缩进也压平） */
	| 'strict';

/** 默认力度：修掉聊天记录与手滑空格，又不动列表的层级 */
export const DEFAULT_LEADING_INDENT_MODE: LeadingIndentMode = 'smart';

/** 一个 Tab 折算成几个空格（Obsidian 编辑器默认制表位） */
const SPACES_PER_TAB = 4;

/**
 * 列表符号：`-` `*` `+` `1.` `1)`。
 * 后面必须跟空格或行尾 —— 否则 `---`（分隔线）、`**粗体**` 会被误判成列表。
 */
const LIST_MARKER = "[-*+](?:[ \\t]|$)|\\d{1,9}[.)](?:[ \\t]|$)";

/** 缩进之后是列表符号 */
const LIST_MARKER_RE = new RegExp("^(?:" + LIST_MARKER + ")");

/**
 * 判断缩进之后的这一行是不是"块级结构"，是则它的缩进有语法含义，不能删。
 *
 * 覆盖：列表符号、引用（`>`）、标题（`#` 后面要跟空白）、表格（`|`）、代码围栏（``` / ~~~）、HTML 块（`<`）。
 * 反过来说，正文、图片嵌入（`![[...]]`）前面那 1~3 个空格都是多打的。
 *
 * `#` 必须后面跟空白才算标题 —— `#标签` 是**标签**，跟正文一样，行首多打的空格该删。
 */
const BLOCK_STRUCTURE_RE = new RegExp(
	"^(?:" + LIST_MARKER + "|[>|]|#{1,6}(?:[ \\t]|$)|`{3,}|~{3,}|<)"
);

/**
 * 判断这一行是不是"列表项里的续行段落"：本行前面隔着空行，而空行之上最近的非空行是列表项。
 *
 * 这种缩进同样有语法含义 —— 删掉这段就会从列表项里掉出来变成顶层段落。
 * （紧接着列表项、中间没有空行的续行属于 lazy continuation，删掉缩进不影响归属。）
 */
function isListItemContinuation(lines: string[], index: number): boolean {
	// 必须隔着空行才算"新起一段"；紧贴列表项的续行是 lazy continuation，删缩进不影响归属
	let sawBlank = false;
	for (let i = index - 1; i >= 0; i--) {
		const line = lines[i];
		if (line === undefined) return false;
		if (line.trim() === '') {
			sawBlank = true;
			continue;
		}
		return sawBlank && LIST_MARKER_RE.test(line.trim());
	}
	return false;
}

/** 把 data.json 里可能被手工改成非法值的设置收敛回合法取值 */
export function resolveLeadingIndentMode(value: unknown): LeadingIndentMode {
	if (value === 'off') return 'off';
	if (value === 'strict') return 'strict';
	return DEFAULT_LEADING_INDENT_MODE;
}

/**
 * 归一化一段行首空白。
 *
 * @param whitespace 行首的空白（只含空格与 Tab）
 * @param rest 缩进之后的该行内容，用来判断这是不是列表子项等块级结构
 * @param listContinuation 该行是否是"列表项里的续行段落"（见 isListItemContinuation）
 * @returns 归一化结果；返回 null 表示这行不需要改动（调用方据此保持原样）
 */
function normalizeIndent(
	whitespace: string,
	rest: string,
	mode: 'smart' | 'strict',
	listContinuation: boolean
): string | null {
	// 纯空格、且列数不是 4 的整数倍：没法整折算
	if (!whitespace.includes('\t') && mode === 'smart' && whitespace.length % SPACES_PER_TAB !== 0) {
		if (whitespace.length <= 3) {
			// 后面是列表子项 / 引用 / 标题 / 表格 → 这是真的嵌套缩进
			if (BLOCK_STRUCTURE_RE.test(rest)) return null;
			// 列表项里的续行段落 → 缩进一删就会掉出列表项
			if (listContinuation) return null;
			// 其余（正文、图片嵌入）就是手滑多打的空格，删掉
			return '';
		}
		// 6、7 格这种列数不整的深缩进，可能是"缩进 4 格 + 2 格"的代码块或奇怪的嵌套，不猜
		return null;
	}

	// 含 Tab、恰好 4 的整数倍，或严格模式下的任意纯空格：
	// 4 个空格算一个 Tab，其余零散空格删掉（严格模式下列表子项的缩进也一并压平）
	let out = '';
	let run = 0;
	for (const char of whitespace) {
		if (char === '\t') {
			out += '\t';
			// Tab 前面不足 4 个的零散空格直接丢弃（`"  \t"` → `"\t"`）
			run = 0;
			continue;
		}
		run++;
		if (run === SPACES_PER_TAB) {
			out += '\t';
			run = 0;
		}
	}
	// 结尾不足 4 个的空格同样丢弃（`"\t  "` → `"\t"`）

	return out === whitespace ? null : out;
}

/**
 * 修复整篇笔记的行首缩进：把"用空格写的缩进"改回 Tab，把多打的空格删掉。
 *
 * 幂等：输出里每行的行首要么是纯 Tab，要么是智能模式下放过的块级结构缩进
 * （1~3 个纯空格 + 列表符号等），再次执行都不会再变。
 *
 * @param content 笔记原文
 * @param mode 修复力度，见 LeadingIndentMode
 * @returns 修复后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function fixLeadingIndent(content: string, mode: LeadingIndentMode): string {
	if (mode === 'off' || content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// frontmatter 与围栏代码块内部：缩进是语法或内容，原样保留
		if (protectedLines[i]) continue;

		// 只看行首空白后面还有内容的行；纯空白行（含空行）保持原样
		const indentMatch = /^[ \t]+(?=\S)/.exec(line);
		if (!indentMatch) continue;

		const indent = indentMatch[0];
		const rest = line.substring(indent.length);
		const fixed = normalizeIndent(indent, rest, mode, isListItemContinuation(lines, i));
		if (fixed === null) continue;

		lines[i] = fixed + rest;
		changed = true;
	}

	return changed ? lines.join('\n') : content;
}
