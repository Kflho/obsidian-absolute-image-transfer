/**
 * 内容板块排序测试
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 段落之间、列表项之间按首字母排（中文按拼音）
 *   2. 块边界 —— 列表与段落不互相穿插；紧凑列表排完仍然紧凑
 *   3. 锚点安全 —— 标题、表格、图片、聊天记录、代码块原地不动，也把排序范围切开
 *   4. 严格幂等 —— 排好序的内容再排一次不变
 */
import { sortContentBlocks } from "../src/block-sort";

const T = "\t";
const sp = (n: number): string => " ".repeat(n);

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
/** 拼音顺序：橙 chéng < 苹 píng < 香 xiāng；阿 a < 波 bo < 词 ci */
const CASES: Array<[string, string, string]> = [
	// —— 段落：整段算一块，块之间按首字母排 ——
	["段落排序", ["苹果", "", "香蕉", "", "橙子"].join("\n"), ["橙子", "", "苹果", "", "香蕉"].join("\n")],
	["段落排序：已经是顺序", ["橙子", "", "苹果", "", "香蕉"].join("\n"), ["橙子", "", "苹果", "", "香蕉"].join("\n")],
	["段落排序：多行段落整体搬动", ["香蕉", "第二行", "", "苹果"].join("\n"), ["苹果", "", "香蕉", "第二行"].join("\n")],
	// —— 列表项：一项一块 ——
	["紧凑列表排序", ["- 香蕉", "- 苹果", "- 橙子"].join("\n"), ["- 橙子", "- 苹果", "- 香蕉"].join("\n")],
	["松散列表排序", ["- 香蕉", "", "- 苹果", "", "- 橙子"].join("\n"), ["- 橙子", "", "- 苹果", "", "- 香蕉"].join("\n")],
	["嵌套子项跟着父项走", ["- 香蕉", `${sp(2)}- 黄色的`, "- 苹果"].join("\n"), ["- 苹果", "- 香蕉", `${sp(2)}- 黄色的`].join("\n")],
	["有序列表同样排序（编号顺手写顺）", ["1. 香蕉", "2. 苹果"].join("\n"), ["1. 苹果", "2. 香蕉"].join("\n")],
	["有序列表：非连续编号不重排", ["3. 香蕉", "5. 苹果"].join("\n"), ["5. 苹果", "3. 香蕉"].join("\n")],
	["有序列表：作者手写的重复编号不动", ["1. 香蕉", "1. 苹果"].join("\n"), ["1. 苹果", "1. 香蕉"].join("\n")],
	["有序列表：括号式编号同样写顺", ["1) 香蕉", "2) 苹果"].join("\n"), ["1) 苹果", "2) 香蕉"].join("\n")],
	["任务列表排序", ["- [ ] 香蕉", "- [x] 苹果"].join("\n"), ["- [x] 苹果", "- [ ] 香蕉"].join("\n")],
	// —— 数字按数值、英文按字母 ——
	["数字按数值排", ["第10条", "", "第2条"].join("\n"), ["第2条", "", "第10条"].join("\n")],
	["英文按字母排", ["banana", "", "Apple"].join("\n"), ["Apple", "", "banana"].join("\n")],
	// —— 引用块算一块 ——
	["引用块排序", ["> 香蕉", "", "> 苹果"].join("\n"), ["> 苹果", "", "> 香蕉"].join("\n")],
	// —— 干净的输入原样返回 ——
	["单块不动", "只有一个段落", "只有一个段落"],
	["空串", "", ""],
];

function goldenTests(): void {
	for (const [name, input, expected] of CASES) {
		check(name, sortContentBlocks(input), expected);
	}

	// 没有改动时返回原串（调用方据此避免无谓写盘）
	const sorted = ["橙子", "", "苹果", "", "香蕉"].join("\n");
	checkTrue("无改动时返回原串", sortContentBlocks(sorted) === sorted, "无改动却返回了新内容");
	checkTrue("空串返回空串", sortContentBlocks("") === "", "空串被改写");
}

// ------------------------------------------------------------ 2. 块边界
function boundaryTests(): void {
	// 列表与段落不互相穿插：两串各自排序，顺序不交叉
	check(
		"列表与段落各自排序",
		sortContentBlocks(["香蕉", "", "苹果", "", "- 香蕉二", "- 苹果二"].join("\n")),
		["苹果", "", "香蕉", "", "- 苹果二", "- 香蕉二"].join("\n")
	);
	check(
		"段落夹在列表之间：互不穿插",
		sortContentBlocks(["- 香蕉", "", "香蕉段", "", "苹果段", "", "- 苹果"].join("\n")),
		["- 香蕉", "", "苹果段", "", "香蕉段", "", "- 苹果"].join("\n")
	);
	// 紧凑列表排完仍然紧凑：空行按"位置"保留，不会凭空多出空行
	check(
		"紧凑列表不插入空行",
		sortContentBlocks(["香蕉", "", "- 香蕉二", "- 苹果二"].join("\n")),
		["香蕉", "", "- 苹果二", "- 香蕉二"].join("\n")
	);
	// 缩进的子项、懒续行都跟着父项
	check(
		"缩进子项与懒续行跟随父项",
		sortContentBlocks(["- 香蕉", `${T}懒续行`, "- 苹果"].join("\n")),
		["- 苹果", "- 香蕉", `${T}懒续行`].join("\n")
	);
}

