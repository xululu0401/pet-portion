#!/usr/bin/env node
/* 封面（1200×1200）：数字全部来自同一次引擎输出（先落盘 evidence/封面取值.json）。
 * 画法：生成临时 HTML → agent-browser 截图 → 裁切到 1200×1200 → 01-pet-portion/cover.png。
 * 不手抄任何数字；并要求内容高度 ≤ 1200（防页脚被切）。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = fs.existsSync(path.join(__dirname, '01-pet-portion')) ? __dirname : path.dirname(__dirname);
const APP = path.join(ROOT, '01-pet-portion');
const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const SESSION = 'codex60-cover';
const PY = '/Users/xululu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
const C = require(path.join(APP, 'core.js'));

const v = C.compute(C.defaults());
if (!v.ok) { console.error('引擎没算干净，不画封面：', v.errors); process.exit(1); }
const bad = v.checks.filter((c) => !c.pass);
if (bad.length) { console.error('自检不通过，不画封面：', bad); process.exit(1); }

const P = {};
v.plans.forEach((p) => { P[p.id] = p; });
const values = {
  headline: v.headline.dryLine, kcal: v.headline.kcal, dryG: v.headline.dryG, cans: v.headline.cans,
  monthCost: P.target.monthlyCost,
  rer: v.rer, k: v.k, mer: v.mer, bcs: v.bcs.bcs, bf: v.bcs.bf, ideal: v.bcs.idealKg,
  rate: v.gap.actualRate, weeks: v.gap.weeks, planKcal: v.gap.planKcal,
  dryCost: P.dry.monthlyCost, wetCost: P.wet.monthlyCost, mixCost: P.mix.monthlyCost,
  dryPer1000: v.unitCost.dryPer1000Kcal, wetPer1000: v.unitCost.wetPer1000Kcal, ratio: v.unitCost.ratio,
  checks: v.checks.length,
  stamp: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'evidence', '封面取值.json'), JSON.stringify(values, null, 2));

const n = (x, d) => C.fmt(x, d == null ? 2 : d);
const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:1200px;background:#f5f2ea;color:#1f2e28;overflow:hidden;
  font-family:-apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;padding:46px 56px;position:relative}
h1{font-size:60px;letter-spacing:1px;line-height:1.05}
.sub{margin-top:12px;font-size:24px;color:#49584f;line-height:1.4}
.rule{height:3px;background:#1f2e28;margin:22px 0 24px}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
.hero .cap{font-size:23px;color:#49584f}
.hero .big{font-size:88px;font-weight:800;line-height:1.04;letter-spacing:-3px;color:#154c34;margin-top:4px}
.hero .right{text-align:right;font-size:23px;line-height:1.65;color:#49584f;white-space:nowrap}
.hero .right b{font-size:27px;color:#1f2e28}
.sec{margin-top:26px;font-size:24px;font-weight:700;color:#49584f}
.tbl{margin-top:10px;width:100%;border-collapse:collapse;font-size:24px}
.tbl th{font-size:20px;color:#7c8a82;font-weight:600;text-align:right;padding:6px 8px;border-bottom:1px solid #dbe2db}
.tbl th:first-child{text-align:left}
.tbl td{padding:9px 8px;border-bottom:1px solid #dbe2db;text-align:right;font-variant-numeric:tabular-nums}
.tbl td:first-child{text-align:left;font-weight:600}
.tbl tr.pick td{background:#eef6f0;color:#154c34;font-weight:700}
.badge{display:inline-block;font-size:18px;background:#eef6f0;border:1px solid #c6e0d0;color:#154c34;border-radius:6px;padding:2px 8px;margin-left:8px;vertical-align:3px}
.facts{margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:8px 26px;font-size:23px;color:#49584f}
.facts b{color:#1f2e28}
.foot{position:absolute;left:56px;right:56px;bottom:40px;font-size:20px;color:#7c8a82;line-height:1.5;
  border-top:1px solid #dbe2db;padding-top:14px}
</style></head><body>
<h1>粮喂多了</h1>
<div class="sub">猫狗每天该喂多少克、几个罐头 —— 按热量算，不靠感觉倒</div>
<div class="rule"></div>
<div class="hero">
  <div>
    <div class="cap">示例：绝育室内猫 4.8 kg（体况 7）</div>
    <div class="big">${values.headline}</div>
  </div>
  <div class="right">
    每日热量 <b>${n(values.kcal, 1)} kcal</b><br>
    每月粮钱 <b>${n(values.monthCost)} 元</b><br>
    到目标体重 <b>${n(values.weeks, 1)} 周</b>
  </div>
</div>
<div class="sec">四套喂法并排对照（每月粮钱）</div>
<table class="tbl">
  <tr><th>方案</th><th>每日热量</th><th>干粮</th><th>罐头</th><th>每月粮钱</th><th>达标周数</th></tr>
  <tr><td>全干粮 · 维持</td><td>${n(values.mer, 1)} kcal</td><td>${n(P.dry.dryG, 1)} g</td><td>—</td><td>${n(values.dryCost)} 元</td><td>—</td></tr>
  <tr><td>全湿粮 · 维持</td><td>${n(values.mer, 1)} kcal</td><td>—</td><td>${n(P.wet.cans)} 罐</td><td>${n(values.wetCost)} 元</td><td>—</td></tr>
  <tr><td>对半混喂 · 维持</td><td>${n(values.mer, 1)} kcal</td><td>${n(P.mix.dryG, 1)} g</td><td>${n(P.mix.cans)} 罐</td><td>${n(values.mixCost)} 元</td><td>—</td></tr>
  <tr class="pick"><td>目标体重方案 · 减到 ${n(values.ideal)} kg<span class="badge">结论用这套</span></td><td>${n(values.planKcal, 1)} kcal</td><td>${n(P.target.dryG, 1)} g</td><td>${n(P.target.cans)} 罐</td><td>${n(values.monthCost)} 元</td><td>${n(values.weeks, 1)} 周</td></tr>
</table>
<div class="facts">
  <div>静息需求 RER = 70 × 体重<sup>0.75</sup> = <b>${n(values.rer, 1)} kcal</b></div>
  <div>体况 7 → 体脂 <b>${n(values.bf * 100, 0)}%</b> → 理想体重 <b>${n(values.ideal)} kg</b></div>
  <div>维持热量 MER = RER × ${n(values.k, 1)} = <b>${n(values.mer, 1)} kcal</b></div>
  <div>掉重速率 <b>${n(values.rate, 2)} %/周</b>（猫的安全上限 1.00）</div>
  <div>每 1000 kcal：干粮 <b>${n(values.dryPer1000)} 元</b>、罐头 <b>${n(values.wetPer1000)} 元</b></div>
  <div>罐头是干粮的 <b>${n(values.ratio, 1)} 倍</b>；引擎自检 <b>${values.checks} / ${values.checks}</b></div>
</div>
<div class="foot">默认数据是虚构示例，不是任何真实品牌或价格分布。本工具只做算术：不做诊断、不开处方、不评价粮的品质。<br>
粮喂多了 v1.0.0 ｜ 单文件应用，全部计算在本机浏览器内完成</div>
</body></html>`;

const tmp = path.join(ROOT, 'evidence', '封面临时.html');
fs.writeFileSync(tmp, html);
const shot = path.join(ROOT, 'evidence', '封面-原始截图.png');

try { execFileSync(AB, ['close', '--all'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { /* 没会话也无所谓 */ }
execFileSync(AB, ['--session', SESSION, 'open', 'file://' + tmp], { encoding: 'utf8', timeout: 120000 });
execFileSync(AB, ['--session', SESSION, 'set', 'viewport', '1200', '1200'], { encoding: 'utf8', timeout: 60000 });
const probe = execFileSync(AB, ['--session', SESSION, '--json', 'eval',
  'JSON.stringify({h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth})'],
  { encoding: 'utf8', timeout: 60000 });
const info = JSON.parse(JSON.parse(probe.trim().split('\n').filter(Boolean).pop()).data.result);
console.log('内容尺寸 ' + info.w + '×' + info.h);
if (info.h > 1200 || info.w > 1200) throw new Error('内容超出 1200×1200，页脚会被切：' + JSON.stringify(info));
execFileSync(AB, ['--session', SESSION, 'screenshot', '--full', shot], { encoding: 'utf8', timeout: 120000 });
execFileSync(AB, ['close', '--all'], { encoding: 'utf8', timeout: 60000 });

const py = `
from PIL import Image
im = Image.open(r"${shot}")
im.crop((0,0,min(1200,im.width),min(1200,im.height))).save(r"${path.join(APP, 'cover.png')}")
print("cover", min(1200,im.width), min(1200,im.height))
`;
console.log(execFileSync(PY, ['-c', py], { encoding: 'utf8' }).trim());
console.log('→ ' + path.join(APP, 'cover.png'));
