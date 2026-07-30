import rss from '@astrojs/rss';

const NOTES = [
  {
    slug: 'context-engineering',
    title: '上下文工程：经营那个窗口，而不是写那段提示词',
    description: 'Prompt 工程已死，上下文工程当立。七个槽位、三条压缩策略、子代理隔离，以及「agent 挂了先查上下文」的调试心法。',
  },
  {
    slug: 'agentic-loop',
    title: 'Agentic Loop 工程：while 循环里的收敛学',
    description: 'observe → reason → act 的三拍子怎么搭，终止条件与 token 预算怎么定，为什么 eval 的对象是轨迹而不是答案。',
  },
  {
    slug: 'multi-agent',
    title: '多智能体的真相：token 消耗解释 80% 的性能差异',
    description: 'Anthropic 多代理研究系统复盘：什么时候该上多代理、上下文隔离为什么是关键、以及 3-10 倍成本你认不认。',
  },
  {
    slug: 'effective-agents',
    title: '构建有效智能体：五种工作流模式与 2026 四层架构',
    description: '从 Anthropic 经典 playbook 到 Agent Loop / Runtime / MCP / Skills 分层——先把单 agent 做可控，再谈编排。',
  },
];

export function GET(context) {
  return rss({
    title: '细林 · Agentic Lab',
    description: 'vibecoding 之后的技术实验场：大模型 · Harness · Loop · Graph',
    site: context.site,
    items: NOTES.map((n) => ({
      title: n.title,
      description: n.description,
      link: `/notes/${n.slug}/`,
      pubDate: new Date('2026-07-30T00:00:00+08:00'),
    })),
    customData: '<language>zh-CN</language>',
  });
}
