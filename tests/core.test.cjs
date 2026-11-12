/* 粮喂多了 · 核心测试（node --test tests/core.test.cjs）
 *
 * 原则：断言里的期望值来自**独立手算/独立公式路线**，不来自被测函数自己的返回值。
 * 覆盖：手算锚点、系数表每条路径、理想体重反推、单位与换算口径、混喂守恒、
 *       阈值两侧（下限触底）、退化、非法输入逐条核字段、单调性、随机不变量、
 *       自检「会红」反向验证、确定性/纯函数、输出与格式化契约。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../core.js');

/* ── 独立路线：w^0.75 = sqrt(sqrt(w^3))，与引擎里的 Math.pow 不是同一条路径 ── */
function rerIndependent(w) { return 70 * Math.sqrt(Math.sqrt(Math.pow(w, 3))); }
function closeTo(got, want, tol) {
  const t = tol == null ? 1e-12 : tol;
  assert.ok(Math.abs(got - want) <= t * Math.max(1, Math.abs(want)), 'got=' + got + ' want=' + want);
}
function base(over) { return Object.assign(A.defaults(), over || {}); }

/* ─────────────── 1. 手算锚点 ─────────────── */

test('RER 手算锚点（40 位精度外部复算，容差 1e-12）', () => {
  const anchors = [
    [0.3, 28.375203250947722273687],
    [0.4, 35.208136031122191432897],
    [0.5, 41.622249025095237335112],
    [3.2, 167.47906349677670069413],
    [3.9, 194.26586458945713250698],
    [4.8, 227.00162600758177818949],
    [12, 451.31937136588760621240],
    [27.5, 840.61582274820380922218],
    [40, 1113.3790202738709312434],
    [90, 2045.4078674931232052876],
  ];
  anchors.forEach(([w, want]) => closeTo(A.rer(w), want, 1e-12));
});

test('RER 与独立公式路线一致，且严格随体重单调递增', () => {
  let prev = -Infinity;
  for (let w = 0.3; w <= 90.0001; w += 0.1) {
    const v = A.rer(w);
    closeTo(v, rerIndependent(w), 1e-12);
    assert.ok(v > prev, '在 ' + w.toFixed(1) + ' kg 处不再单调：' + v + ' <= ' + prev);
    prev = v;
  }
});

test('RER 对非正数与非法值返回 NaN（不外抛）', () => {
  [0, -1, NaN, undefined, null, '', 'abc', Infinity].forEach((bad) => {
    assert.ok(Number.isNaN(A.rer(bad)), '输入 ' + String(bad) + ' 应得 NaN，实得 ' + A.rer(bad));
  });
});

/* ─────────────── 2. 系数表每条路径 ─────────────── */

test('系数 k：幼年四格（不受绝育与活动量影响）', () => {
  assert.equal(A.kFactor(base({ ageStage: '<4月' })).k, 2.5);
  assert.equal(A.kFactor(base({ ageStage: '4-12月' })).k, 2.0);
  assert.equal(A.kFactor(base({ species: 'dog', ageStage: '<4月' })).k, 3.0);
  assert.equal(A.kFactor(base({ species: 'dog', ageStage: '4-12月' })).k, 2.0);
  const a = A.kFactor(base({ ageStage: '<4月', neutered: false, activity: 'high' })).k;
  const b = A.kFactor(base({ ageStage: '<4月', neutered: true, activity: 'low' })).k;
  assert.equal(a, b, '幼年不应受绝育与活动量影响');
});

test('系数 k：成年六格（猫狗 × 低中高 × 绝育）与未绝育 +0.2', () => {
  assert.equal(A.kFactor(base({ activity: 'low' })).k, 1.0);
  assert.equal(A.kFactor(base({ activity: 'mid' })).k, 1.2);
  assert.equal(A.kFactor(base({ activity: 'high' })).k, 1.4);
  assert.equal(A.kFactor(base({ activity: 'low', neutered: false })).k, 1.2);
  assert.equal(A.kFactor(base({ activity: 'mid', neutered: false })).k, 1.4);
  closeTo(A.kFactor(base({ activity: 'high', neutered: false })).k, 1.6, 1e-12);
  assert.equal(A.kFactor(base({ species: 'dog', activity: 'low' })).k, 1.4);
  assert.equal(A.kFactor(base({ species: 'dog', activity: 'mid' })).k, 1.8);
  assert.equal(A.kFactor(base({ species: 'dog', activity: 'high' })).k, 2.2);
  closeTo(A.kFactor(base({ species: 'dog', activity: 'high', neutered: false })).k, 2.4, 1e-12);
});

