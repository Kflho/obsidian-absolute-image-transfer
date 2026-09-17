/**
 * 聊天记录排版引擎测试
 *
 * 运行：npm test
 *
 * 分三级保证：
 *   1. 期望输出（golden）—— 把文档化的排版行为钉死
 *   2. 严格幂等 —— 真实用例在任意设置组合下，执行一次即到不动点
 *   3. 病态输入 —— 允许一次以上收敛，但必须有限收敛、不丢内容、不长空行
 *
 * 第 3 级针对的是刻意构造的对抗性输入（如 `[图片]:` 这类无法解析的伪用户名
 * 搭配纯时分秒时间戳）：这类输入旧版同样无法一次到底，但绝不允许无限增长或丢字。
 */
import { formatChatLog, DEFAULT_CHAT_LOG_OPTIONS, resolveIndent } from "../src/chat-log";
import type { ChatLogOptions, ChatIndent, ChatImageOrder } from "../src/chat-log";

const IMG = "![[Pasted image 20240101120000.png]]";
const IMG2 = "![[Pasted image 20240101120500.png]]";

// ------------------------------------------------------- 真实用例（要求严格幂等）
const CASES: Array<[string, string]> = [
	["readme示例", "张三 2024/1/5 14:30:25你好，文件收到了吗"],
	["姓名与正文换行", "张三 2024/1/5 14:30:25\n你好，文件收到了吗"],
	["姓名带冒号", "张三: 2024/1/5 14:30:25\n你好，文件收到了吗"],
	["姓名独占一行", "张三\n2024/1/5 14:30:25\n你好，文件收到了吗"],
	["多条消息", "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的"],
	["源文有空行", "张三 2024/1/5 14:30:25\n你好\n\n李四 2024/1/5 14:31:02\n在的"],
	["源文多空行", "张三 2024/1/5 14:30:25\n你好\n\n\n\n李四 2024/1/5 14:31:02\n在的"],
	["纯时间戳", "张三 14:30:25\n你好"],
	["前后有笔记", "# 记录\n\n张三 2024/1/5 14:30:25\n你好\n\n## 笔记\n补充说明"],
	["空行结束聊天区", "张三 2024/1/5 14:30:25\n你好\n\n这是笔记，不应被缩进"],
	["正文含图片", "张三 2024/1/5 14:30:25\n你好\n" + IMG + "\n\n笔记"],
	["图片在前", "张三 2024/1/5 14:30:25\n" + IMG + "\n你好\n\n笔记"],
	["图文同行", "张三 2024/1/5 14:30:25\n你好 " + IMG + "\n\n笔记"],
	["图文同行_图在前", "张三 2024/1/5 14:30:25\n" + IMG + " 你好\n\n笔记"],
	["Markdown图片结尾", "张三 2024/1/5 14:30:25\n你好\n![外链](D:\\pic\\a.png)\n李四 2024/1/5 14:31:00\n在的\n\n笔记"],
	["纯图片消息", "张三 2024/1/5 14:30:25\n" + IMG + "\n李四 2024/1/5 14:31:00\n" + IMG2 + "\n\n笔记"],
	["空正文", "张三 2024/1/5 14:30:25\n李四 2024/1/5 14:31:00\n你好\n\n笔记"],
	["多行正文", "张三 2024/1/5 14:30:25\n第一行\n第二行\n第三行\n\n笔记"],
	["末条多行无尾空行", "张三 2024/1/5 14:30:25\n第一行\n第二行"],
	["已排版tab", "张三: 2024/01/05 14:30:25\n\t你好，文件收到了吗\n"],
	["已排版无缩进", "张三: 2024/01/05 14:30:25\n你好，文件收到了吗\n"],
	["已排版多条", "张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"],
	["已排版含图", "张三: 2024/01/05 14:30:25\n\t" + IMG + "\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"],
	["CRLF换行", "张三 2024/1/5 14:30:25\r\n你好\r\n"],
	["日期补零", "张三 2024-1-5 9:05:03\n你好"],
	["两位年份", "张三 24/1/5 14:30:25\n你好"],
	["无时间戳", "这是一段普通笔记，没有任何时间戳。"],
	["空文本", ""],
	["连续空行", "张三 2024/1/5 14:30:25\n\n\n你好\n\n\n笔记"],
	["空行加不可解析姓名", "张三 2024/1/5 14:30:25\n\n[图片] 2024/1/5 14:30:25"],
	["方括号姓名", "[图片] 2024/1/5 14:30:25\n你好\n[图片] 2024/1/5 14:31:00\n在的"],
];

