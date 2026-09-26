// 打包态判定：决定「切换进度窗」（progress-window）走 electron GUI 还是 PowerShell WPF。
// 任务中心已改内嵌面板（settings.js），不再有独立窗口，故不参与此判定。
//
// 开发态 `electron .` 由默认 app 承载，process.defaultApp === true；打包后的 app 不是默认 app，
// 该值为 undefined。纯 node（测试/CLI）里则连 process.versions.electron 都没有。
// 三个状态唯一可区分的是「打包后的 electron app」：有 electron 版本号 + 不是默认 app。
export function isPackagedBuild() {
  return typeof process.versions.electron === 'string' && process.defaultApp !== true;
}
