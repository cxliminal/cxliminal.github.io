import { useState, useRef, useEffect } from 'react';
import { makeClient, getKey, getModel } from './claude.js';
import KeyPanel from './KeyPanel.jsx';

const SYSTEM = '你是 Agentic Lab 网站首页的演示模型。用简洁、准确的中文回答，150 字以内。';

export default function ClaudeChat() {
  const [hasKey, setHasKey] = useState(!!getKey());
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [stats, setStats] = useState('');
  const streamRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const send = async (preset) => {
    const content = (preset ?? input).trim();
    if (!content || streaming) return;
    const client = makeClient();
    if (!client) return;
    setInput('');
    const history = [...msgs, { role: 'user', content }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setStreaming(true);
    setStats('');
    try {
      const stream = client.messages.stream({
        model: getModel(),
        max_tokens: 512,
        system: SYSTEM,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
      });
      streamRef.current = stream;
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta && event.delta.type === 'text_delta') {
          const delta = event.delta.text;
          setMsgs((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + delta };
            return next;
          });
        }
      }
      const finalMsg = await stream.finalMessage();
      setStats(`in ${finalMsg.usage.input_tokens} tok · out ${finalMsg.usage.output_tokens} tok · ${getModel()}`);
    } catch (e) {
      if (String((e && e.name) || '') !== 'APIUserAbortError') {
        setMsgs((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: 'assistant',
            content: next[next.length - 1].content + `\n\n[调用失败：${String((e && e.message) || e).slice(0, 140)}]`,
          };
          return next;
        });
      }
    }
    streamRef.current = null;
    setStreaming(false);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-[var(--color-line)]">
        <span className="relative flex h-2 w-2">
          <span className={`pulse-dot absolute inline-flex h-full w-full rounded-full ${hasKey ? 'bg-[var(--color-teal)]' : 'bg-[var(--color-faint)]'}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${hasKey ? 'bg-[var(--color-teal)]' : 'bg-[var(--color-faint)]'}`}></span>
        </span>
        <span className="text-[13px] font-medium text-[var(--color-ink)]">Claude 直连</span>
        <span className="chip font-monox">BYOK · key 不出浏览器</span>
        <span className="ml-auto font-monox text-[11px] text-[var(--color-faint)]">{getModel()}</span>
      </div>

      <div className="px-4 pt-3">
        <KeyPanel onChange={() => setHasKey(!!getKey())} />
      </div>

      <div ref={scrollRef} className="h-64 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-[13px] text-[var(--color-faint)]">{hasKey ? '已连接，直接开问：' : '连接 Claude 后，这里就是你的实战聊天窗'}</p>
            {hasKey && (
              <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {['用一句话解释 harness engineering', 'agent 和 workflow 的区别是什么', '为什么 token 消耗能解释 80% 的性能差异'].map((p) => (
                  <button key={p} className="chip cursor-pointer hover:text-[var(--color-ink)] hover:border-[var(--color-line-strong)] transition-colors" onClick={() => send(p)}>
                    {p}
                  </button>
                ))}
              </div>
            )}
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

      {stats && <div className="px-4 py-1.5 border-t border-[var(--color-line)] font-monox text-[11px] text-[var(--color-faint)] truncate">{stats}</div>}

      <div className="flex items-center gap-2 px-3 py-3 border-t border-[var(--color-line)]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
          }}
          placeholder={hasKey ? '问 Claude 点什么…' : '先在上方连接 Claude'}
          disabled={!hasKey}
          className="flex-1 bg-transparent outline-none text-[13.5px] px-2 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-faint)] disabled:opacity-50"
        />
        {streaming ? (
          <button className="btn btn-ghost" onClick={() => streamRef.current && streamRef.current.abort()}>停止</button>
        ) : (
          <button className="btn" onClick={() => send()} disabled={!input.trim() || !hasKey}>发送</button>
        )}
        <button className="btn btn-ghost" onClick={() => { setMsgs([]); setStats(''); }} title="清空对话">重置</button>
      </div>
    </div>
  );
}
