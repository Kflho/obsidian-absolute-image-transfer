/**
 * 排版流水线测试（真实入口：main.ts 的 processChatLog 就是调它）
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 各步骤串起来的结果正确 —— 行首缩进 → 标记 → 聊天记录 → 标签 → 板块排序
 *   2. 顺序约束 —— 标签排版排在聊天记录后面（不会被重新缩进挤走）、
 *      行首缩进修复排在聊天记录前面（不会覆盖「正文缩进」设置）
 *   3. 开关生效 —— 「行首缩进修复」关闭时标记排版一并停用；标签排版关闭时不碰标签
 *   4. 全组合幂等 —— 同一篇笔记连跑两次不再改动（否则每次保存都会重写文件）
 */
import { formatNoteText } from "../src/text-pipeline";
import type { TextPipelineOptions } from "../src/text-pipeline";
import { DEFAULT_CHAT_LOG_OPTIONS, resolveIndent } from "../src/chat-log";
import type { ChatLogOptions } from "../src/chat-log";

const T = "\t";
const sp = (n: number): string => " ".repeat(n);

/** 默认：只开行首缩进与标记排版（与插件默认设置一致） */
const BASE: TextPipelineOptions = {
	leadingIndent: "smart",
	chat: DEFAULT_CHAT_LOG_OPTIONS,
	mathLayout: false,
	tags: null,
	blockSort: false,
};

/** 全开 */
const ALL: TextPipelineOptions = { ...BASE, mathLayout: true, tags: { sort: true }, blockSort: true };

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

// -------------------------------------------------------- 1. 各步骤串起来
function pipelineTests(): void {
	// 用户报的坑：`" >引用"` 以前被当成引用整行放过，现在要修成 `"> 引用"`
	check("引用：行首零散空格 + 标记后补空格", formatNoteText(" >引用内容", BASE), "> 引用内容");
	check("引用：多级引用规范化", formatNoteText(" >>引用内容", BASE), "> > 引用内容");
	check("列表：符号后多个空格收成一个", formatNoteText("-    项目", BASE), "- 项目");
	check("标题：符号后多个空格收成一个", formatNoteText("##   标题", BASE), "## 标题");
	check("标题：`#标签` 不能被当成标题", formatNoteText("#标签 内容", BASE), "#标签 内容");

	// 标签归位（默认关闭 → 打开后有变化）
	check("标签：默认关闭时不碰", formatNoteText("#标签 内容", BASE), "#标签 内容");
	check("标签：打开后移到句尾", formatNoteText("#标签 内容", { ...BASE, tags: { sort: true } }), "内容 #标签");

	// 板块排序
	check(
		"板块排序：打开后按首字母排",
		formatNoteText(["香蕉", "", "苹果"].join("\n"), { ...BASE, blockSort: true }),
		["苹果", "", "香蕉"].join("\n")
	);
	check(
		"板块排序：默认关闭时不动",
		formatNoteText(["香蕉", "", "苹果"].join("\n"), BASE),
		["香蕉", "", "苹果"].join("\n")
	);

	// 一串乱排版：缩进 + 引用 + 标签 + 列表，一次全修好
	check(
		"综合：乱排版一次修好",
		formatNoteText(
			[" >#灵感 今天很开心", "", ` ${T}${sp(2)}- 列表子项`, "", "#数学 学了极限"].join("\n"),
			{ ...BASE, tags: { sort: true } }
		),
		["> 今天很开心 #灵感", "", `${T}- 列表子项`, "", "学了极限 #数学"].join("\n")
	);

	// 公式排版：默认关闭；打开后按规则整理 $$…$$ 与行内 $…$，公式外的正文不动
	const formula = ["正文 $a_{n-1}=b$ 与公式：$$", `${T}${T}x=1\\le y$$`].join("\n");
	check("公式排版：默认关闭时不动", formatNoteText(formula, BASE), formula);
	check(
		"公式排版：打开后整理",
		formatNoteText(formula, { ...BASE, mathLayout: true }),
		["正文 $a_{n - 1} = b$ 与公式：$$x = 1 \\le y$$"].join("\n")
	);
}

// ------------------------------------------------------------ 2. 顺序约束
function orderTests(): void {
	// 标签排版必须在聊天记录排版之后：否则聊天记录重新缩进时会把标签挤走
	const chatWithTag = "张三 2024/1/5 14:30:25\n#灵感 今天很开心";
	check(
		"聊天记录 + 标签：标签落在正文句尾",
		formatNoteText(chatWithTag, { ...BASE, tags: { sort: true } }),
		["张三: 2024/01/05 14:30:25", `${T}今天很开心 #灵感`, ""].join("\n")
	);

	// 行首缩进修复必须在聊天记录排版之前：不能覆盖「正文缩进 = 4 个空格」
	const fourSpaces: ChatLogOptions = { ...DEFAULT_CHAT_LOG_OPTIONS, indent: resolveIndent("4") };
	check(
		"不覆盖 4 空格正文缩进设置",
		formatNoteText("张三 2024/1/5 14:30:25\n  你好", { ...BASE, chat: fourSpaces, tags: { sort: true } }),
		["张三: 2024/01/05 14:30:25", `${sp(4)}你好`, ""].join("\n")
	);

	// 板块排序必须在最后：聊天记录整条不动，段落自己排
	check(
		"聊天记录不被板块排序打乱",
		formatNoteText(
			[
				"张三: 2024/01/05 14:30:25",
				`${T}香蕉`,
				"",
				"李四: 2024/01/05 14:31:02",
				`${T}苹果`,
				"",
				"香蕉段",
				"",
				"苹果段",
			].join("\n"),
			ALL
		),
		[
			"张三: 2024/01/05 14:30:25",
			`${T}香蕉`,
			"",
			"李四: 2024/01/05 14:31:02",
			`${T}苹果`,
			"",
			"苹果段",
			"",
			"香蕉段",
		].join("\n")
	);

	// 公式排版必须排在聊天记录之后：聊天记录会重排正文缩进，公式的多行缩进要在它之后再定
	check(
		"聊天记录里的公式缩进在聊天记录之后落定",
		formatNoteText(
			["张三 2024/1/5 14:30:25", "$$a \\\\", "b$$"].join("\n"),
			{ ...ALL, blockSort: false, tags: null }
		),
		["张三: 2024/01/05 14:30:25", `${T}$$a \\\\`, `${T}${T}b$$`].join("\n")
	);

	// 公式整块当锚点：板块排序不会把多行公式拆开搬走，也不越过它排序
	check(
		"多行公式不被板块排序拆散",
		formatNoteText(
			["香蕉", "", "$$a \\\\", "b$$", "", "梨", "", "橙子"].join("\n"),
			{ ...ALL, tags: null }
		),
		["香蕉", "", "$$a \\\\", `${T}b$$`, "", "橙子", "", "梨"].join("\n")
	);
}

