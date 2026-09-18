/**
 * 公式排版（纯函数，除参数外不依赖任何 Obsidian API）。
 *
 * 只管**数学公式**：`$$ … $$` 区块（可跨行，管换行与缩进）与行内 `$…$`（单行，只管空格、绝不换行）。
 * 行内公式的识别跟 Obsidian 一致：`$` 内侧紧贴内容才算公式，`$ 5 与 $` 这类不会被误当公式。
 *
 * 核心原则一句话：**代码里写出来的空格 = 公式渲染出来的空格**。
 * - 渲染出来有缝的地方（二元运算、关系符两侧，逗号之后）→ 代码里留一个空格；
 * - 渲染出来贴在一起的地方（`\partial` 与它的参数、上下标、命令与花括号、
 *   `\begin{bmatrix}` 与第一个元素）→ 代码里也贴在一起，必要时补花括号保证命令名不被吃掉；
 * - 数学模式里**看不见**的空格（源码里随手打的、换行留下的）→ 一律删掉。
 *
 * 六个规则落到实现上：
 * 1. 运算 / 逻辑 / 排版符号（`= + - \le \to \in`、`&`、`\\`）左右各一个空格，某一侧没内容就不留。
 * 2. 一元正负号与修饰符（`\partial \delta \sin` …）和参数之间没有空格 —— 必要时写 `\delta{x}`。
 * 3. `$$` 与里面的内容之间不留空格。
 * 4. 续行缩进 = 首行缩进 + 1 个 tab；`\begin{}` / `\end{}` 不额外缩进。
 * 5. 只在 `\\` 处换行：`\\` 就换行（后面的 `\end{bmatrix}}` 也落到续行上），
 *    没有 `\\` 的换行全部拼回一行。
 * 6. 渲染里连在一起的内容，代码里也连在一起；直接把命令名吃掉会出错时给后一个字符加花括号。
 *    间距命令与后面的字母粘连（`\quadA`，LaTeX 会当成未定义命令报错）按这条修：
 *    前面已有逗号等分隔就删掉这个多余的间距，否则写成 `\quad{A}`。
 *
 * 不碰的地方：frontmatter、围栏代码块、行内代码里的 `$`；`\text{}` / `\operatorname{}` 这类文本参数内部原样保留；
 * 含 `%` 注释的公式整体跳过；行内公式里出现 `\\` 时跳过（免得把正文行截断）。
 */
import { markProtectedLines, inlineCodeRanges } from './line-scan';

/** token 的间隔类别：决定它与左右邻居之间留不留空格 */
type TokenKind =
	/** 二元运算符 / 关系符：左右各一个空格 */
	| 'rel'
	/** 加减号：按上下文判断是一元（贴参数）还是二元（左右各一空格） */
	| 'sign'
	/** 逗号分号：前不加、后加一个 */
	| 'punct'
	/** 左括号 / 左定界符（含 `\left(`）：后面不加空格 */
	| 'open'
	/** 右括号 / 右定界符（含 `\right)`）：前面不加空格 */
	| 'close'
	/** 上下标 `_ ^ '`：与前后都贴紧 */
	| 'script'
	/** 对齐符 `&`：左右各一个空格 */
	| 'amp'
	/** 换行符 `\\`（可带 `[2pt]`） */
	| 'break'
	/** 文本类参数 `\text{…}`：原样保留 */
	| 'verbatim'
	/** 其它：命令、字母、数字、中文…… */
	| 'word';

interface Token {
	kind: TokenKind;
	text: string;
	/** 反斜杠命令的名字（不含 `\`）；只有字母命令才可能在拼接时吃掉后面的字符 */
	command?: string;
	/** 由"间距命令 + 字母"粘连拆出来的（`\quadA` → `\quad` + `A`），见 splitGluedSpacing */
	glued?: boolean;
}

/**
 * 只产生间距、不接受参数的命令。
 *
 * 它们后面直接粘上字母时（`\quadA`），LaTeX 会把整串当成一个命令名 ——
 * `\quadA` 是未定义命令，公式直接报错。这是漏了分隔符，得拆开。
 * 按长度倒序排，保证 `\qquad` 先于 `\quad` 匹配。
 */
