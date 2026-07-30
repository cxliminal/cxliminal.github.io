import { useState, useRef, useEffect } from 'react';

/* web-llm runtime 体积数 MB，按需加载：点「加载模型」时才动态 import，首屏不背这个包 */
const loadWebllm = () => import('@mlc-ai/web-llm');

const SYSTEM = '你是 Agentic Lab 网站里的页内演示模型，运行在访客的浏览器里。用简洁、准确的中文回答，回答控制在 150 字以内。';
const PRESETS = ['用一句话解释 context engineering', '写一个 4 行以内的 Python 快排', '用大白话解释什么是 agentic loop'];

const COMPACT_OPTIONS = ['Qwen2.5-0.5B-Instruct-q4f16_1-MLC'];
const FULL_OPTIONS = [
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC',
  'SmolLM2-360M-Instruct-q4f16_1-MLC',
];
const FALLBACK_KWS = ['Qwen2.5-0.5B-Instruct', 'SmolLM2-360M-Instruct', 'Llama-3.2-1B-Instruct', 'Qwen2-0.5B-Instruct'];

/* 引擎提升为模块级单例：组件卸载/页面切换后模型不必重载 */
let sharedEngine = null;
let sharedModelId = '';

function ensureModel(webllm, wanted) {
  let list = [];
  try {
    list = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
  } catch {
    /* noop */
  }
  if (list.includes(wanted)) return wanted;
  for (const kw of FALLBACK_KWS) {
    const hit = list.find((id) => id.includes(kw) && id.includes('q4f16_1'));
    if (hit) return hit;
  }
  return list.find((id) => id.includes('q4f16_1')) || wanted;
}

