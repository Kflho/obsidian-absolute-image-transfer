/**
 * 行首缩进修复测试
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 把"什么该改、什么不该改"钉死
 *   2. 严格幂等 —— 任意输入跑一次即到不动点（排版功能每次保存都可能重跑）
 *   3. 安全边界 —— frontmatter、代码块、列表子项缩进不许动
 *   4. 与聊天记录排版串联 —— 组合结果同样幂等，且不会覆盖「正文缩进」设置
 */
import { fixLeadingIndent, resolveLeadingIndentMode } from "../src/text-layout";
import type { LeadingIndentMode } from "../src/text-layout";
import { formatChatLog, DEFAULT_CHAT_LOG_OPTIONS, resolveIndent } from "../src/chat-log";
import type { ChatLogOptions } from "../src/chat-log";

const T = "\t";
/** n 个空格（写成 repeat 免得数错） */
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
/** 智能模式（默认）：混用与 4 空格缩进一律归一；1~3 个纯空格只在后面是块级结构时保留 */
const SMART_CASES: Array<[string, string, string]> = [
	// —— 该改的：混用空格与 Tab ——
	["Tab 后跟空格", `${T} 内容`, `${T}内容`],
	["空格后跟 Tab", ` ${T}内容`, `${T}内容`],
	["空格夹两个 Tab 再跟空格", ` ${T}${T} 内容`, `${T}${T}内容`],
	["Tab 前两个空格", `  ${T}内容`, `${T}内容`],
	["Tab 之间夹空格", `${T} ${T} ${T}内容`, `${T}${T}${T}内容`],
	["Tab 后跟四个空格", `${T}${sp(4)}内容`, `${T}${T}内容`],
	["四个空格后跟 Tab", `${sp(4)}${T}内容`, `${T}${T}内容`],
	// —— 该改的：4 个空格 = 1 个 Tab ——
	["四个空格", `${sp(4)}内容`, `${T}内容`],
	["八个空格", `${sp(8)}内容`, `${T}${T}内容`],
	["十二个空格加一个 Tab", `${sp(12)}${T}内容`, `${T}${T}${T}${T}内容`],
	// —— 该改的：正文 / 图片前面手滑多打的 1~3 个空格 ——
	["一个空格", `${sp(1)}内容`, `内容`],
	["两个空格", `${sp(2)}内容`, `内容`],
	["三个空格", `${sp(3)}内容`, `内容`],
	["图片嵌入前的空格", `${sp(1)}![[Pasted image 20240101120000.png]]`, `![[Pasted image 20240101120000.png]]`],
	["Markdown 图片前的空格", `${sp(2)}![说明](a.png)`, `![说明](a.png)`],
	// —— 不该动的：后面是块级结构，缩进有语法含义 ——
	["列表子项（无序）", `${sp(2)}- 子项`, `${sp(2)}- 子项`],
	["列表子项（星号）", `${sp(1)}* 子项`, `${sp(1)}* 子项`],
	["列表子项（加号）", `${sp(3)}+ 子项`, `${sp(3)}+ 子项`],
	["列表子项（有序）", `${sp(2)}1. 子项`, `${sp(2)}1. 子项`],
	["任务列表子项", `${sp(2)}- [x] 已完成`, `${sp(2)}- [x] 已完成`],
	["空列表项", `${sp(2)}-`, `${sp(2)}-`],
	["引用", `${sp(2)}> 引用`, `${sp(2)}> 引用`],
	["标题", `${sp(2)}## 标题`, `${sp(2)}## 标题`],
	["表格", `${sp(2)}| 单元格 |`, `${sp(2)}| 单元格 |`],
	// `#标签` 后面没有空白，是标签不是标题，行首多打的空格该删
	["标签行不是块级结构", `${sp(2)}#标签`, `#标签`],
	["井号后无空格的文本", `${sp(1)}#标签 内容`, `#标签 内容`],
	["列数不整的深缩进（6 格，不猜）", `${sp(6)}内容`, `${sp(6)}内容`],
	["列数不整的深缩进（6 格 + 列表）", `${sp(6)}- 子项`, `${sp(6)}- 子项`],
	// —— 不该动的：本来就是干净的 ——
	["纯 Tab 缩进", `${T}${T}内容`, `${T}${T}内容`],
	["无缩进", `内容`, `内容`],
	["纯空白行", ` ${T} `, ` ${T} `],
	["空行", ``, ``],
	["行中间的空格与 Tab", `内容 ${T} 更多`, `内容 ${T} 更多`],
	["CRLF 行尾", `${T} 内容\r`, `${T}内容\r`],
];

