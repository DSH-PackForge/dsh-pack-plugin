// 浏览器入口：宿主路由下发的 /dsh-pack/ball.js 就是本文件的 iife 产物。
// 只做一件事——自我挂载（mountBall 内部有幂等守卫，重复加载无副作用）。
import { mountBall } from './ball.js';

mountBall();