const SPACING_COMMANDS = [
	'negthickspace', 'negmedspace', 'negthinspace',
	'thickspace', 'medspace', 'thinspace',
	'qquad', 'quad', 'enspace', 'enskip',
	'smallskip', 'medskip', 'bigskip', 'hfill', 'hfil', 'space',
];

/** 粘连拆分时，后面最多认几个字母：再多就可能是 `\quadratic` 这类自定义宏，不碰 */
const MAX_GLUED_LETTERS = 2;

/**
 * 拆开"间距命令 + 字母"的粘连写法。
 *
 * 只在后缀是 1~2 个字母时动手 —— `\quadA`、`\quadC` 是漏了分隔符的典型形态，
 * 而 `\quadratic` 这种自定义宏名不能被当成 `\quad` + `ratic` 拆坏。
 *
 * @returns 拆出来的命令名；不需要拆时返回 null
 */
function splitGluedSpacing(name: string): { command: string } | null {
	for (const command of SPACING_COMMANDS) {
		if (name.length <= command.length) continue;
		if (!name.startsWith(command)) continue;
		const rest = name.substring(command.length);
		if (rest.length > MAX_GLUED_LETTERS) return null;
		return { command };
	}
	return null;
}

/** 关系符 / 二元运算符命令：左右各一个空格（LaTeX 本来就会在渲染时插入间距） */
const RELATION_COMMANDS = new Set([
	'le', 'leq', 'ge', 'geq', 'ne', 'neq', 'equiv', 'approx', 'sim', 'simeq', 'cong', 'propto',
	'll', 'gg', 'prec', 'succ', 'preceq', 'succeq', 'subset', 'subseteq', 'supset', 'supseteq',
	'in', 'notin', 'ni', 'owns', 'cup', 'cap', 'land', 'wedge', 'lor', 'vee', 'oplus', 'otimes',
	'odot', 'times', 'cdot', 'div', 'pm', 'mp', 'ast', 'star', 'circ', 'bullet', 'to', 'rightarrow',
	'leftarrow', 'leftrightarrow', 'longrightarrow', 'longleftarrow', 'Rightarrow', 'Leftarrow',
	'Leftrightarrow', 'implies', 'iff', 'mapsto', 'therefore', 'because', 'perp', 'parallel',
	'mid', 'vdash', 'dashv', 'models', 'triangleq', 'overset', 'underset', 'stackrel', 'bmod', 'pmod',
]);

/** 定界符命令：当作括号处理（`\lVert x \rVert` 里的左右各一个） */
const DELIMITER_COMMANDS: Record<string, TokenKind> = {
	lparen: 'open', lbrack: 'open', lbrace: 'open', langle: 'open',
	lvert: 'open', lVert: 'open', lfloor: 'open', lceil: 'open',
	rparen: 'close', rbrack: 'close', rbrace: 'close', rangle: 'close',
	rvert: 'close', rVert: 'close', rfloor: 'close', rceil: 'close',
	// `\vert` / `\Vert` 左右通用，当普通符号（不加空格，也不会被规则拆开）
	vert: 'word', Vert: 'word',
};

/**
 * 文本类命令：花括号里是"给人看的文字"，里面的空格与中文原样保留。
 * `\mathrm` 之类严格说仍是数学模式，但保留原样最安全 —— 用户明确要求"文本参数完全不动"。
 */
const TEXT_COMMANDS = new Set([
	'text', 'textrm', 'textnormal', 'textsf', 'texttt', 'textbf', 'textit', 'textsl', 'textsc',
	'textup', 'textmd', 'textcolor', 'operatorname', 'mathop', 'mathrm', 'mathbf', 'mathit',
	'mathsf', 'mathtt', 'mathcal', 'mathbb', 'mathfrak', 'mathnormal', 'mbox', 'hbox',
]);

/** 单个字符的关系符 / 运算符 */
const RELATION_CHARS = new Set(['=', '<', '>', ':']);

/** 需要按上下文判断一元 / 二元的加减号 */
const SIGN_CHARS = new Set(['+', '-']);

/** 读一个花括号组（含花括号本身）；`\{` `\}` 不算层级 */
function readGroup(text: string, start: number): { text: string; next: number } | null {
	if (text.charAt(start) !== '{') return null;
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '\\') {
			i++;
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return { text: text.substring(start, i + 1), next: i + 1 };
		}
	}
	return null;
}

