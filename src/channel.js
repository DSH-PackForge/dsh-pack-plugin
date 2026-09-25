// 宿主↔客户端共享的契约常量。独立成模块：host 侧（rpc.js / endpoints.js）与
// client 侧（client-rpc.js / settings.js）共用，且不能引入任何 node 内建
// （client bundle 会把它一起打进 lib/client.js）。
export const CHANNEL = '/dsh-pack';

// profile 名合法格式（host endpoint 与 client UI 双重校验）：kebab-case，
// 小写字母/数字，段与段之间用单个连字符分隔（如 aaa-bb-c）。
export const PROFILE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// 保留的 profile 名，不能被用户新建：desktop 是官方硬编码的激活指针名
// （见 runtime.js 的 ACTIVE_NAME，无 env 覆盖），default 是首次切换时把 desktop 存档成的名字。
export const RESERVED_PROFILE_NAMES = ['desktop', 'default'];