// -------------------------------------------------------------- 确定性 fuzz
let seed = 20240105;
function rnd(): number {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
	return arr[Math.floor(rnd() * arr.length)] as T;
}

const NAMES = ["张三", "李四", "王五", "[图片]", "user_1", "小明"];
const STAMPS = ["2024/1/5 14:30:25", "2024-01-05 14:30:25", "2024/1/5 14:30:25", "14:30:25", "24/1/5 14:30:25"];
const BODIES = ["你好", "在吗？", IMG, IMG2, "图片 " + IMG, IMG + " 说明", "第一行\n第二行", "", "多行\n内容\n第三行"];
const NOISE = ["", "", "", "# 标题", "普通笔记内容", "![外链](D:\\pic\\a.png)"];
const FUZZ_CASES: Array<[string, string]> = [];

function fuzzCase(): string {
	let s = "";
	const blocks = 1 + Math.floor(rnd() * 3);
	for (let b = 0; b < blocks; b++) {
		s += pick(NOISE) + "\n";
		const msgs = 1 + Math.floor(rnd() * 3);
		for (let i = 0; i < msgs; i++) {
			s += pick(NAMES) + (rnd() < 0.5 ? " " : ": ") + pick(STAMPS) + "\n";
			const lines = 1 + Math.floor(rnd() * 2);
			for (let j = 0; j < lines; j++) {
				s += pick(BODIES) + "\n";
			}
		}
		s += pick(["", "", "\n"]);
	}
	return s;
}

for (let i = 0; i < 120; i++) {
	FUZZ_CASES.push(["fuzz#" + i, fuzzCase()]);
}

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function show(s: string): string {
	return JSON.stringify(s);
}

