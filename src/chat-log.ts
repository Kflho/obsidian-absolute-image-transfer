/**
 * QQ/微信聊天记录排版引擎。
 *
 * 从 main.ts 中抽出为纯函数：输入原始文本，输出排版后的文本，除参数外不依赖任何
 * Obsidian API。这样既能保持 main.ts 精简，也便于脱离 Obsidian 单独验证幂等性。
 *
 * 严格幂等：重复执行不会产生多余空行、不会破坏已有排版。
 */

/** 一条消息内同时含图片与文字时，图片的位置 */
export type ChatImageOrder = 'keep' | 'above' | 'below';

/** 正文缩进方式 */
export type ChatIndent = 'tab' | '2' | '4' | 'none';

export interface ChatLogOptions {
	/** 是否输出用户名 */
	showUsername: boolean;
	/** 是否输出日期 */
	showDate: boolean;
	/** 是否输出时间 */
	showTime: boolean;
	/** 实际缩进字符串，空字符串表示不缩进 */
	indent: string;
	/** 图片与文字的相对位置 */
	imageOrder: ChatImageOrder;
	/** 头部信息全部关闭时，是否在相邻消息之间插入空行作为分隔 */
	blankLineBetweenMessages: boolean;
}

/** 默认行为与旧版本完全一致：用户名/日期/时间全显示、Tab 缩进、不调整图片顺序、不加空行 */
export const DEFAULT_CHAT_LOG_OPTIONS: ChatLogOptions = {
	showUsername: true,
	showDate: true,
	showTime: true,
	indent: '\t',
	imageOrder: 'keep',
	blankLineBetweenMessages: false,
};

/** 时间戳锚点（与旧实现一致） */
const TIME_ANCHOR_RE =
	/(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}:\d{2}:\d{2})/g;

/** 时间戳之前最后一个非空白 token —— 旧实现用来识别用户名 */
const USER_BEFORE_ANCHOR_RE = /([^\n[\]\s:|：]+)\s*[:：]?\s*$/;

/**
 * 本插件排版结果的"无用户名头部"：整行只有归一化后的时间戳。
 * 归一化 = 用 `/` 分隔且补零，与旧实现写出的头部格式一致。
 * 原始聊天文本常用 `-` 分隔或未补零（2024/1/5 14:30:25），不会命中。
 */
const NORMALIZED_HEADER_RE = /^(?:\d{4}\/\d{2}\/\d{2} )?\d{2}:\d{2}:\d{2}$/;

/**
 * 图片链接识别：Obsidian 双链嵌入（限定图片扩展名，避免误伤笔记嵌入）
 * 或 Markdown 图片语法。每次调用返回新的正则对象，避免 /g 状态残留。
 */
function imageTokenRegex(): RegExp {
	return /!\[\[[^\]\n]*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)(?:\|[^\]\n]*)?\]\]|!\[[^\]\n]*\]\([^)\n]*\)/gi;
}

/** 缩进选项 → 实际缩进字符串（未知取值回退为 Tab，兼容手改 data.json） */
export function resolveIndent(indent: string): string {
	switch (indent) {
		case 'tab':
			return '\t';
		case '2':
			return '  ';
		case '4':
			return '    ';
		case 'none':
			return '';
		default:
			return '\t';
	}
}

/**
 * 按设置拼装头部行。用户名/日期/时间可分别开关：
 * - 全部开启 → `用户名: 2024/01/05 14:30:25`（与旧版本一致）
 * - 仅用户名 → `用户名:`
 * - 隐藏用户名 → `2024/01/05 14:30:25`
 * - 全部关闭 → 空字符串，调用方不输出头部行
 */
function buildHeaderLine(
	userName: string,
	dateVal: string,
	timeVal: string,
	options: ChatLogOptions
): string {
	const timePart = [
		options.showDate ? dateVal : '',
		options.showTime ? timeVal : '',
	].filter(Boolean).join(' ');

	if (options.showUsername) {
		return timePart ? `${userName}: ${timePart}` : `${userName}:`;
	}
	return timePart;
}

/**
 * 收集所有图片链接在原文中的区间。
 *
 * 用途：用户名正则是"时间戳前最后一个非空白 token"，当正文以 Markdown 图片
 * `![说明](D:\pic\a.png)` 结尾时，它会抓走 `a.png)` 这种图片路径片段当成用户名，
 * 导致图片链接被切断。落在图片区间内的候选一律不算用户名。
 */
