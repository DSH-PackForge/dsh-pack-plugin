// 宿主 I/O：Node 侧的 Host 实现（@dsh-packforge/core 的唯一依赖注入边界）。
//
// core 自己不做任何 node:fs / node:crypto / child_process 操作，全部经 Host 注入；
// 宿主插件跑在 Node 里，用收编进来的 NodeHost（见 ./host-node.js）即可。
import { NodeHost } from './host-node.js';

let host;

/** 惰性单例；测试可注入替身（setHost）。 */
export function getHost() {
  if (!host) host = new NodeHost();
  return host;
}

export function setHost(h) {
  host = h;
}
