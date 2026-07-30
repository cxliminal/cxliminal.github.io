import Anthropic from '@anthropic-ai/sdk';

const KEY_LS = 'agenticlab_anthropic_key';
const MODEL_LS = 'agenticlab_anthropic_model';

export const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 · 快而省' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5 · 更聪明' },
];

export function getKey() {
  try {
    return localStorage.getItem(KEY_LS) || '';
  } catch {
    return '';
  }
}

export function saveKey(k) {
  try {
    if (k) localStorage.setItem(KEY_LS, k);
    else localStorage.removeItem(KEY_LS);
  } catch {
    /* noop */
  }
}

export function getModel() {
  try {
    return localStorage.getItem(MODEL_LS) || MODEL_OPTIONS[0].id;
  } catch {
    return MODEL_OPTIONS[0].id;
  }
}

export function saveModel(m) {
  try {
    localStorage.setItem(MODEL_LS, m);
  } catch {
    /* noop */
  }
}

export function maskKey(k) {
  return k && k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '';
}

export function makeClient() {
  const apiKey = getKey();
  if (!apiKey) return null;
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

/* ---------- 工具层：schema（注入上下文）+ 本地执行（Agent SDK 同构的最小 harness） ---------- */

function mockWeather(city) {
  let h = 0;
  for (const ch of String(city)) h = (h * 31 + ch.charCodeAt(0)) % 997;
  const conds = ['晴', '多云', '阴', '小雨', '雷阵雨'];
  return { city, temp: 4 + (h % 29), condition: conds[h % conds.length], humidity: 30 + (h % 60) + '%', note: '演示环境模拟数据' };
}

function safeCalc(exprRaw) {
  const expr = String(exprRaw).replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[0-9+\-*/().%\s]+$/.test(expr) || !/[0-9]/.test(expr)) throw new Error('表达式不合法');
  const val = Function('"use strict"; return (' + expr + ')')();
  if (typeof val !== 'number' || !isFinite(val)) throw new Error('无法求值');
  return Math.round(val * 1e6) / 1e6;
}

function mockSearch(query) {
  const q = String(query).slice(0, 40);
  return [
    { title: `${q} —— 工程实践指南`, snippet: `关于「${q}」：核心是把上下文当作稀缺资源经营——schema 要精简、tool result 要压缩、状态要显式管理。（演示环境模拟结果）` },
    { title: `${q} 的最佳实践（2026）`, snippet: `终止条件、token 预算、每轮可观测，是可靠 agent 的三根保险丝。（演示环境模拟结果）` },
  ];
}

export const TOOL_DEFS = [
  {
    name: 'calculator',
    description: '四则运算求值。输入合法的数学表达式（支持 +-*/() 和百分号），返回数值结果。涉及任何数字计算时优先使用，不要心算。',
    input_schema: {
      type: 'object',
      properties: { expr: { type: 'string', description: '数学表达式，例如 (128+64)*3.5' } },
      required: ['expr'],
    },
  },
  {
    name: 'get_weather',
    description: '查询指定中国城市的当前天气，返回温度、天气状况和湿度（演示环境为模拟数据）。',
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string', description: '城市名，例如 北京、上海' } },
      required: ['city'],
    },
  },
  {
    name: 'web_search',
    description: '搜索网页，返回最相关的若干条结果摘要（演示环境为模拟结果）。',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索关键词' } },
      required: ['query'],
    },
  },
  {
    name: 'get_time',
    description: '获取当前的日期和时间。',
    input_schema: { type: 'object', properties: {} },
  },
];

export function executeTool(name, input) {
  try {
    if (name === 'calculator') return { value: safeCalc(input && input.expr) };
    if (name === 'get_weather') return mockWeather((input && input.city) || '北京');
    if (name === 'web_search') return { results: mockSearch((input && input.query) || '') };
    if (name === 'get_time') return { time: new Date().toLocaleString('zh-CN', { hour12: false }) };
    return { error: `unknown tool: ${name}` };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
