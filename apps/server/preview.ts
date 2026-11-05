import { createUnitOfWork } from '../../packages/backend/src/platform/database/session.ts';
// Local preview only: deliberately not imported by any deployed function.
import { createDatabase } from '../../packages/backend/src/platform/database/client.ts';
import { createService } from '../../packages/backend/src/service.ts';
import { createMcpFetch } from '../../packages/backend/src/transport/mcp/server.ts';
import { createHttpApp } from '../../packages/backend/src/transport/http/app.ts';
import type { IssueDocument, IssueStatus, RequestContext } from '../../packages/contracts/mod.ts';
import { advanceAllCycles } from '../../packages/backend/src/modules/cycles/index.ts';

const connection = Deno.env.get('DATABASE_URL');
if (!connection) throw new Error('DATABASE_URL is required');
const database = new URL(connection);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
  !database.pathname.endsWith('_preview')
) {
  throw new Error('Preview requires a loopback database named *_preview');
}
const port = Number(Deno.env.get('PORT') ?? '18471');
const frontendPort = Number(Deno.env.get('PREVIEW_FRONTEND_PORT') ?? '5178');
const origins = [`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`];
const ctx: RequestContext = {
  identity: {
    subject: 'b965fa67-d823-4534-a240-56b88f839dad',
    name: 'Local Developer',
    email: 'developer@roster.local',
  },
};
const { db, pool } = createDatabase(connection);
const service = createService(db);
// The hosted version uses Supabase Cron. Local preview owns a bounded timer.
let advancing = false;
const timer = setInterval(async () => {
  if (advancing) return;
  advancing = true;
  try {
    await advanceAllCycles(createUnitOfWork(db));
  } catch (error) {
    console.error(
      'Local cycle advancement failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  } finally {
    advancing = false;
  }
}, 60000);
const slug = 'roster';
if (!(await service.listWorkspaces(ctx)).some((w) => w.slug === slug)) {
  await service.createWorkspace(ctx, { slug, name: 'Roster Playground' });
  await service.createTeam(ctx, slug, { key: 'RO', name: 'Roster', emoji: '🗂️' });
  await service.createTeam(ctx, slug, { key: 'LAB', name: 'Experiments', private: true });
  const lead = (text: string): IssueDocument => ({ lead: text, sections: [], criteria: [] });
  const welcome: IssueDocument = {
    lead:
      '这是免登录的本地预览。你可以创建任务、修改状态和优先级，所有修改都保存在独立的本地数据库里。',
    sections: [
      {
        title: '预览包含什么',
        blocks: [
          {
            type: 'paragraph',
            text:
              '工作区 `roster` 下有公开团队 RO 和私有团队 LAB。API 与 MCP 都使用同一个本地开发者身份。',
          },
          {
            type: 'compare',
            left: {
              title: '可以验证',
              items: ['任务、状态与优先级', '验收条件勾选', 'MCP 工具调用'],
            },
            right: { title: '无法验证', items: ['多用户登录', 'OAuth 授权流程'] },
          },
        ],
      },
      {
        title: '本地地址',
        blocks: [
          {
            type: 'table',
            columns: ['入口', '地址'],
            rows: [
              ['REST', '`/api/w/roster/issues`'],
              ['MCP', '`/w/roster/mcp`'],
            ],
          },
          {
            type: 'note',
            title: '数据只在本机',
            text: '重启预览不会覆盖已有工作区；要重新生成示例数据需要重建预览数据库。',
          },
        ],
      },
    ],
    criteria: [
      {
        id: 'AC-1',
        title: '打开这条任务能看到分节正文。',
        detail: '详情页依次显示导语、两个编号分节和验收条件。',
        done: true,
      },
      {
        id: 'AC-2',
        title: '可以勾选一条验收条件。',
        detail: '勾选 AC-2 后刷新页面，勾选状态仍然保留。',
        done: false,
      },
      {
        id: 'AC-3',
        title: 'Agent 能通过 MCP 勾选条件。',
        detail: '调用 `check_issue_criterion` 设置 AC-3，详情页随之更新。',
        done: false,
      },
    ],
  };
  const examples: [string, IssueStatus, number, IssueDocument][] = [
    ['欢迎来到 Roster', 'in_progress', 2, welcome],
    [
      '体验任务的状态流转',
      'todo',
      3,
      lead('打开详情页，试着把状态从 Todo 改为 In progress，再改为 Done。'),
    ],
    ['给下一次迭代写一份计划', 'backlog', 3, lead('点击 Edit issue 可以修改标题和正文。')],
    [
      '检查成员与邀请设置',
      'todo',
      2,
      lead(
        'Settings & members 页面提供工作区角色、邀请链接和私有团队配置。本地免登录模式固定使用一个开发者身份。',
      ),
    ],
    [
      '连接 MCP 与共享业务层',
      'in_review',
      2,
      lead('REST 和 MCP 调用同一套任务与权限服务。云端 OAuth 仍需要独立配置。'),
    ],
    [
      '初始化 TypeScript 工作区',
      'done',
      3,
      lead('React、Hono、Drizzle 和 Postgres 首版已接通。'),
    ],
  ];
  for (const [title, status, priority, document] of examples) {
    await service.createIssue(ctx, slug, {
      team: 'RO',
      title,
      document,
      status,
      priority,
      type: 'feature',
      assignee: ctx.identity.subject,
    });
  }
  await service.createIssue(ctx, slug, {
    team: 'LAB',
    title: '私有团队中的实验任务',
    document: lead('当前本地开发者是这个团队的 Owner。'),
    status: 'backlog',
    type: 'chore',
  });
}
const app = createHttpApp({ service, verify: async () => ctx, allowedOrigins: origins });
// The loopback preview identity is for local clients only. Browser origins cannot call MCP.
const localMcp = createMcpFetch({
  service,
  verify: async () => ctx,
  allowedOrigins: [],
  publicUrl: `http://127.0.0.1:${port}`,
  authorizationServer: `http://127.0.0.1:${port}`,
});
const server = Deno.serve({ hostname: '127.0.0.1', port }, (request) => {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (url.host !== `127.0.0.1:${port}` && url.host !== `localhost:${port}`) {
    return new Response('Local preview only', { status: 403 });
  }
  if (origin && !origins.includes(origin)) return new Response('Origin denied', { status: 403 });
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return new Response('Origin denied', { status: 403 });
  }
  if (url.pathname === `/w/${slug}/mcp`) {
    if (origin || request.headers.has('sec-fetch-site')) {
      return new Response('Local MCP clients only', { status: 403 });
    }
    return localMcp(request);
  }
  return app.fetch(request);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  Deno.addSignalListener(signal, async () => {
    clearInterval(timer);
    await server.shutdown();
    await pool.end();
  });
}