function collectImageRanges(rawContent: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const re = imageTokenRegex();
	let m: RegExpExecArray | null;
	while ((m = re.exec(rawContent)) !== null) {
		ranges.push([m.index, m.index + m[0].length]);
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	return ranges;
}

/** 候选区间是否与任一图片链接区间重叠 */
function overlapsImageToken(ranges: Array<[number, number]>, start: number, end: number): boolean {
	for (const [rangeStart, rangeEnd] of ranges) {
		if (start < rangeEnd && end > rangeStart) return true;
	}
	return false;
}

/**
 * 返回"用户名之前的行首缩进"的起点。
 *
 * 头部行自身带的缩进（`" \t李四 2024/1/5 14:31:02"` 里 `"李四"` 前面那截）不属于
 * 上一条消息的正文：用户名被抽出来重新拼头部后，这截空白如果不丢掉，就会以
 * "只剩空格与 Tab 的一行"留在两条消息之间 —— 也就是 `" \t"` 这类脏缩进的来源之一，
 * 每排一次版就多留一行。
 */
function skipIndentBefore(content: string, index: number): number {
	let start = index;
	while (start > 0) {
		const previous = content.charAt(start - 1);
		if (previous !== ' ' && previous !== '\t') break;
		start--;
	}
	return start;
}

/**
 * 判断某个时间戳是否为本插件排版结果的"无用户名头部"，是则返回该行起始位置，否则返回 -1。
 *
 * 隐藏用户名时，头部是独占一行的归一化时间戳。重新解析这类内容必须直接按
 * "无用户名消息"处理 —— 否则上一条正文的末行（或聊天记录上方笔记的最后一个词）
 * 会被用户名正则误判成用户名并丢弃，造成内容丢失。
 *
 * 返回行首位置，供调用方把该行之前的文本原样保留。
 */
function findUsernameLessHeaderLine(rawContent: string, anchorStart: number, anchorEnd: number): number {
	const lineStart = rawContent.lastIndexOf('\n', anchorStart - 1) + 1;
	// 时间戳必须独占一行：前面不能有用户名，后面不能有正文
	if (rawContent.substring(lineStart, anchorStart).trim() !== '') return -1;

	let lineEnd = rawContent.indexOf('\n', anchorEnd);
	if (lineEnd === -1) lineEnd = rawContent.length;
	if (rawContent.substring(anchorEnd, lineEnd).trim() !== '') return -1;

	return NORMALIZED_HEADER_RE.test(rawContent.substring(anchorStart, anchorEnd)) ? lineStart : -1;
}

/**
 * 调整一条消息内的图文顺序。
 * 仅当图片与文字同时存在时才重排；纯图片或纯文字保持原样，避免无谓改动。
 * 图片与文字原本在同一行时，会被拆分为两行。
 */
function reorderImages(lines: string[], order: 'above' | 'below'): string[] {
	const images: string[] = [];
	const texts: string[] = [];

	for (const line of lines) {
		const tokens = line.match(imageTokenRegex());
		if (!tokens || tokens.length === 0) {
			texts.push(line);
			continue;
		}

		const rest = line.replace(imageTokenRegex(), ' ').replace(/[ \t]+/g, ' ').trim();
		if (rest) texts.push(rest);
		for (const token of tokens) images.push(token);
	}

	// 纯图片 / 纯文字：没有可调整的相对位置
	if (images.length === 0 || texts.length === 0) return lines;

	return order === 'above' ? [...images, ...texts] : [...texts, ...images];
}

/**
 * 修复聊天记录排版。
 *
 * @param rawContent 笔记原始内容
 * @param options 排版选项（用户名/日期/时间开关、缩进、图片位置）
 * @param now 用于补全缺失日期的"当前时间"，仅在原文没有日期时使用
 * @returns 排版后的内容；无时间戳锚点或无需改动时原样返回
 */
export function formatChatLog(
	rawContent: string,
	options: ChatLogOptions,
	now: Date = new Date()
): string {
	const currentYear = now.getFullYear().toString();

	const anchors: { start: number; end: number; timeStr: string }[] = [];
	const anchorRegex = new RegExp(TIME_ANCHOR_RE.source, 'g');
	let m: RegExpExecArray | null;
	while ((m = anchorRegex.exec(rawContent)) !== null) {
		anchors.push({ start: m.index, end: m.index + m[0].length, timeStr: m[0] });
	}

	if (anchors.length === 0) return rawContent;

	// 仅在隐藏用户名时需要识别"无用户名头部"：显示用户名时头部自带用户名，不存在歧义
	const detectUsernameLessHeader = !options.showUsername;

	// 预先判定每个时间戳是否为"无用户名头部"，正文边界计算也要用到
	const headerLineStarts: number[] = anchors.map(a =>
		detectUsernameLessHeader ? findUsernameLessHeaderLine(rawContent, a.start, a.end) : -1
	);

	// 图片链接区间：候选用户名若落在其中，说明是图片路径片段
	const imageRanges = collectImageRanges(rawContent);

	// 归一化图片顺序选项，兼容 data.json 中被手工改成非法值的情况
	const imageOrder: ChatImageOrder =
		options.imageOrder === 'above' || options.imageOrder === 'below' ? options.imageOrder : 'keep';

	let result = "";
	let lastProcessedIndex = 0;
	// 上一次输出的是否为消息正文 —— 无头部信息时据此判断是否需要补一个分隔空行
	let previousOutputWasBody = false;

	for (let i = 0; i < anchors.length; i++) {
		const anchor = anchors[i];
		const nextAnchor = anchors[i + 1];
		if (!anchor) continue;

		const textBefore = rawContent.substring(lastProcessedIndex, anchor.start);
		const userMatch = textBefore.match(USER_BEFORE_ANCHOR_RE);

		// 本条消息的头部信息：用户名 + 头部之前需要原样保留的文本终点
		let userName = "";
		let fragmentEnd = -1;

		const headerLineStart = headerLineStarts[i] ?? -1;

		if (headerLineStart >= 0) {
			// 无用户名头部（本插件隐藏用户名后的排版结果）：整行时间戳，前面全部原样保留
			fragmentEnd = headerLineStart;
		} else if (userMatch && userMatch[1]) {
			const candidateStart = lastProcessedIndex + (userMatch.index ?? 0);
			// 落在图片链接内部的候选是图片路径片段，不能当作用户名（否则图片链接会被切断）
			if (!overlapsImageToken(imageRanges, candidateStart, candidateStart + userMatch[1].length)) {
				userName = userMatch[1].trim();
				// 头部行自己的缩进不留进正文，否则两条消息之间会多出一行纯空白
				fragmentEnd = skipIndentBefore(rawContent, candidateStart);
			}
		}

		if (fragmentEnd < 0) {
			// 无用户名可识别：保持原样，避免误伤笔记正文。
			// 同样要做换行抵消 —— 否则上一段输出末尾的换行与本段开头的空行会叠加，
			// 每执行一次就多出一个空行（无上限增长）。
			let verbatim = rawContent.substring(lastProcessedIndex, anchor.end);
			if (verbatim.startsWith('\n') && result.endsWith('\n')) {
				verbatim = verbatim.substring(1);
			}
			result += verbatim;
			lastProcessedIndex = anchor.end;
			previousOutputWasBody = false;
			continue;
		}

		// 1. 提取当前聊天记录之前的文本（笔记、空行等）
		let fragment = rawContent.substring(lastProcessedIndex, fragmentEnd);

		// 核心修复1：重叠换行抵消（防止多次运行导致换行符堆叠生长）
		if (fragment.startsWith('\n') && result.endsWith('\n')) {
			fragment = fragment.substring(1);
		}

		result += fragment;
		if (fragment) {
			// 中间夹着笔记正文，本条消息不算是紧邻上一条正文
			previousOutputWasBody = false;
		}

		// 确保聊天记录标题独占一行
		if (result.length > 0 && !result.endsWith('\n')) {
			result += '\n';
		}

		// 2. 归一化日期与时间
		const rawTime = anchor.timeStr.trim().replace(/-/g, '/');
		const timePartMatch = rawTime.match(/(\d{1,2}:\d{2}:\d{2})$/);
		const datePartStr = rawTime.replace(/\s*(\d{1,2}:\d{2}:\d{2})$/, "").trim();

		let dateVal = datePartStr;
		if (!dateVal) {
			dateVal = `${currentYear}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;
		} else if (dateVal.split('/').length === 2) {
			dateVal = `${currentYear}/${dateVal}`;
		}

		const dParts = dateVal.split('/');
		if (dParts.length === 3) {
			const y = (dParts[0]?.length === 2 ? `20${dParts[0]}` : dParts[0]) || currentYear;
			const mm = (dParts[1] || "").padStart(2, '0');
			const dd = (dParts[2] || "").padStart(2, '0');
			dateVal = `${y}/${mm}/${dd}`;
		}

		const timeVal: string = (timePartMatch && timePartMatch[1]) ? timePartMatch[1] : "00:00:00";
		const tParts = timeVal.split(':');
		const normalizedTime = `${(tParts[0] || "00").padStart(2, '0')}:${(tParts[1] || "00").padStart(2, '0')}:${(tParts[2] || "00").padStart(2, '0')}`;

		// 按设置拼装头部（用户名/日期/时间可分别关闭；全关时不输出头部行）
		const headerText = buildHeaderLine(userName, dateVal, normalizedTime, options);
		if (headerText) {
			result += `${headerText}\n`;
		}

		// 3. 正文边界计算：支持空行笔记剥离
		let boundary: number;
		const searchStart = anchor.end;

		if (nextAnchor) {
			const nextHeaderLineStart = headerLineStarts[i + 1] ?? -1;
			let maxOffset: number;

			if (nextHeaderLineStart >= 0) {
				// 下一条是无用户名头部：两者之间的文本全部属于本条正文，
				// 不能再用用户名启发式切分（否则正文末行会被当成下一条的用户名）
				maxOffset = nextHeaderLineStart - searchStart;
			} else {
				const midText = rawContent.substring(searchStart, nextAnchor.start);
				const nextUserMatch = midText.match(USER_BEFORE_ANCHOR_RE);
				let candidateOffset = nextUserMatch ? (nextUserMatch.index ?? midText.length) : midText.length;

				// 候选落在图片链接内部时不能作为正文终点，否则图片链接会被切断
				if (nextUserMatch && nextUserMatch[1] &&
					overlapsImageToken(
						imageRanges,
						searchStart + candidateOffset,
						searchStart + candidateOffset + nextUserMatch[1].length
					)) {
					candidateOffset = midText.length;
				}
				maxOffset = candidateOffset;
			}

			const potentialContent = rawContent.substring(searchStart, searchStart + maxOffset);
			const doubleNewline = potentialContent.match(/\n\s*\n/);

			if (doubleNewline && doubleNewline.index !== undefined) {
				boundary = searchStart + doubleNewline.index;
			} else {
				boundary = searchStart + maxOffset;
			}
		} else {
			const potentialContent = rawContent.substring(searchStart);
			const doubleNewline = potentialContent.match(/\n\s*\n/);

			// 核心修复2：严格定位末条消息内容的实际结束点，防止跳过同行的文字
			let contentStartOffset = 0;
			const leadingSpaceMatch = potentialContent.match(/^[\s\n]+/);
			if (leadingSpaceMatch) {
				contentStartOffset = leadingSpaceMatch[0].length;
			}
			const firstNewline = potentialContent.indexOf('\n', contentStartOffset);

			if (doubleNewline && doubleNewline.index !== undefined) {
				boundary = searchStart + doubleNewline.index;
			} else if (firstNewline !== -1) {
				boundary = searchStart + firstNewline;
			} else {
				boundary = rawContent.length;
			}
		}

		// 4. 提取正文，按需调整图文顺序并施加缩进
		const bodyRaw = rawContent.substring(anchor.end, boundary);
		const bodyClean = bodyRaw.replace(/^[:：]\s*/, "").trim();

		if (bodyClean) {
			// 头部信息全部关闭时，两条消息的正文会直接相邻，可按设置补一个空行分隔。
			// 有头部信息时头部本身已起分隔作用，不额外插入。
			if (options.blankLineBetweenMessages && !headerText && previousOutputWasBody) {
				result += '\n';
			}

			let lines = bodyClean.split('\n').map(line => line.trim());
			if (imageOrder !== 'keep') {
				lines = reorderImages(lines, imageOrder);
			}
			result += lines.map(line => `${options.indent}${line}`).join('\n') + '\n';
			previousOutputWasBody = true;
		} else {
			if (!result.endsWith('\n')) result += '\n';
		}

		lastProcessedIndex = boundary;
	}

	if (lastProcessedIndex < rawContent.length) {
		const remaining = rawContent.substring(lastProcessedIndex);
		if (remaining.startsWith('\n') && result.endsWith('\n')) {
			result += remaining.substring(1);
		} else {
			result += remaining;
		}
	}

	return result;
}
