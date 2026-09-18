/**
 * 命令注册审计
 *
 * 运行：npm test
 *
 * 右键菜单与命令面板是同一批操作的两个入口，任何"菜单里有、命令面板里没有"的操作
 * 都是漏注册。这里把插件真的 onload 一遍，再抓下它注册的命令与右键菜单结构对照：
 *
 *   1. 命令 ID 固定 —— 改名或删除会立刻失败（命令 ID 是已发布版本的稳定接口）
 *   2. 菜单里的每个操作都能在命令表里找到；命令表里的每条命令都真的注册了
 *   3. 两条子菜单路径行为一致 —— 原生 setSubmenu（右侧画 › 箭头）与旧版退化路径
 */
import { Menu, MenuItem, TFile } from "obsidian";
import type { App, PluginManifest } from "obsidian";
import ImageTransferPlugin from "../src/main";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

function checkList(name: string, actual: string[], expected: string[]): void {
	checks++;
	if (actual.join(" | ") !== expected.join(" | ")) {
		failures.push(`[列表不符] ${name}\n  期望 ${expected.join(" | ")}\n  实际 ${actual.join(" | ")}`);
	}
}

// ---------------------------------------------------------------- 测试替身类型
/** 替身 MenuItem 记录下来的字段（真实 MenuItem 没有 title / clickHandler） */
interface StubMenuItem {
	title: string;
	submenu?: StubMenu;
	clickHandler: ((evt: { clientX: number; clientY: number }) => void) | null;
}

interface StubMenu {
	items: StubMenuItem[];
}

interface StubMenuCtor {
	new (): StubMenu;
	created: StubMenu[];
}

interface RecordedCommand {
	id: string;
	name: string;
}

interface RecordedPlugin {
	commands: RecordedCommand[];
	settingTabs: unknown[];
}

type FileMenuHandler = (menu: StubMenu, file: TFile) => void;

const MenuCtor = Menu as unknown as StubMenuCtor;
const MenuItemPrototype = (MenuItem as unknown as { prototype: { setSubmenu?: () => StubMenu } }).prototype;

// -------------------------------------------------------------- 操作 ↔ 命令表
/**
 * 右键菜单操作 → 命令 ID。
 * 菜单里出现、这张表里没有的标题 = 漏注册命令（测试会失败）。
 */
const OPERATIONS: Array<{ menu: RegExp; commands: string[] }> = [
	{
		menu: /^转换.*的外部图片$/,
		commands: ["transfer-images-current-note", "transfer-images-entire-vault"],
	},
	{
		menu: /^重命名.*的乱码图片$/,
		commands: ["rename-garbled-images-current-note", "rename-garbled-images-entire-vault"],
	},
	{
		menu: /^将.*的所有图片重命名为预设格式$/,
		commands: ["rename-all-images-entire-vault"],
	},
	{
		menu: /^强制将.*的所有图片重命名为预设格式$/,
		commands: ["force-rename-all-images-entire-vault"],
	},
	{
		menu: /^整理.*图片位置$/,
		commands: ["organize-images-current-note", "organize-images-entire-vault"],
	},
	{
		menu: /^设置.*图片的大小$/,
		commands: ["set-image-size-current-note", "set-image-size-entire-vault"],
	},
	{
		menu: /^修复.*的聊天记录排版$/,
		commands: ["format-chat-log-current-note", "format-chat-log-entire-vault"],
	},
];

// ------------------------------------------------------------------ 辅助构造
function createApp(): { app: App; handlers: Map<string, FileMenuHandler[]> } {
	const handlers = new Map<string, FileMenuHandler[]>();
	const app = {
		vault: {
			getMarkdownFiles: (): TFile[] => [],
			getFiles: (): TFile[] => [],
			getAbstractFileByPath: (): null => null,
			read: async (): Promise<string> => "",
			modify: async (): Promise<void> => undefined,
			createBinary: async (): Promise<unknown> => ({}),
		},
		workspace: {
			on: (event: string, callback: FileMenuHandler) => {
				const list = handlers.get(event) ?? [];
				list.push(callback);
				handlers.set(event, list);
				return { event };
			},
		},
		fileManager: { renameFile: async (): Promise<void> => undefined },
	} as unknown as App;
	return { app, handlers };
}

async function loadPlugin(): Promise<{ plugin: RecordedPlugin; handlers: Map<string, FileMenuHandler[]> }> {
	const { app, handlers } = createApp();
	const manifest = { id: "absolute-image-transfer", name: "test", version: "0.0.0" } as PluginManifest;
	const plugin = new ImageTransferPlugin(app, manifest);
	await plugin.onload();
	return { plugin: plugin as unknown as RecordedPlugin, handlers };
}