/** 读 `\left` / `\right` / `\middle` 后面的定界符（`(`、`.`、`|`、`\{`、`\langle` …） */
function readDelimiter(text: string, start: number): { text: string; next: number } | null {
	const ch = text.charAt(start);
	if (ch === '') return null;
	if (ch !== '\\') return { text: ch, next: start + 1 };

	const command = /^\\([a-zA-Z]+|[\s\S])/.exec(text.substring(start));
	if (!command) return null;
	return { text: command[0], next: start + command[0].length };
}

/** 把公式代码切成 token；所有空白直接丢掉，输出里的空格全部由规则重建 */
function tokenize(body: string): Token[] {
	const tokens: Token[] = [];
	let index = 0;

	while (index < body.length) {
		const ch = body.charAt(index);

		// 空白（含换行）在数学模式里不可见 —— 由规则决定输出里的空格
		if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
			index++;
			continue;
		}

		if (ch === '\\') {
			const named = /^\\([a-zA-Z]+)/.exec(body.substring(index));
			if (named) {
				const fullName = named[1] ?? '';
				// `\quadA` 这种"间距命令 + 字母"粘连：拆成 `\quad` 与 `A`，剩下的字母下一轮再扫
				const gluedSplit = splitGluedSpacing(fullName);
				const name = gluedSplit ? gluedSplit.command : fullName;
				index += 1 + name.length;

				// \begin{...} / \end{...}：连环境名一起当一个整体
				if (name === 'begin' || name === 'end') {
					const group = readGroup(body, index);
					if (group) index = group.next;
					tokens.push({ kind: 'word', text: `\\${name}${group?.text ?? ''}`, command: name });
					continue;
				}

				// \left \right \middle：连定界符一起，按括号处理
				if (name === 'left' || name === 'right' || name === 'middle') {
					const delimiter = readDelimiter(body, index);
					if (delimiter) index = delimiter.next;
					tokens.push({ kind: name === 'right' ? 'close' : 'open', text: `\\${name}${delimiter?.text ?? ''}` });
					continue;
				}

				// 文本类参数：整段原样保留
				if (TEXT_COMMANDS.has(name)) {
					const group = readGroup(body, index);
					if (group) index = group.next;
					// \textcolor{色}{文字}：第二个参数也是文本
					let extra = '';
					if (name === 'textcolor') {
						const second = readGroup(body, index);
						if (second) {
							extra = second.text;
							index = second.next;
						}
					}
					tokens.push({ kind: 'verbatim', text: `\\${name}${group?.text ?? ''}${extra}`, command: name });
					continue;
				}

				const delimiterKind = DELIMITER_COMMANDS[name];
				if (delimiterKind) {
					tokens.push({ kind: delimiterKind, text: `\\${name}` });
					continue;
				}
				if (RELATION_COMMANDS.has(name)) {
					tokens.push({ kind: 'rel', text: `\\${name}` });
					continue;
				}
				tokens.push({ kind: 'word', text: `\\${name}`, command: name, glued: gluedSplit !== null });
				continue;
			}

			// `\\` 换行（可带 [2pt] 之类的可选间距）与 `\,` `\{` `\|` 这类单字符命令
			if (body.substring(index, index + 2) === '\\\\') {
				let text = '\\\\';
				let next = index + 2;
				const optional = /^\[[^\]\n]*\]/.exec(body.substring(next));
				if (optional) {
					text += optional[0];
					next += optional[0].length;
				}
				tokens.push({ kind: 'break', text });
				index = next;
				continue;
			}

			const single = body.charAt(index + 1);
			if (single === '') break;
			tokens.push({ kind: 'word', text: `\\${single}`, command: single });
			index += 2;
			continue;
		}

		if (ch === ',') {
			tokens.push({ kind: 'punct', text: ch });
			index++;
			continue;
		}
		if (ch === ';') {
			tokens.push({ kind: 'punct', text: ch });
			index++;
			continue;
		}
		if (ch === '_' || ch === '^' || ch === "'") {
			tokens.push({ kind: 'script', text: ch });
			index++;
			continue;
		}
		if (ch === '&') {
			tokens.push({ kind: 'amp', text: ch });
			index++;
			continue;
		}
		if (ch === '{' || ch === '(' || ch === '[') {
			tokens.push({ kind: 'open', text: ch });
			index++;
			continue;
		}
		if (ch === '}' || ch === ')' || ch === ']') {
			tokens.push({ kind: 'close', text: ch });
			index++;
			continue;
		}
		if (SIGN_CHARS.has(ch)) {
			tokens.push({ kind: 'sign', text: ch });
			index++;
			continue;
		}
		if (RELATION_CHARS.has(ch)) {
			tokens.push({ kind: 'rel', text: ch });
			index++;
			continue;
		}

		tokens.push({ kind: 'word', text: ch });
		index++;
	}

	return tokens;
}

