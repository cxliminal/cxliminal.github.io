import { useState, useEffect, useRef } from 'react';
import { makeClient, getKey, getModel, executeTool, TOOL_DEFS } from './claude.js';
import KeyPanel from './KeyPanel.jsx';

const est = (s) => Math.max(4, Math.ceil(String(s).length / 2));

const EPISODES = [
  {
    id: 'converge',
    name: '收敛',
    task: '查一下上海明天的天气，给我穿衣建议',
    note: '健康的 loop：拿到足够信息就收口。',
    iterations: [
      {
        thought: '用户要明天上海的天气和穿衣建议。我手上没有天气数据，需要先调 get_weather。',
        action: { name: 'get_weather', args: { city: '上海', date: '明天' } },
        observation: { city: '上海', temp: 18, condition: '小雨', wind: '3 级', humidity: '78%' },
      },
      {
        thought: '数据已经齐了：小雨、18°C、有风。信息足够回答，不需要再调工具——收口。',
        answer: '上海明天小雨，18°C 左右，3 级风。建议薄外套 + 长裤，出门带伞；风不小，伞骨选结实点的。',
      },
    ],
  },
  {
    id: 'self-correct',
    name: '自我纠偏',
    task: '帮我查杭州明天的天气',
    note: '工具报错不是终点，是 loop 的输入。',
    iterations: [
      {
        thought: '查杭州明天天气，直接调 get_weather。',
        action: { name: 'get_weather', args: { city: '杭洲' } },
        observation: { error: 'city_not_found: "杭洲"' },
      },
      {
        thought: '工具返回 city_not_found。检查参数——我把"杭州"误写成了"杭洲"。修正后重试。',
        action: { name: 'get_weather', args: { city: '杭州' } },
        observation: { city: '杭州', temp: 21, condition: '多云', humidity: '62%' },
      },
      {
        thought: '修正后拿到了数据。可以回答了。',
        answer: '杭州明天多云，21°C，体感舒适。适合户外活动，早晚加件薄长袖即可。',
      },
    ],
  },
  {
    id: 'diverge',
    name: '发散防护',
    task: '总结一下 agentic loop 的工程最佳实践',
    note: '没有防护栏的 loop 是一台烧钱机器。拖动右侧 max_iterations，看护栏在哪里把它拦下。',
    iterations: [
      {
        thought: '这个话题需要全面资料，先搜一轮。',
        action: { name: 'web_search', args: { query: 'agentic loop 最佳实践' } },
        observation: { results: ['Agent Loop 设计模式', 'Loop 与工作流的区别'] },
      },
      {
        thought: '结果还不够全面，换更精确的词再搜一次。',
        action: { name: 'web_search', args: { query: 'agentic loop best practices 2026' } },
        observation: { results: ['2026 年 Agent 工程综述', 'Loop guardrails'] },
      },
      {
        thought: '感觉还差一点，换个角度再搜。',
        action: { name: 'web_search', args: { query: '如何设计可靠的 agent loop' } },
        observation: { results: ['可靠性清单', '终止条件设计'] },
      },
      {
        thought: '也许还有更好的资料，继续。',
        action: { name: 'web_search', args: { query: 'agent loop 收敛策略' } },
        observation: { results: ['收敛判据', '预算控制'] },
      },
      {
        thought: '再搜最后一次，确认没有遗漏。',
        action: { name: 'web_search', args: { query: 'agent loop max iterations' } },
        observation: { results: ['防护栏实践', '超时与预算'] },
      },
      {
        thought: '我觉得还能找到更多……',
        action: { name: 'web_search', args: { query: 'loop engineer 方法论' } },
        observation: { results: ['方法论合集', '常见陷阱'] },
      },
    ],
  },
];

const GUARDS = {
  converge: (n) =>
    `触达 max_iterations = ${n}，天气查询 loop 被强制终止。基于已拿到的观测（上海 · 小雨 · 18°C）给出兜底回答：出门带伞、薄外套加长裤。` +
    '（护栏误伤正常任务时的标准动作：用已有信息给出当前最佳回答。）',
  'self-correct': (n) =>
    `触达 max_iterations = ${n}，自我纠偏过程被打断。基于最后一次成功观测（杭州 · 多云 · 21°C）兜底：体感舒适，早晚加件薄长袖。` +
    '（想看完整的纠偏链路，请调大 max_iterations 重放。）',
  diverge: (n, tools) =>
    `触达 max_iterations = ${n}，harness 强制收口：基于已检索的 ${tools} 条资料给出当前最佳回答——` +
    'agentic loop 的核心实践：显式终止条件、token 预算、每轮可观测。（这正是护栏存在的意义。）',
};

