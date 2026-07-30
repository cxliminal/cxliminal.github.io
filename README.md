# 细林 · Agentic Lab

从调用模型，到让模型自己干活。

这不是博客，是实验室。vibecoding 之后，静态知识不再稀缺，**能跑的东西**才稀缺——
所以本站的每一篇认知都配一个能在浏览器里上手玩的 demo。

## 四篇章

| 篇章 | 主题 | 页内 demo |
| --- | --- | --- |
| 01 · Model | 大模型即基础设施 | WebLLM：页面里跑着一个真模型（WebGPU，无后端） |
| 02 · Harness | 给模型造驾驶舱 | Tool-use 沙盒：上下文窗口可视化 + 压缩策略 |
| 03 · Loop | 循环里住着智能 | Agent loop 模拟器：收敛 / 自我纠偏 / 发散防护 |
| 04 · Graph | 多智能体拓扑 | 可拖拽拓扑演练场：流水线 / 主管 / 辩论 |

## 技术栈

- **Astro 5** + Tailwind v4 + React 19 岛屿（islands architecture）
- **WebLLM**（@mlc-ai/web-llm）浏览器内推理，WebGPU 加速
- ClientRouter 页面转场，全站零后端，GitHub Pages 静态部署

## 开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出 dist/
npm run preview
```

## 元信息

本站由 AI agent 协作构建，全部决策与过程公开在 [/meta](https://chenxilin1994.github.io/meta/) 构建日志。
前身「智学笔记」（191 篇 VitePress 笔记）封存在 git 历史中。
