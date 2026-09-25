// 类型声明：让 desktop-host（TypeScript）能 import 这个纯 JS 包。
// 实际实现见 ./index.js。
export const name: string;
export const inject: string[];
// Cordis 插件的 apply 签名；ctx 由 Cordis 注入，这里不引入 @deepseek-ai/* 类型依赖。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any): void;