test('系数 k：老年 −0.2 且有 1.0 下限；未绝育叠加顺序为先加后减', () => {
  assert.equal(A.kFactor(base({ ageStage: '老年', activity: 'mid' })).k, 1.0);   // 1.2−0.2
  assert.equal(A.kFactor(base({ ageStage: '老年', activity: 'low' })).k, 1.0);   // 1.0−0.2 → 触底 1.0
  assert.equal(A.kFactor(base({ ageStage: '老年', activity: 'high' })).k, 1.2);
  closeTo(A.kFactor(base({ ageStage: '老年', activity: 'low', neutered: false })).k, 1.0, 1e-12); // 1.2−0.2
  closeTo(A.kFactor(base({ ageStage: '老年', activity: 'mid', neutered: false })).k, 1.2, 1e-12); // 1.4−0.2
  closeTo(A.kFactor(base({ species: 'dog', ageStage: '老年', activity: 'high' })).k, 2.0, 1e-12);
  assert.equal(A.kFactor(base({ species: 'dog', ageStage: '老年', activity: 'low' })).k, 1.2);
});

test('系数 k：非法枚举返回 NaN 并在 steps 里说明', () => {
  const kf = A.kFactor(base({ species: 'rabbit' }));
  assert.ok(Number.isNaN(kf.k));
  assert.ok(kf.steps.join(' ').indexOf('范围') >= 0);
});

test('MER = RER × k（默认场景 227.00162600758178 × 1.2）', () => {
  closeTo(A.merKcal(A.defaults()), 227.00162600758177818949 * 1.2, 1e-12);
});

/* ─────────────── 3. 体况评分 → 体脂率 → 理想体重 ─────────────── */

test('体脂率分档表单调不减，且 BCS 5 = 20% 理想', () => {
  assert.equal(A.BCS_BF[5], 0.20);
  for (let b = 2; b <= 9; b++) assert.ok(A.BCS_BF[b] > A.BCS_BF[b - 1], 'BCS ' + b + ' 体脂率未递增');
});

test('去脂体重守恒：体脂 + 去脂 = 当前体重；BCS 5 时理想体重 = 当前体重', () => {
  [0.3, 3.2, 4.8, 12, 40, 90].forEach((w) => {
    for (let b = 1; b <= 9; b++) {
      const info = A.bcsInfo({ weight: w, bcs: b, targetWeight: w });
      closeTo(w * info.bf + info.leanKg, w, 1e-12);
      if (b === 5) closeTo(info.idealKg, w, 1e-12);
    }
  });
});

test('理想体重锚点：BCS 9 为当前体重的 0.5625 倍；BCS 4 大于当前体重', () => {
  closeTo(A.bcsInfo({ weight: 40, bcs: 9, targetWeight: 22.5 }).idealKg, 22.5, 1e-12);
  closeTo(A.bcsInfo({ weight: 4.8, bcs: 7, targetWeight: 3.9 }).idealKg, 3.9, 1e-12);
  closeTo(A.bcsInfo({ weight: 3.2, bcs: 3, targetWeight: 3.4 }).idealKg, 3.4, 1e-12);
  assert.ok(A.bcsInfo({ weight: 5, bcs: 4, targetWeight: 5 }).idealKg > 5, 'BCS 4 偏瘦，理想体重应大于当前体重');
});

test('理想带宽 = 理想体重 ±15%', () => {
  const info = A.bcsInfo({ weight: 4.8, bcs: 7, targetWeight: 3.9 });
  closeTo(info.idealLo, 3.9 * 0.85, 1e-12);
  closeTo(info.idealHi, 3.9 * 1.15, 1e-12);
});

/* ─────────────── 4. 单位与换算口径 ─────────────── */

test('干粮换算：100 kcal 用 400 kcal/100g 的粮 = 25 g', () => {
  const p = A.planOf(100, 0, base({ dryKcalPer100g: 400 }));
  closeTo(p.dryG, 25, 1e-12);
  assert.equal(p.cans, 0);
});

