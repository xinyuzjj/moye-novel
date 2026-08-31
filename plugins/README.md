# 墨页插件（即插即用）

墨页从 v2.1 起支持插件。**核心只保留骨架，功能都靠插件长出来。** 想要某个功能，把对应插件放进去就好，不用重装软件。

## 怎么用

1. 打开「插件」目录：软件内点右上角 **插件** → **打开插件目录**（或手动去安装目录下的 `plugins\`）。
2. 把插件文件夹（含 `plugin.json` + `index.js`）放进 `plugins\`。
3. 重启软件，在 **插件** 面板里勾选启用即可。

内置插件在 `src/js/plugins\`（已随安装包提供）：全文搜索、自动备份。删掉或停用它们也不会影响软件本身。

## 插件结构

```
plugins/
  你的插件/
    plugin.json      # 清单
    index.js         # 入口，调用 window.MoyePlugins.register({...})
```

`plugin.json` 字段：

```json
{
  "id": "my-plugin",          // 唯一标识
  "name": "我的插件",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": "你",
  "entry": "index.js",        // 入口文件，默认 index.js
  "builtin": false            // 用户插件填 false
}
```

## 入口怎么写

```js
window.MoyePlugins.register({
  id: 'my-plugin',
  name: '我的插件',
  activate(ctx) {
    // 加一个工具栏按钮
    ctx.ui.addToolbarButton({ label: '干活', onClick: () => doWork(ctx) });
    // 监听事件
    ctx.on('save', () => console.log('保存了'));
  },
  deactivate() { /* 清理 */ }
});
```

## ctx 提供的 API

- **数据**：`getDb()` `getBooks()` `getActiveBook()` `getChapter(id)` `getActiveChapter()` `getAllChapters()` `htmlToText(html)` `escapeHtml(s)`
- **持久化**：`scheduleSave()` `saveNow()` `replaceDb(data)`
- **导航**：`selectChapter(id)`
- **UI**：`toast(msg)` `openDrawer(id)` `closeDrawer(id)`
- **UI 扩展**：`ui.addToolbarButton({label,title,onClick})` `ui.openModal({title,render})` `ui.addSettingsSection({title,render})`
- **事件**：`on(ev,fn)` `off(ev,fn)`（事件：`boot` `save` `chapterChange` `bookChange`）
- **设置**（全局，存进数据文件）：`getSetting(k, def)` `setSetting(k, v)`
- **文件**（沙箱在 data 目录内）：`electronAPI.pluginFs({op:'write'|'read'|'list'|'delete'|'ensureDir', rel, content})`

写文件示例：

```js
await ctx.electronAPI.pluginFs({ op: 'write', rel: 'my-plugin/note.txt', content: 'hi' });
```

## 内置插件参考

- `src/js/plugins/fulltext-search` —— 跨章搜索
- `src/js/plugins/auto-backup` —— 滚动备份 + 一键恢复

照着改就行。
