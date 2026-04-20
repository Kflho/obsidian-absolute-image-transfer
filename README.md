# Obsidian Absolute Image Transfer (绝对路径图片转换器)

这是一个专为 Obsidian 打造的本地图片本地化插件。

当你从其他软件（如 QQ、微信、Typora 等）导出或复制 Markdown 笔记到 Obsidian 时，图片链接往往是外部的绝对物理路径（例如 `![](file:///D:\Images\test.png)`）。这会导致笔记在跨设备同步时图片全部失效（死链）。

本插件完美解决了这个痛点：**一键将笔记中的外部物理图片提取、复制到你的 Obsidian 仓库中，并自动转换为原生的双链格式。**

## ✨ 核心特性

- **一键提取与转换**：自动解析形如 `file:///` 或 `C:\` 的本地物理图片路径，将图片物理搬运至仓库内，并将链接转为 `![[Pasted image 2026xxxx.png]]`。
- **智能附件目录**：自动在当前笔记的同级目录下寻找或创建 `Attachments` 文件夹来存放图片，保持仓库整洁。
- **强大的极端命名兼容 (Hardcore Edge Cases)**：
  - 完美兼容路径中的空格及中文字符。
  - **独家防弹设计**：完美解析包含乱码、 `%` 号混淆、甚至带有半角括号 `()` `{}` 的变态文件名（如 QQ 生成的复杂图片名），自动剥离 Obsidian 强加的转义符 `\`。
- **无损防冲突机制**：采用时间戳（YYYYMMDDHHmmss）对图片进行标准化重命名，若遇到同秒并发，自动顺延探测，绝不覆盖已有文件。

## 🚀 快速使用

插件提供了多种灵活的使用方式，满足不同场景的需求：

### 1. 快捷键 & 命令面板
- 打开一篇包含绝对路径图片的笔记。
- 按下默认快捷键 **`Alt + P`**（支持在设置中自定义）。
- 或使用 `Ctrl/Cmd + P` 呼出命令面板，搜索 `Transfer local images in current note` 并执行。

### 2. 右键菜单 (Context Menu) 最强推荐！
- **处理单篇笔记**：在左侧文件树中，右键点击任意 `.md` 文件，选择 `转换该文件内的本地图片`。
- **批量处理文件夹**：右键点击任意文件夹，选择 `转换该文件夹内所有本地图片`，插件将自动遍历该文件夹及所有子文件夹，一键完成海量笔记的图片迁移！

### 3. 全局暴力洗地
- 在命令面板中执行 `Transfer ALL local images in vault (Batch)`，一键处理整个仓库中的所有笔记。

## 📸 转换效果演示

**转换前 (外部脆弱链接):**
```markdown
这里是一段笔记内容。
![](file:///D:\QQ_Data\Tencent%20Files\Image\58`7R\(F{BB37HFZ7$@FL%_H.png)
```

**转换后 (Obsidian 原生双链):**
```markdown
这里是一段笔记内容。
![[Pasted image 20260420123045.png]]
```
*(同时图片已被安全地复制到了当前目录的 `Attachments` 文件夹中)*

## 📦 安装说明

### 手动安装
1. 从本仓库的 [Releases](../../releases) 页面下载最新版本的 `main.js` 和 `manifest.json`。
2. 在你的 Obsidian 仓库中，进入 `.obsidian/plugins/` 目录。
3. 新建一个名为 `obsidian-absolute-image-transfer` 的文件夹。
4. 将下载的两个文件放入该文件夹中。
5. 重启 Obsidian，在设置 -> 第三方插件中关闭安全模式，并启用本插件。

### 使用 BRAT 安装 (推荐测试版用户)
1. 安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件。
2. 在 BRAT 设置中点击 `Add Beta plugin`。
3. 输入本仓库的地址：`KFLhoTAT/obsidian-absolute-image-transfer`。
4. 在 Obsidian 插件列表中启用它。

## ⚠️ 注意事项

- 转换过程会真实读取你电脑硬盘上的图片文件。如果原始图片在转换前已经被你从硬盘上删除，插件将跳过该链接并在控制台输出警告。
- 建议在执行全局批量处理 (`Transfer ALL local images in vault`) 之前，先使用 Git 或 Obsidian 的同步功能备份您的仓库，以防万一。

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。欢迎提交 Issue 或 Pull Request！