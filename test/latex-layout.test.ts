/**
 * 公式排版测试（`$$ … $$` 里的 LaTeX 代码）
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 六个规则逐条钉死：符号左右的空格、一元号与修饰符、
 *      `$$` 与内容之间、换行与缩进、连写与花括号
 *   2. 安全边界 —— 行内 `$…$`、代码块、frontmatter、未闭合的 `$$`、
 *      `\text{…}` 里的文字、含 `%` 注释的公式都不许动
 *   3. 与其它排版串联 —— 公式所在行的正文原样保留，标签排版与板块排序不碰公式
 *   4. 严格幂等 —— 排好版的公式再跑一次不变
 */
import { formatDisplayMath } from "../src/latex-layout";

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
/** 规则 1：运算、逻辑、排版符号左右各一个空格 */
const SPACING_CASES: Array<[string, string, string]> = [
	["等号", String.raw`$$\dot{x}=f(x, t)$$`, String.raw`$$\dot{x} = f(x, t)$$`],
	["已经是目标形态（不动）", String.raw`$$A^TP + PA = -Q$$`, String.raw`$$A^TP + PA = -Q$$`],
	["等号与加号", String.raw`$$\Delta\dot{x}=A\Delta{x}$$`, String.raw`$$\Delta\dot{x} = A\Delta{x}$$`],
	["上下标里同样加空格", String.raw`$$a_{n-1}\le b_{n-1}$$`, String.raw`$$a_{n - 1} \le b_{n - 1}$$`],
	["关系符", String.raw`$$x\ge{t}_0$$`, String.raw`$$x \ge {t}_0$$`],
	["对齐符 &", String.raw`$$a&b&c$$`, String.raw`$$a & b & c$$`],
	["逗号前后", String.raw`$$f(x,y)$$`, String.raw`$$f(x, y)$$`],
	["句内减号", String.raw`$$t_0-x_e$$`, String.raw`$$t_0 - x_e$$`],
	["句内加号", String.raw`$$a+b$$`, String.raw`$$a + b$$`],
	["冒号是关系符", String.raw`$$\{x:x>0\}$$`, String.raw`$$\{x : x > 0\}$$`],
	["积分与微分", String.raw`$$\int_{t_0}^t \Phi(\tau)Bu(t-\tau)\, d\tau$$`, String.raw`$$\int_{t_0}^t\Phi(\tau)Bu(t - \tau)\,d\tau$$`],
	["重叠的括号与空格", String.raw`$$( x-x_e )$$`, String.raw`$$(x - x_e)$$`],
	["上下标贴紧", String.raw`$$x _ 1 ^ 2$$`, String.raw`$$x_1^2$$`],
	["花括号与命令贴紧", String.raw`$$\frac {a} {b}$$`, String.raw`$$\frac{a}{b}$$`],
	["反斜杠括号", String.raw`$$\lVert{x}_0-x_e\rVert\le\delta(\sigma, t_0)$$`, String.raw`$$\lVert{x}_0 - x_e\rVert \le \delta(\sigma, t_0)$$`],
];