/** 严格模式：行首只留 Tab，空格一律删掉（列表子项的 1~3 格缩进也压平） */
const STRICT_CASES: Array<[string, string, string]> = [
	["一个空格", `${sp(1)}内容`, `内容`],
	["两个空格", `${sp(2)}内容`, `内容`],
	["三个空格", `${sp(3)}内容`, `内容`],
	["六个空格", `${sp(6)}内容`, `${T}内容`],
	["十个空格", `${sp(10)}内容`, `${T}${T}内容`],
	["十六个空格", `${sp(16)}内容`, `${T}${T}${T}${T}内容`],
	["四个空格", `${sp(4)}内容`, `${T}内容`],
	["列表子项缩进也压平", `${sp(2)}- 子项`, `- 子项`],
	["Tab 与空格混用", ` ${T}${T} 内容`, `${T}${T}内容`],
	["纯 Tab 不动", `${T}内容`, `${T}内容`],
];

function goldenTests(): void {
	for (const [name, input, expected] of SMART_CASES) {
		check(`智能·${name}`, fixLeadingIndent(input, "smart"), expected);
	}
	for (const [name, input, expected] of STRICT_CASES) {
		check(`严格·${name}`, fixLeadingIndent(input, "strict"), expected);
	}

	// 多行：只改该改的行，其余行原样保留
	const multi = [
		"# 标题",
		` ${T}坏掉的缩进`,
		`${sp(2)}- 列表子项（缩进保留）`,
		`${sp(2)}正文前多打的空格（删掉）`,
		`${sp(4)}四个空格折成 tab`,
		"",
		`${T}正常缩进`,
	].join("\n");
	check(
		"多行混合",
		fixLeadingIndent(multi, "smart"),
		[
			"# 标题",
			`${T}坏掉的缩进`,
			`${sp(2)}- 列表子项（缩进保留）`,
			"正文前多打的空格（删掉）",
			`${T}四个空格折成 tab`,
			"",
			`${T}正常缩进`,
		].join("\n")
	);

	// 关闭：原样返回（同一个字符串对象，避免调用方误以为发生过改动）
	const raw = ` ${T}内容`;
	check("关闭模式", fixLeadingIndent(raw, "off"), raw);
	checkTrue("关闭模式不做拷贝", fixLeadingIndent(raw, "off") === raw, "返回了新的字符串");
	checkTrue("无需改动时返回原串", fixLeadingIndent("没有缩进问题\n", "smart") === "没有缩进问题\n", "无改动却返回了新内容");

	// 设置值收敛：data.json 被手改成非法值时回退到默认
	checkTrue("非法设置值回退默认", resolveLeadingIndentMode("乱写") === "smart", "未回退到 smart");
	checkTrue("旧值 safe 回退默认", resolveLeadingIndentMode("safe") === "smart", "safe 未回退到 smart");
	checkTrue("合法设置值保留", resolveLeadingIndentMode("strict") === "strict", "strict 被改写");
	checkTrue("off 保留", resolveLeadingIndentMode("off") === "off", "off 被改写");
	checkTrue("缺省值回退", resolveLeadingIndentMode(undefined) === "smart", "undefined 未回退");
}