/** 触发一次文件右键菜单，取出顶层入口与二级菜单里的操作 */
function collectMenus(handlers: Map<string, FileMenuHandler[]>): { titles: string[]; leaves: string[] } {
	const menu = new Menu() as unknown as StubMenu;
	MenuCtor.created.length = 0;

	const file = Object.assign(new TFile(), { extension: "md", name: "测试.md", path: "测试.md" });
	for (const handler of handlers.get("file-menu") ?? []) handler(menu, file);

	const titles: string[] = [];
	const leaves: string[] = [];
	for (const entry of menu.items) {
		titles.push(entry.title);
		if (entry.submenu) {
			// 原生子菜单：build() 的结果直接挂在菜单项上
			for (const leaf of entry.submenu.items) leaves.push(leaf.title);
			continue;
		}
		// 退化路径：子菜单在点击时才创建
		const before = MenuCtor.created.length;
		entry.clickHandler?.({ clientX: 0, clientY: 0 });
		for (const submenu of MenuCtor.created.slice(before)) {
			for (const leaf of submenu.items) leaves.push(leaf.title);
		}
	}
	return { titles, leaves };
}

/** 菜单操作是否与 OPERATIONS 表双向对应 */
function checkOperations(label: string, leaves: string[]): void {
	const matched = new Set<number>();
	for (const title of leaves) {
		const hits = OPERATIONS.map((op, index) => (op.menu.test(title) ? index : -1)).filter(index => index >= 0);
		if (hits.length !== 1) {
			checkTrue(
				`${label}：菜单项已登记`,
				false,
				`菜单里有「${title}」，审计表 OPERATIONS 匹配到 ${hits.length} 条（应为 1 条）`
			);
			continue;
		}
		matched.add(hits[0] as number);
	}
	for (let i = 0; i < OPERATIONS.length; i++) {
		const op = OPERATIONS[i];
		if (!op) continue;
		checkTrue(
			`${label}：操作出现在菜单里`,
			matched.has(i),
			`审计表里的 ${op.menu} 在右键菜单里找不到`
		);
	}
	checkTrue(`${label}：菜单项数量`, leaves.length === OPERATIONS.length, `期望 ${OPERATIONS.length} 项，实际 ${leaves.length} 项`);
}

// -------------------------------------------------------------------- 审计
async function audit(): Promise<void> {
	const { plugin, handlers } = await loadPlugin();

	// ---- 1. 命令 ID 与注册情况 ----
	const registered = plugin.commands.map(command => command.id);
	checkTrue("命令 ID 不重复", new Set(registered).size === registered.length, `出现重复：${registered.join(", ")}`);

	const expected = OPERATIONS.flatMap(op => op.commands);
	for (const id of expected) {
		checkTrue(`命令已注册：${id}`, registered.includes(id), `审计表里的 ${id} 没有被 addCommand 注册`);
	}
	for (const id of registered) {
		checkTrue(
			`命令已登记审计表：${id}`,
			expected.includes(id),
			`${id} 没有登记在本文件的 OPERATIONS 表里，请补上它对应的菜单操作`
		);
	}

	// ---- 2. 原生子菜单路径（Obsidian 自带，右侧 › 箭头） ----
	const native = collectMenus(handlers);
	checkList("原生子菜单：顶层入口", native.titles, ["图片功能", "文本排版"]);
	checkOperations("原生子菜单", native.leaves);

	// ---- 3. 拿不到 setSubmenu 时的退化路径 ----
	const savedSetSubmenu = MenuItemPrototype.setSubmenu;
	delete MenuItemPrototype.setSubmenu;
	try {
		const fallback = collectMenus(handlers);
		checkList("退化路径：顶层入口", fallback.titles, ["图片功能 ›", "文本排版 ›"]);
		checkOperations("退化路径", fallback.leaves);
		checkTrue(
			"两条子菜单路径的操作一致",
			fallback.leaves.join("|") === native.leaves.join("|"),
			`原生 ${native.leaves.join(" | ")}\n退化 ${fallback.leaves.join(" | ")}`
		);
	} finally {
		MenuItemPrototype.setSubmenu = savedSetSubmenu;
	}

	// ---- 4. 其他入口 ----
	checkTrue("设置面板已注册", plugin.settingTabs.length === 1, `实际注册 ${plugin.settingTabs.length} 个`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 命令注册审计 ===");
await audit();

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