function check(name: string, actual: string, expected: string): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[期望输出不符] ${name}\n  期望 ${show(expected)}\n  实际 ${show(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

// ------------------------------------------------------------ 1. golden 测试
const D = DEFAULT_CHAT_LOG_OPTIONS;
function opts(patch: Partial<ChatLogOptions>): ChatLogOptions {
	return { ...D, ...patch };
}

function goldenTests(): void {
	const SIMPLE = "张三 2024/1/5 14:30:25\n你好，文件收到了吗";
	const BODY = "\t你好，文件收到了吗\n";

	check("默认设置", formatChatLog(SIMPLE, D), `张三: 2024/01/05 14:30:25\n${BODY}`);
	check("隐藏时间", formatChatLog(SIMPLE, opts({ showTime: false })), `张三: 2024/01/05\n${BODY}`);
	check("隐藏日期", formatChatLog(SIMPLE, opts({ showDate: false })), `张三: 14:30:25\n${BODY}`);
	check("隐藏用户名", formatChatLog(SIMPLE, opts({ showUsername: false })), `2024/01/05 14:30:25\n${BODY}`);
	check(
		"隐藏用户名与日期",
		formatChatLog(SIMPLE, opts({ showUsername: false, showDate: false })),
		`14:30:25\n${BODY}`
	);
	check(
		"头部信息全关",
		formatChatLog(SIMPLE, opts({ showUsername: false, showDate: false, showTime: false })),
		"\t你好，文件收到了吗\n"
	);
	check("不缩进", formatChatLog(SIMPLE, opts({ indent: "" })), "张三: 2024/01/05 14:30:25\n你好，文件收到了吗\n");
	check("两空格缩进", formatChatLog(SIMPLE, opts({ indent: "  " })), "张三: 2024/01/05 14:30:25\n  你好，文件收到了吗\n");
	check("四空格缩进", formatChatLog(SIMPLE, opts({ indent: "    " })), "张三: 2024/01/05 14:30:25\n    你好，文件收到了吗\n");

	// 图文顺序
	const IMGCASE = `张三 2024/1/5 14:30:25\n你好\n${IMG}\n\n笔记`;
	const IMGCASE_REV = `张三 2024/1/5 14:30:25\n${IMG}\n你好\n\n笔记`;
	const HEAD = "张三: 2024/01/05 14:30:25\n";
	check("图片保持原顺序", formatChatLog(IMGCASE, D), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check("图片移到上方", formatChatLog(IMGCASE, opts({ imageOrder: "above" })), `${HEAD}\t${IMG}\n\t你好\n\n笔记`);
	check("图片已在下方", formatChatLog(IMGCASE, opts({ imageOrder: "below" })), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check("图片移到下方", formatChatLog(IMGCASE_REV, opts({ imageOrder: "below" })), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check(
		"图文同行_图片下移",
		formatChatLog(`张三 2024/1/5 14:30:25\n${IMG} 你好\n\n笔记`, opts({ imageOrder: "below" })),
		`${HEAD}\t你好\n\t${IMG}\n\n笔记`
	);
	check(
		"纯图片消息不重排",
		formatChatLog(`张三 2024/1/5 14:30:25\n${IMG}\n\n笔记`, opts({ imageOrder: "above" })),
		`${HEAD}\t${IMG}\n\n笔记`
	);

	// 空行：源文里的空行会被保留
	const TWO = "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的";
	const TWO_BLANK = "张三 2024/1/5 14:30:25\n你好\n\n李四 2024/1/5 14:31:02\n在的";
	check(
		"相邻消息_默认不留空行",
		formatChatLog(TWO, D),
		"张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"
	);
	check(
		"源文空行被保留",
		formatChatLog(TWO_BLANK, D),
		"张三: 2024/01/05 14:30:25\n\t你好\n\n李四: 2024/01/05 14:31:02\n\t在的\n"
	);

	// 空行：头部信息全关时可选择插入空行
	const ALL_OFF = opts({ showUsername: false, showDate: false, showTime: false });
	check("全关_不插空行", formatChatLog(TWO, ALL_OFF), "\t你好\n\t在的\n");
	check("全关_插空行", formatChatLog(TWO, { ...ALL_OFF, blankLineBetweenMessages: true }), "\t你好\n\n\t在的\n");
	check(
		"全关_插空行_三条消息",
		formatChatLog(`${TWO}\n王五 2024/1/5 14:32:00\n再见`, { ...ALL_OFF, blankLineBetweenMessages: true }),
		"\t你好\n\n\t在的\n\n\t再见\n"
	);
	check(
		"全关_源文已有空行不重复插",
		formatChatLog(TWO_BLANK, { ...ALL_OFF, blankLineBetweenMessages: true }),
		"\t你好\n\n\t在的\n"
	);
	check(
		"有头部信息时插空行设置不生效",
		formatChatLog(TWO, { ...D, blankLineBetweenMessages: true }),
		"张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"
	);
	check(
		"全关_插空行_末条笔记不缩进",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的\n\n笔记", {
			...ALL_OFF,
			blankLineBetweenMessages: true,
		}),
		"\t你好\n\n\t在的\n\n笔记"
	);

	// 空行不应随执行次数增长（历史 bug 的最小复现）
	const GROWTH_OUT = "张三: 2024/01/05 14:30:25\n\n[图片] 2024/1/5 14:30:25";
	check("空行不增长_首次", formatChatLog("张三 2024/1/5 14:30:25\n\n[图片] 2024/1/5 14:30:25", D), GROWTH_OUT);
	check("空行不增长_复跑", formatChatLog(GROWTH_OUT, D), GROWTH_OUT);
}

// ------------------------------------------------------------ 设置组合枚举
function allOptionCombos(): Array<[string, ChatLogOptions]> {
	const indents: ChatIndent[] = ["tab", "2", "4", "none"];
	const orders: ChatImageOrder[] = ["keep", "above", "below"];
	const combos: Array<[string, ChatLogOptions]> = [];

	for (const showUsername of [true, false]) {
		for (const showDate of [true, false]) {
			for (const showTime of [true, false]) {
				for (const indent of indents) {
					for (const order of orders) {
						for (const blankLine of [false, true]) {
							const label = `u=${showUsername} d=${showDate} t=${showTime} i=${indent} o=${order} b=${blankLine}`;
							combos.push([
								label,
								{
									showUsername,
									showDate,
									showTime,
									indent: resolveIndent(indent),
									imageOrder: order,
									blankLineBetweenMessages: blankLine,
								},
							]);
						}
					}
				}
			}
		}
	}
	return combos;
}

/**
 * 最长连续换行数，即空行的"厚度"。
 *
 * 这是判断空行是否累积的正确指标：补一行头部只会增加单个换行，
 * 而历史 bug 的表现是同一处空行每执行一次就厚一层（2 → 3 → 4 …）。
 */
function maxNewlineRun(s: string): number {
	let max = 0;
	for (const run of s.match(/\n+/g) || []) {
		max = Math.max(max, run.length);
	}
	return max;
}

/**
 * 归一化日期分隔符：排版引擎会把 `2024-01-05` 统一成 `2024/01/05`，
 * 这是有意的格式统一，不应被当成内容丢失。
 */
const normalizeDashes = (s: string): string => s.replace(/-/g, "/");

/** 非空白字符计数，用于判断内容是否被丢掉 */
function contentMap(s: string): Map<string, number> {
	const map = new Map<string, number>();
	for (const ch of s) {
		if (/\s/.test(ch)) continue;
		map.set(ch, (map.get(ch) || 0) + 1);
	}
	return map;
}

function lostChars(before: string, after: string): string {
	const afterMap = contentMap(normalizeDashes(after));
	const beforeMap = contentMap(normalizeDashes(before));
	let lost = "";
	for (const [ch, count] of beforeMap) {
		if ((afterMap.get(ch) || 0) < count) lost += ch;
	}
	return lost;
}

// ------------------------------------------- 2. 真实用例：一次执行即到不动点
function strictIdempotencyTests(): void {
	const combos = allOptionCombos();
	for (const [label, options] of combos) {
		for (const [name, input] of CASES) {
			const once = formatChatLog(input, options);
			const twice = formatChatLog(once, options);
			checkTrue(`幂等性失败 ${name} [${label}]`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
		}
	}
	console.log(`严格幂等：${combos.length} 组合 × ${CASES.length} 个真实用例 = ${combos.length * CASES.length} 次`);
}

// --------------------- 3. 病态输入：有限次收敛，且不丢内容、不长空行
const MAX_PASSES = 4;
function fuzzConvergenceTests(): void {
	const combos = allOptionCombos();
	let maxPassesUsed = 0;

	for (const [label, options] of combos) {
		// 只有"不隐藏任何头部信息"的组合才适合做字符级丢失检查：
		// 隐藏用户名/日期/时间时，第二次执行可能把残留的原始行按设置改写，
		// 那属于设置的预期效果，不是内容丢失。
		const hidesInfo = !(options.showUsername && options.showDate && options.showTime);

		for (const [name, input] of FUZZ_CASES) {
			let current = input;
			let blankRun = -1;
			let passes = 0;

			while (passes < MAX_PASSES) {
				const next = formatChatLog(current, options);
				passes++;
				if (next === current) break;

				if (passes === 1) {
					// 首次执行会按设置增删信息（隐藏时间、统一日期分隔符、新增头部行、
					// 插入空行等），都属于预期行为，只记录基准
					blankRun = maxNewlineRun(next);
				} else {
					// 此时 current 已经是排版结果，不允许再丢字或让空行变厚
					const nextBlankRun = maxNewlineRun(next);
					checkTrue(
						`病态输入空行累积 ${name} [${label}]`,
						nextBlankRun <= blankRun,
						`  第 ${passes} 次：最长连续换行 ${blankRun} → ${nextBlankRun}`
					);
					blankRun = nextBlankRun;

					const lost = lostChars(current, next);
					checkTrue(
						`病态输入内容丢失 ${name} [${label}]`,
						hidesInfo || lost === "",
						`  第 ${passes} 次丢失 ${show(lost)}\n  前 ${show(current)}\n  后 ${show(next)}`
					);
				}

				current = next;
			}

			maxPassesUsed = Math.max(maxPassesUsed, passes);
			checkTrue(
				`病态输入未收敛 ${name} [${label}]`,
				formatChatLog(current, options) === current,
				`  执行 ${MAX_PASSES} 次后仍未到不动点：${show(current)}`
			);
		}
	}
	console.log(
		`病态输入：${combos.length} 组合 × ${FUZZ_CASES.length} 个 fuzz 用例，最多 ${maxPassesUsed} 次执行收敛`
	);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 严格幂等（真实用例）===");
strictIdempotencyTests();

console.log("=== 3. 病态输入收敛性 ===");
fuzzConvergenceTests();

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
