/**
 * 块级标记排版测试（引用 / 列表 / 标题的空白规范）
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 用户报的那个坑（`" >引用"` 被当成引用整行放过）钉死在这里
 *   2. 安全边界 —— frontmatter、代码块、列表项里的引用缩进不许动；`#标签` 不许被加空格
 *   3. 严格幂等 —— 规范化后的形态再跑一次不变（排版功能每次保存都可能重跑）
 *   4. 与行首缩进修复串联 —— 两步合起来的结果同样幂等
 */
import { fixBlockMarkers } from "../src/markdown-markers";
import { fixLeadingIndent } from "../src/text-layout";
import type { LeadingIndentMode } from "../src/text-layout";

const T = "\t";
/** n 个空格 */
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
const CASES: Array<[string, string, string]> = [
	// —— 用户报的坑：`" >"` 被判成引用，排版一点没修 ——
	["引用：一个空格 + 引用", ` >引用`, `> 引用`],
	["引用：一个空格 + 引用 + 空格", ` > 引用`, `> 引用`],
	["引用：两个空格", `  >引用文字`, `> 引用文字`],
	["引用：三个空格", `   >引用文字`, `> 引用文字`],
	["引用：四个空格（缩进是代码块，标记排版不碰，交给行首缩进修复）", `${sp(4)}>引用`, `${sp(4)}> 引用`],
	// —— 引用标记与正文之间补空格 / 多级引用规范化 ——
	["引用：标记后没空格", `>引用`, `> 引用`],
	["引用：标记后两个空格", `>  引用`, `> 引用`],
	["引用：多级引用连写", `>>引用`, `> > 引用`],
	["引用：多级引用多空格", `> >   引用`, `> > 引用`],
	["引用：空引用行", `>`, `>`],
	["引用：空引用行去掉尾空格", `> `, `>`],
	["引用：callout 标记后补空格", `>[!note] 标题`, `> [!note] 标题`],
	["引用：callout 已规范", `> [!note] 标题`, `> [!note] 标题`],
	// —— 引用里的嵌套块：缩进有含义，空白原样保留 ——
	["引用：里面的列表缩进保留", `>   - 子项`, `>   - 子项`],
	["引用：里面的表格缩进保留", `>   | 单元格 |`, `>   | 单元格 |`],
	["引用：里面的标题缩进保留", `>   # 标题`, `>   # 标题`],
	// —— 列表：符号后面的空白收成一个 ——
	["列表：横线后三个空格", `-   项目`, `- 项目`],
	["列表：星号后两个空格", `*  项目`, `* 项目`],
	["列表：加号后 tab", `+\t项目`, `+ 项目`],
	["列表：有序列表后两个空格", `1.  项目`, `1. 项目`],
	["列表：有序列表括号式", `2)   项目`, `2) 项目`],
	["列表：已规范", `- 项目`, `- 项目`],
	["列表：嵌套子项缩进保留", `  -   子项`, `  - 子项`],
	["列表：空列表项不动", `-`, `-`],
	["列表：空列表项带空格不动", `- `, `- `],
	["列表：任务列表不动", `- [x] 已完成`, `- [x] 已完成`],
	// —— 不是列表符号的别乱动 ——
	["分隔线不算列表", `---`, `---`],
	["粗体不算列表", `**粗体**`, `**粗体**`],
	["无空格的 `-项` 不算列表", `-项目`, `-项目`],
	// —— 标题：已有空白时收成一个；`#标签` 绝不能加空格 ——
	["标题：两个空格", `##   标题`, `## 标题`],
	["标题：tab", `##${T}标题`, `## 标题`],
	["标题：已规范", `# 标题`, `# 标题`],
	["标题：`#标签` 是标签不是标题", `#标签 内容`, `#标签 内容`],
	["标题：`##标签` 同样不动", `##标签`, `##标签`],
	// —— 干净的输入原样返回 ——
	["普通正文", `正文内容`, `正文内容`],
	["行中间的空格", `内容 -  项目`, `内容 -  项目`],
	["空行", ``, ``],
];

function goldenTests(): void {
	for (const [name, input, expected] of CASES) {
		check(name, fixBlockMarkers(input), expected);
	}

	checkTrue("无改动时返回原串", fixBlockMarkers("没有标记问题\n") === "没有标记问题\n", "无改动却返回了新内容");
	checkTrue("空串返回空串", fixBlockMarkers("") === "", "空串被改写");
}

