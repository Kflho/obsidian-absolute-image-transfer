/**
 * 文本排版流水线：把各个纯函数排版步骤按固定顺序串起来。
 *
 * 顺序不是随便定的：
 * 1. **行首缩进**（text-layout.ts）—— 必须排在聊天记录排版**前面**。
 *    聊天记录排版会按「正文缩进」设置重新缩进每条消息的正文，
 *    放后面会把用户设置的"2/4 个空格缩进"又改成 Tab。
 * 2. **标记排版**（markdown-markers.ts）—— 排在标签排版前面，
 *    这样标签排版拿到的引用前缀已经是规范形态（`> `），缩进也不会再来回改。
 * 3. **聊天记录排版**（chat-log.ts）—— 认内容，重排每条消息的头部与正文。
 * 4. **公式排版**（latex-layout.ts）—— 排在聊天记录**后面**：
 *    聊天记录排版会把正文行重新缩进，公式的多行缩进必须在它之后才定下来。
 * 5. **标签排版**（tags.ts）—— 排在聊天记录**后面**，
 *    聊天记录的正文行已经被重新缩进过，标签归位不会再被缩进修复挪动；
 *    `$$…$$` 公式整体跳过，`\textcolor{#fff}{…}` 里的 `#fff` 不会被当成标签。
 * 6. **内容板块排序**（block-sort.ts）—— 放最后：标签已经归位到块尾，
 *    排序键取的是块首的正文，不会受标签位置影响；公式整块当锚点，不会被拆散。
 *
 * 每一步都是幂等的纯函数，整条流水线因此也幂等：同一篇笔记连跑两次，
 * 第二次不会有任何改动，也就不会反复写盘。
 */
import { fixLeadingIndent } from './text-layout';
import type { LeadingIndentMode } from './text-layout';
import { fixBlockMarkers } from './markdown-markers';
import { formatChatLog } from './chat-log';
import type { ChatLogOptions } from './chat-log';
import { formatDisplayMath } from './latex-layout';
import { formatTags } from './tags';
import type { TagLayoutOptions } from './tags';
import { sortContentBlocks } from './block-sort';

export interface TextPipelineOptions {
	/** 行首缩进修复力度；`off` 时连标记排版一起停用 */
	leadingIndent: LeadingIndentMode;
	/** 聊天记录排版选项 */
	chat: ChatLogOptions;
	/** 是否整理 `$$…$$` 公式排版 */
	mathLayout: boolean;
	/** 标签排版选项；关闭时传 null */
	tags: TagLayoutOptions | null;
	/** 是否按首字母给内容块排序 */
	blockSort: boolean;
}

/**
 * 修复一篇笔记的排版。
 *
 * @param raw 笔记原文
 * @param options 各步骤的选项（由插件设置转换而来）
 * @returns 排版后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function formatNoteText(raw: string, options: TextPipelineOptions): string {
	if (raw === '') return raw;

	let content = fixLeadingIndent(raw, options.leadingIndent);
	// 「行首缩进修复」关掉时整块文本排版都停用，用户拿它当总开关
	if (options.leadingIndent !== 'off') content = fixBlockMarkers(content);
	content = formatChatLog(content, options.chat);
	if (options.mathLayout) content = formatDisplayMath(content);
	if (options.tags) content = formatTags(content, options.tags);
	if (options.blockSort) content = sortContentBlocks(content);

	return content;
}
