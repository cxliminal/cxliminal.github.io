import { useState, useRef, useEffect } from 'react';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOPOS = {
  pipeline: {
    name: '流水线',
    desc: '线性接力，审核不通过会打回——图里也能有环。',
    nodes: [
      { id: 'input', label: '输入', x: 90, y: 210, tone: 'gray' },
      { id: 'retrieve', label: '检索员', x: 230, y: 210, tone: 'acc' },
      { id: 'summary', label: '撰稿员', x: 370, y: 210, tone: 'acc' },
      { id: 'review', label: '审核员', x: 510, y: 210, tone: 'acc' },
      { id: 'output', label: '输出', x: 650, y: 210, tone: 'gray' },
    ],
    edges: [['input', 'retrieve'], ['retrieve', 'summary'], ['summary', 'review'], ['review', 'output'], ['review', 'summary']],
    script: [
      { f: 'input', t: 'retrieve', msg: '任务：整理 agentic coding 要点' },
      { f: 'retrieve', t: 'summary', msg: '原始资料 ×4' },
      { f: 'summary', t: 'review', msg: '初稿 v1' },
      { f: 'review', t: 'summary', msg: '打回：第 2 节事实存疑' },
      { f: 'summary', t: 'review', msg: '修订稿 v2' },
      { f: 'review', t: 'output', msg: '通过，发布' },
    ],
  },
  supervisor: {
    name: '主管-工人',
    desc: '一个 supervisor 分派任务、汇总结果，工人互不通信。',
    nodes: [
      { id: 'supervisor', label: '主管', x: 380, y: 210, tone: 'boss' },
      { id: 'researcher', label: '检索员', x: 170, y: 105, tone: 'acc' },
      { id: 'writer', label: '撰稿员', x: 170, y: 315, tone: 'acc' },
      { id: 'critic', label: '评审员', x: 600, y: 210, tone: 'acc' },
    ],
    edges: [['supervisor', 'researcher'], ['supervisor', 'writer'], ['supervisor', 'critic']],
    script: [
      { f: 'supervisor', t: 'researcher', msg: '分工①：检索资料' },
      { f: 'researcher', t: 'supervisor', msg: '资料已回传' },
      { f: 'supervisor', t: 'writer', msg: '分工②：基于资料成稿' },
      { f: 'writer', t: 'supervisor', msg: '初稿完成' },
      { f: 'supervisor', t: 'critic', msg: '分工③：评审初稿' },
      { f: 'critic', t: 'supervisor', msg: '评审通过 · 任务完成' },
    ],
  },
  debate: {
    name: '辩论',
    desc: '三个角色互相质询，评委收敛共识——涌现式协作。',
    nodes: [
      { id: 'pro', label: '正方', x: 230, y: 115, tone: 'acc' },
      { id: 'con', label: '反方', x: 230, y: 305, tone: 'acc' },
      { id: 'devil', label: '质疑者', x: 480, y: 210, tone: 'acc2' },
      { id: 'judge', label: '评委', x: 645, y: 210, tone: 'amber' },
    ],
    edges: [['pro', 'con'], ['con', 'devil'], ['devil', 'pro'], ['pro', 'judge'], ['con', 'judge'], ['devil', 'judge']],
    script: [
      { f: 'pro', t: 'con', msg: '立论：loop 足以解决多数任务' },
      { f: 'con', t: 'devil', msg: '反驳：无结构 loop 不可控' },
      { f: 'devil', t: 'pro', msg: '质询：预算从哪来？' },
      { f: 'pro', t: 'judge', msg: '总结陈词' },
      { f: 'con', t: 'judge', msg: '总结陈词' },
      { f: 'devil', t: 'judge', msg: '补充意见' },
      { f: 'judge', t: 'judge', msg: '共识：loop + 防护栏 + 显式状态', self: true },
    ],
  },
};