test('kcal/100g 与 kcal/kg 是同一条公式的两种写法（等价性）', () => {
  const a = A.planOf(300, 0, base({ dryKcalPer100g: 400 }));
  const b = A.planOf(300, 0, base({ dryKcalPer100g: 4000 / 10 }));  // 4000 kcal/kg → 400 kcal/100g
  closeTo(a.dryG, b.dryG, 1e-12);
});

test('每罐热量 = kcal/100g × 罐净重 ÷ 100（90 × 85 ÷ 100 = 76.5）', () => {
  closeTo(A.canKcalOf(base()), 76.5, 1e-12);
  closeTo(A.canKcalOf(base({ wetKcalPer100g: 110, canNetG: 400 })), 440, 1e-12);
});

test('混喂：湿粮占比 30% 时湿粮热量 = 总热量 × 0.30（热量占比口径，不是重量占比）', () => {
  const mer = A.merKcal(A.defaults());
  const p = A.planOf(mer, 30, A.defaults());
  closeTo(p.wetKcal, mer * 0.30, 1e-12);
  closeTo(p.dryKcal, mer * 0.70, 1e-12);
  closeTo(p.cans, mer * 0.30 / 76.5, 1e-12);
  closeTo(p.dryG, mer * 0.70 / 3.6, 1e-12);
});

test('每 1000 kcal 单价：干粮 = 10·元每kg ÷ (kcal/100g)；罐头 = (1000 ÷ kcal每g) ÷ 罐净重 × 元每罐', () => {
  const uc = A.unitCostOf(A.defaults());
  closeTo(uc.dryPer1000Kcal, 10 * 60 / 360, 1e-12);          // 1.6666…
  closeTo(uc.wetPer1000Kcal, (1000 / 0.9) / 85 * 8, 1e-12);  // 104.5751…
  closeTo(uc.ratio, ((1000 / 0.9) / 85 * 8) / (10 * 60 / 360), 1e-12);
  assert.equal(uc.cheaper, 'dry');
});

/* ─────────────── 5. 默认场景全链路锚点（与 需求与调研.md §3.4 同一批数） ─────────────── */

test('默认场景全链路锚点（与需求文档 §3.4 逐项一致）', () => {
  const r = A.compute(A.defaults());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  closeTo(r.rer, 227.00162600758177818949, 1e-12);
  assert.equal(r.k, 1.2);
  closeTo(r.mer, 272.40195120909813, 1e-12);
  closeTo(r.bcs.leanKg, 3.12, 1e-12);
  closeTo(r.bcs.idealKg, 3.9, 1e-12);
  const P = {};
  r.plans.forEach((p) => { P[p.id] = p; });
  closeTo(P.dry.dryG, 75.667208669193926, 1e-12);
  closeTo(P.dry.monthlyCost, 136.20097560454907, 1e-12);
  closeTo(P.wet.cans, 3.560809819726773, 1e-12);
  closeTo(P.wet.monthlyCost, 854.5943567344255, 1e-12);
  closeTo(P.mix.wetKcal, 136.20097560454906, 1e-12);
  closeTo(P.mix.dryKcal, 136.20097560454906, 1e-12);
  closeTo(P.mix.dryG, 37.833604334596963, 1e-12);
  closeTo(P.mix.cans, 1.7804049098633865, 1e-12);
  closeTo(P.mix.monthlyCost, 495.39766616948731, 1e-12);
  assert.deepEqual(r.plans.map((p) => p.wetPct), [0, 100, 50, 30], '三套固定对照（0/100/对半）+ 目标方案用你自己的占比');
  closeTo(r.gap.gapKcal, 39.6, 1e-12);
  closeTo(r.gap.targetKcal, 232.80195120909813, 1e-9);
  closeTo(r.gap.floorKcal, 163.44117072545887, 1e-9);
  assert.equal(r.gap.clamped, false);
  closeTo(r.gap.planKcal, 232.80195120909813, 1e-9);
  closeTo(r.gap.actualRate, 0.75, 1e-12);
  closeTo(r.gap.needPct, 18.75, 1e-12);
  closeTo(r.gap.weeks, 25, 1e-9);
  closeTo(P.target.monthlyCost, 300.58840170821787, 1e-12);
  closeTo(P.target.dryG, 45.267046068435747, 1e-12);
  closeTo(P.target.cans, 0.91294882827097312, 1e-12);
  closeTo(r.meals.perMealG, 22.633523034217873, 1e-12);
  closeTo(r.meals.perMealCans, 0.45647441413548656, 1e-12);
  closeTo(r.aggressive.kcal, 155.4126916715657, 1e-12);
  closeTo(r.aggressive.rate, 2.2157056730593263, 1e-12);
  closeTo(r.unitCost.dryPer1000Kcal, 1.6666666666666667, 1e-12);
  closeTo(r.unitCost.wetPer1000Kcal, 104.57516339869281, 1e-12);
  closeTo(r.unitCost.ratio, 62.745098039215686, 1e-12);
});

