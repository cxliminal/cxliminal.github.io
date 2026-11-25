// 生成站点 og 分享图：node scripts/gen-og.mjs → public/og.png (1200x630)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const W = 1200;
const H = 630;

const grid = Array.from({ length: Math.ceil(W / 48) + 1 }, (_, i) => `<line x1="${i * 48}" y1="0" x2="${i * 48}" y2="${H}" stroke="rgba(148,163,255,0.07)" stroke-width="1"/>`)
  .concat(Array.from({ length: Math.ceil(H / 48) + 1 }, (_, i) => `<line x1="0" y1="${i * 48}" x2="${W}" y2="${i * 48}" stroke="rgba(148,163,255,0.07)" stroke-width="1"/>`))
  .join('');

const chapters = ['model', 'harness', 'loop', 'graph']
  .map((c, i) => {
    const x = 80 + i * 150;
    return `<rect x="${x}" y="470" width="128" height="44" rx="10" fill="rgba(109,141,255,0.10)" stroke="rgba(109,141,255,0.45)" stroke-width="1.2"/>
    <text x="${x + 64}" y="497" text-anchor="middle" font-family="Consolas, monospace" font-size="20" fill="#8ea6ff">${c}</text>${
      i < 3 ? `<text x="${x + 140}" y="497" text-anchor="middle" font-size="18" fill="#3d3d55">→</text>` : ''
    }`;
  })
  .join('');

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0a0a13"/>
  ${grid}
  <rect x="0" y="0" width="${W}" height="4" fill="#6d8dff"/>
  <g transform="translate(80, 86) scale(0.9)">
    <path d="M32 14a18 18 0 1 1-12.7 5.3" fill="none" stroke="#6d8dff" stroke-width="6" stroke-linecap="round"/>
    <path d="M18 12v10h10" fill="none" stroke="#a78bfa" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="32" cy="32" r="5" fill="#2dd4bf"/>
  </g>
  <text x="150" y="122" font-family="Consolas, monospace" font-size="24" letter-spacing="3" fill="#7c7c96">AGENTIC LAB</text>
  <text x="80" y="270" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-weight="600" font-size="64" fill="#e8e8f2">从调用模型，</text>
  <text x="80" y="360" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-weight="600" font-size="64" fill="#e8e8f2">到<tspan fill="#6d8dff">让模型自己干活</tspan></text>
  <text x="80" y="425" font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif" font-size="24" fill="#9b9bb4">vibecoding 之后的互动实验室 · 每篇认知都有一个能上手玩的 demo</text>
  ${chapters}
  <text x="80" y="565" font-family="Consolas, monospace" font-size="20" fill="#7c7c96">cxliminal.github.io</text>
  <text x="1120" y="565" text-anchor="end" font-family="Consolas, monospace" font-size="20" fill="#7c7c96">built by AI agents × 细林</text>
</svg>`;

const out = new URL('../public/og.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(dirname(out), { recursive: true });
await sharp(Buffer.from(svg), { density: 96 }).png().toFile(out);
console.log('og.png written:', out);
