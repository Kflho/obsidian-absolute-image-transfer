/**
 * 测试用的 obsidian 模块替身。
 *
 * 测试运行器（test/run-tests.mjs）通过 esbuild 的 alias 把 `obsidian` 指到这里，
 * 这样源码里的 `instanceof TFile` 等判断在 Node 下也能成立。
 * 只实现纯逻辑模块真正用到的那一小部分 API。
 */

export class TAbstractFile {}
export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class App {}
export class Plugin {}
export class Component {}
export class Modal {}
export class Notice {}
export class Setting {}
export class PluginSettingTab {}
export class Menu {}

export const Platform = { isWin: true, isMacOS: false, isLinux: false, isMobile: false, isDesktop: true };

export function normalizePath(p) {
	return p;
}