/* ---------- 卡片渲染（剧本/实战共用） ---------- */
function ThoughtCard({ text }) {
  return (
    <div className="fade-up rounded-xl border border-[rgba(109,141,255,0.3)] bg-[rgba(109,141,255,0.06)] px-3.5 py-2.5">
      <div className="font-monox text-[11px] text-[var(--color-acc)] mb-1">thought</div>
      <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{text}</p>
    </div>
  );
}
function ActionCard({ name, args }) {
  return (
    <div className="fade-up rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.07)] px-3.5 py-2.5">
      <div className="font-monox text-[11px] text-[var(--color-acc2)] mb-1">action</div>
      <pre className="font-monox text-[12px] text-[var(--color-ink)] whitespace-pre-wrap break-all">{`${name}(${JSON.stringify(args)})`}</pre>
    </div>
  );
}
function ObsCard({ data }) {
  return (
    <div className="fade-up rounded-xl border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.06)] px-3.5 py-2.5">
      <div className="font-monox text-[11px] text-[var(--color-amber)] mb-1">observation</div>
      <pre className="font-monox text-[11.5px] text-[var(--color-mute)] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
function AnswerCard({ text }) {
  return (
    <div className="fade-up rounded-xl border border-[rgba(45,212,191,0.35)] bg-[rgba(45,212,191,0.08)] px-3.5 py-2.5">
      <div className="font-monox text-[11px] text-[var(--color-teal)] mb-1">final answer · 循环终止</div>
      <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{text}</p>
    </div>
  );
}
function GuardCard({ text }) {
  return (
    <div className="fade-up rounded-xl border border-[rgba(251,113,133,0.4)] bg-[rgba(251,113,133,0.08)] px-3.5 py-2.5">
      <div className="font-monox text-[11px] text-[var(--color-rose)] mb-1">guardrail · 强制收口</div>
      <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{text}</p>
    </div>
  );
}

/* ---------- 模式一：教学剧本 ---------- */
function ScriptMode() {
  const [epIdx, setEpIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [maxIter, setMaxIter] = useState(4);
  const scrollRef = useRef(null);

  const ep = EPISODES[epIdx];
  const stopAt = Math.min(ep.iterations.length, maxIter);
  const revealed = ep.iterations.slice(0, step);
  const converged = revealed.some((it) => it.answer);
  const finished = converged || step >= stopAt;
  const guarded = !converged && step >= stopAt;
  const toolCalls = revealed.filter((it) => it.action).length;
  const tokens = revealed.reduce((a, it) => a + est(it.thought) + (it.observation ? est(JSON.stringify(it.observation)) : 0) + (it.answer ? est(it.answer) : 0) + 24, 0);
  const BUDGET = 4000;

  useEffect(() => {
    if (!playing || finished) {
      if (finished) setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 2300 / speed);
    return () => clearTimeout(t);
  }, [playing, step, finished, speed]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [step, guarded]);

  const status = converged
    ? { label: '已收敛', color: 'var(--color-teal)' }
    : guarded
      ? { label: '护栏触发', color: 'var(--color-rose)' }
      : playing
        ? { label: '循环中', color: 'var(--color-acc)' }
        : step > 0
          ? { label: '已暂停', color: 'var(--color-mute)' }
          : { label: '待启动', color: 'var(--color-faint)' };

  return (
    <div className="grid lg:grid-cols-[1fr_250px] gap-3">
      <div className="panel flex flex-col min-h-[460px]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--color-line)]">
          <div className="flex gap-1.5">
            {EPISODES.map((e, i) => (
              <button
                key={e.id}
                onClick={() => {
                  setEpIdx(i);
                  setStep(0);
                  setPlaying(false);
                }}
                className={`chip font-monox cursor-pointer transition-colors ${i === epIdx ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : 'hover:text-[var(--color-ink)]'}`}
              >
                {e.name}
              </button>
            ))}
          </div>
          <span className="chip ml-auto" style={{ color: status.color, borderColor: status.color }}>{status.label}</span>
        </div>

        <div className="px-4 py-2.5 border-b border-[var(--color-line)] flex items-center gap-2">
          <span className="font-monox text-[11px] text-[var(--color-faint)] shrink-0">TASK</span>
          <span className="text-[13px] text-[var(--color-ink)]">{ep.task}</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[380px]">
          {step === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-12">
              <p className="text-[13px] text-[var(--color-faint)] max-w-sm">{ep.note}</p>
              <p className="font-monox text-[11px] text-[var(--color-faint)]">真实 loop 里，每个 iteration 都是一次完整的 LLM 调用</p>
            </div>
          )}
          {revealed.map((it, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-monox text-[10.5px] px-2 py-0.5 rounded-full border border-[var(--color-line)] text-[var(--color-faint)]">iteration {i + 1}</span>
              </div>
              <ThoughtCard text={it.thought} />
              {it.action && <ActionCard name={it.action.name} args={it.action.args} />}
              {it.observation && <ObsCard data={it.observation} />}
              {it.answer && <AnswerCard text={it.answer} />}
            </div>
          ))}
          {guarded && <GuardCard text={GUARDS[ep.id](stopAt, toolCalls)} />}
        </div>

        <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
          {!playing ? (
            <button className="btn" onClick={() => (finished ? (setStep(0), setPlaying(true)) : setPlaying(true))}>
              {finished ? '重放' : step > 0 ? '继续' : '播放'}
            </button>
          ) : (
            <button className="btn" onClick={() => setPlaying(false)}>暂停</button>
          )}
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.min(s + 1, stopAt))} disabled={finished}>单步</button>
          <button className="btn btn-ghost" onClick={() => { setStep(0); setPlaying(false); }}>重置</button>
          <div className="ml-auto flex gap-1">
            {[0.5, 1, 2].map((v) => (
              <button key={v} onClick={() => setSpeed(v)} className={`chip font-monox cursor-pointer transition-colors ${speed === v ? 'border-[var(--color-acc)] text-[var(--color-ink)]' : ''}`}>
                {v}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="panel p-4 flex flex-col gap-4">
        <div>
          <div className="text-[12px] font-monox text-[var(--color-faint)] mb-2.5">LOOP STATE</div>
          <div className="space-y-2 font-monox text-[12px]">
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">iteration</span><span className="text-[var(--color-ink)]">{step} / {stopAt}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">tool calls</span><span className="text-[var(--color-ink)]">{toolCalls}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">tokens</span><span className="text-[var(--color-ink)]">{tokens}</span></div>
          </div>
        </div>
        <div>
          <div className="flex justify-between font-monox text-[11px] mb-1.5">
            <span className="text-[var(--color-mute)]">token 预算</span>
            <span className="text-[var(--color-faint)]">{tokens}/{BUDGET}</span>
          </div>
          <div className="h-2 rounded-full bg-[rgba(148,163,255,0.1)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (tokens / BUDGET) * 100)}%`,
                background: tokens / BUDGET > 0.8 ? 'var(--color-rose)' : 'linear-gradient(90deg, var(--color-acc), var(--color-acc2))',
              }}
            />
          </div>
        </div>
        <div className="pt-3 border-t border-[var(--color-line)]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] text-[var(--color-ink)]">max_iterations</span>
            <span className="font-monox text-[12px] text-[var(--color-acc)]">{maxIter}</span>
          </div>
          <input
            type="range"
            min="2"
            max="6"
            step="1"
            value={maxIter}
            onChange={(e) => {
              setMaxIter(Number(e.target.value));
              setStep(0);
              setPlaying(false);
            }}
            className="w-full accent-[#6d8dff]"
          />
          <p className="text-[11px] text-[var(--color-faint)] leading-relaxed mt-2">护栏太小会误伤正常任务，太大则放任烧钱。调它，然后重放「发散防护」。</p>
        </div>
        <div className="mt-auto pt-3 border-t border-[var(--color-line)] text-[11.5px] text-[var(--color-faint)] leading-relaxed">
          收敛判据 · 预算 · 最大轮数 —— loop 工程的三根保险丝。
        </div>
      </div>
    </div>
  );
}

/* ---------- 模式二：Claude 实战（真实 agentic loop） ---------- */
const LIVE_SYS =
  '你是一个运行在演示环境里的 agent。通过工具完成用户任务，需要几步就用几步，信息够了就直接回答。' +
  '回答用简洁中文。天气与搜索工具返回的是模拟数据，照常用即可。';

function LiveMode() {
  const [hasKey, setHasKey] = useState(!!getKey());
  const [task, setTask] = useState('');
  const [items, setItems] = useState([]); // {kind:'thought'|'action'|'obs'|'answer'|'guard'|'note', ...}
  const [running, setRunning] = useState(false);
  const [maxIter, setMaxIter] = useState(4);
  const [usage, setUsage] = useState({ in: 0, out: 0 });
  const [iterCount, setIterCount] = useState(0);
  const usageRef = useRef({ in: 0, out: 0 });
  const scrollRef = useRef(null);
  const runIdRef = useRef(0);
  const BUDGET = 8000;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const PRESET_TASKS = ['北京和上海今天天气对比，哪个适合户外跑步', '帮我算 (1024*768) / 3.6，再告诉我现在几点', '搜一下 context engineering 并总结要点'];

  const run = async (preset) => {
    const q = (preset ?? task).trim();
    if (!q || running) return;
    const client = makeClient();
    if (!client) return;
    const myId = ++runIdRef.current;
    const alive = () => runIdRef.current === myId;
    setTask('');
    setItems([{ kind: 'task', text: q }]);
    setUsage({ in: 0, out: 0 });
    usageRef.current = { in: 0, out: 0 };
    setIterCount(0);
    setRunning(true);

    const messages = [{ role: 'user', content: q }];
    let converged = false;

    for (let iter = 0; iter < maxIter; iter++) {
      if (!alive()) return;
      let resp;
      try {
        resp = await client.messages.create({ model: getModel(), max_tokens: 1024, system: LIVE_SYS, tools: TOOL_DEFS, messages });
      } catch (e) {
        if (alive()) setItems((prev) => [...prev, { kind: 'note', text: `API 调用失败：${String((e && e.message) || e).slice(0, 160)}` }]);
        setRunning(false);
        return;
      }
      if (!alive()) return;
      setIterCount(iter + 1);
      usageRef.current = { in: usageRef.current.in + resp.usage.input_tokens, out: usageRef.current.out + resp.usage.output_tokens };
      setUsage({ ...usageRef.current });
      messages.push({ role: 'assistant', content: resp.content });

      const texts = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const toolUses = resp.content.filter((b) => b.type === 'tool_use');

      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
        if (texts) setItems((prev) => [...prev, { kind: 'answer', text: texts }]);
        converged = true;
        break;
      }

      if (texts) setItems((prev) => [...prev, { kind: 'thought', text: texts, iter: iter + 1 }]);
      const results = [];
      for (const tu of toolUses) {
        if (!alive()) return;
        setItems((prev) => [...prev, { kind: 'action', name: tu.name, args: tu.input, iter: iter + 1 }]);
        const obs = executeTool(tu.name, tu.input);
        if (!alive()) return;
        setItems((prev) => [...prev, { kind: 'obs', data: obs, iter: iter + 1 }]);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(obs) });
      }
      messages.push({ role: 'user', content: results });
    }

    if (!alive()) return;
    if (!converged) {
      setItems((prev) => [
        ...prev,
        {
          kind: 'guard',
          text: `触达 max_iterations = ${maxIter}，loop 被强制终止。真实 harness 此时会基于已有 ${usageRef.current.in} input tokens 的观察强制收口，或升级给人审。调大右侧滑块再跑一次对比看看。`,
        },
      ]);
    }
    setRunning(false);
  };

  const reset = () => {
    runIdRef.current++;
    setItems([]);
    setRunning(false);
    setUsage({ in: 0, out: 0 });
    setIterCount(0);
  };

  const guarded = items.some((it) => it.kind === 'guard');
  const converged = items.some((it) => it.kind === 'answer');
  const status = converged
    ? { label: '已收敛', color: 'var(--color-teal)' }
    : guarded
      ? { label: '护栏触发', color: 'var(--color-rose)' }
      : running
        ? { label: '循环中', color: 'var(--color-acc)' }
        : { label: '待启动', color: 'var(--color-faint)' };

  return (
    <div className="grid lg:grid-cols-[1fr_250px] gap-3">
      <div className="panel flex flex-col min-h-[460px]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--color-line)]">
          <span className="text-[13px] font-medium text-[var(--color-ink)]">Claude 实战 loop</span>
          <span className="chip">真实模型 · 真实工具决策 · 真实 token</span>
          <span className="chip ml-auto" style={{ color: status.color, borderColor: status.color }}>{status.label}</span>
        </div>

        <div className="px-4 pt-3">
          <KeyPanel onChange={() => setHasKey(!!getKey())} />
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 max-h-[360px]">
          {items.length === 0 && hasKey && (
            <div className="h-full flex flex-col items-center justify-center gap-3 py-10">
              <p className="text-[13px] text-[var(--color-faint)]">给一个任务，看 Claude 自己决定循环几轮：</p>
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {PRESET_TASKS.map((p) => (
                  <button key={p} className="chip cursor-pointer hover:text-[var(--color-ink)] hover:border-[var(--color-line-strong)] transition-colors" onClick={() => run(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((it, i) => {
            if (it.kind === 'task')
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-monox text-[11px] text-[var(--color-faint)] shrink-0">TASK</span>
                  <span className="text-[13px] text-[var(--color-ink)]">{it.text}</span>
                </div>
              );
            if (it.kind === 'thought')
              return (
                <div key={i} className="space-y-1.5">
                  <span className="font-monox text-[10.5px] px-2 py-0.5 rounded-full border border-[var(--color-line)] text-[var(--color-faint)]">iteration {it.iter}</span>
                  <ThoughtCard text={it.text} />
                </div>
              );
            if (it.kind === 'action') return <ActionCard key={i} name={it.name} args={it.args} />;
            if (it.kind === 'obs') return <ObsCard key={i} data={it.data} />;
            if (it.kind === 'answer') return <AnswerCard key={i} text={it.text} />;
            if (it.kind === 'guard') return <GuardCard key={i} text={it.text} />;
            return (
              <div key={i} className="text-center">
                <span className="chip font-monox text-[11px]">{it.text}</span>
              </div>
            );
          })}
          {running && <div className="text-[12px] font-monox text-[var(--color-faint)] pulse-dot">Claude 正在推理下一轮…</div>}
        </div>

        <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) run();
            }}
            placeholder={hasKey ? '布置一个需要多步工具调用的任务…' : '先在上方连接 Claude'}
            disabled={!hasKey}
            className="flex-1 bg-transparent outline-none text-[13px] px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)] disabled:opacity-50"
          />
          <button className="btn" onClick={() => run()} disabled={running || !task.trim() || !hasKey}>运行 loop</button>
          <button className="btn btn-ghost" onClick={reset}>重置</button>
        </div>
      </div>

      <div className="panel p-4 flex flex-col gap-4">
        <div>
          <div className="text-[12px] font-monox text-[var(--color-faint)] mb-2.5">LOOP STATE · LIVE</div>
          <div className="space-y-2 font-monox text-[12px]">
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">iteration</span><span className="text-[var(--color-ink)]">{iterCount} / {maxIter}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">input tok</span><span className="text-[var(--color-teal)]">{usage.in}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">output tok</span><span className="text-[var(--color-teal)]">{usage.out}</span></div>
          </div>
        </div>
        <div>
          <div className="flex justify-between font-monox text-[11px] mb-1.5">
            <span className="text-[var(--color-mute)]">input 预算</span>
            <span className="text-[var(--color-faint)]">{usage.in}/{BUDGET}</span>
          </div>
          <div className="h-2 rounded-full bg-[rgba(148,163,255,0.1)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (usage.in / BUDGET) * 100)}%`,
                background: usage.in / BUDGET > 0.8 ? 'var(--color-rose)' : 'linear-gradient(90deg, var(--color-acc), var(--color-acc2))',
              }}
            />
          </div>
          <p className="text-[11px] text-[var(--color-faint)] leading-relaxed mt-2">
            input tokens 逐轮累加（每轮都重发全部历史）——这就是 agentic loop 的真实成本曲线。
          </p>
        </div>
        <div className="pt-3 border-t border-[var(--color-line)]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[12px] text-[var(--color-ink)]">max_iterations</span>
            <span className="font-monox text-[12px] text-[var(--color-acc)]">{maxIter}</span>
          </div>
          <input type="range" min="2" max="8" step="1" value={maxIter} onChange={(e) => setMaxIter(Number(e.target.value))} className="w-full accent-[#6d8dff]" disabled={running} />
          <p className="text-[11px] text-[var(--color-faint)] leading-relaxed mt-2">把它调到 2，再跑一个需要三步的任务——亲眼看看护栏误伤长什么样。</p>
        </div>
        <div className="mt-auto pt-3 border-t border-[var(--color-line)] text-[11.5px] text-[var(--color-faint)] leading-relaxed">
          同一个 loop 语义，剧本里是教学，这里是实战。
        </div>
      </div>
    </div>
  );
}

export default function LoopSimulator() {
  const [tab, setTab] = useState('script');
  return (
    <div>
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={() => setTab('script')}
          className={`chip font-monox cursor-pointer transition-colors ${tab === 'script' ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : 'hover:text-[var(--color-ink)]'}`}
        >
          教学剧本
        </button>
        <button
          onClick={() => setTab('live')}
          className={`chip font-monox cursor-pointer transition-colors ${tab === 'live' ? 'border-[var(--color-teal)] text-[var(--color-teal)] bg-[rgba(45,212,191,0.1)]' : 'hover:text-[var(--color-ink)]'}`}
        >
          Claude 实战（BYOK）
        </button>
      </div>
      {tab === 'script' ? <ScriptMode /> : <LiveMode />}
    </div>
  );
}