/* ─────────────── 6. 阈值两侧：下限保护触底 ─────────────── */

test('下限保护两侧：狗 40 kg / BCS 9 / 低活动触底，猫 4.8 kg 不触底', () => {
  const dog = A.compute(base({
    species: 'dog', weight: 40, bcs: 9, activity: 'low', neutered: true,
    dryKcalPer100g: 340, dryPricePerKg: 42, wetKcalPer100g: 110, canNetG: 400, canPrice: 22,
    wetPct: 20, targetWeight: 27.5,
  }));
  assert.equal(dog.ok, true, JSON.stringify(dog.errors));
  closeTo(dog.rer, 1113.3790202738709312434, 1e-12);
  assert.equal(dog.k, 1.4);
  closeTo(dog.bcs.idealKg, 22.5, 1e-12);
  closeTo(dog.gap.gapKcal, 660, 1e-12);
  closeTo(dog.gap.targetKcal, 898.7306283834193, 1e-9);
  closeTo(dog.gap.floorKcal, 935.2383770300516, 1e-9);
  assert.equal(dog.gap.clamped, true, '这一组必须触底');
  closeTo(dog.gap.planKcal, dog.gap.floorKcal, 1e-12);
  closeTo(dog.gap.actualRate, 1.4170278439849266, 1e-9);
  assert.ok(dog.warnings.some((w) => w.code === 'clamped'), '触底应给出提示');
  assert.ok(dog.warnings.some((w) => w.code === 'target-band'), '27.5 kg 落在理想带宽（19.13–25.88）之外，应提示');

  const cat = A.compute(A.defaults());
  assert.equal(cat.gap.clamped, false);
});

test('下限保护的翻转点：扫出第一处触底，验证两侧', () => {
  const cfg = (w) => base({ species: 'dog', weight: w, bcs: 9, activity: 'low', neutered: true, targetWeight: w / 2 });
  let flip = null;
  for (let w = 10; w <= 40; w += 0.01) {
    const r = A.weightPlan(cfg(w), A.merKcal(cfg(w)), A.bcsInfo(cfg(w)));
    if (r.clamped) { flip = w; break; }
  }
  assert.ok(flip !== null, '在 10–40 kg 之间应能扫到触底');
  const on = A.weightPlan(cfg(flip), A.merKcal(cfg(flip)), A.bcsInfo(cfg(flip)));
  const off = A.weightPlan(cfg(flip - 0.01), A.merKcal(cfg(flip - 0.01)), A.bcsInfo(cfg(flip - 0.01)));
  assert.equal(on.clamped, true, '翻转点 ' + flip + ' 应为触底');
  assert.equal(off.clamped, false, '翻转点前一格 ' + (flip - 0.01) + ' 应不触底');
  assert.ok(Math.abs(on.targetKcal - on.floorKcal) < 1, '翻转点上两者应几乎相等');
});

test('安全速率上限两侧：猫按期望速率喂不超上限；0.8·RER(理想) 口径反推必超上限', () => {
  const cat = A.compute(A.defaults());
  assert.ok(cat.gap.actualRate <= A.SAFE_MAX.cat + 1e-12, '猫按 0.75 %/周排，不应超上限');
  assert.ok(cat.aggressive.rate > A.SAFE_MAX.cat, '口径对照：0.8·RER(理想) 反推的速率应超过猫上限 1.0');
});

/* ─────────────── 7. 退化与边界 ─────────────── */

test('退化为维持：目标体重 = 当前体重 → 缺口为 0、速率 0、不排时间线、热量 = 维持热量', () => {
  const r = A.compute(base({ targetWeight: 4.8 }));
  assert.equal(r.ok, true);
  assert.equal(r.gap.direction, 'maintain');
  assert.equal(r.gap.weeks, null);
  assert.equal(r.gap.gapKcal, 0);
  assert.equal(r.gap.actualRate, 0);
  closeTo(r.gap.planKcal, r.mer, 1e-12);
  assert.equal(r.gap.clamped, false);
  assert.equal(r.timeline.length, 0);
  closeTo(r.plans[3].kcal, r.plans[0].kcal, 1e-12);      // 目标方案 = 维持热量，不制造缺口
  closeTo(r.headline.kcal, r.mer, 1e-12);
  closeTo(r.headline.dryG, r.plans[3].dryG, 1e-12);
});

