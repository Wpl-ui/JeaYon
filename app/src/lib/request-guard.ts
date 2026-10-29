/**
 * 请求轮次守卫。
 *
 * 首版没有实时推送，所有数据靠"写后重查 + 手动刷新 + 窗口重新聚焦重查"。
 * 这些查询会并发、会乱序（切换团队时尤其明显）。规则是：
 *  - 每次"重新加载某一批数据"开启一个新轮次；
 *  - 响应回来时若轮次已过期，直接丢弃，不写进组件状态；
 *  - 切换团队 / 退出登录 / 会话失效时调用 `invalidate()`，让所有在途请求作废。
 *
 * 这样旧团队的慢响应永远不会覆盖当前团队的数据。
 */
export class RequestGuard {
  private generation = 0

  /** 开启新一轮，返回本轮票据。 */
  next(): number {
    this.generation += 1
    return this.generation
  }

  /** 该票据是否仍属于当前轮次。 */
  isCurrent(ticket: number): boolean {
    return ticket === this.generation
  }

  /** 作废所有在途请求。 */
  invalidate(): void {
    this.generation += 1
  }
}

/** 供 React 组件用的稳定守卫（每个组件实例一份）。 */
export function createGuard(): RequestGuard {
  return new RequestGuard()
}
