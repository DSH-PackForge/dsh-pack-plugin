// 宿主↔客户端 RPC 通道名。独立成模块：host 侧（rpc.js）与 client 侧（client-rpc.js）共用，
// 且不能引入任何 node 内建（client bundle 会把它一起打进 lib/client.js）。
export const CHANNEL = '/dsh-pack';