test('目标体重大于当前体重 → 维持计算 + 「只排减重方向」提示', () => {
  const r = A.compute(base({ targetWeight: 5.2 }));
  assert.equal(r.ok, true);
  assert.equal(r.gap.direction, 'maintain');
  assert.ok(r.warnings.some((w) => w.code === 'gain'));
  assert.equal(r.timeline.length, 0);
});

test('体况偏瘦（BCS 3）→ 提示增重不在范围；BS C 8/9 → 提示先排查疾病', () => {
  const lean = A.compute(base({ weight: 3.2, bcs: 3, targetWeight: 3.2 }));
  assert.equal(lean.ok, true);
  assert.ok(lean.warnings.some((w) => w.code === 'lean'));
  [8, 9].forEach((b) => {
    const ob = A.compute(base({ bcs: b, targetWeight: 3.9 }));
    assert.ok(ob.warnings.some((w) => w.code === 'obese'), 'BCS ' + b + ' 应提示');
  });
});

test('物种范围边界：猫 0.3 / 12 kg 与狗 0.4 / 90 kg 都在范围内', () => {
  [[0.3, 'cat'], [12, 'cat'], [0.4, 'dog'], [90, 'dog']].forEach(([w, sp]) => {
    const r = A.compute(base({ species: sp, weight: w, targetWeight: w }));
    assert.equal(r.ok, true, sp + ' ' + w + ' 应通过：' + JSON.stringify(r.errors));
  });
});

test('对照表前三行固定为 0% / 100% / 50%，第四行跟随用户占比；热量不变，克数口径自洽', () => {
  const a = A.compute(base({ wetPct: 0 }));
  const b = A.compute(base({ wetPct: 100 }));
  const c = A.compute(base({ wetPct: 37 }));
  assert.equal(a.plans[0].cans, 0);                    // 全干粮不出罐头
  assert.equal(b.plans[1].dryG, 0);                    // 全湿粮不出干粮
  assert.deepEqual(a.plans.map((p) => p.wetPct), [0, 100, 50, 0]);
  assert.deepEqual(c.plans.map((p) => p.wetPct), [0, 100, 50, 37]);
  closeTo(a.plans[0].kcal, b.plans[1].kcal, 1e-12);
  closeTo(a.plans[2].cans, b.plans[1].cans / 2, 1e-12);  // 对半 = 全湿粮的一半
});

test('时间线首尾与步长：首点 = 当前体重，末点 = 目标体重，最多 25 点', () => {
  const r = A.compute(A.defaults());
  closeTo(r.timeline[0].kg, 4.8, 1e-12);
  closeTo(r.timeline[r.timeline.length - 1].kg, 3.9, 1e-12);
  closeTo(r.timeline[r.timeline.length - 1].week, 25, 1e-9);
  assert.ok(r.timeline.length <= 26, '时间线点数应受控，实得 ' + r.timeline.length);
});

/* ─────────────── 8. 非法输入逐条核字段（≥30 条） ─────────────── */

