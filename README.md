# 墨页 · 本地小说写作软件

一款**纯本地、轻量、不联网**的小说写作桌面软件。单 exe 仅约 2.4MB，所有稿件数据都存在你电脑上的 `data/` 文件夹，随手可带走，不上传任何云端。

![墨页主界面](docs/screenshot.png)

**作者：峻峻尼 · 版本：v1.2.1 · 开源协议：MIT**

## 特性

- **轻量桌面应用**：基于 [Neutralinojs](https://neutralino.js.org/) 封装，调用系统 WebView2 渲染，无需打包浏览器内核，安装包极小。
- **分卷 / 章节管理**：多作品、多分卷、多章节，支持拖拽排序，结构一目了然。
- **自动保存**：编辑即存（0.3~5s 可调），刷新、关机都不丢稿。
- **实时字数统计**：当前章节字数、全书总字数、今日码字目标与进度条。
- **写作习惯可视化**：写作热力图 + 近 14 天码字柱状图。
- **资料栏**：大纲 / 人物 / 设定 / 灵感 四栏笔记，随写随查。
- **素材卡片**：随手存梗、金句、设定碎片。
- **查找替换**：编辑器内全文查找、逐个 / 全部替换。
- **历史快照**：每 5 分钟自动留存一份快照（保留最近 30 个），可回退。
- **专注模式**：F11 一键沉浸写作。
- **多种导出**：全书 / 本章的 TXT、Markdown（保留粗体 / 斜体 / 标题层级），以及全部作品合并导出；JSON 备份与恢复。
- **三种主题**：宣纸 / 极简 / 夜间，护眼克制，不炫酷。

## 快速开始

### 一键安装（推荐）

1. 到 [Releases](../../releases) 下载 `moye-novel-setup.exe`。
2. 双击运行，按向导安装（默认装到当前用户 `AppData\Programs\墨页`，**无需管理员权限**）。
3. 安装完成后从**开始菜单 / 桌面快捷方式**启动即可，并自带卸载程序。

> 若被 Windows SmartScreen 拦截，点“更多信息”→“仍要运行”即可。本软件未做代码签名，属正常现象，不影响使用。

### 便携版（免安装）

1. 到 [Releases](../../releases) 下载 `moye-novel-win_x64.exe` 与同目录的 `resources.neu`。
2. 把 `墨页-win_x64.exe` 和 `resources.neu` 放在**同一个文件夹**里，双击 exe 即可。
3. 也可双击同目录的 `launch.bat` 启动（会先校验两个文件是否齐全）。

> **数据存放位置**：优先保存在程序所在目录的 `data/novels.json`（便携，整包拷到任意电脑、U 盘都能带着稿子走）；若该目录不可写，则自动改存到「文档 / 墨页小说写作 / data / novels.json」。想直接打开数据文件夹，可在设置里点「打开数据文件夹」。

### 从源码构建

环境要求：Node.js 18+，以及系统已安装 Microsoft Edge WebView2 Runtime（Windows 10/11 通常自带）。

```bash
npm install          # 安装构建工具链（@neutralinojs/neu / @electron/asar / jsdom）
node build.mjs       # 单文件内联 + 打包 + 自动解包校验
```

构建完成后成品在 `dist/墨页/`：`墨页-win_x64.exe` + `resources.neu`。

构建脚本 `build.mjs` 会依次做：

1. 对三个 JS 做语法检查；
2. 把 `css / store.js / app.js` **内联进单个 `index.html`**，从根上避免资源缺失类启动失败；
3. `neu build --release` 打包；
4. 解包校验：单文件 html 含全部逻辑、无 css/js 碎片、体积合理。

任何一步失败都会直接报错退出、绝不产出坏包。

## 目录结构

```
墨页/
├─ src/                  # 开发态前端源码（模块化）
│  ├─ index.html         # 界面骨架（含启动错误浮层）
│  ├─ css/style.css      # 三套主题样式
│  ├─ js/store.js        # 存储层（Neutralino 文件存储 + 浏览器 IndexedDB 兜底）
│  ├─ js/app.js          # 核心逻辑
│  └─ js/neutralino.js   # Neutralino 框架客户端库
├─ installer.iss         # Inno Setup 安装脚本（编译出 墨页-setup.exe）
├─ installer/            # 安装脚本依赖（中文语言文件等）
├─ .github/workflows/    # GitHub Actions 自动构建 Release
├─ bin/                  # Neutralino 跨平台二进制（构建用）
├─ build.mjs             # 构建脚本（内联 + 打包 + 校验）
├─ test/smoke.mjs        # 无头启动冒烟测试（jsdom）
├─ neutralino.config.json
└─ package.json
```

## 数据导出与备份

| 功能 | 说明 |
| --- | --- |
| 导出全书 / 本章 TXT | 纯文本，适合粘贴到任何平台 |
| 导出全书 / 本章 Markdown | 保留粗体、斜体、标题层级 |
| 导出全部作品 TXT / Markdown | 把库里所有作品合并导出 |
| 备份全部数据 (JSON) | 导出完整工程文件，含大纲 / 人物 / 设定 / 灵感 / 素材 |
| 从备份恢复 | 导入上面的 JSON 还原全部数据 |

## 许可证

[MIT](LICENSE) © 峻峻尼