/** 已定型的 token：一元加减号在这里已经变成 `unary` */
interface Item {
	kind: TokenKind | 'unary';
	text: string;
	command?: string;
}

/** 一元还是二元：前面是"缺一个操作数"的位置（行首、左括号、运算符、逗号、& 、换行）就是一元 */
function isUnary(previous: Item | null): boolean {
	if (!previous) return true;
	return previous.kind === 'rel' || previous.kind === 'unary' || previous.kind === 'punct'
		|| previous.kind === 'amp' || previous.kind === 'open' || previous.kind === 'break';
}

/**
 * 两个 token 之间该留的空格。
 *
 * 公式里所有位置一视同仁：上下标里也照规则 1 加空格（`a_{n-1}` → `a_{n - 1}`），
 * 不因为"TeX 在上下标里会压缩间距"之类的渲染细节开特例。
 */
function separator(previous: Item | null, next: Item): string {
	if (!previous) return '';
	if (previous.kind === 'open') return '';
	if (next.kind === 'close') return '';
	if (next.kind === 'script' || previous.kind === 'script') return '';

	// 一元符号：与参数贴紧；它自己前面留不留空格，由上一个 token 的规则决定
	if (next.kind === 'unary') {
		return previous.kind === 'rel' || previous.kind === 'punct' || previous.kind === 'amp' ? ' ' : '';
	}
	if (previous.kind === 'unary') return '';

	if (next.kind === 'punct') return '';
	if (previous.kind === 'punct') return ' ';
	if (next.kind === 'rel' || previous.kind === 'rel') return ' ';
	if (next.kind === 'amp' || previous.kind === 'amp') return ' ';
	if (next.kind === 'break' || previous.kind === 'break') return ' ';
	return '';
}

/** 把命令与后面的字符拼在一起时，会不会把命令名吃掉（`\delta x` → `\deltax` 是非法的） */
function needsBrace(previous: Item, next: Item): boolean {
	if (!previous.command || !/^[a-zA-Z]+$/.test(previous.command)) return false;
	if (previous.kind !== 'word') return false;
	// 命令自带花括号参数（\text{…} / \begin{…}）时不用再包
	if (/[{(]/.test(previous.text)) return false;
	return next.kind === 'word' && /^[a-zA-Z]/.test(next.text);
}

/**
 * 渲染 token 流：按规则插空格，按 `\\` 切行。
 * @returns 每个元素是一行（不含缩进，缩进由调用方补）
 */
function renderTokens(tokens: Token[]): string[] {
	const lines: string[] = [];
	let current = '';
	let previous: Item | null = null;

	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (!token) continue;

		// 粘连拆出来的间距命令（`\quadA`）：
		// 前面已经有分隔（逗号 / 分号 / `&` / 换行 / 行首）时，这个间距是多余的 ——
		// LaTeX 自己会按标点排版（`A_{i}, \quadA_{j}` → `A_{i}, A_{j}`）；
		// 前面是实打实的内容时，间距是作者要的，保留下来并靠花括号与后面分开（`\quad{A}`）。
		if (token.glued) {
			const hasSeparator = !previous || previous.kind === 'punct' || previous.kind === 'amp' || previous.kind === 'break';
			if (hasSeparator) continue;
		}

		if (token.kind === 'break') {
			// `\\` 左边一个空格；行尾不留尾空格。`\\` 就换行 —— 与实际换行行为一致
			if (current !== '') current += ' ';
			current += token.text;
			lines.push(current);
			current = '';
			previous = null;
			continue;
		}

		const item: Item = token.kind === 'sign'
			? { ...token, kind: isUnary(previous) ? 'unary' : 'rel' }
			: token;

		const gap = separator(previous, item);
		let text = item.text;
		// 拼接会把命令名吃掉时补花括号：`\delta x` → `\delta{x}`
		if (gap === '' && previous && needsBrace(previous, item)) text = `{${text}}`;

		current += gap + text;
		previous = { ...item, text };
	}

	if (current !== '') lines.push(current);
	return lines;
}

/** 公式首行的缩进（首行前面的空白原样保留，续行在它基础上加一个 tab） */
function leadingWhitespace(text: string): string {
	const match = /^[ \t]*/.exec(text);
	return match ? match[0] : '';
}

/** 收集所有"未被保护、也不在行内代码里"的 `$$` 位置 */
function collectMarks(lines: string[], protectedLines: boolean[]): Array<{ line: number; column: number }> {
	const marks: Array<{ line: number; column: number }> = [];

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		const line = lines[i] ?? '';
		const codeRanges = inlineCodeRanges(line);

		let at = line.indexOf('$$');
		while (at >= 0) {
			const escaped = at > 0 && line.charAt(at - 1) === '\\';
			const inCode = codeRanges.some(([start, end]) => at < end && at + 2 > start);
			if (!escaped && !inCode) marks.push({ line: i, column: at });
			at = line.indexOf('$$', at + 2);
		}
	}

	return marks;
}