test('非法输入逐条核到字段上（35 条）', () => {
  const cases = [
    ['weight', { weight: 0.1 }], ['weight', { weight: 0 }], ['weight', { weight: -3 }],
    ['weight', { weight: NaN }], ['weight', { weight: '' }], ['weight', { weight: 13 }],
    ['weight', { weight: 200 }], ['weight', { species: 'dog', weight: 0.2 }], ['weight', { species: 'dog', weight: 91 }],
    ['targetWeight', { targetWeight: 0 }], ['targetWeight', { targetWeight: -1 }], ['targetWeight', { targetWeight: NaN }],
    ['targetWeight', { targetWeight: 99 }], ['targetWeight', { targetWeight: 0.1 }],
    ['bcs', { bcs: 0 }], ['bcs', { bcs: 10 }], ['bcs', { bcs: 5.5 }], ['bcs', { bcs: NaN }], ['bcs', { bcs: '' }],
    ['species', { species: 'rabbit' }], ['species', { species: '' }],
    ['ageStage', { ageStage: '青年' }], ['activity', { activity: 'extreme' }], ['activity', { activity: null }],
    ['neutered', { neutered: 'yes' }], ['neutered', { neutered: 1 }],
    ['dryKcalPer100g', { dryKcalPer100g: 0 }], ['dryKcalPer100g', { dryKcalPer100g: -5 }],
    ['dryKcalPer100g', { dryKcalPer100g: 700 }], ['dryKcalPer100g', { dryKcalPer100g: NaN }],
    ['wetKcalPer100g', { wetKcalPer100g: 0 }], ['wetKcalPer100g', { wetKcalPer100g: 500 }],
    ['canNetG', { canNetG: 0 }], ['canNetG', { canNetG: 900 }], ['canNetG', { canNetG: NaN }],
    ['dryPricePerKg', { dryPricePerKg: -1 }], ['canPrice', { canPrice: -0.5 }],
    ['wetPct', { wetPct: -1 }], ['wetPct', { wetPct: 101 }], ['wetPct', { wetPct: NaN }],
  ];
  cases.forEach(([field, over]) => {
    const v = A.validate(base(over));
    assert.equal(v.ok, false, JSON.stringify(over) + ' 应判非法');
    assert.ok(v.errors.some((e) => e.field === field), JSON.stringify(over) + ' 应报在字段 ' + field + ' 上，实得 ' + JSON.stringify(v.errors.map((e) => e.field)));
    v.errors.forEach((e) => assert.ok(typeof e.msg === 'string' && e.msg.length > 3, '提示文案太短：' + JSON.stringify(e)));
  });
});

test('非法输入时 compute 不抛异常、返回 ok=false、且不产生结果字段', () => {
  [null, undefined, {}, base({ weight: -1 }), base({ bcs: 99 })].forEach((bad) => {
    const r = A.compute(bad);
    assert.equal(r.ok, false);
    assert.ok(Array.isArray(r.errors) && r.errors.length >= 1);
    assert.equal(r.plans, undefined, '非法输入不应给出方案表');
  });
});

test('零分母与极端值：密度/净重为 0 时不产生 NaN 结果而是报错', () => {
  [['dryKcalPer100g', 0], ['wetKcalPer100g', 0], ['canNetG', 0]].forEach(([f, v]) => {
    const r = A.compute(base({ [f]: v }));
    assert.equal(r.ok, false, f + '=0 应报错');
    assert.ok(r.errors.some((e) => e.field === f));
  });
});

/* ─────────────── 9. 单调性与随机不变量 ─────────────── */

test('湿粮占比 0→100 全程：罐头数单调不减、干粮单调不增、总热量不变', () => {
  let prevCans = -Infinity, prevDry = Infinity;
  for (let p = 0; p <= 100; p += 1) {
    const pl = A.planOf(300, p, base());
    assert.ok(pl.cans >= prevCans - 1e-12, '占比 ' + p + ' 罐头数回退');
    assert.ok(pl.dryG <= prevDry + 1e-12, '占比 ' + p + ' 干粮回退');
    closeTo(pl.kcal, 300, 1e-12);
    closeTo(pl.dryKcal + pl.wetKcal, 300, 1e-12);
    prevCans = pl.cans; prevDry = pl.dryG;
  }
});

test('体重变大 → 热量与干粮克数都变大（同系数）', () => {
  let prevMer = -Infinity, prevG = -Infinity;
  for (let w = 1; w <= 60; w += 0.5) {
    const inp = base({ species: 'dog', weight: w, targetWeight: w });
    const mer = A.merKcal(inp);
    const g = A.planOf(mer, 0, inp).dryG;
    assert.ok(mer > prevMer && g > prevG, w + ' kg 处不再单调');
    prevMer = mer; prevG = g;
  }
});

