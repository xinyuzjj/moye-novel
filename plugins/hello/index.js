/* 示例插件：演示「即插即用」。
 * 放到「墨页」安装目录下的 plugins\hello\ 即可，无需重装。
 * 所有能力都来自 ctx（宿主注入），照着写你自己的功能即可。 */
(function () {
  'use strict';
  window.MoyePlugins.register({
    id: 'hello',
    name: '示例插件',
    activate(ctx) {
      ctx.ui.addToolbarButton({
        label: '示例',
        title: '示例插件：点我',
        onClick: () => {
          const book = ctx.getActiveBook();
          ctx.toast('你好，当前作品：' + (book ? book.title : '（无）'));
        }
      });
    },
    deactivate() {}
  });
})();
