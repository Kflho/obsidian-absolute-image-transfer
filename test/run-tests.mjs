/**
 * 测试运行器：用 esbuild 把 test/ 下的测试打包成 ESM 后在当前进程内执行。
 * 这样测试无需任何测试框架，也不受 Node 版本对 TypeScript 支持程度的限制。
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const entryPoints = [
	"test/chat-log.test.ts",
	"test/text-layout.test.ts",
	"test/image-size.test.ts",
	"test/image-organizer.test.ts",
	"test/commands.test.ts",
];
const outdir = path.resolve("test/.build");

fs.rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
	entryPoints,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	outdir,
	outExtension: { ".js": ".mjs" },
	// 纯逻辑模块里的 instanceof TFile 等判断需要真实的类，这里换成测试替身
	alias: { obsidian: path.resolve("test/obsidian-stub.mjs") },
	logLevel: "warning",
});

for (const entry of entryPoints) {
	const outfile = path.join(outdir, path.basename(entry).replace(/\.ts$/, ".mjs"));
	console.log(`\n──────── ${path.basename(entry)} ────────`);
	await import(pathToFileURL(outfile).href);
}