// ------------------------------------------------------------ 2. 安全边界
function guardTests(): void {
	// YAML frontmatter：缩进是语法，Tab 更非法
	const fm = ["---", "tags:", `${sp(4)}- 一个标签`, "标题: 测试", "---", ` ${T}正文`, `${sp(4)}正文`].join("\n");
	check(
		"frontmatter 不动",
		fixLeadingIndent(fm, "smart"),
		["---", "tags:", `${sp(4)}- 一个标签`, "标题: 测试", "---", `${T}正文`, `${T}正文`].join("\n")
	);
	checkTrue(
		"frontmatter 严格模式也不动",
		fixLeadingIndent(fm, "strict").startsWith(`---\ntags:\n${sp(4)}- 一个标签`),
		`实际 ${show(fixLeadingIndent(fm, "strict"))}`
	);

	// 围栏代码块：缩进是代码内容
	const code = ["说明：", "```ts", ` ${T}const a = 1;`, `${sp(4)}缩进四格`, "```", ` ${T}正文`].join("\n");
	check(
		"代码块不动",
		fixLeadingIndent(code, "smart"),
		["说明：", "```ts", ` ${T}const a = 1;`, `${sp(4)}缩进四格`, "```", `${T}正文`].join("\n")
	);
	check(
		"波浪号围栏同样保护",
		fixLeadingIndent(["~~~", `${sp(4)}代码`, "~~~", `${sp(4)}正文`].join("\n"), "smart"),
		["~~~", `${sp(4)}代码`, "~~~", `${T}正文`].join("\n")
	);
	check(
		"带缩进的围栏也认得出",
		fixLeadingIndent([`${sp(2)}` + "```", `${sp(4)}代码`, `${sp(2)}` + "```", `${sp(4)}正文`].join("\n"), "smart"),
		[`${sp(2)}` + "```", `${sp(4)}代码`, `${sp(2)}` + "```", `${T}正文`].join("\n")
	);
	check(
		"未闭合代码块内部不动",
		fixLeadingIndent(["```", `${sp(4)}代码`].join("\n"), "smart"),
		["```", `${sp(4)}代码`].join("\n")
	);

	// Markdown 嵌套列表：块级结构前的 1~3 格缩进必须原样保留；
	// 4 个空格折成一个 Tab —— 制表位就是 4 列，渲染出来的层级不变
	const list = [
		"- 顶层",
		`${sp(2)}- 二级`,
		`${sp(4)}- 四级风格二级`,
		`${sp(2)}该项的续行说明（懒续行，缩进没有语法含义 → 删掉）`,
		"",
		"1. 有序",
		`${sp(3)}- 子项`,
	].join("\n");
	check(
		"嵌套列表：结构缩进保留，续行空格删掉",
		fixLeadingIndent(list, "smart"),
		[
			"- 顶层",
			`${sp(2)}- 二级`,
			`${T}- 四级风格二级`,
			"该项的续行说明（懒续行，缩进没有语法含义 → 删掉）",
			"",
			"1. 有序",
			`${sp(3)}- 子项`,
		].join("\n")
	);

	// 没有首行 frontmatter 分隔符时，不应把整篇当成 frontmatter 吃掉
	const noFm = ["正文", "---", ` ${T}后面还有内容`].join("\n");
	check("非首行 --- 不当 frontmatter", fixLeadingIndent(noFm, "smart"), ["正文", "---", `${T}后面还有内容`].join("\n"));

	// 列表项里的续行段落（前面隔着空行，空行之上是列表项）：缩进有语法含义，保留
	check(
		"列表项续行段落保留缩进",
		fixLeadingIndent(
			["- 顶层", "", `${sp(2)}续行段落`, "", "普通正文", "", `${sp(2)}手滑的空格`].join("\n"),
			"smart"
		),
		["- 顶层", "", `${sp(2)}续行段落`, "", "普通正文", "", "手滑的空格"].join("\n")
	);
	check(
		"有序列表的续行段落同样保留",
		fixLeadingIndent(["1. 第一步", "", `${sp(3)}这一步的补充说明`].join("\n"), "smart"),
		["1. 第一步", "", `${sp(3)}这一步的补充说明`].join("\n")
	);
	// 紧接着列表项、中间没有空行的续行属于 lazy continuation，删掉缩进不影响归属
	check(
		"懒续行的空格删掉",
		fixLeadingIndent(["- 顶层", `${sp(2)}紧接着的续行`].join("\n"), "smart"),
		["- 顶层", "紧接着的续行"].join("\n")
	);
	// 分隔线 / 粗体不是列表符号，别被误判成结构
	check(
		"分隔线与粗体不算列表符号",
		fixLeadingIndent(["正文", `${sp(2)}---`, `${sp(1)}**粗体**`].join("\n"), "smart"),
		["正文", "---", "**粗体**"].join("\n")
	);
}