/**
 * 这一段像不像一个公式区域。
 *
 * 用来兜住"落单的 `$$`"：数量不对时，贪心配对可能把一段正文当成公式。
 * 出现空行、标题、围栏、分隔线，或者跨太多行，就认为配错了对象，整段不动。
 */
function looksLikeFormulaRegion(body: string, spanLines: number): boolean {
	if (spanLines > 200) return false;
	if (/\n[ \t]*\n/.test(body)) return false;
	if (/(^|\n)[ \t]*(?:#{1,6}[ \t]|`{3,}|~{3,}|[-*_]{3,}[ \t]*$)/.test(body)) return false;
	return true;
}

/**
 * `$$ … $$` 区块排版：按空格规则整理，按 `\\` 切行，续行缩进 = 首行缩进 + 1 个 tab。
 *
 * 落单的 `$$` 不再让整篇失效：按出现顺序贪心配对，配出来不像公式的区域跳过，
 * 后面的正常公式照样处理。
 */
function formatDisplayBlocks(content: string): string {
	if (!content.includes('$$')) return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const marks = collectMarks(lines, protectedLines);
	if (marks.length < 2) return content;

	// 行首偏移，用来把 (行, 列) 换算成绝对位置
	const lineStarts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		lineStarts.push(offset);
		offset += line.length + 1;
	}
	const positionOf = (mark: { line: number; column: number }) => (lineStarts[mark.line] ?? 0) + mark.column;
	const lineOf = (position: number) => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if ((lineStarts[middle] ?? 0) <= position) low = middle;
			else high = middle - 1;
		}
		return low;
	};

	let result = '';
	let cursor = 0;

	// 配对：从每个 `$$` 往后找第一个"配起来像公式"的 `$$`。
	// 落单的 `$$`（例如正文里手滑打的一个）因此不会把后面的真公式连累掉，
	// 也不会把一大段正文当成公式吃掉。
	for (let i = 0; i + 1 < marks.length; i++) {
		const openMark = marks[i];
		if (!openMark) continue;
		const openAt = positionOf(openMark);

		for (let j = i + 1; j < marks.length; j++) {
			const closeMark = marks[j];
			if (!closeMark) continue;
			const closeAt = positionOf(closeMark);
			if (closeAt < openAt) continue;

			const body = content.substring(openAt + 2, closeAt);
			// 含 `%` 注释的公式：注释会把后面的内容吃掉，拼行会改变语义
			if (body.includes('%')) continue;
			if (!looksLikeFormulaRegion(body, closeMark.line - openMark.line + 1)) continue;

			const indent = leadingWhitespace(lines[lineOf(openAt)] ?? '');
			const segments = renderTokens(tokenize(body));

			// 公式之外的文字原样保留：开区间之前的、以及闭区间之后由后面的循环继续输出
			result += content.substring(cursor, openAt);
			result += '$$';
			result += segments[0] ?? '';
			for (let k = 1; k < segments.length; k++) {
				result += `\n${indent}\t${segments[k] ?? ''}`;
			}
			result += '$$';
			cursor = closeAt + 2;
			i = j;   // 这一对已处理，继续看后面的
			break;
		}
	}

	result += content.substring(cursor);
	return result === content ? content : result;
}

