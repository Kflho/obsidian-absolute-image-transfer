/**
 * 标签排版测试
 *
 * 运行：npm test
 *
 * 分五级保证：
 *   1. 期望输出（golden）—— 标签归位到句尾、与正文空一格；多个标签按首字母排序
 *   2. 块边界 —— 段落按块、列表项按行、**纯标签行自成一块**、**表格按单元格**（不能把标签挪到别的列）
 *   3. 安全边界 —— frontmatter / 代码块 / 行内代码 / 双链 / 链接 / `C#` / `#123` 都不许动
 *   4. 严格幂等 —— 排好版的内容再跑一次不变
 *   5. 关闭排序 —— 标签保持原有先后顺序
 */
import { formatTags, DEFAULT_TAG_LAYOUT_OPTIONS } from "../src/tags";
import type { TagLayoutOptions } from "../src/tags";

const T = "\t";
const sp = (n: number): string => " ".repeat(n);

const SORTED: TagLayoutOptions = { sort: true };
const KEEP_ORDER: TagLayoutOptions = { sort: false };

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
/** 标签归位：句首、句中、句尾，以及标点与空格的处理 */
const GOLDEN: Array<[string, string, string]> = [
	["行首标签", `#数学 今天学了极限`, `今天学了极限 #数学`],
	["行中标签", `今天学了 #数学 极限`, `今天学了 极限 #数学`],
	["行尾标签（已是句尾）", `今天学了极限 #数学`, `今天学了极限 #数学`],
	["紧跟标点的标签", `今天学了极限 #数学。`, `今天学了极限。 #数学`],
	["标签在句号之后（前一个字符是标点，与 Obsidian 一致不算标签）", `今天学了极限。#数学`, `今天学了极限。#数学`],
	["两个标签都归位", `#数学 #笔记 今天学了极限`, `今天学了极限 #笔记 #数学`],
	["标签之间只剩一个空格", `内容 #数学   #笔记`, `内容 #笔记 #数学`],
	["同一个标签出现两次只留一个", `#标签 内容 #标签`, `内容 #标签`],
	["多个空格被收成一个", `内容   #标签`, `内容 #标签`],
	// —— 前缀（引用 / 列表 / 标题）必须留在原地 ——
	["列表项", `- #标签 内容`, `- 内容 #标签`],
	["列表项（有序）", `1. #标签 内容`, `1. 内容 #标签`],
	["任务列表", `- [ ] #标签 任务`, `- [ ] 任务 #标签`],
	["嵌套列表子项", `${sp(2)}- #标签 子项`, `${sp(2)}- 子项 #标签`],
	["引用", `> #标签 引用内容`, `> 引用内容 #标签`],
	["多级引用", `> > #标签 引用内容`, `> > 引用内容 #标签`],
	["标题", `## #标签 标题`, `## 标题 #标签`],
	["Tab 缩进的正文（聊天记录正文就是这样）", `说明\n${T}#标签 内容`, `说明\n${T}内容 #标签`],
	["连续两个列表项不串行", ["- [ ] #标签 任务一", "- [x] 任务二 #完成"].join("\n"), ["- [ ] 任务一 #标签", "- [x] 任务二 #完成"].join("\n")],
	["连续两个普通列表项不串行", ["- #标签 甲", "- 乙"].join("\n"), ["- 甲 #标签", "- 乙"].join("\n")],
	// —— 段落（多行）算一块，标签挪到段落末尾 ——
	["段落：标签在首行", `#标签 第一行\n第二行`, `第一行\n第二行 #标签`],
	["段落：标签在中间行", `第一行\n#标签 第二行\n第三行`, `第一行\n第二行\n第三行 #标签`],
	["段落：标签本来就在末行", `第一行\n第二行 #标签`, `第一行\n第二行 #标签`],
	["段落：末行只有标签，位置不动", `第一行\n#标签`, `第一行\n#标签`],
	// —— 整行只有标签：自成一块，位置不动，也不与相邻正文行合并 ——
	["纯标签行", `#标签`, `#标签`],
	["纯标签行（多个）", `#笔记 #数学`, `#笔记 #数学`],
	["纯标签行（需要排序）", `#数学 #笔记`, `#笔记 #数学`],
	["纯标签行：段落开头（不被并进下一行）", `#标签\n下一行文字`, `#标签\n下一行文字`],
	["纯标签行：段落中间（不被抽走）", `第一行\n#标签\n第三行`, `第一行\n#标签\n第三行`],
	["纯标签行：夹在正文之间，标签不外流也不接收", `#甲 第一行\n#乙\n第三行`, `第一行 #甲\n#乙\n第三行`],
	["纯标签行：连着两行不被并成一行", `文字\n#甲\n#乙`, `文字\n#甲\n#乙`],
	["纯标签行：段落里仍按需排序", `第一行\n#乙 #甲\n第三行`, `第一行\n#甲 #乙\n第三行`],
	["纯标签行：引用里的纯标签行", `> 上一行文字\n> #标签`, `> 上一行文字\n> #标签`],
	["纯标签行：CRLF 行尾", `第一行\r\n#标签`, `第一行\r\n#标签`],
	// —— 表格：按单元格处理，列不会被撑坏 ——
	["表格：单元格内标签归位", `| #标签 内容 | 说明 |`, `| 内容 #标签 | 说明 |`],
	["表格：两个单元格各自处理", `| #b a | #d c |`, `| a #b | c #d |`],
	["表格：单元格两侧填充保留", `|  #标签 x  |  y  |`, `|  x #标签  |  y  |`],
	["表格：已经规范不动", `| a #b | c #d |`, `| a #b | c #d |`],
	["表格：对齐行不动", `| --- | --- |`, `| --- | --- |`],
	["表格：整格只有标签", `| #标签 | 说明 |`, `| #标签 | 说明 |`],
	["表格：单元格内多标签排序", `| #数学 #笔记 内容 | x |`, `| 内容 #笔记 #数学 | x |`],
	// —— 干净的输入原样返回 ——
	["没有标签", `普通正文内容`, `普通正文内容`],
	["空行", ``, ``],
	["标签后没有正文", `#标签 `, `#标签`],
];