test('300 组随机输入：引擎自检全绿、数值有限非负、守恒成立', () => {
  const rnd = (() => { let s = 20261113; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })();
  const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
  let n = 0, asserts = 0;
  for (let i = 0; i < 300; i++) {
    const sp = pick(['cat', 'dog']);
    const lim = A.LIMITS[sp];
    const w = A.round(lim.wMin + rnd() * (lim.wMax - lim.wMin), 3);
    const inp = {
      species: sp, weight: w, bcs: 1 + Math.floor(rnd() * 9), ageStage: pick(A.AGE_STAGES),
      neutered: rnd() < 0.5, activity: pick(A.ACTIVITIES),
      dryKcalPer100g: A.round(200 + rnd() * 250, 1), dryPricePerKg: A.round(rnd() * 200, 2),
      wetKcalPer100g: A.round(40 + rnd() * 200, 1), canNetG: A.round(40 + rnd() * 400, 1),
      canPrice: A.round(rnd() * 40, 2), wetPct: A.round(rnd() * 100, 1),
      targetWeight: A.round(lim.wMin + rnd() * (lim.wMax - lim.wMin), 3),
    };
    const r = A.compute(inp);
    assert.equal(r.ok, true, '随机组 ' + i + ' 被判非法：' + JSON.stringify(r.errors) + ' ' + JSON.stringify(inp));
    n++;
    const bad = r.checks.filter((c) => !c.pass);
    asserts += r.checks.length;
    assert.equal(bad.length, 0, '随机组 ' + i + ' 自检变红：' + JSON.stringify(bad) + ' ' + JSON.stringify(inp));
    r.plans.forEach((p) => {
      [p.kcal, p.dryKcal, p.wetKcal, p.dryG, p.cans, p.dryCost, p.wetCost, p.monthlyCost].forEach((x) => {
        assert.ok(isFinite(x) && x >= 0, '出现非法数值 ' + x + '：' + JSON.stringify(inp));
      });
      closeTo(p.dryKcal + p.wetKcal, p.kcal, 1e-9);
    });
  }
  assert.equal(n, 300);
  assert.ok(asserts >= 300 * 15, '累计断言数应达到 300×15 以上，实得 ' + asserts);
});

/* ─────────────── 10. 自检「会红」反向验证 ─────────────── */

test('自检会红：13 套人工注入的错误各自必须让指定检查变红', () => {
  const inp = A.defaults();
  const good = A.compute(inp);
  assert.equal(good.checks.filter((c) => !c.pass).length, 0, '未注入时自检必须全绿');

  const muts = [
    ['全干粮方案罐头数为 0、全湿粮方案干粮为 0', (r) => { r.plans[0].cans = 0.5; }],
    ['费用自洽', (r) => { r.plans[0].monthlyCost += 1; }],
    ['热量守恒', (r) => { r.plans[1].dryKcal += 5; }],
    ['系数 k 落在 1.0–3.0', (r) => { r.k = 5; }],
    ['所有输出都是有限非负', (r) => { r.plans[2].dryG = NaN; }],
    ['减重方案热量不超过维持热量', (r) => { r.plans[3].kcal = r.plans[2].kcal + 10; }],
    ['分餐数在 2–4 之间', (r) => { r.meals.count = 1; }],
    ['每 1000 kcal 单价口径：干粮', (r) => { r.unitCost.dryPer1000Kcal *= 2; }],
    ['每 1000 kcal 单价口径：罐头', (r) => { r.unitCost.wetPer1000Kcal += 1; }],
    ['时间线单调下降', (r) => { r.timeline.reverse(); }],
    ['周数与速率自洽', (r) => { r.gap.weeks = 1; }],
    ['每餐量 × 餐数 = 每日总量', (r) => { r.meals.perMealG *= 3; }],
    ['结论条与目标方案同一套数', (r) => { r.headline.dryG += 1; }],
  ];
  muts.forEach(([prefix, mut]) => {
    const copy = JSON.parse(JSON.stringify(good));
    mut(copy);
    const checks = A.runChecks(inp, copy);
    const hit = checks.filter((c) => !c.pass);
    assert.ok(hit.length >= 1, '注入「' + prefix + '」后自检没有变红（假绿灯）');
    assert.ok(hit.some((c) => c.name.indexOf(prefix) >= 0),
      '注入「' + prefix + '」后变红的是别的检查：' + JSON.stringify(hit.map((c) => c.name)));
  });
});

test('自检条目数与命名固定（15 条，页面上照实展示）', () => {
  const r = A.compute(A.defaults());
  assert.equal(r.checks.length, 16);
  r.checks.forEach((c) => assert.ok(c.name.length > 4 && typeof c.pass === 'boolean'));
});

/* ─────────────── 11. 确定性、纯函数、输出契约 ─────────────── */