// ------------------------------------------------------------ 3. 开关生效
function switchTests(): void {
	// 「行首缩进修复」是文本排版的总开关：关闭后标记也不再规范化
	check(
		"关闭行首缩进修复：标记排版一并停用",
		formatNoteText(" >引用", { ...BASE, leadingIndent: "off" }),
		" >引用"
	);
	// 但标签排版是独立开关，照样生效（只跟着自己那个设置走）
	check(
		"关闭行首缩进修复：标签排版照常",
		formatNoteText("#标签 内容", { ...BASE, leadingIndent: "off", tags: { sort: true } }),
		"内容 #标签"
	);
	// 标签排版关闭时不碰标签，其它步骤照常
	check(
		"关闭标签排版：标签不动，缩进照修",
		formatNoteText([" #标签 内容", ` ${T}正文`].join("\n"), BASE),
		["#标签 内容", `${T}正文`].join("\n")
	);
	// 标签排序关闭：标签归位但顺序不变
	check(
		"关闭标签排序：归位但保持原顺序",
		formatNoteText("#数学 #笔记 内容", { ...BASE, tags: { sort: false } }),
		"内容 #数学 #笔记"
	);
}

// ------------------------------------------------------------ 4. 安全与幂等
function safetyTests(): void {
	// 全开也不能碰 frontmatter 与代码块
	const guarded = [
		"---",
		"tags:",
		`${sp(2)}- 标签一`,
		"---",
		"```sh",
		"#标签 注释",
		" >引用",
		"---",
		"```",
		"",
		"#标签 正文",
	].join("\n");
	check(
		"全开：frontmatter 与代码块不动",
		formatNoteText(guarded, ALL),
		[
			"---",
			"tags:",
			`${sp(2)}- 标签一`,
			"---",
			"```sh",
			"#标签 注释",
			" >引用",
			"---",
			"```",
			"",
			"正文 #标签",
		].join("\n")
	);
}

function idempotencyTests(): void {
	const inputs: string[] = [
		" >#标签 引用内容",
		["#标签 第一行", "第二行", "", "-    项目 #标签", "", "##   标题"].join("\n"),
		["张三 2024/1/5 14:30:25", "#灵感 今天很开心", "", "李四 2024/1/5 14:31:02", "在的"].join("\n"),
		["---", "tags:", `${sp(2)}- a`, "---", "", "香蕉", "", "苹果", "", "```", "#标签 x", "```"].join("\n"),
		["> 引用甲 #标签", "", "| #b a | #d c |", "| --- | --- |", "| #b a | #d c |"].join("\n"),
		["- 香蕉", `${sp(2)}- 子项`, "- 苹果", "", "#标签 段落", "", "香蕉段"].join("\n"),
		["说明 $a_{n-1}=b$：$$", `${T}${T}x=1\\le y$$`, "", "香蕉", "", "苹果"].join("\n"),
		["$$a \\\\", "b$$ 后面的正文 #标签"].join("\n"),
	];
	const combos: TextPipelineOptions[] = [
		BASE,
		{ ...BASE, tags: { sort: true } },
		{ ...BASE, tags: { sort: false } },
		{ ...BASE, mathLayout: true },
		{ ...BASE, tags: { sort: true }, blockSort: true },
		{ ...BASE, mathLayout: true, tags: { sort: true }, blockSort: true },
		{ ...BASE, leadingIndent: "strict", mathLayout: true, tags: { sort: true }, blockSort: true },
		{ ...BASE, leadingIndent: "off", mathLayout: true, tags: { sort: true }, blockSort: true },
		{ ...BASE, chat: { ...DEFAULT_CHAT_LOG_OPTIONS, showUsername: false, indent: resolveIndent("none") }, mathLayout: true, tags: { sort: true }, blockSort: true },
	];

	for (const options of combos) {
		for (const input of inputs) {
			const once = formatNoteText(input, options);
			const twice = formatNoteText(once, options);
			checkTrue(
				`幂等失败 [indent=${options.leadingIndent} tags=${options.tags ? options.tags.sort : "off"} sort=${options.blockSort}]`,
				once === twice,
				`  一次 ${show(once)}\n  二次 ${show(twice)}`
			);
		}
	}
	console.log(`流水线幂等：${combos.length} 种组合 × ${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 各步骤串起来 ===");
pipelineTests();

console.log("=== 2. 顺序约束 ===");
orderTests();

console.log("=== 3. 开关生效 ===");
switchTests();

console.log("=== 4. 安全与幂等 ===");
safetyTests();
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