function goldenTests(): void {
	for (const [name, input, expected] of GOLDEN) {
		check(name, formatTags(input, SORTED), expected);
	}

	// 首字母排序：中文按拼音（笔 b < 数 s）、数字按数值（2 < 10）、英文大小写不敏感
	check("标签排序：中文按拼音", formatTags(`内容 #数学 #笔记`, SORTED), `内容 #笔记 #数学`);
	check("标签排序：数字按数值", formatTags(`内容 #第10条 #第2条`, SORTED), `内容 #第2条 #第10条`);
	check("标签排序：英文", formatTags(`内容 #banana #Apple`, SORTED), `内容 #Apple #banana`);
	check(
		"标签排序：按首字母而不是整串（阿 < 波）",
		formatTags(`内容 #波 #阿`, SORTED),
		`内容 #阿 #波`
	);
	check("标签排序：嵌套标签", formatTags(`内容 #b/子 #a/子`, SORTED), `内容 #a/子 #b/子`);

	// 关闭排序：位置归位，但先后顺序保持原样
	check("关闭排序：归位但保持原顺序", formatTags(`#数学 #笔记 内容`, KEEP_ORDER), `内容 #数学 #笔记`);
	check("关闭排序：纯标签行原样", formatTags(`#数学 #笔记`, KEEP_ORDER), `#数学 #笔记`);
	check("关闭排序：表格单元格内保持原顺序", formatTags(`| #数学 #笔记 内容 | x |`, KEEP_ORDER), `| 内容 #数学 #笔记 | x |`);

	// 选项缺省值 = 排序打开（与设置项默认值一致）
	checkTrue("默认选项为排序打开", DEFAULT_TAG_LAYOUT_OPTIONS.sort === true, "默认没有打开排序");
	check("默认选项生效", formatTags(`内容 #数学 #笔记`), `内容 #笔记 #数学`);

	// 没有改动时返回原串，避免调用方误以为需要写盘
	const clean = `内容 #标签`;
	checkTrue("无改动时返回原串", formatTags(clean, SORTED) === clean, "无改动却返回了新内容");
	checkTrue("空串返回空串", formatTags("", SORTED) === "", "空串被改写");
}

