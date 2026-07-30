# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Agentic Lab** — a dark-themed interactive lab site (Chinese) showcasing post-vibecoding engineering: 大模型 (Model) → Harness → Loop → Graph. Built with Astro 5, deploys statically to GitHub Pages. Not a blog: every chapter pairs a short essay with a runnable in-browser demo.

## Commands

```bash
npm run dev       # Dev server (http://localhost:4321)
npm run build     # Build production site into dist/
npm run preview   # Preview built site
```

No tests or linting exist.

## Architecture

- `src/layouts/Base.astro` — site shell: nav, footer, `<ClientRouter />` (view transitions), imports `src/styles/global.css` (Tailwind v4 via `@tailwindcss/vite`, custom `@theme` tokens like `--color-void/-panel/-acc`, `.doc` essay typography).
- `src/pages/` — `index` (hero + live LLM + manifesto), `model`, `harness`, `loop`, `graph` (four chapters), `meta` (public agent build log).
- `src/components/islands/` — React 19 islands, one per demo:
  - `WebLlmChat.jsx` (`client:only="react"`, prop `compact`): in-browser LLM via `@mlc-ai/web-llm`; WebGPU detection, click-to-load gate (never auto-downloads weights), model picker resolved against `prebuiltAppConfig`.
  - `ToolSandbox.jsx` (`client:load`): rule-routed mock agent + live context-window stacked bar; toggle compacts old tool results.
  - `LoopSimulator.jsx` (`client:load`): scripted ReAct episodes (converge / self-correct / diverge) with transport controls and adjustable `max_iterations` guardrail.
  - `GraphPlayground.jsx` (`client:load`): SVG multi-agent topologies (pipeline / supervisor / debate), draggable nodes, animated message packets, event log.

## Conventions

- Islands render dark surfaces only; reuse CSS vars from global.css (`var(--color-*)`, `.panel`, `.btn`, `.chip`, `.font-monox`).
- Demo data is mocked in-island; no backend, no API keys anywhere.
- Deployment: `.github/workflows/deploy.yml` (push to `master` → `npm ci` → `npm run build` → `dist/` to Pages).
- The predecessor VitePress site ("智学笔记", 191 notes) lives only in git history — do not resurrect unless asked.