// ------------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const modes: LeadingIndentMode[] = ["smart", "strict", "off"];
	const inputs: string[] = [
		...SMART_CASES.map(([, input]) => input),
		...STRICT_CASES.map(([, input]) => input),
		["---", "tags:", `${sp(4)}- a`, "---", ` ${T}正文`, `${sp(2)}- 二级`, "```", ` ${T}代码`, "```"].join("\n"),
		[` ${T}${T} 混排`, `${sp(4)}`, `${sp(1)}五个空格?`, `${sp(2)}正文`, `${sp(2)}- 子项`, `${T}${sp(12)}   `].join("\n"),
		["- 顶层", "", `${sp(2)}续行段落`, "", `${sp(2)}- 子项`, "", `${sp(1)}手滑的空格`].join("\n"),
	];

	for (const mode of modes) {
		for (const input of inputs) {
			const once = fixLeadingIndent(input, mode);
			const twice = fixLeadingIndent(once, mode);
			checkTrue(`幂等失败 [${mode}]`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
		}
	}
	console.log(`行首缩进幂等：${modes.length} 种力度 × ${inputs.length} 个用例`);
}

// ------------------------------------------- 4. 与聊天记录排版串联（真实入口）
/** main.ts 里 processChatLog 的等价实现：先修缩进，再排版 */
function pipeline(raw: string, options: ChatLogOptions, mode: LeadingIndentMode): string {
	return formatChatLog(fixLeadingIndent(raw, mode), options);
}

function pipelineTests(): void {
	const D = DEFAULT_CHAT_LOG_OPTIONS;

	// 混乱缩进的聊天记录：正文行由排版引擎按设置重排，笔记正文的坏缩进也一并修好
	const messy = [
		"张三 2024/1/5 14:30:25",
		`${T} 你好，文件收到了吗`,
		`${T}${T} 图片说明`,
		"",
		` ${T}李四 2024/1/5 14:31:02`,
		`${sp(1)}在的`,
		"",
		`${sp(4)}笔记正文`,
	].join("\n");
	check(
		"混乱缩进聊天记录",
		pipeline(messy, D, "smart"),
		[
			"张三: 2024/01/05 14:30:25",
			`${T}你好，文件收到了吗`,
			`${T}图片说明`,
			"",
			"李四: 2024/01/05 14:31:02",
			`${T}在的`,
			"",
			`${T}笔记正文`,
		].join("\n")
	);

	// 认不出用户名的段落会原样保留 —— 这类行正是最需要修缩进的地方
	// 全角空格（U+3000）不算行首缩进，保持不动
	const fullWidth = "\u3000";
	const verbatim = ["说明文字", ` ${T}没认出来的行`, `${sp(1)}手滑的空格`, `${fullWidth}${T}全角空格（不动）`].join("\n");
	check(
		"原样保留段落的缩进被修好",
		pipeline(verbatim, D, "smart"),
		["说明文字", `${T}没认出来的行`, "手滑的空格", `${fullWidth}${T}全角空格（不动）`].join("\n")
	);

	// 组合幂等：任何输入跑一次就到不动点（否则每次保存都会重写文件）
	const inputs = [
		messy,
		verbatim,
		["张三 2024/1/5 14:30:25", ` ${T}你好`, `${sp(2)}- 子项`, "", "笔记"].join("\n"),
	];
	const combos: ChatLogOptions[] = [
		D,
		{ ...D, indent: resolveIndent("4") },
		{ ...D, indent: "" },
		{ ...D, showUsername: false, showDate: false, showTime: false, blankLineBetweenMessages: true },
	];
	for (const options of combos) {
		for (const mode of ["smart", "strict"] as LeadingIndentMode[]) {
			for (const input of inputs) {
				const once = pipeline(input, options, mode);
				const twice = pipeline(once, options, mode);
				checkTrue(
					`组合幂等失败 [indent=${JSON.stringify(options.indent)} mode=${mode}]`,
					once === twice,
					`  一次 ${show(once)}\n  二次 ${show(twice)}`
				);
			}
		}
	}

	// 关键：行首缩进修复不能把「正文缩进 = 4 个空格」的设置again改成 Tab
	const four = pipeline("张三 2024/1/5 14:30:25\n  你好", { ...D, indent: resolveIndent("4") }, "smart");
	check("不覆盖 4 空格缩进设置", four, `张三: 2024/01/05 14:30:25\n${sp(4)}你好\n`);
	const two = pipeline("张三 2024/1/5 14:30:25\n  你好", { ...D, indent: resolveIndent("2") }, "smart");
	check("不覆盖 2 空格缩进设置", two, `张三: 2024/01/05 14:30:25\n${sp(2)}你好\n`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 安全边界 ===");
guardTests();

console.log("=== 3. 幂等 ===");
idempotencyTests();

console.log("=== 4. 与聊天记录排版串联 ===");
pipelineTests();

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
