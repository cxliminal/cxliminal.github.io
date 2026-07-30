import { useState, useRef, useEffect } from 'react';
import { makeClient, getKey, getModel, executeTool, TOOL_DEFS } from './claude.js';
import KeyPanel from './KeyPanel.jsx';

const SYSTEM_TOKENS = 156;
const CTX_LIMIT = 4096;
const CLAUDE_SYS =
  '你是 Tool-use 沙盒里的演示 agent。根据用户问题自主决定是否调用工具、调用哪些工具。' +
  '回答用简洁中文，150 字以内。天气与搜索工具在演示环境返回模拟数据，照常用即可。';

const TOOLS_VIEW = [
  { name: 'calculator', sig: '(expr: string) => number', desc: '四则运算求值', schemaTokens: 68 },
  { name: 'get_weather', sig: '(city: string) => Weather', desc: '查询城市天气（mock）', schemaTokens: 74 },
  { name: 'web_search', sig: '(query: string) => Result[]', desc: '网页搜索（mock）', schemaTokens: 92 },
  { name: 'get_time', sig: '() => string', desc: '获取当前时间', schemaTokens: 52 },
];

const PRESETS = ['北京今天天气怎么样？适合穿什么', '帮我算一下 (128+64)*3.5 等于多少', '搜一下什么是 harness engineering', '现在几点了？'];