// ------------------------------------------------------------ 2. 安全边界
function guardTests(): void {
	// frontmatter：`tags:` 下面的缩进是语法
	const fm = ["---", "tags:", `${sp(2)}- 一个标签`, "标题: 测试", "---", ` >引用`].join("\n");
	check(
		"frontmatter 不动",
		fixBlockMarkers(fm),
		["---", "tags:", `${sp(2)}- 一个标签`, "标题: 测试", "---", `> 引用`].join("\n")
	);

	// 围栏代码块：`>` 与 `#` 都是代码内容
	const code = ["```sh", " >引用", "#   注释行", "```", ` >引用`].join("\n");
	check("代码块内部不动", fixBlockMarkers(code), ["```sh", " >引用", "#   注释行", "```", `> 引用`].join("\n"));
	check(
		"未闭合代码块内部不动",
		fixBlockMarkers(["```", ` >引用`].join("\n")),
		["```", ` >引用`].join("\n")
	);

	// 列表项里的引用：缩进决定它归哪个列表项，删了就掉出列表
	check(
		"列表项里的引用缩进保留",
		fixBlockMarkers(["- 顶层", `${sp(2)}> 引用`].join("\n")),
		["- 顶层", `${sp(2)}> 引用`].join("\n")
	);
	check(
		"隔着空行的列表项内容同样保留缩进",
		fixBlockMarkers(["- 顶层", "", `${sp(2)}> 引用`, "", "普通正文", "", `${sp(1)}> 引用`].join("\n")),
		["- 顶层", "", `${sp(2)}> 引用`, "", "普通正文", "", `> 引用`].join("\n")
	);
	check(
		"有序列表里的引用同样保留",
		fixBlockMarkers(["1. 第一步", `${sp(3)}>说明`].join("\n")),
		["1. 第一步", `${sp(3)}> 说明`].join("\n")
	);
	// Tab 缩进是有含义的（4 列），只规范标记后面的空白
	check("tab 缩进的引用保留缩进", fixBlockMarkers(`${T}>引用`), `${T}> 引用`);
	// 多行：只改该改的行
	check(
		"多行混合",
		fixBlockMarkers(["# 标题", ` >引用`, `${sp(2)}- 项目`, "正文", `${sp(2)}> 引用缩进`].join("\n")),
		["# 标题", `> 引用`, `${sp(2)}- 项目`, "正文", `> 引用缩进`].join("\n")
	);
}

// ------------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		...CASES.map(([, input]) => input),
		["---", "tags:", `${sp(2)}- a`, "---", ` >引用`, "```", ` >引用`, "```", `${T}>引用`].join("\n"),
		["- 顶层", `${sp(2)}> 引用`, ` >>引用`, ">   - 子项", `>[!note] x`].join("\n"),
	];
	for (const input of inputs) {
		const once = fixBlockMarkers(input);
		const twice = fixBlockMarkers(once);
		checkTrue(`幂等失败`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
	}
	console.log(`标记排版幂等：${inputs.length} 个用例`);
}

// ------------------------------------------- 4. 与行首缩进修复串联（真实入口）
function pipeline(raw: string, mode: LeadingIndentMode): string {
	return fixBlockMarkers(fixLeadingIndent(raw, mode));
}

function pipelineTests(): void {
	// 智能模式下，行首缩进修复会把 `>引用` 当成"缩进有语法含义的引用行"放过，
	// 标记排版必须把它接住
	check("智能 + 标记：引用补齐空格", pipeline(` >引用`, "smart"), `> 引用`);
	check("智能 + 标记：多级引用", pipeline(` >>引用`, "smart"), `> > 引用`);
	check("严格 + 标记：引用补齐空格", pipeline(` >引用`, "strict"), `> 引用`);
	check("智能 + 标记：四个空格先折成 tab", pipeline(`${sp(4)}>引用`, "smart"), `${T}> 引用`);
	check("智能 + 标记：标签行前面的空格删掉", pipeline(` #标签 内容`, "smart"), `#标签 内容`);

	// 组合幂等
	const inputs = [
		` >#标签 引用内容`,
		["# 标题", ` >引用`, `${sp(2)}-   项目`, "```", ` >代码`, "```"].join("\n"),
		["- 顶层", `${sp(2)}> 引用`, "", ` >引用`].join("\n"),
	];
	for (const mode of ["smart", "strict"] as LeadingIndentMode[]) {
		for (const input of inputs) {
			const once = pipeline(input, mode);
			const twice = pipeline(once, mode);
			checkTrue(`组合幂等失败 [${mode}]`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
		}
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 安全边界 ===");
guardTests();

console.log("=== 3. 幂等 ===");
idempotencyTests();

console.log("=== 4. 与行首缩进修复串联 ===");
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