// ------------------------------------------------------------ 3. 锚点安全
function anchorTests(): void {
	// 标题：排序只发生在"这个标题与下一个标题之间"
	check(
		"标题切开排序范围",
		sortContentBlocks(["# 一", "", "香蕉", "", "苹果", "", "# 二", "", "橙子", "", "梨"].join("\n")),
		["# 一", "", "苹果", "", "香蕉", "", "# 二", "", "橙子", "", "梨"].join("\n")
	);
	check(
		"标题本身不参与排序",
		sortContentBlocks(["# 香蕉", "", "苹果", "", "# 苹果", "", "香蕉"].join("\n")),
		["# 香蕉", "", "苹果", "", "# 苹果", "", "香蕉"].join("\n")
	);

	// 图片：位置有含义，原地不动
	check(
		"图片当锚点",
		sortContentBlocks(["![[图.png]]", "", "香蕉", "", "苹果"].join("\n")),
		["![[图.png]]", "", "苹果", "", "香蕉"].join("\n")
	);

	// 聊天记录：一条消息一块（头部 + 正文），整条原地不动
	const chat = [
		"张三: 2024/01/05 14:30:25",
		`${T}香蕉`,
		"",
		"李四: 2024/01/05 14:31:02",
		`${T}苹果`,
	].join("\n");
	check("聊天记录整条原地不动", sortContentBlocks(chat), chat);
	check(
		"聊天记录的正文行不会被单独排序",
		sortContentBlocks(["张三: 2024/01/05 14:30:25", `${T}第二行`, `${T}第一行`].join("\n")),
		["张三: 2024/01/05 14:30:25", `${T}第二行`, `${T}第一行`].join("\n")
	);

	// 表格：位置有含义，原地不动
	check(
		"表格当锚点",
		sortContentBlocks(["| 香蕉 | 一 |", "| --- | --- |", "| 苹果 | 二 |", "", "香蕉", "", "苹果"].join("\n")),
		["| 香蕉 | 一 |", "| --- | --- |", "| 苹果 | 二 |", "", "苹果", "", "香蕉"].join("\n")
	);

	// 代码块：里面是代码，整段当锚点
	const code = ["```", "香蕉", "苹果", "```", "", "香蕉", "", "苹果"].join("\n");
	check(
		"代码块当锚点",
		sortContentBlocks(code),
		["```", "香蕉", "苹果", "```", "", "苹果", "", "香蕉"].join("\n")
	);
	check(
		"缩进代码块当锚点",
		sortContentBlocks(["香蕉", "", `${sp(4)}苹果`, `${sp(4)}橙子`, "", "阿", "", "波"].join("\n")),
		["香蕉", "", `${sp(4)}苹果`, `${sp(4)}橙子`, "", "阿", "", "波"].join("\n")
	);

	// 脚注定义：渲染时固定在文末，别在正文里搬来搬去
	check(
		"脚注定义当锚点",
		sortContentBlocks(["正文[^1]", "", "[^1]: 脚注内容", "", "香蕉", "", "苹果"].join("\n")),
		["正文[^1]", "", "[^1]: 脚注内容", "", "苹果", "", "香蕉"].join("\n")
	);

	// frontmatter：原地不动，正文照排
	check(
		"frontmatter 不动",
		sortContentBlocks(["---", "title: 排序", "---", "", "香蕉", "", "苹果"].join("\n")),
		["---", "title: 排序", "---", "", "苹果", "", "香蕉"].join("\n")
	);

	// 分隔线：当锚点
	check(
		"分隔线当锚点",
		sortContentBlocks(["香蕉", "", "---", "", "苹果", "", "橙子"].join("\n")),
		["香蕉", "", "---", "", "橙子", "", "苹果"].join("\n")
	);
}

// ------------------------------------------------------------------ 4. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		...CASES.map(([, input]) => input),
		["# 标题", "", "香蕉", "", "苹果", "", "- 香蕉", "- 苹果", "", "> 引用乙", "", "> 引用甲"].join("\n"),
		["---", "tags:", `${sp(2)}- a`, "---", "", "香蕉", "", "苹果", "", "```", "香蕉", "苹果", "```"].join("\n"),
		["张三: 2024/01/05 14:30:25", `${T}香蕉`, "", "李四: 2024/01/05 14:31:02", `${T}苹果`].join("\n"),
		["苹果", "", "香蕉", "", "橙子", "", "- 丙", "- 甲", "- 乙"].join("\n"),
	];
	for (const input of inputs) {
		const once = sortContentBlocks(input);
		const twice = sortContentBlocks(once);
		checkTrue(`幂等失败`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
	}

	// 排完的结果必须是"排好的"：再排一次等于原样（也就是收敛到不动点）
	check(
		"收敛到拼音序",
		sortContentBlocks(["阿", "", "词", "", "波"].join("\n")),
		["阿", "", "波", "", "词"].join("\n")
	);
	console.log(`板块排序幂等：${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 块边界 ===");
boundaryTests();

console.log("=== 3. 锚点安全 ===");
anchorTests();

console.log("=== 4. 幂等 ===");
idempotencyTests();

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