const CITY_DICT = ['北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '西安', '南京', '武汉', '苏州', '天津', '长沙', '青岛', '厦门'];

function extractCity(q) {
  for (const c of CITY_DICT) if (q.includes(c)) return c;
  const m = q.match(/([一-龥]{2,4}?)(?:今天|明天|后天)?的?天气/);
  if (m && m[1] && !/今天|明天|后天|现在/.test(m[1])) return m[1];
  return '北京';
}

const SEG_COLORS = { system: '#6d8dff', schema: '#a78bfa', user: '#2dd4bf', answer: '#9b9bb4', obs: '#fbbf24', obsPacked: '#62627a' };

const est = (s) => Math.max(4, Math.ceil(String(s).length / 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Claude 模式的真实压缩：发送前把旧的 tool_result 替换为摘要 stub，只留最新一轮细节 */
function compressToolResults(msgs) {
  const trIdx = msgs
    .map((m, i) => (m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result') ? i : -1))
    .filter((i) => i >= 0);
  const last = trIdx[trIdx.length - 1];
  return msgs.map((m, i) => {
    if (!trIdx.includes(i) || i === last) return m;
    return { ...m, content: m.content.map((b) => (b.type === 'tool_result' ? { ...b, content: '[已压缩] 早期工具结果摘要' } : b)) };
  });
}

export default function ToolSandbox() {
  const [mode, setMode] = useState(() => (getKey() ? 'claude' : 'mock'));
  const [hasKey, setHasKey] = useState(!!getKey());
  const [events, setEvents] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [compact, setCompact] = useState(false);
  const [usage, setUsage] = useState([]); // claude 模式：每轮真实 usage
  const scrollRef = useRef(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const push = (ev) => setEvents((prev) => [...prev, ev]);

  /* ---------- mock 模式：规则路由 ---------- */
  const mockRun = async (q) => {
    const myId = runIdRef.current;
    const alive = () => runIdRef.current === myId;
    const calls = [];
    if (/天气|穿衣/.test(q)) {
      calls.push({ name: 'get_weather', args: { city: extractCity(q) } });
    }
    const exprMatch = q.match(/[-+0-9()\s*/.×÷%]{3,}/);
    if (exprMatch && /算|等于|多少|\?|？/.test(q)) calls.push({ name: 'calculator', args: { expr: exprMatch[0].trim() } });
    if (/搜|什么是|查一下/.test(q)) calls.push({ name: 'web_search', args: { query: q } });
    if (/几点|时间/.test(q)) calls.push({ name: 'get_time', args: {} });

    const picked = calls.slice(0, 2);
    if (picked.length === 0 && alive) {
      push({ type: 'note', text: '规则路由：未命中任何工具 → 直接生成回答（真实 harness 里这一步由模型自己决策）' });
    }

    const obsParts = [];
    for (const c of picked) {
      if (!alive()) return;
      push({ type: 'call', name: c.name, args: c.args, tokens: est(JSON.stringify(c.args)) + 12 });
      await sleep(650);
      const obs = await executeTool(c.name, c.args);
      if (!alive()) return;
      push({ type: 'obs', name: c.name, data: obs, tokens: est(JSON.stringify(obs)) });
      obsParts.push({ call: c, obs });
      await sleep(500);
    }

    if (!alive()) return;
    let answer;
    if (obsParts.length === 0) {
      answer = '这个问题不需要调用工具。（演示环境使用模板回复；切到 Claude 模式后，这里是由真模型基于上下文生成的答案。）';
    } else {
      answer = obsParts
        .map(({ call, obs }) => {
          if (obs.error) return `工具 ${call.name} 出错了：${obs.error}`;
          if (call.name === 'get_weather') {
            const w = obs;
            const tip = w.temp < 10 ? '建议厚外套或羽绒服。' : w.temp < 20 ? '薄外套、长袖刚好。' : '短袖即可，注意防晒补水。';
            return `${w.city}今天${w.condition}，气温 ${w.temp}°C，湿度 ${w.humidity}。${tip}`;
          }
          if (call.name === 'calculator') return `计算结果：${(call.args.expr || '').trim()} = ${obs.value}`;
          if (call.name === 'web_search') return `搜到最关键的一条：${obs.results[0].snippet}`;
          return `现在是 ${obs.time}。`;
        })
        .join('\n');
    }
    push({ type: 'answer', text: answer, tokens: est(answer) });
  };

  /* ---------- claude 模式：真实 tool_use 循环 ---------- */
  const claudeRun = async (q) => {
    const myId = runIdRef.current;
    const alive = () => runIdRef.current === myId;
    const client = makeClient();
    if (!client) {
      push({ type: 'note', text: '未配置 API key，已回退到 mock 模式' });
      return mockRun(q);
    }

    const history = events
      .filter((e) => e.type === 'user' || e.type === 'answer')
      .slice(-6)
      .map((e) => ({ role: e.type === 'user' ? 'user' : 'assistant', content: e.text }));
    const messages = [...history, { role: 'user', content: q }];
    let finalText = '';

    for (let round = 0; round < 4; round++) {
      if (!alive()) return;
      let resp;
      try {
        resp = await client.messages.create({
          model: getModel(),
          max_tokens: 1024,
          system: CLAUDE_SYS,
          tools: TOOL_DEFS,
          messages: compact ? compressToolResults(messages) : messages,
        });
      } catch (e) {
        if (alive()) push({ type: 'note', text: `API 调用失败：${String((e && e.message) || e).slice(0, 160)}` });
        return;
      }
      if (!alive()) return;
      setUsage((prev) => [...prev, { in: resp.usage.input_tokens, out: resp.usage.output_tokens }]);
      messages.push({ role: 'assistant', content: resp.content });

      const toolUses = resp.content.filter((b) => b.type === 'tool_use');
      const texts = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
        finalText = texts || '（模型未返回文本）';
        break;
      }

      if (texts) push({ type: 'note', text: `模型决策：${texts.slice(0, 120)}` });
      const results = [];
      for (const tu of toolUses) {
        if (!alive()) return;
        push({ type: 'call', name: tu.name, args: tu.input, tokens: est(JSON.stringify(tu.input)) + 12 });
        await sleep(250);
        const obs = await executeTool(tu.name, tu.input);
        if (!alive()) return;
        push({ type: 'obs', name: tu.name, data: obs, tokens: est(JSON.stringify(obs)) });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(obs) });
      }
      messages.push({ role: 'user', content: results });
      if (round === 3) finalText = '（触达沙盒的 4 轮工具调用上限，强制收口——真实 harness 里这个上限可配置）';
    }

    if (!alive()) return;
    push({ type: 'answer', text: finalText, tokens: est(finalText) });
  };

  const run = async (preset) => {
    const q = (preset ?? input).trim();
    if (!q || running) return;
    runIdRef.current++;
    setInput('');
    setRunning(true);
    setUsage([]);
    push({ type: 'user', text: q, tokens: est(q) });
    if (mode === 'claude') await claudeRun(q);
    else {
      await sleep(450);
      await mockRun(q);
    }
    setRunning(false);
  };

  const clear = () => {
    runIdRef.current++;
    setEvents([]);
    setUsage([]);
    setRunning(false);
  };

  /* ---------- 上下文窗口估算（教学模型） ---------- */
  const lastObsIdx = events.map((e, i) => (e.type === 'obs' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const segments = [
    { key: 'system', label: 'system prompt', tokens: SYSTEM_TOKENS, color: SEG_COLORS.system },
    { key: 'schema', label: `工具 schema × ${TOOLS_VIEW.length}`, tokens: TOOLS_VIEW.reduce((a, t) => a + t.schemaTokens, 0), color: SEG_COLORS.schema },
  ];
  events.forEach((e, i) => {
    if (e.type === 'user') segments.push({ key: 'u' + i, label: 'user 消息', tokens: e.tokens, color: SEG_COLORS.user });
    if (e.type === 'answer') segments.push({ key: 'a' + i, label: 'assistant 回答', tokens: e.tokens, color: SEG_COLORS.answer });
    if (e.type === 'obs') {
      const packed = compact && i < lastObsIdx;
      segments.push({ key: 'o' + i, label: packed ? 'tool result（已压缩）' : 'tool result', tokens: packed ? 24 : e.tokens, color: packed ? SEG_COLORS.obsPacked : SEG_COLORS.obs });
    }
  });
  const used = segments.reduce((a, s) => a + s.tokens, 0);
  const obsTotal = segments.filter((s) => s.label.startsWith('tool result')).reduce((a, s) => a + s.tokens, 0);
  const pct = Math.min(100, Math.round((used / CTX_LIMIT) * 100));
  const lastUsage = usage[usage.length - 1];

  return (
    <div className="grid lg:grid-cols-[220px_1fr_240px] gap-3">
      {/* tools */}
      <div className="panel p-4">
        <div className="text-[12px] font-monox text-[var(--color-faint)] mb-3">TOOL REGISTRY</div>
        <div className="space-y-2.5">
          {TOOLS_VIEW.map((t) => (
            <div key={t.name} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel2)] px-3 py-2.5">
              <div className="font-monox text-[12px] text-[var(--color-acc)]">{t.name}</div>
              <div className="font-monox text-[11px] text-[var(--color-faint)] mt-0.5 break-all">{t.sig}</div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px] text-[var(--color-mute)]">{t.desc}</span>
                <span className="font-monox text-[10.5px] text-[var(--color-acc2)]">{t.schemaTokens} tok</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-[var(--color-faint)] leading-relaxed mt-3">
          {TOOLS_VIEW.length} 份 schema 每轮都注入上下文，共 {TOOLS_VIEW.reduce((a, t) => a + t.schemaTokens, 0)} tokens —— 工具不是免费的。
        </p>
      </div>

      {/* chat / trace */}
      <div className="panel flex flex-col min-h-[420px]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--color-line)]">
          <span className="text-[13px] font-medium text-[var(--color-ink)]">Tool-use 沙盒</span>
          <div className="flex gap-1">
            <button
              onClick={() => setMode('mock')}
              className={`chip font-monox cursor-pointer transition-colors ${mode === 'mock' ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : ''}`}
            >
              mock 规则路由
            </button>
            <button
              onClick={() => setMode('claude')}
              className={`chip font-monox cursor-pointer transition-colors ${mode === 'claude' ? 'border-[var(--color-teal)] text-[var(--color-teal)] bg-[rgba(45,212,191,0.1)]' : ''}`}
            >
              Claude 真模型
            </button>
          </div>
          <button className="btn btn-ghost ml-auto !py-1 !px-2.5 text-[12px]" onClick={clear}>清空</button>
        </div>

        {mode === 'claude' && (
          <div className="px-4 pt-3">
            <KeyPanel onChange={() => setHasKey(!!getKey())} />
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 max-h-[380px]">
          {events.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center gap-3 py-10">
              <p className="text-[13px] text-[var(--color-faint)]">
                {mode === 'claude' ? '真模型自己做工具决策——问点需要工具的：' : '试试这些，观察右侧上下文窗口怎么被吃掉：'}
              </p>
              <div className="flex flex-wrap justify-center gap-2 max-w-sm">
                {PRESETS.map((p) => (
                  <button key={p} className="chip cursor-pointer hover:text-[var(--color-ink)] hover:border-[var(--color-line-strong)] transition-colors" onClick={() => run(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {events.map((e, i) => {
            if (e.type === 'user')
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl px-3.5 py-2 text-[13px] bg-[rgba(45,212,191,0.12)] border border-[rgba(45,212,191,0.25)] text-[var(--color-ink)]">{e.text}</div>
                </div>
              );
            if (e.type === 'call')
              return (
                <div key={i} className="fade-up rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.07)] px-3.5 py-2.5">
                  <div className="font-monox text-[11px] text-[var(--color-acc2)] mb-1">→ tool_call</div>
                  <pre className="font-monox text-[12px] text-[var(--color-ink)] whitespace-pre-wrap break-all">{`${e.name}(${JSON.stringify(e.args)})`}</pre>
                </div>
              );
            if (e.type === 'obs')
              return (
                <div key={i} className="fade-up rounded-xl border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.06)] px-3.5 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-monox text-[11px] text-[var(--color-amber)]">← observation</span>
                    <span className="font-monox text-[10.5px] text-[var(--color-faint)]">+{e.tokens} tok</span>
                  </div>
                  <pre className="font-monox text-[11.5px] text-[var(--color-mute)] whitespace-pre-wrap break-all max-h-28 overflow-y-auto">{JSON.stringify(e.data, null, 2)}</pre>
                </div>
              );
            if (e.type === 'note')
              return (
                <div key={i} className="text-center">
                  <span className="chip font-monox text-[11px]">{e.text}</span>
                </div>
              );
            return (
              <div key={i} className="fade-up flex justify-start">
                <div className="max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap bg-[var(--color-panel2)] border border-[var(--color-line)] text-[var(--color-ink)]">{e.text}</div>
              </div>
            );
          })}
          {running && <div className="text-[12px] font-monox text-[var(--color-faint)] pulse-dot">{mode === 'claude' ? 'Claude 正在决策…' : 'agent 正在决策…'}</div>}
        </div>

        <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) run();
            }}
            placeholder="问点需要工具才能答的…"
            className="flex-1 bg-transparent outline-none text-[13px] px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)]"
          />
          <button className="btn" onClick={() => run()} disabled={running || !input.trim()}>执行</button>
        </div>
      </div>

      {/* context window */}
      <div className="panel p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-monox text-[var(--color-faint)]">CONTEXT WINDOW</span>
          <span className="font-monox text-[11px] text-[var(--color-mute)]">{used}/{CTX_LIMIT}</span>
        </div>

        <div className="h-3 rounded-full overflow-hidden bg-[rgba(148,163,255,0.1)] flex mb-1.5">
          {segments.map((s) => (
            <div
              key={s.key}
              className="h-full transition-all duration-500"
              style={{ width: `${Math.min(100, (s.tokens / CTX_LIMIT) * 100)}%`, background: s.color }}
              title={`${s.label}: ${s.tokens}`}
            />
          ))}
        </div>
        <div className="text-right font-monox text-[11px] mb-3" style={{ color: pct > 80 ? 'var(--color-rose)' : 'var(--color-faint)' }}>已用 {pct}%（估算）</div>

        <div className="space-y-1 text-[11.5px] font-monox overflow-y-auto max-h-36 pr-1">
          {segments.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-[var(--color-mute)] truncate">{s.label}</span>
              <span className="ml-auto text-[var(--color-faint)]">{s.tokens}</span>
            </div>
          ))}
        </div>

        {mode === 'claude' && usage.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--color-line)]">
            <div className="text-[11px] font-monox text-[var(--color-faint)] mb-1.5">真实计量（API usage）</div>
            <div className="space-y-1 font-monox text-[11.5px]">
              {usage.map((u, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-[var(--color-mute)]">round {i + 1}</span>
                  <span className="text-[var(--color-teal)]">in {u.in} · out {u.out}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-faint)] leading-relaxed mt-2">
              每轮 tool_use 都把全部历史重新送进模型——input tokens 逐轮累加，这就是 loop 的成本结构。
            </p>
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-[var(--color-line)]">
          <div className="text-[11.5px] text-[var(--color-mute)] leading-relaxed mb-2.5">
            tool result 占比 <span className="text-[var(--color-amber)] font-monox">{used ? Math.round((obsTotal / used) * 100) : 0}%</span> —— 上下文的第一大消耗源。
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} className="accent-[#6d8dff]" />
            <span className="text-[12px] text-[var(--color-ink)]">压缩旧的 tool result</span>
          </label>
          <p className="text-[11px] text-[var(--color-faint)] leading-relaxed mt-1.5">
            上下文工程的基本功：旧观测摘要化，只留最新细节。Claude 模式下会真实压缩发送给模型的旧 tool result。
          </p>
        </div>
      </div>
    </div>
  );
}
