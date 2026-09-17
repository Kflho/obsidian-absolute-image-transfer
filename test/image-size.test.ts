/**
 * 图片尺寸引擎测试
 *
 * 运行：npm test
 *
 * 重点保证：
 *   1. 各种写法（宽 / 宽x高 / 移除 / 片段 / Markdown 图片 / 大小写扩展名）改写正确
 *   2. 幂等 —— 尺寸已经正确时 changed 为 0，内容一字不变
 *   3. 安全 —— 非图片链接、含说明文字的别名、未开启覆盖时一律不碰
 */
import { applyImageSize, toSizeString, validateImageSize } from "../src/image-size";
import type { ImageSizeOptions } from "../src/image-size";

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

function checkEqual(name: string, actual: number | string, expected: number | string): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[数值不符] ${name}\n  期望 ${expected}\n  实际 ${actual}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

// ---------------------------------------------------------------- 辅助构造
function size(width: string, height = "", overwriteExisting = true): ImageSizeOptions {
	return { width, height, overwriteExisting };
}

/** 改写并断言结果与改动数 */
function expectRewrite(name: string, input: string, options: ImageSizeOptions, expected: string, changed = 1): void {
	const result = applyImageSize(input, options);
	check(name, result.content, expected);
	checkEqual(`${name} (改动数)`, result.changed, changed);
}

// ------------------------------------------------------------ 1. 双链嵌入
function wikiTests(): void {
	// 补尺寸
	expectRewrite("补宽度", "![[图片.png]]", size("100"), "![[图片.png|100]]");
	expectRewrite("补宽高", "![[图片.png]]", size("100", "200"), "![[图片.png|100x200]]");
	expectRewrite("带路径", "![[附件/图片.png]]", size("100"), "![[附件/图片.png|100]]");
	expectRewrite("文件名含点", "![[我.的.图.png]]", size("100"), "![[我.的.图.png|100]]");

	// 覆盖已有尺寸
	expectRewrite("覆盖已有宽度", "![[图片.png|300]]", size("100"), "![[图片.png|100]]");
	expectRewrite("覆盖已有宽高", "![[图片.png|300x200]]", size("100", "200"), "![[图片.png|100x200]]");
	expectRewrite("宽高改成纯宽度", "![[图片.png|300x200]]", size("100"), "![[图片.png|100]]");

	// 保留 #片段
	expectRewrite("保留片段", "![[图片.png#outline]]", size("100"), "![[图片.png#outline|100]]");
	expectRewrite("片段加已有尺寸", "![[图片.png#outline|300]]", size("100"), "![[图片.png#outline|100]]");

	// 大小写扩展名
	expectRewrite("大写扩展名", "![[照片.JPG]]", size("100"), "![[照片.JPG|100]]");
	expectRewrite("混合大小写", "![[照片.PnG]]", size("100"), "![[照片.PnG|100]]");

	// 各种扩展名
	for (const ext of ["png", "jpg", "jpeg", "gif", "bmp", "webp", "heic", "avif", "svg"]) {
		expectRewrite(`扩展名 ${ext}`, `![[图.${ext}]]`, size("100"), `![[图.${ext}|100]]`);
	}

	// 移除尺寸
	expectRewrite("移除已有尺寸", "![[图片.png|300]]", size(""), "![[图片.png]]");
	expectRewrite("移除宽高", "![[图片.png|300x200]]", size(""), "![[图片.png]]");
	expectRewrite("清掉空别名", "![[图片.png|]]", size(""), "![[图片.png]]");

	// 多张图片混在一行
	expectRewrite(
		"一行多张",
		"![[a.png]] 和 ![[b.png|50]]",
		size("100"),
		"![[a.png|100]] 和 ![[b.png|100]]",
		2
	);

	// 段落中的图片
	expectRewrite(
		"段落中的图片",
		"前面文字\n\n![[图.png]]\n\n后面文字\n",
		size("144"),
		"前面文字\n\n![[图.png|144]]\n\n后面文字\n"
	);
}

// -------------------------------------------------------------------- 2. 安全
function safetyTests(): void {
	// 别名是说明文字：原样保留
	const alt = applyImageSize("![[图片.png|一张风景照]]", size("100"));
	check("保留说明文字", alt.content, "![[图片.png|一张风景照]]");
	checkEqual("保留说明文字 (改动数)", alt.changed, 0);
	checkEqual("保留说明文字 (跳过数)", alt.skipped, 1);

	// 关闭覆盖：只补缺
	expectRewrite("关闭覆盖_补缺", "![[a.png]]\n![[b.png|300]]", size("100", "", false), "![[a.png|100]]\n![[b.png|300]]");

	// 非图片链接完全不处理
	for (const link of ["![[笔记.md]]", "![[文档.pdf]]", "![[音频.mp3]]", "[[普通链接]]", "![[没有扩展名]]"]) {
		const result = applyImageSize(link, size("100"));
		check(`非图片不处理 ${link}`, result.content, link);
		checkEqual(`非图片改动数 ${link}`, result.changed, 0);
		checkEqual(`非图片跳过数 ${link}`, result.skipped, 0);
	}

	// 图片名里出现类似扩展名的片段但不是结尾
	const fake = applyImageSize("![[a.png.bak]]", size("100"));
	check("非图片结尾不处理", fake.content, "![[a.png.bak]]");

	// 行内 Markdown 图片的 alt 槽位有文字 → 按设计跳过，保住文字
	const inline = applyImageSize("文字 ![示意](https://x.com/a.png) 结束", size("100"));
	check("行内 Markdown 图片保留 alt", inline.content, "文字 ![示意](https://x.com/a.png) 结束");
	checkEqual("行内 Markdown 图片跳过数", inline.skipped, 1);

	// 没有 alt 文字时正常改写
	expectRewrite("行内 Markdown 无 alt", "文字 ![](https://x.com/a.png) 结束", size("100"), "文字 ![100](https://x.com/a.png) 结束");
}

