import { useState } from 'react';
import { getKey, saveKey, getModel, saveModel, maskKey, MODEL_OPTIONS } from './claude.js';

export default function KeyPanel({ onChange }) {
  const [keyInput, setKeyInput] = useState('');
  const [model, setModel] = useState(getModel());
  const [editing, setEditing] = useState(!getKey());
  const savedKey = getKey();

  const save = () => {
    const k = keyInput.trim();
    if (!k) return;
    saveKey(k);
    saveModel(model);
    setKeyInput('');
    setEditing(false);
    onChange && onChange();
  };

  const clear = () => {
    saveKey('');
    setEditing(true);
    onChange && onChange();
  };

  if (savedKey && !editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="chip font-monox !border-[rgba(45,212,191,0.4)] !text-[var(--color-teal)]">Claude 已连接 · {maskKey(savedKey)}</span>
        <select
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            saveModel(e.target.value);
            onChange && onChange();
          }}
          className="bg-[var(--color-panel2)] border border-[var(--color-line)] rounded-full px-2.5 py-1 text-[11.5px] text-[var(--color-mute)] outline-none cursor-pointer"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button className="chip cursor-pointer hover:text-[var(--color-ink)] transition-colors" onClick={() => setEditing(true)}>更换</button>
        <button className="chip cursor-pointer hover:text-[var(--color-rose)] transition-colors" onClick={clear}>清除</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.05)] p-4">
      <div className="text-[13px] font-medium text-[var(--color-ink)] mb-1.5">连接 Claude（BYOK）</div>
      <p className="text-[12px] text-[var(--color-mute)] leading-relaxed mb-3">
        粘贴你的 Anthropic API key，demo 将由真实模型驱动。key 只存在浏览器 localStorage，
        除 api.anthropic.com 外不经过任何服务器——这个站没有后端。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="sk-ant-..."
          className="flex-1 min-w-[220px] bg-[var(--color-panel2)] border border-[var(--color-line)] rounded-lg px-3 py-2 text-[13px] font-monox text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-[var(--color-panel2)] border border-[var(--color-line)] rounded-lg px-2.5 py-2 text-[12px] text-[var(--color-mute)] outline-none cursor-pointer"
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button className="btn" onClick={save} disabled={!keyInput.trim()}>连接</button>
      </div>
    </div>
  );
}