const TONE = {
  gray: { fill: '#1a1a28', stroke: '#62627a', text: '#9b9bb4' },
  acc: { fill: 'rgba(109,141,255,0.14)', stroke: '#6d8dff', text: '#b7c5ff' },
  acc2: { fill: 'rgba(167,139,250,0.14)', stroke: '#a78bfa', text: '#d3c6ff' },
  boss: { fill: 'rgba(167,139,250,0.2)', stroke: '#a78bfa', text: '#e2d8ff' },
  amber: { fill: 'rgba(251,191,36,0.14)', stroke: '#fbbf24', text: '#ffe1a3' },
};

export default function GraphPlayground() {
  const [topoId, setTopoId] = useState('pipeline');
  const [pos, setPos] = useState(() => {
    const init = {};
    for (const [k, t] of Object.entries(TOPOS)) {
      init[k] = {};
      for (const n of t.nodes) init[k][n.id] = { x: n.x, y: n.y };
    }
    return init;
  });
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(null);
  const [packet, setPacket] = useState(null); // {x,y}
  const [hotEdge, setHotEdge] = useState(null);
  const [log, setLog] = useState([]);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const runRef = useRef(0);
  const logRef = useRef(null);

  const topo = TOPOS[topoId];
  const P = pos[topoId];

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 760,
      y: ((e.clientY - rect.top) / rect.height) * 420,
    };
  };

  const onNodeDown = (id) => (e) => {
    if (running) return;
    e.preventDefault();
    const p = toSvg(e);
    dragRef.current = { id, dx: p.x - P[id].x, dy: p.y - P[id].y };
  };

  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toSvg(e);
    const nx = Math.max(50, Math.min(710, p.x - d.dx));
    const ny = Math.max(50, Math.min(370, p.y - d.dy));
    setPos((prev) => ({ ...prev, [topoId]: { ...prev[topoId], [d.id]: { x: nx, y: ny } } }));
  };

  const onUp = () => {
    dragRef.current = null;
  };

  const animatePacket = async (from, to, dur = 750) => {
    const a = P[from];
    const b = P[to];
    setPacket({ x: a.x, y: a.y, dur: 0 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    setPacket({ x: b.x, y: b.y, dur });
    await sleep(dur + 40);
    setPacket(null);
  };

  const run = async () => {
    if (running) return;
    const myId = ++runRef.current;
    const alive = () => runRef.current === myId;
    setRunning(true);
    setLog([]);
    for (const step of topo.script) {
      if (!alive()) return;
      setHotEdge([step.f, step.t]);
      setActive(step.f);
      if (step.self) {
        setActive(step.t);
        setLog((prev) => [...prev, { f: step.f, t: step.t, msg: step.msg, self: true }]);
        await sleep(900);
        continue;
      }
      await animatePacket(step.f, step.t);
      if (!alive()) return;
      setActive(step.t);
      setLog((prev) => [...prev, { f: step.f, t: step.t, msg: step.msg }]);
      await sleep(320);
    }
    setHotEdge(null);
    setRunning(false);
    setTimeout(() => {
      if (alive()) setActive(null);
    }, 1200);
  };

  const switchTopo = (id) => {
    runRef.current++;
    setTopoId(id);
    setRunning(false);
    setLog([]);
    setActive(null);
    setPacket(null);
    setHotEdge(null);
  };

  const nodeById = (id) => topo.nodes.find((n) => n.id === id);

  return (
    <div className="grid lg:grid-cols-[1fr_250px] gap-3">
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-[var(--color-line)]">
          <div className="flex gap-1.5">
            {Object.entries(TOPOS).map(([id, t]) => (
              <button
                key={id}
                onClick={() => switchTopo(id)}
                className={`chip font-monox cursor-pointer transition-colors ${id === topoId ? 'border-[var(--color-acc)] text-[var(--color-ink)] bg-[rgba(109,141,255,0.15)]' : 'hover:text-[var(--color-ink)]'}`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <button className="btn ml-auto !py-1.5" onClick={run} disabled={running}>
            {running ? '运行中…' : '运行'}
          </button>
        </div>

        <svg
          ref={svgRef}
          viewBox="0 0 760 420"
          className="w-full touch-none select-none"
          role="img"
          aria-label="多智能体拓扑图：节点可拖拽，点击运行后消息沿边流动"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        >
          {topo.edges.map(([a, b]) => {
            const pa = P[a];
            const pb = P[b];
            const hot = hotEdge && hotEdge[0] === a && hotEdge[1] === b;
            const hasReverse = topo.edges.some(([x, y]) => x === b && y === a);
            const stroke = hot ? 'var(--color-acc)' : 'var(--color-line-strong)';
            const width = hot ? 2 : 1.2;
            const dash = a === 'review' && b === 'summary' ? '5 4' : undefined;
            if (hasReverse) {
              const mx = (pa.x + pb.x) / 2;
              const my = (pa.y + pb.y) / 2;
              const dx = pb.x - pa.x;
              const dy = pb.y - pa.y;
              const len = Math.hypot(dx, dy) || 1;
              const cx = mx + (-dy / len) * 26;
              const cy = my + (dx / len) * 26;
              return (
                <path
                  key={`${a}-${b}`}
                  d={`M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={width}
                  strokeDasharray={dash}
                  style={{ transition: 'stroke 0.3s' }}
                />
              );
            }
            return (
              <line
                key={`${a}-${b}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={stroke}
                strokeWidth={width}
                strokeDasharray={dash}
                style={{ transition: 'stroke 0.3s' }}
              />
            );
          })}

          {packet && (
            <g style={{ transform: `translate(${packet.x}px, ${packet.y}px)`, transition: `transform ${packet.dur}ms cubic-bezier(0.4, 0, 0.2, 1)` }}>
              <circle r="7" fill="var(--color-acc)" opacity="0.25" />
              <circle r="3.5" fill="var(--color-acc)" />
            </g>
          )}

          {topo.nodes.map((n) => {
            const p = P[n.id];
            const tone = TONE[n.tone];
            const isActive = active === n.id;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={onNodeDown(n.id)}
                style={{ cursor: running ? 'default' : 'grab' }}
              >
                {isActive && <circle r="34" fill="none" stroke={tone.stroke} strokeWidth="1" opacity="0.5" className="pulse-dot" />}
                <circle
                  r="26"
                  fill={tone.fill}
                  stroke={tone.stroke}
                  strokeWidth={isActive ? 2.2 : 1.2}
                  style={{ transition: 'stroke-width 0.25s' }}
                />
                <text textAnchor="middle" dominantBaseline="central" fontSize="15" fill={tone.text} style={{ pointerEvents: 'none' }}>
                  {n.label.slice(0, 1)}
                </text>
                <text textAnchor="middle" y="42" fontSize="12" fill="var(--color-mute)" style={{ pointerEvents: 'none' }}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="px-4 py-2.5 border-t border-[var(--color-line)] text-[11.5px] text-[var(--color-faint)]">
          节点可拖拽 · {topo.desc}
        </div>
      </div>

      {/* event log */}
      <div className="panel p-4 flex flex-col min-h-[300px]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-monox text-[var(--color-faint)]">MESSAGE LOG</span>
          <span className="font-monox text-[11px] text-[var(--color-mute)]">{log.length} hops</span>
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto space-y-2 max-h-[340px] pr-1">
          {log.length === 0 && (
            <p className="text-[12px] text-[var(--color-faint)] leading-relaxed">
              点「运行」，看消息沿着拓扑的边流动。不同拓扑 = 不同的协作协议。
            </p>
          )}
          {log.map((l, i) => (
            <div key={i} className="fade-up rounded-lg border border-[var(--color-line)] bg-[var(--color-panel2)] px-2.5 py-2">
              <div className="font-monox text-[11px] text-[var(--color-acc)] mb-0.5">
                {l.self ? `${l.f} · 内部收敛` : `${nodeById(l.f)?.label || l.f} → ${nodeById(l.t)?.label || l.t}`}
              </div>
              <div className="text-[11.5px] text-[var(--color-mute)] leading-relaxed">{l.msg}</div>
            </div>
          ))}
        </div>
        <div className="pt-3 mt-3 border-t border-[var(--color-line)] text-[11.5px] text-[var(--color-faint)] leading-relaxed">
          拓扑即协议：谁跟谁说话，决定了系统的能力上限。
        </div>
      </div>
    </div>
  );
}
