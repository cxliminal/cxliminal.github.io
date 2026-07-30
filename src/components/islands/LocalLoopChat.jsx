import { useState, useRef, useEffect } from 'react';
import { executeTool, TOOL_DEFS } from './claude.js';

/* WebLLM function calling 驱动的本地 agentic loop：引擎独立单例，按需动态 import */
const loadWebllm = () => import('@mlc-ai/web-llm');

let loopEngine = null;
let loopModelId = '';

const PREFS = ['Qwen2.5-1.5B-Instruct', 'Qwen2.5-0.5B-Instruct', 'Llama-3.2-1B-Instruct'];
const SYS =
  '你是一个运行在浏览器里的本地 agent。完成用户任务需要数据时，必须调用提供的工具，禁止编造观测数据。' +
  '信息足够后用简洁中文直接回答。天气与搜索工具在演示环境可能返回模拟数据，照常用即可。';
const PRESET_TASKS = ['北京和上海今天天气对比，哪个适合户外跑步', '帮我算 (1024*768)/3.6，再告诉我现在几点', '搜一下 context engineering 并总结成三点'];

const est = (s) => Math.max(4, Math.ceil(String(s).length / 2));

function resolveLoopModel(webllm) {
  let list = [];
  try {
    list = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
  } catch {
    /* noop */
  }
  for (const kw of PREFS) {
    const hit = list.find((id) => id.includes(kw) && id.includes('q4f16_1'));
    if (hit) return hit;
  }
  return list.find((id) => id.includes('q4f16_1')) || 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
}

const OAI_TOOLS = TOOL_DEFS.map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