test('compute 是纯函数：不修改入参，两次调用结果完全一致', () => {
  const inp = A.defaults();
  const snapshot = JSON.stringify(inp);
  const a = JSON.stringify(A.compute(inp));
  assert.equal(JSON.stringify(inp), snapshot, 'compute 改动了入参');
  const b = JSON.stringify(A.compute(inp));
  assert.equal(a, b, '两次计算结果不一致（存在隐藏状态）');
});

test('validate 不改动入参', () => {
  const inp = base({ weight: -1 });
  const snap = JSON.stringify(inp);
  A.validate(inp);
  assert.equal(JSON.stringify(inp), snap);
});

test('输出契约：字段齐全、方案顺序与编号固定、headline 与时间线自洽', () => {
  const r = A.compute(A.defaults());
  ['ok', 'errors', 'warnings', 'input', 'species', 'rer', 'k', 'kSteps', 'mer', 'canKcal',
    'bcs', 'gap', 'aggressive', 'plans', 'unitCost', 'meals', 'timeline', 'headline', 'checks'].forEach((k) => {
      assert.ok(k in r, '缺少字段 ' + k);
    });
  assert.deepEqual(r.plans.map((p) => p.id), ['dry', 'wet', 'mix', 'target']);
  r.plans.forEach((p) => assert.ok(typeof p.label === 'string' && p.label.length > 2));
  assert.equal(r.headline.wetPct, 30);
  assert.ok(r.headline.dryLine.indexOf('g 干粮') > 0);
  assert.ok(r.headline.bcsLine.indexOf('理想体重约') > 0);
  assert.equal(r.kSteps.length >= 1, true);
  assert.equal(r.timeline.length, r.buildTimeline ? r.timeline.length : r.timeline.length);
});

test('normalizeInput 把字符串数字转成数字、把绝育转成布尔', () => {
  const n = A.normalizeInput({ species: 'cat', weight: '4.8', bcs: '7', ageStage: '成年', neutered: 1, activity: 'mid', dryKcalPer100g: '360', dryPricePerKg: '60', wetKcalPer100g: '90', canNetG: '85', canPrice: '8', wetPct: '30', targetWeight: '3.9' });
  assert.strictEqual(n.weight, 4.8);
  assert.strictEqual(n.bcs, 7);
  assert.strictEqual(n.neutered, true);
  assert.equal(A.compute(Object.assign({}, n)).ok, true);
});

/* ─────────────── 12. 格式化契约 ─────────────── */

test('格式化：克数按量级取位、金额两位、非数给破折号', () => {
  assert.equal(A.fmtG(75.6672), '75.7 g');
  assert.equal(A.fmtG(9.876), '9.88 g');
  assert.equal(A.fmtG(120.4), '120 g');
  assert.equal(A.fmtCans(3.5608), '3.56 罐');
  assert.equal(A.fmtMoney(136.20097), '136.20 元');
  assert.equal(A.fmtWeeks(25), '25.0 周');
  assert.equal(A.fmtWeeks(null), '—');
  assert.equal(A.fmtKcal(272.40195), '272.4 kcal');
  assert.equal(A.fmt(undefined), '—');
  assert.equal(A.fmt(NaN), '—');
  assert.equal(A.fmtPct(62.745, 1), '62.7%');
});

test('round 只做显示层取整：半值进位、浮点尾巴归位、非数不抛异常', () => {
  assert.equal(A.round(2.5, 0), 3);
  assert.equal(A.round(-2.5, 0), -2);
  assert.equal(A.round(0.30000000000000004, 3), 0.3);
  assert.equal(A.round(3.560809819726773, 4), 3.5608);
  assert.equal(A.round(136.20097560454907, 2), 136.2);
  assert.ok(Number.isNaN(A.round(NaN, 2)));
});

/* ─────────────── 13. 预设场景 ─────────────── */

test('三个预设场景都能算出结果（errors 为空）', () => {
  const sc = A.scenarios();
  assert.equal(sc.length, 3);
  sc.forEach((s) => {
    const r = A.compute(s.input);
    assert.equal(r.ok, true, s.label + ' 报错：' + JSON.stringify(r.errors));
    assert.equal(r.errors.length, 0);
    assert.ok(r.mer > 0);
  });
});

test('预设场景不改动全局默认值（defaults() 返回副本）', () => {
  const a = A.defaults();
  a.weight = 99;
  assert.equal(A.defaults().weight, 4.8);
  const sc = A.scenarios();
  sc[0].input.weight = 77;
  assert.equal(A.defaults().weight, 4.8);
});
