/**
 * "按首字母排序"用的比较器（纯函数，不依赖 Obsidian API）。
 *
 * 用 `Intl.Collator` 而不是 `<` 直接比字符：
 * - 中文按**拼音**排（`阿` < `波` < `词`），这是用户说"首字母"时的预期；
 *   JS 的 `<` 比的是 UTF-16 码位，中文会排成笔画/编码序，不是拼音序；
 * - 数字按**数值**排（`第2条` < `第10条`），否则会排成 `第10条` < `第2条`；
 * - 大小写、全半角不敏感（`Apple` 与 `apple` 视为同级，靠稳定排序保持原有先后）。
 *
 * 环境缺少中文排序数据时（极老的运行时）退回到默认 Collator，仍能正确排英文与数字。
 */

/** 中文优先、英文兜底的排序器；数字按数值比较 */
function createCollator(): Intl.Collator {
	const options: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
	try {
		return new Intl.Collator(['zh-Hans-CN', 'zh', 'en'], options);
	} catch {
		try {
			return new Intl.Collator(undefined, options);
		} catch {
			return new Intl.Collator();
		}
	}
}

const collator = createCollator();

/**
 * 比较两段文本的"首字母"顺序。
 *
 * @returns 负数表示 a 应排在 b 前面，0 表示两者同级（调用方靠稳定排序保持原顺序）
 */
export function compareByFirstLetter(a: string, b: string): number {
	return collator.compare(a, b);
}