/** 行内公式 `$…$` 的收尾 `$` 在哪；找不到返回 -1 */
function findInlineMathEnd(line: string, start: number, inCode: (at: number) => boolean): number {
	for (let i = start; i < line.length; i++) {
		if (line.charAt(i) !== '$') continue;
		if (line.charAt(i - 1) === '\\' || line.charAt(i + 1) === '$' || inCode(i)) continue;
		// 收尾 `$` 前面紧贴内容才算公式（`$x $` 在 Obsidian 里不是公式）
		if (/\s/.test(line.charAt(i - 1))) return -1;
		return i;
	}
	return -1;
}

/**
 * 行内公式排版：`$M=1$` → `$M = 1$`。
 *
 * 规则与区块公式完全一致（同一套 token 与空格规则），只是**绝不换行**：
 * 行内公式里出现 `\\` 时整段跳过，否则会把正文行截断。
 * 识别方式跟 Obsidian 对齐 —— `$` 内侧紧贴内容才算公式，`$ 5 与 $` 这种不会被误当公式。
 */
function formatInlineMath(content: string): string {
	if (!content.includes('$')) return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	/** 是否处在 `$$ … $$` 里（可能跨行）：里面不是行内公式 */
	let inDisplay = false;
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (protectedLines[i] || !line.includes('$')) continue;

		const codeRanges = inlineCodeRanges(line);
		const inCode = (at: number): boolean => codeRanges.some(([start, end]) => at < end && at + 1 > start);
		let out = '';
		let index = 0;
		let touched = false;

		while (index < line.length) {
			const at = line.indexOf('$', index);
			if (at < 0) {
				out += line.substring(index);
				break;
			}
			out += line.substring(index, at);

			const escaped = at > 0 && line.charAt(at - 1) === '\\';
			const isDelimiter = line.charAt(at + 1) === '$';

			if (!escaped && !inCode(at) && isDelimiter) {
				// 显示公式的定界符：原样输出，顺便记下"现在在不在 $$ 里"
				out += '$$';
				index = at + 2;
				inDisplay = !inDisplay;
				continue;
			}
			// 转义的 `\$`、`$$` 内部、行内代码里的 `$`：原样走
			if (escaped || inDisplay || inCode(at) || /\s/.test(line.charAt(at + 1))) {
				out += '$';
				index = at + 1;
				continue;
			}

			const end = findInlineMathEnd(line, at + 1, inCode);
			if (end < 0) {
				out += '$';
				index = at + 1;
				continue;
			}

			const body = line.substring(at + 1, end);
			const segments = renderTokens(tokenize(body));
			// 出现 `\\` 就会切成多行：行内公式不能截断正文，整段跳过
			if (segments.length !== 1) {
				out += line.substring(at, end + 1);
				index = end + 1;
				continue;
			}

			const fixed = segments[0] ?? '';
			if (fixed !== body) touched = true;
			out += `$${fixed}$`;
			index = end + 1;
		}

		if (touched) {
			lines[i] = out;
			changed = true;
		}
	}

	return changed ? lines.join('\n') : content;
}

/**
 * 公式排版：`$$ … $$` 区块与行内 `$…$` 都按"代码里的空格 = 渲染出来的空格"整理。
 *
 * 幂等：输出的公式再跑一次不会变（空格与换行位置完全由规则决定，规则只看 token 类型）。
 *
 * @param content 笔记原文
 * @returns 排版后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function formatDisplayMath(content: string): string {
	if (content === '' || !content.includes('$')) return content;

	let result = formatDisplayBlocks(content);
	result = formatInlineMath(result);
	return result === content ? content : result;
}
