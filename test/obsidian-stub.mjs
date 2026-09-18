/**
 * 测试用的 obsidian 模块替身。
 *
 * 测试运行器（test/run-tests.mjs）通过 esbuild 的 alias 把 `obsidian` 指到这里，
 * 这样源码里的 `instanceof TFile` 等判断在 Node 下也能成立。
 *
 * 除纯逻辑模块用到的那一小部分 API 外，这里还实现了 Plugin / Menu / MenuItem 的
 * 最小可用版本（记录注册结果），供 test/commands.test.ts 审计命令注册情况：
 * 插件真的 onload 一遍，再看它注册了哪些命令、右键菜单里有哪些操作。
 */

export class TAbstractFile {}
export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class App {}
export class Component {}

/** 菜单项替身：只保留插件用到的方法，外加记录标题与点击回调 */
export class MenuItem {
	constructor(menu) {
		this.menu = menu;
		this.title = '';
		this.icon = null;
		this.section = '';
		this.clickHandler = null;
	}
	setTitle(title) {
		this.title = title;
		return this;
	}
	setIcon(icon) {
		this.icon = icon;
		return this;
	}
	setChecked() { return this; }
	setDisabled() { return this; }
	setWarning() { return this; }
	setIsLabel() { return this; }
	setSection(section) {
		this.section = section;
		return this;
	}
	onClick(callback) {
		this.clickHandler = callback;
		return this;
	}
	/**
	 * 真实 Obsidian 里 MenuItem.setSubmenu() 创建原生子菜单（菜单项右侧画 › 箭头）。
	 * 它没有写进公开类型定义，所以这里照样提供，用来覆盖插件的原生子菜单分支。
	 */
	setSubmenu() {
		this.submenu = new Menu();
		return this.submenu;
	}
}

/** 菜单替身：addItem 立刻执行回调，把结果记进 items（Menu.created 保留全部实例） */
export class Menu {
	constructor() {
		this.items = [];
		this.parentMenu = null;
		Menu.created.push(this);
	}
	addItem(build) {
		const item = new MenuItem(this);
		build(item);
		this.items.push(item);
		return item;
	}
	addSeparator() { return this; }
	showAtMouseEvent() { return this; }
	showAtPosition() { return this; }
	hide() { return this; }
	close() { return this; }
	onHide() { return this; }
}
Menu.created = [];

export class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = { empty() {}, createEl() {}, createDiv() {} };
	}
	open() {}
	close() {}
}

/** 通知替身：只记录消息，便于断言"操作结果有提示" */
export class Notice {
	constructor(message) {
		this.message = message;
		Notice.messages.push(message);
	}
}
Notice.messages = [];

export class Setting {}
export class PluginSettingTab {}

/** 插件基类替身：记录 addCommand / addStatusBarItem / addSettingTab 的结果 */
export class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
		this.commands = [];
		this.settingTabs = [];
		this.statusBarItems = [];
		this.events = [];
	}
	addCommand(command) {
		this.commands.push(command);
		return command;
	}
	addStatusBarItem() {
		const el = { setText() {}, addClass() {}, removeClass() {}, setAttribute() {} };
		this.statusBarItems.push(el);
		return el;
	}
	addSettingTab(tab) {
		this.settingTabs.push(tab);
	}
	registerEvent(event) {
		this.events.push(event);
	}
	registerDomEvent() {}
	registerInterval() {}
	register() {}
	async loadData() { return null; }
	async saveData() {}
}

export const Platform = { isWin: true, isMacOS: false, isLinux: false, isMobile: false, isDesktop: true };

export function normalizePath(p) {
	return p;
}