export default function WebLlmChat({ compact = false }) {
  const [status, setStatus] = useState(() => (sharedEngine ? 'ready' : 'checking')); // checking | idle | loading | ready | unsupported | error
  const [progress, setProgress] = useState({ text: '', progress: 0 });
  const [options] = useState(() => (compact ? COMPACT_OPTIONS : FULL_OPTIONS));
  const [modelId, setModelId] = useState(() => sharedModelId || (compact ? COMPACT_OPTIONS[0] : FULL_OPTIONS[0]));
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [stats, setStats] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (sharedEngine) return;
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
  }, [msgs, streaming]);

  const load = async (target) => {
    setStatus('loading');
    setErrMsg('');
    try {
      const webllm = await loadWebllm();
      const id = ensureModel(webllm, target || modelId);
      if (sharedEngine) {
        await sharedEngine.reload(id);
      } else {
        sharedEngine = await webllm.CreateMLCEngine(id, {
          initProgressCallback: (p) => setProgress({ text: p.text || '', progress: p.progress || 0 }),
        });
      }
      sharedModelId = id;
      setModelId(id);
      setStatus('ready');
    } catch (e) {
      setErrMsg(String(e && e.message ? e.message : e).slice(0, 300));
      setStatus('error');
    }
  };

  const send = async (preset) => {
    const content = (preset ?? input).trim();
    if (!content || streaming || status !== 'ready') return;
    setInput('');
    const history = [...msgs, { role: 'user', content }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    try {
      const chunks = await sharedEngine.chat.completions.create({
        messages: [{ role: 'system', content: SYSTEM }, ...history],
        stream: true,
        temperature: 0.7,
        max_tokens: 512,
      });
      for await (const c of chunks) {
        const delta = (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content) || '';
        if (delta) {
          setMsgs((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { role: 'assistant', content: last.content + delta };
            return next;
          });
        }
      }
      try {
        setStats(await sharedEngine.runtimeStatsText());
      } catch {
        setStats('');
      }
    } catch (e) {
      setMsgs((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: '生成中断：' + String(e && e.message ? e.message : e).slice(0, 120) };
        return next;
      });
    }
    setStreaming(false);
  };

  const stop = async () => {
    try {
      await sharedEngine.interruptGenerate();
    } catch {
      /* noop */
    }
  };

  const reset = async () => {
    setMsgs([]);
    setStats('');
    try {
      await sharedEngine.resetChat();
    } catch {
      /* noop */
    }
  };

  return (
    <div className="panel overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-[var(--color-line)]">
        <span className="relative flex h-2 w-2">
          <span className={`pulse-dot absolute inline-flex h-full w-full rounded-full ${status === 'ready' ? 'bg-[var(--color-teal)]' : 'bg-[var(--color-faint)]'}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${status === 'ready' ? 'bg-[var(--color-teal)]' : 'bg-[var(--color-faint)]'}`}></span>
        </span>
        <span className="text-[13px] font-medium text-[var(--color-ink)]">本页运行着一个 LLM</span>
        <span className="chip font-monox">无后端 · WebGPU · 数据不出本机</span>
        <span className="ml-auto font-monox text-[11px] text-[var(--color-faint)] truncate max-w-[45%]">{modelId}</span>
      </div>

      {/* unsupported / error */}
      {status === 'unsupported' && (
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] text-[var(--color-ink)] mb-2">当前浏览器不支持 WebGPU</p>
          <p className="text-[13px] text-[var(--color-mute)] leading-relaxed max-w-md mx-auto">
            这个 demo 需要 WebGPU 在本地跑模型推理。请用最新版 Chrome / Edge 桌面端访问；
            在此之前，可以先去 <a href="/loop/" className="text-[var(--color-acc)]">Loop 篇章</a> 玩不需要 GPU 的模拟器。
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] text-[var(--color-rose)] mb-2">模型加载失败</p>
          <p className="font-monox text-[12px] text-[var(--color-mute)] break-all max-w-lg mx-auto mb-4">{errMsg}</p>
          <button className="btn" onClick={() => load()}>重试</button>
        </div>
      )}

      {/* idle: load gate */}
      {(status === 'idle' || status === 'checking') && (
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] text-[var(--color-ink)] mb-1.5">
            {status === 'checking' ? '正在检测 WebGPU…' : '点击加载，模型就会下载并进驻这个页面'}
          </p>
          <p className="text-[12.5px] text-[var(--color-mute)] mb-5 leading-relaxed">
            首次加载需下载模型权重（百 MB 级，之后走浏览器缓存）。
            推理全部发生在你自己的 GPU 上，这个网站没有后端。
          </p>
          {!compact && options.length > 1 && (
            <div className="flex flex-wrap justify-center gap-2 mb-5">
              {options.map((id) => (
                <button
                  key={id}
                  onClick={() => setModelId(id)}
                  className={`chip font-monox cursor-pointer transition-colors ${id === modelId ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : 'hover:text-[var(--color-ink)]'}`}
                >
                  {id.replace('-q4f16_1-MLC', '').replace(/-Instruct$/, '')}
                </button>
              ))}
            </div>
          )}
          <button className="btn" disabled={status === 'checking'} onClick={() => load()}>
            加载模型
          </button>
        </div>
      )}

      {/* loading */}
      {status === 'loading' && (
        <div className="px-5 py-8">
          <div className="flex items-center justify-between text-[12px] font-monox text-[var(--color-mute)] mb-2">
            <span className="truncate pr-4">{progress.text || '初始化…'}</span>
            <span>{Math.round((progress.progress || 0) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[rgba(148,163,255,0.12)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--color-acc)] to-[var(--color-acc2)] transition-all duration-300"
              style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }}
            />
          </div>
          <p className="text-[12px] text-[var(--color-faint)] mt-3 text-center">权重正在下载并编译到 WebGPU，首次需要一两分钟</p>
        </div>
      )}

      {/* ready: chat */}
      {status === 'ready' && (
        <>
          <div ref={scrollRef} className={`${compact ? 'h-72' : 'h-96'} overflow-y-auto px-4 py-4 space-y-3`}>
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-[13px] text-[var(--color-faint)]">模型已就绪。问点什么，或者点下面的预设：</p>
                <div className="flex flex-wrap justify-center gap-2 max-w-md">
                  {PRESETS.map((p) => (
                    <button key={p} className="chip cursor-pointer hover:text-[var(--color-ink)] hover:border-[var(--color-line-strong)] transition-colors" onClick={() => send(p)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${
                    m.role === 'user'
                      ? 'bg-[rgba(109,141,255,0.16)] text-[var(--color-ink)]'
                      : 'bg-[var(--color-panel2)] border border-[var(--color-line)] text-[var(--color-mute)]'
                  }`}
                >
                  {m.content || (streaming && i === msgs.length - 1 ? <span className="text-[var(--color-faint)]">思考中…</span> : '')}
                </div>
              </div>
            ))}
          </div>

          {stats && (
            <div className="px-4 py-1.5 border-t border-[var(--color-line)] font-monox text-[11px] text-[var(--color-faint)] truncate">{stats}</div>
          )}

          <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
              }}
              placeholder="问这个页内模型点什么…"
              className="flex-1 bg-transparent outline-none text-[13.5px] px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)]"
            />
            {streaming ? (
              <button className="btn btn-ghost" onClick={stop}>停止</button>
            ) : (
              <button className="btn" onClick={() => send()} disabled={!input.trim()}>发送</button>
            )}
            <button className="btn btn-ghost" onClick={reset} title="清空对话">重置</button>
          </div>
        </>
      )}
    </div>
  );
}
