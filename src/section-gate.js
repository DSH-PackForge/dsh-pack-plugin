// settings.section 注册闸门：让「整合包」这条设置入口在 DSH 插件热重载
// （关/开插件、装其他插件触发宿主重载）之后仍能重新注册，而不是被重载周期吞掉。
//
// 根因（已从 DSH slots 服务源码确证）：
//   SlotsService.inject 的回调绑在「slot 声明生命周期」（declaration epoch）上；
//   SlotsService.register 底层是 ctx.effect(() => _register(...))，也挂在调用方 fiber。
//   若写 `slots.inject('settings.section', () => slots.register({id}, Comp))`，
//   热重载时 DSH 会「先跑新 apply（旧 id 注册尚未被 unload 清理）→ 再清旧 fiber」，
//   新 register 命中 SlotCore 对 list slot 的重复 id 校验
//   （`already has an entry with id "${id}"`）直接 throw；该 throw 被 inject 的
//   changed() 吞掉并 stop()，随后旧 fiber 清理把旧入口也带走——两个都没了。
//   因 throw 走 queueMicrotask 异步重抛，故无任何可见警告。
//
// 对策（照搬 dsh-market 的 section-gate 状态机，实测其重载不丢入口）：
//   register 只允许成功调用一次（幂等），disposer 被显式持有；
//   inject 回调只负责置 available，返回 undefined，不把 register 绑成回调清理函数。
export function createSectionGate(register) {
  let ready = false;
  let removed = false;
  let dispose = null;

  const apply = () => {
    if (!ready) return;
    const shouldShow = !removed;
    if (shouldShow && dispose === null) {
      dispose = register();
      return;
    }
    if (!shouldShow && dispose !== null) {
      const stop = dispose;
      dispose = null;
      stop();
    }
  };

  return {
    /** slots 服务已就位（inject 回调触发）。幂等：重复调用不会二次 register。 */
    available: () => {
      ready = true;
      apply();
    },
    /** 当前入口是否已注册。 */
    visible: () => dispose !== null,
    /** 本包被移除：永久注销，后续任何 available 都不再复活。 */
    retire: () => {
      removed = true;
      apply();
    },
  };
}
