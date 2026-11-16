# RST-1～RST-7 交付索引

全部实现按依赖堆叠，未合并、未部署生产。PR创建后保持 **In review**，不将预览验证当作生产验收。10条系统依赖边已补齐；RST-6物理分支堆叠在RST-5之上，仍保留正文所列RST-1/2/3的逻辑依赖。

| Ticket | PR | 报告及复现入口 | 主要结果 |
| --- | --- | --- | --- |
| RST-1 | [43](https://github.com/DengNaichen/Roster/pull/43) | [基线](rst-1.md)，probe.mjs / ui-probe.mjs | 真实托管热API P50/P95：列表2866/7204、详情4840/9137、写入3167/5413ms；MCP后页面超过30秒仍旧 |
| RST-2 | [44](https://github.com/DengNaichen/Roster/pull/44) | [区域](rst-2.md)，regions.mjs / mcp-regions.mjs | 同一客户端位置的一批交错请求、RST-3前载荷：东京自动路由→巴黎，REST P95列表5976→1178、详情8086→1035、写入3521→2402ms；MCP也改善 |
| RST-3 | [45](https://github.com/DengNaichen/Roster/pull/45) | [载荷](rst-3.md)，probe.mjs / payload.mjs | 同数据列表499805→17363 bytes（−96.5%），SQL5不变；本地P95 11→3.9ms |
| RST-4 | [46](https://github.com/DengNaichen/Roster/pull/46) | [缓存](rst-4.md)，roundtrip.mjs / ui-report.mjs | 20次列表详情往返请求406→5；热往返11/9→0/0；详情DOM P95 126.4→15.7ms |
| RST-5 | [47](https://github.com/DengNaichen/Roster/pull/47) | [乐观写入](rst-5.md)，writes.mjs / write-report.mjs | 300ms网络条件：优先级DOM P95 328.1→4.6ms，状态332.4→4.3；请求7→1、SQL34→9/次交互 |
| RST-6 | [48](https://github.com/DengNaichen/Roster/pull/48) | [SQL往返](rst-6.md)，probe.mjs / read-ab.ts / sql-plan.ts | 普通列表/详情/写入SQL5/20/9→3/9/8；富关联6/46/9→3/11/8；响应完全相同 |
| RST-7 | 当前 remote-refresh-on-roundtrips 分支 | [远端刷新](rst-7.md)，remote-refresh.mjs / remote-lifecycle.mjs / remote-access.mjs / conditional.mjs / remote-report.mjs | 本地最坏轮询相位n=5：MCP→DOM P50/P95 14949/15049ms；任务详情页3请求/15秒；隐藏/离线0请求、正常304正文0bytes |

## 哪些结论已经得到证明

- 独立合成Workspace、真实浏览器与业务REST/MCP请求；正式roster仅记录开发ticket。区域对比是真实已登录JWT调用托管业务接口，不是未登录401。后续代码在本地固定身份预览、真实受限PostgreSQL验证。
- 最新堆叠保留main #40～#42的Onboarding、首条任务todo和query-wrapper适配；前四支对齐25065b4上的远端提交。RST-5原改动先正常提交87e5e77，再按指定旧父8584b4e rebase；未使用stash。历史测量仍保留当时SHA，不伪装为测量新SHA。
- 用户/Workspace隔离、旧响应取消、同实体写序、失败回滚、权限清理、空态引导、筛选与Triage收敛有回归测试。真实浏览器验证了网络失败/恢复、成员停用、私有Team变化和本地删除fixture；各报告区分实际链路与测试替身。
- 最终完整堆叠：format/check/build、155前端用例、35后端测试/6数据库步骤通过，无数据库测试跳过。前六个PR远端CI通过、生产部署步骤跳过；最后一个PR的CI在开PR后读回记录。

## 不能外推的部分

- **生产新代码、OAuth首次登录/刷新/撤销/退出、托管新CORS和DTO端到端尚未验证。** 现有已授权roster-self成功仅证明本次任务访问。预览固定身份及mock身份的组件测试不算OAuth验收。
- RST-4的406请求基线受开发StrictMode重复读取影响；原rAF计时受隐藏标签页限速，改报DOM匹配。不能据此声称生产请求节省同样比例或实际绘制加速。
- RST-5的4ms是乐观DOM反馈，服务器确认仍约313–316ms。RST-6本地浏览器延迟并非全改善，普通路径部分P95上升；交错同进程真实处理器A/B说明服务端收益，但不含浏览器/TCP，不代替托管测量。
- 区域数据来自单个客户端位置的一批交错请求，测量早于RST-3/6的载荷及SQL改动；不是覆盖所有地域/负载的持续SLO。小样本P95受极值影响；RST-7的5个样本接近最坏轮询相位，不是随机到达典型延迟。304仍运行SQL、鉴权、哈希和Edge调用；正常详情每可见标签约12请求/52 SQL每分钟。托管成本、并发用户及大数据计划未测。
- RST-7早期指纹范围不足，已扩展为前后端、contracts、Vite、依赖锁与全部性能脚本，并冻结后重新采样。早期结果单独保留，未改写为最终结果。
- 列表统一为 `{issues,next_cursor}`，移除了重复 `items`；外部MCP脚本迁移清单未完成。富关联详情仍有完整文档，审计会增长。当前没有公开deleteIssue API，删除测试仅是受限本地fixture清理后真实404/UI路径。

## 取舍与回退

选择内存共享缓存、定向乐观属性合并、批量读取和轻量轮询。没有离线写队列、同步引擎、数据表直订阅、新索引或SQL权限提升。区域方案由真实Tokyo/Paris结果支持；SQL方案因普通列表初测变慢而缩小为带无引用快捷路径的批量查询。

按RST-7→6→5→4→3→2→1逆依赖撤销。RST-7设 `VITE_REMOTE_REFRESH_MS=0` 可关闭定时轮询；回退条件读取时保留If-None-Match的CORS许可，避免已缓存客户端预检失败。RST-2设 `VITE_API_REGION=any` 或空值恢复自动区域；回退时保留x-region CORS许可。其余按独立PR撤销；无新增数据库迁移。所有工作树和测量数据保留，未删除用户工作。