export default function LocalLoopChat() {
  const [status, setStatus] = useState(() => (loopEngine ? 'ready' : 'checking'));
  const [progress, setProgress] = useState({ text: '', progress: 0 });
  const [errMsg, setErrMsg] = useState('');
  const [items, setItems] = useState([]);
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [maxIter, setMaxIter] = useState(4);
  const [tokens, setTokens] = useState(0);
  const [iterCount, setIterCount] = useState(0);
  const [noFcHint, setNoFcHint] = useState(false);
  const scrollRef = useRef(null);
  const runIdRef = useRef(0);
  const BUDGET = 8000;

  useEffect(() => {
    if (loopEngine) return;
    (async () => {
      if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        setStatus('unsupported');
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        setStatus(adapter ? 'idle' : 'unsupported');
      } catch {
        setStatus('unsupported');
      }
    })();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const load = async () => {
    setStatus('loading');
    setErrMsg('');
    try {
      const webllm = await loadWebllm();
      const id = resolveLoopModel(webllm);
      if (loopEngine) await loopEngine.reload(id);
      else {
        loopEngine = await webllm.CreateMLCEngine(id, {
          initProgressCallback: (p) => setProgress({ text: p.text || '', progress: p.progress || 0 }),
        });
      }
      loopModelId = id;
      setStatus('ready');
    } catch (e) {
      setErrMsg(String((e && e.message) || e).slice(0, 300));
      setStatus('error');
    }
  };

  const run = async (preset) => {
    const q = (preset ?? task).trim();
    if (!q || running || status !== 'ready') return;
    const myId = ++runIdRef.current;
    const alive = () => runIdRef.current === myId;
    setTask('');
    setItems([{ kind: 'task', text: q }]);
    setNoFcHint(false);
    setTokens(0);
    setIterCount(0);
    setRunning(true);

    const messages = [
      { role: 'system', content: SYS },
      { role: 'user', content: q },
    ];
    let converged = false;
    let usedTools = false;

    for (let iter = 0; iter < maxIter; iter++) {
      if (!alive()) return;
      let resp;
      try {
        resp = await loopEngine.chat.completions.create({
          messages,
          tools: OAI_TOOLS,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 512,
        });
      } catch (e) {
        if (alive()) setItems((prev) => [...prev, { kind: 'note', text: `推理失败：${String((e && e.message) || e).slice(0, 140)}` }]);
        setRunning(false);
        return;
      }
      if (!alive()) return;
      setIterCount(iter + 1);
      setTokens((prev) => prev + est(JSON.stringify(messages)) + 200);

      const msg = (resp.choices && resp.choices[0] && resp.choices[0].message) || {};
      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        const text = msg.content || '';
        if (text) setItems((prev) => [...prev, { kind: 'answer', text }]);
        converged = true;
        if (iter === 0 && !usedTools) setNoFcHint(true);
        break;
      }

      if (msg.content) setItems((prev) => [...prev, { kind: 'thought', text: msg.content, iter: iter + 1 }]);
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: toolCalls });

      for (const tc of toolCalls) {
        if (!alive()) return;
        let args = {};
        try {
          args = JSON.parse((tc.function && tc.function.arguments) || '{}');
        } catch {
          args = {};
        }
        setItems((prev) => [...prev, { kind: 'action', name: tc.function.name, args, iter: iter + 1 }]);
        const obs = await executeTool(tc.function.name, args);
        usedTools = true;
        if (!alive()) return;
        setItems((prev) => [...prev, { kind: 'obs', data: obs, iter: iter + 1 }]);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(obs) });
      }
    }

    if (!alive()) return;
    if (!converged) {
      setItems((prev) => [
        ...prev,
        { kind: 'guard', text: `触达 max_iterations = ${maxIter}，loop 被强制终止。调大右侧滑块或简化任务再试。` },
      ]);
    }
    setRunning(false);
  };

  const reset = () => {
    runIdRef.current++;
    setItems([]);
    setRunning(false);
    setTokens(0);
    setIterCount(0);
    setNoFcHint(false);
    try {
      loopEngine && loopEngine.resetChat();
    } catch {
      /* noop */
    }
  };

  const guarded = items.some((it) => it.kind === 'guard');
  const converged = items.some((it) => it.kind === 'answer');
  const statusMeta = converged
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
          <span className="text-[13px] font-medium text-[var(--color-ink)]">本地模型实战 loop</span>
          <span className="chip">WebLLM function calling · 无需 key</span>
          <span className="chip ml-auto" style={{ color: statusMeta.color, borderColor: statusMeta.color }}>{statusMeta.label}</span>
        </div>

        {status === 'unsupported' && (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-[var(--color-ink)] mb-2">当前浏览器不支持 WebGPU</p>
            <p className="text-[13px] text-[var(--color-mute)]">本地 loop 需要 WebGPU。可以切到「Claude 实战」或玩「教学剧本」。</p>
          </div>
        )}

        {status === 'error' && (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-[var(--color-rose)] mb-2">模型加载失败</p>
            <p className="font-monox text-[12px] text-[var(--color-mute)] break-all max-w-lg mx-auto mb-4">{errMsg}</p>
            <button className="btn" onClick={load}>重试</button>
          </div>
        )}

        {(status === 'idle' || status === 'checking') && (
          <div className="px-5 py-10 text-center">
            <p className="text-[14px] text-[var(--color-ink)] mb-1.5">{status === 'checking' ? '正在检测 WebGPU…' : '加载本地模型，零 key 跑真实 agentic loop'}</p>
            <p className="text-[12.5px] text-[var(--color-mute)] mb-5 leading-relaxed max-w-md mx-auto">
              模型在你的 GPU 上做 function calling：自己决定调工具、读观测、再推理。
              小模型能力有限，loop 可能笨拙——这正是观察模型能力边界的好机会。
            </p>
            <button className="btn" disabled={status === 'checking'} onClick={load}>加载模型</button>
          </div>
        )}

        {status === 'loading' && (
          <div className="px-5 py-10">
            <div className="flex items-center justify-between text-[12px] font-monox text-[var(--color-mute)] mb-2">
              <span className="truncate pr-4">{progress.text || '初始化…'}</span>
              <span>{Math.round((progress.progress || 0) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[rgba(148,163,255,0.12)] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[var(--color-acc)] to-[var(--color-acc2)] transition-all duration-300" style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }} />
            </div>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 max-h-[360px]">
              {items.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-3 py-10">
                  <p className="text-[13px] text-[var(--color-faint)]">布置一个需要多步工具调用的任务：</p>
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
                      <div className="fade-up rounded-xl border border-[rgba(109,141,255,0.3)] bg-[rgba(109,141,255,0.06)] px-3.5 py-2.5">
                        <div className="font-monox text-[11px] text-[var(--color-acc)] mb-1">thought</div>
                        <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{it.text}</p>
                      </div>
                    </div>
                  );
                if (it.kind === 'action')
                  return (
                    <div key={i} className="fade-up rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.07)] px-3.5 py-2.5">
                      <div className="font-monox text-[11px] text-[var(--color-acc2)] mb-1">action</div>
                      <pre className="font-monox text-[12px] text-[var(--color-ink)] whitespace-pre-wrap break-all">{`${it.name}(${JSON.stringify(it.args)})`}</pre>
                    </div>
                  );
                if (it.kind === 'obs')
                  return (
                    <div key={i} className="fade-up rounded-xl border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.06)] px-3.5 py-2.5">
                      <div className="font-monox text-[11px] text-[var(--color-amber)] mb-1">observation</div>
                      <pre className="font-monox text-[11.5px] text-[var(--color-mute)] whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{JSON.stringify(it.data, null, 2)}</pre>
                    </div>
                  );
                if (it.kind === 'answer')
                  return (
                    <div key={i} className="fade-up rounded-xl border border-[rgba(45,212,191,0.35)] bg-[rgba(45,212,191,0.08)] px-3.5 py-2.5">
                      <div className="font-monox text-[11px] text-[var(--color-teal)] mb-1">final answer · 循环终止</div>
                      <p className="text-[13px] leading-relaxed text-[var(--color-ink)] whitespace-pre-wrap">{it.text}</p>
                    </div>
                  );
                if (it.kind === 'guard')
                  return (
                    <div key={i} className="fade-up rounded-xl border border-[rgba(251,113,133,0.4)] bg-[rgba(251,113,133,0.08)] px-3.5 py-2.5">
                      <div className="font-monox text-[11px] text-[var(--color-rose)] mb-1">guardrail · 强制收口</div>
                      <p className="text-[13px] leading-relaxed text-[var(--color-ink)]">{it.text}</p>
                    </div>
                  );
                return (
                  <div key={i} className="text-center">
                    <span className="chip font-monox text-[11px]">{it.text}</span>
                  </div>
                );
              })}
              {noFcHint && converged && (
                <div className="text-center">
                  <span className="chip font-monox text-[11px]">注意：模型首轮未调用任何工具——本地小模型的 function calling 能力不稳定，可换任务重试，或切「Claude 实战」对比</span>
                </div>
              )}
              {running && <div className="text-[12px] font-monox text-[var(--color-faint)] pulse-dot">本地模型正在推理下一轮…</div>}
            </div>

            <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) run();
                }}
                placeholder="布置一个需要多步工具调用的任务…"
                className="flex-1 bg-transparent outline-none text-[13px] px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)]"
              />
              <button className="btn" onClick={() => run()} disabled={running || !task.trim()}>运行 loop</button>
              <button className="btn btn-ghost" onClick={reset}>重置</button>
            </div>
          </>
        )}
      </div>

      <div className="panel p-4 flex flex-col gap-4">
        <div>
          <div className="text-[12px] font-monox text-[var(--color-faint)] mb-2.5">LOOP STATE · LOCAL</div>
          <div className="space-y-2 font-monox text-[12px]">
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">engine</span><span className="text-[var(--color-ink)] truncate max-w-[130px]">{loopModelId || '—'}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">iteration</span><span className="text-[var(--color-ink)]">{iterCount} / {maxIter}</span></div>
            <div className="flex justify-between"><span className="text-[var(--color-mute)]">tokens（估算）</span><span className="text-[var(--color-ink)]">{tokens}</span></div>
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
          <input type="range" min="2" max="6" step="1" value={maxIter} onChange={(e) => setMaxIter(Number(e.target.value))} className="w-full accent-[#6d8dff]" disabled={running} />
        </div>
        <div className="mt-auto pt-3 border-t border-[var(--color-line)] text-[11.5px] text-[var(--color-faint)] leading-relaxed">
          与「Claude 实战」同一套 loop 语义、同一批工具——差异全在模型。这就是对比实验。
        </div>
      </div>
    </div>
  );
}