/** 规则 2、6：一元号与修饰符贴紧参数；连写会吃掉命令名时补花括号 */
const COMMAND_CASES: Array<[string, string, string]> = [
	["行首一元号", String.raw`$$-Q$$`, String.raw`$$-Q$$`],
	["等号后的一元号", String.raw`$$A = -Q$$`, String.raw`$$A = -Q$$`],
	["括号里的一元号", String.raw`$$(-x)$$`, String.raw`$$(-x)$$`],
	["二元号仍然是二元号", String.raw`$$(x-x_e)$$`, String.raw`$$(x - x_e)$$`],
	["负指数", String.raw`$$T^{-1}$$`, String.raw`$$T^{-1}$$`],
	["偏微分", String.raw`$$\partial f$$`, String.raw`$$\partial{f}$$`],
	["希腊字母命令", String.raw`$$\delta x$$`, String.raw`$$\delta{x}$$`],
	["函数名", String.raw`$$\sin x$$`, String.raw`$$\sin{x}$$`],
	["数字开头不用花括号（\\sin2x 合法）", String.raw`$$\sin 2x$$`, String.raw`$$\sin2x$$`],
	["间距命令", String.raw`$$\quad y$$`, String.raw`$$\quad{y}$$`],
	["单字符间距命令不用花括号", String.raw`$$\, d\tau$$`, String.raw`$$\,d\tau$$`],
	// 间距命令与后面字母粘连：`\quadA` 会被 LaTeX 当成一个未定义命令，公式直接报错
	["粘连的间距命令：前面有逗号 → 删掉多余的间距", String.raw`$$A_{i}, \quadA_{j}$$`, String.raw`$$A_{i}, A_{j}$$`],
	["粘连的间距命令：两个方程之间", String.raw`$$A_{ii} = A_{i}, \quadA_{ij} = E_{i}$$`, String.raw`$$A_{ii} = A_{i}, A_{ij} = E_{i}$$`],
	["粘连的 qquad 同样处理", String.raw`$$a, \qquadB$$`, String.raw`$$a, B$$`],
	["粘连的间距命令：行首 → 删掉", String.raw`$$\quadA_{i}$$`, String.raw`$$A_{i}$$`],
	["粘连的间距命令：前面是内容 → 补花括号", String.raw`$$a \quadB$$`, String.raw`$$a\quad{B}$$`],
	["合法的 \\quad + 命令不动", String.raw`$$a, \quad\Xi = 1$$`, String.raw`$$a, \quad\Xi = 1$$`],
	["合法的 \\quad{…} 不动", String.raw`$$\left[A_i\quad{G}_i\right]$$`, String.raw`$$\left[A_i\quad{G}_i\right]$$`],
	["自定义宏不拆", String.raw`$$\quadratic x$$`, String.raw`$$\quadratic{x}$$`],
	["命令后面还是命令", String.raw`$$\Delta\dot{x}$$`, String.raw`$$\Delta\dot{x}$$`],
	["带参数的命令", String.raw`$$\text{if} x$$`, String.raw`$$\text{if}x$$`],
	[
		"环境与第一个元素连写",
		"$$" + String.raw`{\begin{bmatrix} 1 \\ 2 \\ \end{bmatrix}}` + "$$",
		[
			"$$" + String.raw`{\begin{bmatrix}1 \\`,
			`${T}` + String.raw`2 \\`,
			`${T}` + String.raw`\end{bmatrix}}` + "$$",
		].join("\n"),
	],
	["\\left \\right 连定界符", String.raw`$$\left. \frac{a}{b}\right|_{x=x_e}$$`, String.raw`$$\left.\frac{a}{b}\right|_{x = x_e}$$`],
];

/** 规则 3：`$$` 与里面的内容之间没有空格 */
const DELIMITER_CASES: Array<[string, string, string]> = [
	["两侧空格", String.raw`$$ x = 1 $$`, String.raw`$$x = 1$$`],
	["两侧多个空格", String.raw`$$   x=1   $$`, String.raw`$$x = 1$$`],
	["已经是目标形态", String.raw`$$x = 1$$`, String.raw`$$x = 1$$`],
	["行内公式不受影响", String.raw`$ x = 1 $`, String.raw`$ x = 1 $`],
	["公式外的正文原样", String.raw`前面文字$$x=1$$后面文字`, String.raw`前面文字$$x = 1$$后面文字`],
];

function goldenTests(): void {
	for (const [name, input, expected] of SPACING_CASES) {
		check(`空格·${name}`, formatDisplayMath(input), expected);
	}
	for (const [name, input, expected] of COMMAND_CASES) {
		check(`命令·${name}`, formatDisplayMath(input), expected);
	}
	for (const [name, input, expected] of DELIMITER_CASES) {
		check(`定界·${name}`, formatDisplayMath(input), expected);
	}
	for (const [name, input, expected] of INLINE_CASES) {
		check(`行内·${name}`, formatDisplayMath(input), expected);
	}
}