// ------------------------------------------------------------ 2. 安全边界
function guardTests(): void {
	// frontmatter：`tags:` 里的 `#` 不是行内标签，且缩进是语法
	const fm = ["---", "tags:", `${sp(2)}- 标签一`, "标题: #不是标签", "---", `#标签 正文`].join("\n");
	check(
		"frontmatter 不动",
		formatTags(fm, SORTED),
		["---", "tags:", `${sp(2)}- 标签一`, "标题: #不是标签", "---", `正文 #标签`].join("\n")
	);

	// 围栏代码块：`#` 是注释或代码
	const code = ["```sh", "#标签 注释", "#b #a", "```", `#标签 正文`].join("\n");
	check(
		"代码块内部不动",
		formatTags(code, SORTED),
		["```sh", "#标签 注释", "#b #a", "```", `正文 #标签`].join("\n")
	);
	check("未闭合代码块内部不动", formatTags(["```", `#标签 x`].join("\n"), SORTED), ["```", `#标签 x`].join("\n"));

	// 行内代码 / 双链 / Markdown 链接 / HTML 注释里的 `#`
	check("行内代码不动", formatTags("`#标签 内容` 说明", SORTED), "`#标签 内容` 说明");
	check("双链里的 # 不是标签", formatTags("[[笔记#标题]] 内容", SORTED), "[[笔记#标题]] 内容");
	check("双链嵌入里的 # 不是标签", formatTags("![[图片.png#outline]] 内容", SORTED), "![[图片.png#outline]] 内容");
	check("Markdown 链接里的 # 不是标签", formatTags("[文字](http://x.com#锚点) 说明", SORTED), "[文字](http://x.com#锚点) 说明");
	check("HTML 注释里的 # 不是标签", formatTags("<!-- #标签 --> 说明", SORTED), "<!-- #标签 --> 说明");

	// 不是标签的几种写法
	check("C# 不是标签", formatTags("C# 语言", SORTED), "C# 语言");
	check("行内紧贴文字的 # 不是标签", formatTags("文字#标签 内容", SORTED), "文字#标签 内容");
	check("纯数字不是标签", formatTags("#123 内容", SORTED), "#123 内容");
	check("井号后面没内容不是标签", formatTags("# 内容", SORTED), "# 内容");
	check("URL 里的 # 不是标签", formatTags("见 https://x.com#a 说明", SORTED), "见 https://x.com#a 说明");
	check("井号前是标点也不算标签", formatTags("（#标签） 内容", SORTED), "（#标签） 内容");

	// 全角空格同样是分隔符：标签能被认出来，删掉后不会留下双空格
	check("全角空格分隔的标签", formatTags("内容\u3000#标签", SORTED), "内容 #标签");

	// 缩进写成的代码块：`#fff`、`#TODO` 看着像标签，其实在代码里，整段不动
	check(
		"缩进代码块（4 个空格）不动",
		formatTags(["说明", "", `${sp(4)}color: #fff;`, `${sp(4)}#TODO 修一下`].join("\n"), SORTED),
		["说明", "", `${sp(4)}color: #fff;`, `${sp(4)}#TODO 修一下`].join("\n")
	);
	check(
		"开头就是 Tab 缩进：当代码块",
		formatTags(`${T}#标签 代码`, SORTED),
		`${T}#标签 代码`
	);
	// 列表项里的缩进内容是正文，不是代码
	check(
		"列表项里的缩进内容仍算正文",
		formatTags(["- 列表项", "", `${sp(4)}#标签 续行内容`].join("\n"), SORTED),
		["- 列表项", "", `${sp(4)}续行内容 #标签`].join("\n")
	);
	// 聊天记录：正文紧跟在头部行后面，不会被当成缩进代码
	check(
		"聊天记录正文照常处理",
		formatTags(["张三: 2024/01/05 14:30:25", `${sp(4)}#标签 你好`].join("\n"), SORTED),
		["张三: 2024/01/05 14:30:25", `${sp(4)}你好 #标签`].join("\n")
	);
}

// ------------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		...GOLDEN.map(([, input]) => input),
		["---", "tags: x", "---", `#标签 正文`, "```", `#标签 x`, "```"].join("\n"),
		["#b #a", `内容 #数学 #笔记`, `${sp(2)}- #标签 子项`, `> #标签 引用`].join("\n"),
		["| #b a | #d c |", "| --- | --- |", "| #b a | #d c |"].join("\n"),
		["第一行", "#标签", "第三行"].join("\n"),
		["#标签", "下一行文字", "", "文字", "#甲", "#乙"].join("\n"),
	];
	for (const options of [SORTED, KEEP_ORDER]) {
		for (const input of inputs) {
			const once = formatTags(input, options);
			const twice = formatTags(once, options);
			checkTrue(
				`幂等失败 [sort=${options.sort}]`,
				once === twice,
				`  一次 ${show(once)}\n  二次 ${show(twice)}`
			);
		}
	}
	console.log(`标签排版幂等：2 种选项 × ${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 安全边界 ===");
guardTests();

console.log("=== 3. 幂等 ===");
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
