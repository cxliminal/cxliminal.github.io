import { useState } from 'react';
import WebLlmChat from './WebLlmChat.jsx';
import ClaudeChat from './ClaudeChat.jsx';

export default function HomeChat() {
  const [tab, setTab] = useState('local');
  return (
    <div>
      <div className="flex justify-center gap-1.5 mb-4">
        <button
          onClick={() => setTab('local')}
          className={`chip font-monox cursor-pointer transition-colors ${tab === 'local' ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : 'hover:text-[var(--color-ink)]'}`}
        >
          本地小模型 · WebGPU 离线跑
        </button>
        <button
          onClick={() => setTab('claude')}
          className={`chip font-monox cursor-pointer transition-colors ${tab === 'claude' ? 'border-[var(--color-teal)] text-[var(--color-teal)] bg-[rgba(45,212,191,0.1)]' : 'hover:text-[var(--color-ink)]'}`}
        >
          Claude · BYOK 云端直连
        </button>
      </div>
      {/* 双实例常驻、显隐切换：避免 tab 切换卸载 WebLLM 引擎丢状态 */}
      <div style={{ display: tab === 'local' ? 'block' : 'none' }}>
        <WebLlmChat compact />
      </div>
      <div style={{ display: tab === 'claude' ? 'block' : 'none' }}>
        <ClaudeChat />
      </div>
    </div>
  );
}