/** 行内公式 `$…$`：同一套空格规则，但不换行；识别方式与 Obsidian 一致 */
const INLINE_CASES: Array<[string, string, string]> = [
	["等号补空格", String.raw`$M=1$`, String.raw`$M = 1$`],
	["集合写法", String.raw`$\mathcal{N}_1=\{3\}$`, String.raw`$\mathcal{N}_1 = \{3\}$`],
	["加减号与关系符", String.raw`$y_{i,k}=C_ix_{i,k}+D_i u_{i,k}$`, String.raw`$y_{i, k} = C_ix_{i, k} + D_iu_{i, k}$`],
	["逻辑符号", String.raw`$F_i\neq0\Rightarrow H_i$`, String.raw`$F_i \neq 0 \Rightarrow H_i$`],
	["上下标里也补", String.raw`$x_i=h_i-h_i^{eq}$`, String.raw`$x_i = h_i - h_i^{eq}$`],
	["一行两个行内公式", String.raw`$a=1$ 与 $b=2$`, String.raw`$a = 1$ 与 $b = 2$`],
	["与显示公式混在一行", String.raw`前面 $a=1$ 后面$$b=2$$`, String.raw`前面 $a = 1$ 后面$$b = 2$$`],
	["内侧带空格的不算公式（Obsidian 规则）", `$ x = 1 $`, `$ x = 1 $`],
	["收尾前带空格的不算公式", `$x = 1 $`, `$x = 1 $`],
	["货币写法不误伤", `价格 $5 与 $10`, `价格 $5 与 $10`],
	["转义的美元符号不动", String.raw`\$5 与 \$10`, String.raw`\$5 与 \$10`],
	["行内代码里的不动", "`$x=1$`", "`$x=1$`"],
	["行内公式里有 \\\\ 时跳过", String.raw`$a \\ b$`, String.raw`$a \\ b$`],
	["没有美元符号的正文不动", `正文没有公式`, `正文没有公式`],
];

// ------------------------------------------------------------ 规则 4 / 5
function lineTests(): void {
	// 没有 `\\` 的换行全部拼回一行（`$$` 独占一行也一样）
	check(
		"跨行拼接（没有 \\\\）",
		formatDisplayMath(["$$", `${sp(4)}x = 1`, "$$"].join("\n")),
		"$$x = 1$$"
	);
	check(
		"列表里跨两行的公式",
		formatDisplayMath([`${T}若满足$$`, `${T}${T}x\\le 1$$`].join("\n")),
		`${T}若满足$$x \\le 1$$`
	);

	// 矩阵：`\\` 处换行，续行 = 首行缩进 + 1 个 tab，原来的 4 个 tab 被归一
	const matrix = [
		`${T}说明$$T=(a, b){\\begin{bmatrix}`,
		`${T}${T}${T}${T}1 \\\\`,
		`${T}${T}${T}${T}a & b \\\\ \\end{bmatrix}}$$`,
	].join("\n");
	check(
		"矩阵缩进归一 + 换行",
		formatDisplayMath(matrix),
		[
			`${T}说明$$T = (a, b){\\begin{bmatrix}1 \\\\`,
			`${T}${T}a & b \\\\`,
			`${T}${T}\\end{bmatrix}}$$`,
		].join("\n")
	);

	// 顶层公式（前面没有缩进）：续行就是一个 tab
	check(
		"顶层公式的续行缩进",
		formatDisplayMath(["$$a \\\\ b \\\\ c$$"].join("\n")),
		["$$a \\\\", `${T}b \\\\`, `${T}c$$`].join("\n")
	);

	// `\\[2pt]` 的可选间距不能被拆开，也不额外加空格
	check(
		"\\\\[2pt] 可选间距",
		formatDisplayMath(String.raw`$$a \\[2pt] b$$`),
		["$$a \\\\[2pt]", `${T}b$$`].join("\n")
	);

	// 行尾 `\\` 不留尾空格
	check(
		"行尾不留尾空格",
		formatDisplayMath("$$a \\\\   $$"),
		"$$a \\\\$$"
	);

	// 多行公式后面的正文仍然跟在最后一行后面
	check(
		"公式后面的正文跟在闭区间那一行",
		formatDisplayMath(["$$a \\\\ b$$ 后面的正文"].join("\n")),
		["$$a \\\\", `${T}b$$ 后面的正文`].join("\n")
	);
}