// ------------------------------------------------------- 3. Markdown 图片
function markdownTests(): void {
	expectRewrite("Markdown 补尺寸", "![](https://x.com/a.png)", size("100"), "![100](https://x.com/a.png)");
	expectRewrite("Markdown 覆盖尺寸", "![300](https://x.com/a.png)", size("100"), "![100](https://x.com/a.png)");
	expectRewrite(
		"Markdown 保留查询串",
		"![](https://x.com/a.png?v=2)",
		size("100"),
		"![100](https://x.com/a.png?v=2)"
	);
	expectRewrite("Markdown 相对路径", "![](附件/a.jpg)", size("100"), "![100](附件/a.jpg)");
	expectRewrite("Markdown 移除尺寸", "![100](a.png)", size(""), "![](a.png)");

	// alt 槽位是文字 → 跳过
	const alt = applyImageSize("![一张风景照](a.png)", size("100"));
	check("Markdown 保留 alt", alt.content, "![一张风景照](a.png)");
	checkEqual("Markdown 保留 alt (跳过数)", alt.skipped, 1);

	// 非图片地址不处理
	const pdf = applyImageSize("![](文档.pdf)", size("100"));
	check("Markdown 非图片不处理", pdf.content, "![](文档.pdf)");
	checkEqual("Markdown 非图片改动数", pdf.changed, 0);
}

// ---------------------------------------------------------------- 4. 幂等
function idempotencyTests(): void {
	const INPUTS = [
		"![[a.png]]",
		"![[a.png|300]]",
		"![[a.png|300x200]]",
		"![[a.png#outline|300]]",
		"![[a.png|说明文字]]",
		"![[b.md]]",
		"![](url.png)",
		"![300](url.png)",
		"![文字](url.png)",
		"![[a.png]]\n\n![[b.jpg|50]]\n\n![](c.gif)",
		"没有图片的普通笔记",
	];

	const SIZES: ImageSizeOptions[] = [
		size("100"),
		size("100", "200"),
		size("100", "", false),
		size(""),
	];

	let worst = 0;
	for (const input of INPUTS) {
		for (const options of SIZES) {
			const once = applyImageSize(input, options);
			const twice = applyImageSize(once.content, options);
			const label = `${show(input)} [w=${options.width} h=${options.height} o=${options.overwriteExisting}]`;

			checkTrue(`幂等失败 ${label}`, twice.content === once.content, `  一次 ${show(once.content)}\n  二次 ${show(twice.content)}`);
			checkEqual(`二次仍有改动 ${label}`, twice.changed, 0);
			worst = Math.max(worst, once.changed);
		}
	}
	checkTrue("至少有一个用例真的改动了", worst > 0, "所有用例都没有产生改动，测试可能失效了");
}

// -------------------------------------------------------------- 5. 输入校验
function validationTests(): void {
	checkEqual("合法宽度", String(validateImageSize("100", "")), "null");
	checkEqual("合法宽高", String(validateImageSize("100", "200")), "null");
	checkEqual("全空表示移除", String(validateImageSize("", "")), "null");
	checkTrue("宽度非数字被拒绝", validateImageSize("abc", "") !== null, "abc 应当被拒绝");
	checkTrue("小数被拒绝", validateImageSize("10.5", "") !== null, "10.5 应当被拒绝");
	checkTrue("负数被拒绝", validateImageSize("-10", "") !== null, "-10 应当被拒绝");
	checkTrue("零被拒绝", validateImageSize("0", "") !== null, "0 应当被拒绝");
	checkTrue("只填高度被拒绝", validateImageSize("", "200") !== null, "只填高度应当被拒绝");
	checkTrue("高度非数字被拒绝", validateImageSize("100", "abc") !== null, "abc 应当被拒绝");

	checkEqual("尺寸字符串_宽", toSizeString("100", ""), "100");
	checkEqual("尺寸字符串_宽高", toSizeString("100", "200"), "100x200");
	checkEqual("尺寸字符串_空", toSizeString("", ""), "");
	checkEqual("尺寸字符串_去空格", toSizeString(" 100 ", " 200 "), "100x200");
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 双链嵌入 ===");
wikiTests();

console.log("=== 2. 安全边界 ===");
safetyTests();

console.log("=== 3. Markdown 图片 ===");
markdownTests();

console.log("=== 4. 幂等性 ===");
idempotencyTests();

console.log("=== 5. 输入校验 ===");
validationTests();

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
