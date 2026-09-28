// DSH 客户端 · 设置页导航 tab 的自定义图标。
//
// DSH 设置面板（dsh-client-ui-settings-general）为每个 settings.section 在
// <nav> 里渲染一个 <button>，图标取自内置 section id 白名单（models /
// agent-presets / plugins），其余 id 一律回退成齿轮；settings.section 的
// slots 契约只投影 id / order / label，注册方没有任何 icon 字段可传。
//
// 所以这里在设置对话框挂载后，用 MutationObserver 找到「可见文本 == 本插件
// section label」的那一行 <button>，打上一个 marker 属性，再用注入的
// <style> 把齿轮隐藏、以 CSS mask 画出本插件 logo（currentColor 上色）。
// 做法与 dsh-market 的 settings-nav-icon 一致（dsh-better-sidebar、
// dsh-skill-mcp-panel 同理）。
//
// 作用域刻意收窄：只改属于本插件的那一行，不碰任何 shell 结构；style 与
// marker 都挂在 ctx.effect 里，随 fiber 卸载清理；locale 切换经
// MutationObserver 重新认领，label 与图标永不脱节。
//
// 等到 settings.section 长出 icon 字段那天，删掉本模块即可。
import { SECTION_FOCUS_HOOK, SECTION_LABEL_HOOK, SECTION_WANT_FLAG } from './ball-settings.js';

/** 标记「这一行导航属于本插件」的属性名。 */
export const NAV_ICON_MARKER = 'data-dspack-nav-icon';
/**
 * 设置对话框里的导航行。shell 把每个 settings.section 渲染为面板 <nav> 里的
 * 一个 <button>（dsh-client-ui-settings-general 的 SettingsPanel）。
 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button';

/** 图标盒尺寸（px）。shell 用这个尺寸渲染所有导航图标且不发任何 media query。 */
export const NAV_ICON_SIZE = 16;

/**
 * 把一条 SVG path 包成独立 SVG（纯黑上色）。CSS mask 只读 alpha，可见颜色由
 * 元素的 background-color: currentColor 决定，故 path 必须填黑。
 *
 * @param path - SVG path d 串（本项目 logo：icons/folder-zip-line.svg）。
 * @param viewBox - 源 SVG 的 viewBox，默认 0 0 1024 1024。
 */
export function navIconMaskSvg(path, viewBox = '0 0 1024 1024') {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'
    + `${viewBox}" fill="#000">`
    + `<path d="${path}"/>`
    + '</svg>';
}

/** mask 的 data URL（运行时 encode，永不用手写转义）。 */
export function navIconMaskUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 某一行导航是否属于本插件。唯一的判断：行可见文本 == shell 当前投影的
 * section label。label 为空则不匹配任何行——locale 尚未解析完成时不能误标
 * 整个导航。
 */
export function isOwnNavRow(rowText, wantedLabel) {
  const wanted = String(wantedLabel ?? '').trim();
  if (wanted.length === 0) return false;
  return String(rowText ?? '').trim() === wanted;
}

/** 标记行的样式：隐藏 shell 齿轮，画出自定义图标。 */
export function navIconCss(maskUrl) {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`,
  ].join('\n');
}

/**
 * 安装导航图标。
 *
 * @param ctx - 客户端 cordis context（用它的 effect 持有 style/marker 生命周期）。
 * @param resolveLabel - 本插件当前的 section label（与 settings.section 注册
 *   用同一个 thunk，locale 切换后重新读取，无需重新注册）。
 * @param maskUrl - 图标 mask 的 data URL（navIconMaskUrl 的产物）。
 */export function installSettingsNavIcon(ctx, resolveLabel, maskUrl) {
  if (typeof document === 'undefined') return;
  if (!ctx || typeof ctx.effect !== 'function') return;

  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-packforge';
    tag.dataset.pluginCss = 'dsh-packforge/settings-nav-icon';
    tag.textContent = navIconCss(maskUrl);
    document.head.appendChild(tag);

    let disposed = false;
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const wanted = resolveLabel();
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '');
        else row.removeAttribute(NAV_ICON_MARKER);
      }
      // 悬浮球点开设置前会立一个旗标：弹窗一挂上就立刻把导航切到本插件分区。
      // 我们比球更早看到 DOM 变化（同一个 MutationObserver），也更认识自己的 label。
      if (window[SECTION_WANT_FLAG] === true) {
        const wantedText = String(wanted ?? '').trim();
        if (wantedText.length > 0) {
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            if (!isOwnNavRow(row.textContent, wantedText)) continue;
            window[SECTION_WANT_FLAG] = false;
            row.click();
            break;
          }
        }
      }
    };

    // 把一波 DOM mutation 合并成一次 sync，且在下一帧绘制前落地，避免行先闪
    // 一下齿轮。
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(sync);
    };

    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      disposed = true;
      observer.disconnect();
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER);
      tag.remove();
    };
  }, 'dsh-packforge: settings nav icon');
}

/**
 * 安装「切到本插件分区」钩子，供悬浮球调用。
 *
 * 为什么需要它：悬浮球在页面 DOM 里找设置入口，但「切到本插件分区」这步不能依赖图标
 * 标记的时机（标记由 MutationObserver + label 文本匹配产生，可能晚一两帧，也可能因为
 * label 尚未解析而没打上）。这把「按当前 label 找到本插件那一行并点击」放在客户端插件
 * 里：它认识自己的分区标签，locale 切换后也立刻反映。
 *
 * @param ctx - 客户端 cordis context（用 effect 持有钩子的生命周期）。
 * @param resolveLabel - 与 settings.section 注册同一个 label thunk。
 * @returns {boolean} 是否安装（非浏览器环境返回 false）
 */
export function installSectionFocusHook(ctx, resolveLabel) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const focus = () => {
    const wanted = String(resolveLabel?.() ?? '').trim();
    if (wanted.length === 0) return false;
    for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
      if (!isOwnNavRow(row.textContent, wanted)) continue;
      row.click();
      return true;
    }
    return false;
  };
  const previous = window[SECTION_FOCUS_HOOK] ?? null;
  window[SECTION_FOCUS_HOOK] = focus;
  // 同时把标签公布出去：球万一拿不到钩子，还能按标签文案自己认行。
  const previousLabel = window[SECTION_LABEL_HOOK] ?? null;
  window[SECTION_LABEL_HOOK] = () => String(resolveLabel?.() ?? '');
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      // 只撤掉自己装的那个（热重载期间可能已被新实例替换）
      if (window[SECTION_FOCUS_HOOK] === focus) window[SECTION_FOCUS_HOOK] = previous;
      if (window[SECTION_LABEL_HOOK] !== null && typeof window[SECTION_LABEL_HOOK] === 'function') {
        window[SECTION_LABEL_HOOK] = previousLabel;
      }
    }, 'dsh-packforge: section focus hook');
  }
  return true;
}