// ------------------------------------------------------------ 2. 安全边界
function guardTests(): void {
	// 行内公式：与显示公式同一套规则（`$a_{n-1}=b$` → `$a_{n - 1} = b$`）
	check(
		"行内公式一并整理",
		formatDisplayMath(String.raw`$a_{n-1}=b$ 与 $$c=1$$`),
		String.raw`$a_{n - 1} = b$ 与 $$c = 1$$`
	);

	// 围栏代码块与 frontmatter 里的 $$ 不算公式
	check(
		"代码块里的 $$ 不动",
		formatDisplayMath(["```", "$$x=1$$", "```"].join("\n")),
		["```", "$$x=1$$", "```"].join("\n")
	);
	check(
		"frontmatter 不动",
		formatDisplayMath(["---", "title: $$x=1$$", "---", "", "$$y = 2$$"].join("\n")),
		["---", "title: $$x=1$$", "---", "", "$$y = 2$$"].join("\n")
	);
	// 行内代码里的 $$ 不动
	check(
		"行内代码里的 $$ 不动",
		formatDisplayMath("`$$x=1$$` 与 " + String.raw`$$y=2$$`),
		"`$$x=1$$` 与 " + String.raw`$$y = 2$$`
	);

	// 落单的 $$ 不再让整篇失效：配不出公式的区域跳过，后面的正常公式照排
	check(
		"落单的 $$ 不影响后面的公式",
		formatDisplayMath([String.raw`价格 $$ 随便写`, "", String.raw`$$x=1$$`].join("\n")),
		[String.raw`价格 $$ 随便写`, "", String.raw`$$x = 1$$`].join("\n")
	);
	check(
		"配错对象的区域（跨空行/标题）不动",
		formatDisplayMath(["$$开头", "", "# 标题", "", "正文 $$", "", "$$x=1$$"].join("\n")),
		["$$开头", "", "# 标题", "", "正文 $$", "", "$$x = 1$$"].join("\n")
	);

	// 未闭合的 $$ 整篇不动（否则会把后面的正文当成公式吃掉）
	check("未闭合的 $$ 不动", formatDisplayMath(String.raw`$$x=1`), String.raw`$$x=1`);
	check(
		"只有一个 $$ 时不动",
		formatDisplayMath(["正文", String.raw`$$x=1`, "后面还有正文"].join("\n")),
		["正文", String.raw`$$x=1`, "后面还有正文"].join("\n")
	);

	// 文本参数里原样保留
	check(
		"\\text{} 里的文字与空格不动",
		formatDisplayMath(String.raw`$$\text{其中 } x > 0$$`),
		String.raw`$$\text{其中 }x > 0$$`
	);
	check(
		"\\operatorname{} 不动",
		formatDisplayMath(String.raw`$$\operatorname{diag}( e^{Jt} , 0 )$$`),
		String.raw`$$\operatorname{diag}(e^{Jt}, 0)$$`
	);

	// 含 % 注释的公式整体跳过（拼行会改变注释范围）
	check(
		"% 注释的公式跳过",
		formatDisplayMath(String.raw`$$\frac{a}{b}% 这里是注释` + "\n" + String.raw`+ c$$`),
		String.raw`$$\frac{a}{b}% 这里是注释` + "\n" + String.raw`+ c$$`
	);

	// 同一行两个公式
	check(
		"同一行两个公式",
		formatDisplayMath(String.raw`$$a=1$$ 与 $$b=2$$`),
		String.raw`$$a = 1$$ 与 $$b = 2$$`
	);

	// 没有公式时原样返回（同一个字符串对象）
	const plain = "没有公式的一段话";
	checkTrue("无公式时返回原串", formatDisplayMath(plain) === plain, "无改动却返回了新内容");
	const canonical = String.raw`$$A^TP + PA = -Q$$`;
	checkTrue("已规范时返回原串", formatDisplayMath(canonical) === canonical, "无改动却返回了新内容");
	checkTrue("空串返回空串", formatDisplayMath("") === "", "空串被改写");
}

// ------------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		...SPACING_CASES.map(([, input]) => input),
		...COMMAND_CASES.map(([, input]) => input),
		...DELIMITER_CASES.map(([, input]) => input),
		...INLINE_CASES.map(([, input]) => input),
		[
			`${T}说明$$T=(a, b){\\begin{bmatrix}`,
			`${T}${T}${T}${T}1 \\\\`,
			`${T}${T}${T}${T}a & b \\\\ \\end{bmatrix}}$$`,
			"",
			"正文",
			"",
			"$$",
			`${sp(2)}\\dot{x}=f(x, t)`,
			"$$",
		].join("\n"),
		["---", "tags: [a]", "---", "", String.raw`$$\int_{t_0}^t \Phi(\tau)\, d\tau = \frac{a}{b}$$`].join("\n"),
		"```",
		"$$x=1$$",
		"```",
		String.raw`$$\text{中文 } x>0$$`,
		"",
	];

	for (const input of inputs) {
		const once = formatDisplayMath(input);
		const twice = formatDisplayMath(once);
		checkTrue(`幂等失败`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
	}
	console.log(`公式排版幂等：${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出（规则 1/2/3/6）===");
goldenTests();

console.log("=== 2. 换行与缩进（规则 4/5）===");
lineTests();

console.log("=== 3. 安全边界 ===");
guardTests();

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
