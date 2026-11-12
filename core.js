/* 粮喂多了 · 核心引擎（纯函数，浏览器与 node 通用）
 *
 * 一句话：把宠物的体重、体况评分和粮的热量密度填进去，算出每天该喂多少克干粮、几个罐头，
 *         几套喂法并排对照月花费，再排出到目标体重需要多少周。
 *
 * 口径与假设全部写在页面上（也在 需求与调研.md §3 里）：本引擎不联网、不识别任何品牌、
 * 不评价粮的品质、不做诊断也不开处方。所有数字都由输入与下面的公式算出来。
 *
 * 公式（与页面、说明里每个数字同一套）：
 *   RER        = 70 · W^0.75                                  （kcal/日，W 为 kg）
 *   MER        = RER · k                                      （k 见 kFactor 的系数表口径）
 *   体脂率      = BCS_BF[BCS]；去脂体重 = W·(1−体脂率)
 *   理想体重    = 去脂体重 ÷ (1 − 0.20)                         （去脂体重守恒）
 *   干粮 g     = 干粮热量 kcal ÷ (干粮 kcal/100g) × 100
 *   罐头 罐    = 湿粮热量 kcal ÷ (罐头 kcal/100g × 罐净重 ÷ 100)
 *   能量缺口 G  = 速率 × W × 7700 ÷ 7                           （7700 kcal ≈ 1 kg 体脂）
 *   目标热量 T  = MER − G，下限保护 T ≥ max(0.8·RER(理想体重), 0.6·MER)
 *   实际速率    = (MER − T)·7 ÷ 7700 ÷ W × 100                  （%/周）
 *   周数        = (W − 目标体重) ÷ W × 100 ÷ 实际速率
 *   月成本      = 每日 g×30÷1000×元每kg + 每日罐数×30×元每罐
 *   1000 kcal 单价：干粮 = 10·元每kg ÷ (kcal/100g)；罐头 = (1000 ÷ kcal每g) ÷ 罐净重 × 元每罐
 */
(function (root, factory) {
  const A = factory();
  if (typeof module === 'object' && module.exports) module.exports = A;
  if (root) root.AppCore = A;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ─────────────── 常量与口径 ─────────────── */

  const VERSION = '1.0.0';
  const RER_K = 70;                 // RER = 70 · W^0.75
  const BW_EXP = 0.75;              // 代谢体重指数
  const KCAL_PER_KG_FAT = 7700;     // 1 kg 体脂 ≈ 7700 kcal
  const IDEAL_BF = 0.20;            // 理想体脂率（猫狗同用）
  const BAND = 0.15;                // 理想体重带宽 ±15%

  /* BCS(1–9) → 体脂率。这是**分档设计表**，取自公开体况评分图表常见的区间中值，
     不是精确测量：BCS 4–5 视为理想（体脂 18–20%），BCS ≤3 偏瘦，≥8 肥胖。 */
  const BCS_BF = { 1: 0.05, 2: 0.10, 3: 0.15, 4: 0.18, 5: 0.20, 6: 0.28, 7: 0.35, 8: 0.45, 9: 0.55 };
  const BCS_LABEL = { 1: '极瘦', 2: '很瘦', 3: '偏瘦', 4: '略瘦', 5: '理想', 6: '略胖', 7: '偏胖', 8: '肥胖', 9: '严重肥胖' };

  /* 成年基准系数（绝育） → 未绝育再 +0.2；老年再 −0.2（下限 1.0）；幼年用 YOUNG_K。 */
  const ADULT_BASE = { cat: { low: 1.0, mid: 1.2, high: 1.4 }, dog: { low: 1.4, mid: 1.8, high: 2.2 } };
  const YOUNG_K = { cat: { '<4月': 2.5, '4-12月': 2.0 }, dog: { '<4月': 3.0, '4-12月': 2.0 } };
  const NEUTER_BONUS = 0.2;
  const SENIOR_DROP = 0.2;

  /* 减重速率：期望值取公开区间中值；上限是安全线，超了要警告。 */
  const RATE = { cat: 0.75, dog: 1.5 };        // 期望速率 %/周
  const SAFE_MAX = { cat: 1.0, dog: 2.0 };     // 安全上限 %/周
  const SAFE_MIN = { cat: 0.5, dog: 1.0 };     // 偏慢提示线 %/周

  const LIMITS = {
    cat: { wMin: 0.3, wMax: 12.0 },
    dog: { wMin: 0.4, wMax: 90.0 },
    dryKcalMin: 1, dryKcalMax: 600,
    wetKcalMin: 1, wetKcalMax: 400,
    canNetMin: 1, canNetMax: 800,
  };

  const MEALS_BY_AGE = { '<4月': 4, '4-12月': 3, '成年': 2, '老年': 2 };
  const SPECIES = ['cat', 'dog'];
  const SPECIES_LABEL = { cat: '猫', dog: '狗' };
  const AGE_STAGES = ['<4月', '4-12月', '成年', '老年'];
  const ACTIVITIES = ['low', 'mid', 'high'];
  const ACTIVITY_LABEL = { low: '低（多数时间在家／很少出门）', mid: '中（每天有活动）', high: '高（活跃／工作犬）' };
  const FIELDS = ['species', 'weight', 'bcs', 'ageStage', 'neutered', 'activity',
    'dryKcalPer100g', 'dryPricePerKg', 'wetKcalPer100g', 'canNetG', 'canPrice', 'wetPct', 'targetWeight'];

  /* ─────────────── 默认与预设（默认数据是虚构示例） ─────────────── */

  const DEFAULTS = {
    species: 'cat', weight: 4.8, bcs: 7, ageStage: '成年', neutered: true, activity: 'mid',
    dryKcalPer100g: 360, dryPricePerKg: 60, wetKcalPer100g: 90, canNetG: 85, canPrice: 8,
    wetPct: 30, targetWeight: 3.9,
  };

  function defaults() {
    const o = {};
    FIELDS.forEach(function (f) { o[f] = DEFAULTS[f]; });
    return o;
  }

  const SCENARIOS = [
    { id: 'demo', label: '示例：绝育室内猫偏胖（4.8 kg / BCS 7）', input: defaults() },
    {
      id: 'lean', label: '示例：偏瘦的猫（3.2 kg / BCS 3）',
      input: Object.assign(defaults(), { weight: 3.2, bcs: 3, activity: 'high', targetWeight: 3.2, wetPct: 0 }),
    },
    {
      id: 'dog', label: '示例：大型犬减重（40 kg / BCS 9 / 低活动）',
      input: Object.assign(defaults(), {
        species: 'dog', weight: 40, bcs: 9, activity: 'low', neutered: true,
        dryKcalPer100g: 340, dryPricePerKg: 42, wetKcalPer100g: 110, canNetG: 400, canPrice: 22,
        wetPct: 20, targetWeight: 27.5,
      }),
    },
  ];
  function scenarios() {
    return SCENARIOS.map(function (s) { return { id: s.id, label: s.label, input: Object.assign({}, s.input) }; });
  }

  /* ─────────────── 基础工具 ─────────────── */

  function num(v) {
    if (v === null || v === undefined || v === '') return NaN;
    const n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }

  /* ─────────────── 公式实现 ─────────────── */

  /* RER = 70 · W^0.75（W 为 kg） */
  function rer(kg) {
    const w = num(kg);
    if (!isFinite(w) || w <= 0) return NaN;
    return RER_K * Math.pow(w, BW_EXP);
  }

  /* 系数 k：返回 {k, basis, steps[]} —— steps 用来在页面上解释这个数是怎么来的 */
  function kFactor(inp) {
    const sp = inp.species, age = inp.ageStage, act = inp.activity;
    const steps = [];
    if (SPECIES.indexOf(sp) < 0 || AGE_STAGES.indexOf(age) < 0 || ACTIVITIES.indexOf(act) < 0) {
      return { k: NaN, basis: '', steps: ['物种／年龄阶段／活动量取值不在范围内，系数算不出来'] };
    }
    if (YOUNG_K[sp][age] != null) {
      const k = YOUNG_K[sp][age];
      steps.push('幼年（' + age + '）：' + SPECIES_LABEL[sp] + ' 取 ' + k + '，不受绝育与活动量影响');
      return { k: k, basis: '幼年表', steps: steps };
    }
    let k = ADULT_BASE[sp][act];
    steps.push('成年基准（' + SPECIES_LABEL[sp] + ' / 活动量' + act + '，已绝育）：' + k);
    if (!inp.neutered) { k += NEUTER_BONUS; steps.push('未绝育：+' + NEUTER_BONUS + ' → ' + round(k, 4)); }
    if (age === '老年') { k = Math.max(1.0, k - SENIOR_DROP); steps.push('老年：−' + SENIOR_DROP + '，下限 1.0 → ' + round(k, 4)); }
    return { k: k, basis: (age === '老年' ? '成年基准±绝育±老年' : '成年基准±绝育'), steps: steps };
  }

  function merKcal(inp) {
    const r = rer(inp.weight), kf = kFactor(inp);
    return r * kf.k;
  }

  /* 体况评分 → 体脂率 → 去脂体重 → 理想体重 */
  function bcsInfo(inp) {
    const w = num(inp.weight), bcs = num(inp.bcs);
    const bf = BCS_BF[bcs];
    if (!isFinite(w) || bf === undefined) return { ok: false };
    const lean = w * (1 - bf);
    const ideal = lean / (1 - IDEAL_BF);
    return {
      ok: true, bcs: bcs, bf: bf, leanKg: lean, idealKg: ideal,
      idealLo: ideal * (1 - BAND), idealHi: ideal * (1 + BAND),
      label: BCS_LABEL[bcs] || '',
      direction: (num(inp.targetWeight) < w - 1e-9) ? 'lose' : 'maintain',
    };
  }

  /* 每罐多少 kcal（按 kcal/100g × 罐净重） */
  function canKcalOf(inp) {
    const per100 = num(inp.wetKcalPer100g), net = num(inp.canNetG);
    if (!isFinite(per100) || !isFinite(net)) return NaN;
    return per100 * net / 100;
  }

  /* 给定每日总热量与湿粮热量占比 → 干粮克数、罐头数、成本 */
  function planOf(kcal, wetPct, inp) {
    const per100 = num(inp.dryKcalPer100g), dryPrice = num(inp.dryPricePerKg), canPrice = num(inp.canPrice);
    const canK = canKcalOf(inp);
    const p = num(wetPct) / 100;
    const wetKcal = kcal * p, dryKcal = kcal - wetKcal;
    const dryG = dryKcal / (per100 / 100);
    const cans = wetKcal / canK;
    const dryCost = dryG * 30 / 1000 * dryPrice;
    const wetCost = cans * 30 * canPrice;
    return {
      kcal: kcal, wetKcal: wetKcal, dryKcal: dryKcal, dryG: dryG, cans: cans,
      dryCost: dryCost, wetCost: wetCost, monthlyCost: dryCost + wetCost,
    };
  }

  /* 目标体重方案：只排减重方向 */
  function weightPlan(inp, mer, bcs) {
    const w = num(inp.weight), target = num(inp.targetWeight), sp = inp.species;
    const floor = Math.max(0.8 * rer(bcs.idealKg), 0.6 * mer);
    if (!(target < w - 1e-9)) {
      return {
        direction: 'maintain', gapKcal: 0, targetKcal: mer, floorKcal: floor, clamped: false,
        planKcal: mer, actualRate: 0, needPct: (w - target) / w * 100, weeks: null,
        expectedRate: NaN,
        note: '目标体重不小于当前体重：本工具只排减重方向，增重请按兽医建议调整',
      };
    }
    const expectedRate = RATE[sp];
    const gapKcal = expectedRate / 100 * w * KCAL_PER_KG_FAT / 7;
    const targetKcal = mer - gapKcal;
    const clamped = targetKcal < floor;
    const planKcal = Math.max(targetKcal, floor);
    const actualRate = (mer - planKcal) * 7 / KCAL_PER_KG_FAT / w * 100;
    const needPct = (w - target) / w * 100;
    const weeks = actualRate > 0 ? needPct / actualRate : null;
    return {
      direction: 'lose', gapKcal: gapKcal, targetKcal: targetKcal, floorKcal: floor, clamped: clamped,
      planKcal: planKcal, actualRate: actualRate, needPct: needPct, weeks: weeks,
      expectedRate: expectedRate,
      note: clamped ? '按期望速率算出的热量低于下限保护，已抬到下限，实际速率随之放慢' : '按' + SP_LABEL(sp) + '期望速率 ' + expectedRate + ' %/周排出',
    };
  }
  function SP_LABEL(sp) { return SPECIES_LABEL[sp] || sp; }

  /* 每 1000 kcal 单价：跨品类可比的成本口径 */
  function unitCostOf(inp) {
    const per100 = num(inp.dryKcalPer100g), dryPrice = num(inp.dryPricePerKg);
    const wetPer100 = num(inp.wetKcalPer100g), net = num(inp.canNetG), canPrice = num(inp.canPrice);
    const dryPer1000 = 10000 / per100 / 1000 * dryPrice;         // = 10·元每kg ÷ (kcal/100g)
    const wetKcalPerG = wetPer100 / 100;
    const wetPer1000 = (1000 / wetKcalPerG) / net * canPrice;
    return {
      dryPer1000Kcal: dryPer1000, wetPer1000Kcal: wetPer1000,
      ratio: dryPer1000 > 0 ? wetPer1000 / dryPer1000 : NaN,
      cheaper: dryPer1000 <= wetPer1000 ? 'dry' : 'wet',
    };
  }

  /* ─────────────── 校验 ─────────────── */

  function validate(inp) {
    const errors = [], warnings = [];
    const E = function (field, msg) { errors.push({ field: field, msg: msg }); };
    if (!inp || typeof inp !== 'object') { E('_', '没有读到输入'); return { ok: false, errors: errors, warnings: warnings }; }

    const sp = inp.species;
    if (SPECIES.indexOf(sp) < 0) E('species', '物种只能是猫或狗');
    const lim = LIMITS[sp] || LIMITS.cat;

    const w = num(inp.weight);
    if (!isFinite(w)) E('weight', '体重没填或不是数字');
    else if (w <= 0) E('weight', '体重必须大于 0');
    else if (w < lim.wMin || w > lim.wMax) E('weight', '体重 ' + w + ' kg 超出本工具范围（' + SP_LABEL(sp) + ' ' + lim.wMin + '–' + lim.wMax + ' kg）');

    const t = num(inp.targetWeight);
    if (!isFinite(t)) E('targetWeight', '目标体重没填或不是数字');
    else if (t <= 0) E('targetWeight', '目标体重必须大于 0');
    else if (t < lim.wMin || t > lim.wMax) E('targetWeight', '目标体重 ' + t + ' kg 超出本工具范围（' + SP_LABEL(sp) + ' ' + lim.wMin + '–' + lim.wMax + ' kg）');

    const bcs = num(inp.bcs);
    if (!isInt(bcs)) E('bcs', '体况评分必须是整数');
    else if (bcs < 1 || bcs > 9) E('bcs', '体况评分只能是 1–9');

    if (AGE_STAGES.indexOf(inp.ageStage) < 0) E('ageStage', '年龄阶段取值不在范围内');
    if (typeof inp.neutered !== 'boolean') E('neutered', '是否绝育必须是是或否');
    if (ACTIVITIES.indexOf(inp.activity) < 0) E('activity', '活动量取值不在范围内');

    const dk = num(inp.dryKcalPer100g);
    if (!isFinite(dk)) E('dryKcalPer100g', '干粮热量密度没填或不是数字');
    else if (dk <= 0) E('dryKcalPer100g', '干粮热量密度必须大于 0（不能拿 0 当分母）');
    else if (dk > LIMITS.dryKcalMax) E('dryKcalPer100g', '干粮热量密度 ' + dk + ' kcal/100g 超出常见上限 ' + LIMITS.dryKcalMax);

    const wk = num(inp.wetKcalPer100g);
    if (!isFinite(wk)) E('wetKcalPer100g', '罐头热量密度没填或不是数字');
    else if (wk <= 0) E('wetKcalPer100g', '罐头热量密度必须大于 0');
    else if (wk > LIMITS.wetKcalMax) E('wetKcalPer100g', '罐头热量密度 ' + wk + ' kcal/100g 超出常见上限 ' + LIMITS.wetKcalMax);

    const net = num(inp.canNetG);
    if (!isFinite(net)) E('canNetG', '罐净重没填或不是数字');
    else if (net <= 0) E('canNetG', '罐净重必须大于 0');
    else if (net > LIMITS.canNetMax) E('canNetG', '罐净重 ' + net + ' g 超出常见上限 ' + LIMITS.canNetMax);

    const dp = num(inp.dryPricePerKg);
    if (!isFinite(dp)) E('dryPricePerKg', '干粮价格没填或不是数字');
    else if (dp < 0) E('dryPricePerKg', '价格不能是负数');

    const cp = num(inp.canPrice);
    if (!isFinite(cp)) E('canPrice', '罐头价格没填或不是数字');
    else if (cp < 0) E('canPrice', '价格不能是负数');

    const pct = num(inp.wetPct);
    if (!isFinite(pct)) E('wetPct', '湿粮热量占比没填或不是数字');
    else if (pct < 0 || pct > 100) E('wetPct', '湿粮热量占比必须在 0–100 之间');

    if (errors.length) return { ok: false, errors: errors, warnings: warnings };

    /* 以下只给提示，不影响计算 */
    const bcs2 = bcsInfo(inp);
    if (bcs2.ok) {
      if (t < bcs2.idealLo - 1e-9 || t > bcs2.idealHi + 1e-9) {
        warnings.push({ code: 'target-band', msg: '目标体重 ' + round(t, 2) + ' kg 落在理想体重带宽（' + round(bcs2.idealLo, 2) + '–' + round(bcs2.idealHi, 2) + ' kg）之外，仍按你填的数计算' });
      }
      if (bcs >= 8) warnings.push({ code: 'obese', msg: '体况评分 ' + bcs + '（' + bcs2.label + '）：先排除疾病因素再减重，本工具不做诊断' });
      if (bcs <= 3) warnings.push({ code: 'lean', msg: '体况评分 ' + bcs + '（' + bcs2.label + '）：偏瘦的增重方案不在本工具范围，建议先排查疾病' });
    }
    const mer = merKcal(inp);
    const wp = weightPlan(inp, mer, bcs2);
    if (wp.direction === 'lose') {
      if (wp.actualRate > SAFE_MAX[sp] + 1e-9) {
        warnings.push({ code: 'too-fast', msg: '按这套喂推算掉重 ' + round(wp.actualRate, 3) + ' %/周，超过' + SP_LABEL(sp) + '的安全上限 ' + SAFE_MAX[sp] + ' %/周' });
      }
      if (sp === 'cat' && wp.actualRate < SAFE_MIN.cat - 1e-9) {
        warnings.push({ code: 'too-slow', msg: '按这套喂推算掉重 ' + round(wp.actualRate, 3) + ' %/周，低于猫的常见区间下限 ' + SAFE_MIN.cat + ' %/周' });
      }
      if (wp.clamped) {
        warnings.push({ code: 'clamped', msg: '期望速率对应的热量低于下限保护（' + round(wp.floorKcal, 2) + ' kcal），已抬到下限，实际速率放慢到 ' + round(wp.actualRate, 3) + ' %/周' });
      }
    } else if (t > w + 1e-9) {
      warnings.push({ code: 'gain', msg: '目标体重 ' + round(t, 2) + ' kg 大于当前体重：本工具只排减重方向，不会给出增重计划' });
    }
    if (dk === DEFAULTS.dryKcalPer100g && dp === DEFAULTS.dryPricePerKg && wk === DEFAULTS.wetKcalPer100g && net === DEFAULTS.canNetG && cp === DEFAULTS.canPrice) {
      warnings.push({ code: 'defaults-food', msg: '热量密度与价格用的是虚构示例默认值，换成你家粮包装上的数字更准' });
    }
    return { ok: true, errors: errors, warnings: warnings };
  }

  /* ─────────────── 汇总计算 ─────────────── */

  function compute(inp) {
    const v = validate(inp);
    const out = {
      version: VERSION, ok: v.ok, errors: v.errors, warnings: v.warnings,
      input: normalizeInput(inp),
    };
    if (!v.ok) return out;

    const w = num(inp.weight), target = num(inp.targetWeight), sp = inp.species;
    const R = rer(w), kf = kFactor(inp), mer = R * kf.k;
    const bcs = bcsInfo(inp);
    const wp = weightPlan(inp, mer, bcs);
    const uc = unitCostOf(inp);
    const canK = canKcalOf(inp);

    const plans = [
      Object.assign({ id: 'dry', label: '全干粮 · 维持体重', wetPct: 0, weeks: null, note: '最省钱的喂法（按每 1000 kcal 单价比较）；采用后把湿粮热量占比改成 0%' }, planOf(mer, 0, inp)),
      Object.assign({ id: 'wet', label: '全湿粮 · 维持体重', wetPct: 100, weeks: null, note: '水分摄入高，但按月花费最贵；采用后把湿粮热量占比改成 100%' }, planOf(mer, 100, inp)),
      Object.assign({ id: 'mix', label: '对半混喂 · 维持体重', wetPct: 50, weeks: null, note: '干湿各占一半热量；采用后把湿粮热量占比改成 50%' }, planOf(mer, 50, inp)),
      Object.assign({
        id: 'target', label: wp.direction === 'lose' ? '目标体重方案 · 减到 ' + round(target, 2) + ' kg' : '目标体重方案 · 不排减重',
        wetPct: num(inp.wetPct), weeks: wp.weeks, note: wp.note,
      }, planOf(wp.planKcal, num(inp.wetPct), inp)),
    ];

    /* 分餐量跟随「结论条」用的那套方案（目标方案 = 你当前的湿粮占比），
       这样页面上「今天喂多少」和「每餐多少」是同一套数。 */
    const meals = MEALS_BY_AGE[inp.ageStage] || 2;
    const headPlan = plans[3];
    const mealsInfo = {
      count: meals,
      perMealG: headPlan.dryG / meals,
      perMealCans: headPlan.cans / meals,
      note: inp.ageStage === '成年' || inp.ageStage === '老年' ? '成年／老年按 2 餐（可按实际习惯拆成 2–4 餐，总量不变）' : '幼年按 ' + meals + ' 餐',
    };

    const timeline = buildTimeline(w, target, wp);

    const result = Object.assign(out, {
      species: sp, speciesLabel: SP_LABEL(sp),
      rer: R, k: kf.k, kSteps: kf.steps, kBasis: kf.basis, mer: mer,
      canKcal: canK,
      bcs: bcs, gap: wp, aggressive: {
        kcal: 0.8 * rer(bcs.idealKg),
        rate: (mer - 0.8 * rer(bcs.idealKg)) * 7 / KCAL_PER_KG_FAT / w * 100,
      },
      plans: plans, unitCost: uc, meals: mealsInfo, timeline: timeline,
      headline: headlineOf(plans, wp, bcs, mer, target),
    });
    result.checks = runChecks(inp, result);
    return result;
  }

  /* 入参可能是 null／字符串／数组（页面初始化读到空控件时就会这样），
     这里必须自己兜住，否则 compute(null) 会直接抛异常把整页带崩。 */
  function normalizeInput(inp) {
    const o = {};
    const src = (inp && typeof inp === 'object') ? inp : {};
    FIELDS.forEach(function (f) {
      if (f === 'neutered') o[f] = (src[f] === true || src[f] === 1 || src[f] === 'true' || src[f] === 'yes');
      else if (f === 'species' || f === 'ageStage' || f === 'activity') o[f] = (typeof src[f] === 'string' ? src[f] : '');
      else o[f] = num(src[f]);
    });
    return o;
  }

  function headlineOf(plans, wp, bcs, mer, target) {
    /* 结论条 = 目标方案那一行（维持方向时它就是「按你当前占比的维持方案」） */
    const usePlan = plans[3];
    const isMix = usePlan.wetPct > 0 && usePlan.wetPct < 100;
    const kcalTarget = wp.direction === 'lose' ? wp.planKcal : mer;
    /* 只出干粮时就说克数、只出罐头时就说罐数，两边都有才连起来 —— 别写成「0 g 干粮 + 4.2 罐」 */
    const gTxt = usePlan.dryG >= 0.05 ? round(usePlan.dryG, 1).toFixed(1) + ' g 干粮' : '';
    const cTxt = usePlan.cans >= 0.005 ? round(usePlan.cans, 2).toFixed(2) + ' 罐' : '';
    return {
      kcal: kcalTarget, dryG: usePlan.dryG, cans: usePlan.cans, wetPct: usePlan.wetPct,
      isMix: isMix,
      bcsLine: '体况评分 ' + bcs.bcs + '（' + bcs.label + '）：体脂约 ' + round(bcs.bf * 100, 0) + '%，理想体重约 ' + round(bcs.idealKg, 2) + ' kg',
      weightLine: wp.direction === 'lose'
        ? '目标 ' + round(target, 2) + ' kg：按 ' + round(wp.actualRate, 3) + ' %/周，约 ' + round(wp.weeks, 1) + ' 周'
        : '目标体重不小于当前体重：按维持热量喂，不排减重时间线',
      dryLine: (gTxt && cTxt) ? (gTxt + ' + ' + cTxt) : (gTxt || cTxt || '0 g'),
    };
  }

  function buildTimeline(w, target, wp) {
    if (wp.direction !== 'lose' || !isFinite(wp.weeks) || wp.weeks <= 0) return [];
    const weeks = wp.weeks;
    const step = Math.max(1, Math.ceil(weeks / 24));
    const pts = [];
    for (let wk = 0; wk < weeks; wk += step) {
      pts.push({ week: wk, kg: w - (w - target) * (wk / weeks), kcal: wp.planKcal });
    }
    pts.push({ week: weeks, kg: target, kcal: wp.planKcal });
    return pts;
  }

  /* ─────────────── 引擎自检（页面可见，也被测试调用） ─────────────── */

  function close(a, b, tol) {
    if (!isFinite(a) || !isFinite(b)) return false;
    const t = tol == null ? 1e-9 : tol;
    return Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));
  }

  function runChecks(inp, r) {
    const ck = [];
    const add = function (name, pass, detail) { ck.push({ name: name, pass: !!pass, detail: detail == null ? '' : String(detail) }); };

    add('热量守恒：干粮热量 + 湿粮热量 = 该方案总热量',
      r.plans.every(function (p) { return close(p.dryKcal + p.wetKcal, p.kcal, 1e-9); }),
      r.plans.map(function (p) { return p.id + ':' + round(p.dryKcal + p.wetKcal - p.kcal, 9); }).join(' '));

    add('费用自洽：月花费 = 干粮成本 + 罐头成本',
      r.plans.every(function (p) { return close(p.dryCost + p.wetCost, p.monthlyCost, 1e-9); }));

    add('全干粮方案罐头数为 0、全湿粮方案干粮为 0',
      r.plans[0].cans === 0 && r.plans[1].dryG === 0);

    add('所有输出都是有限非负数（无 NaN／Infinity／负数）', (function () {
      const vals = [];
      r.plans.forEach(function (p) { vals.push(p.kcal, p.dryKcal, p.wetKcal, p.dryG, p.cans, p.dryCost, p.wetCost, p.monthlyCost); });
      vals.push(r.rer, r.mer, r.k, r.canKcal, r.unitCost.dryPer1000Kcal, r.unitCost.wetPer1000Kcal, r.meals.perMealG);
      return vals.every(function (x) { return isFinite(x) && x >= 0; });
    })());

    add('系数 k 落在 1.0–3.0 之间', r.k >= 1.0 && r.k <= 3.0, 'k=' + r.k);

    add('RER 随体重单调不减（0.5–90 kg 抽样）', (function () {
      let prev = -Infinity;
      for (let x = 0.5; x <= 90; x += 0.5) { const v = rer(x); if (!(v > prev)) return false; prev = v; }
      return true;
    })());

    add('体况评分 5 时理想体重 = 当前体重（去脂体重守恒的自洽点）',
      close(bcsInfo({ weight: inp.weight, bcs: 5, targetWeight: inp.targetWeight }).idealKg, num(inp.weight), 1e-12));

    add('湿粮热量占比越高，罐头数不减、干粮克数不增', (function () {
      const a = planOf(200, 0, inp), b = planOf(200, 50, inp), c = planOf(200, 100, inp);
      return b.cans >= a.cans - 1e-12 && c.cans >= b.cans - 1e-12 && b.dryG <= a.dryG + 1e-12 && c.dryG <= b.dryG + 1e-12;
    })());

    add('结论条与目标方案同一套数（克数、罐数、热量一致）', (function () {
      return close(r.headline.dryG, r.plans[3].dryG, 1e-12) && close(r.headline.cans, r.plans[3].cans, 1e-12) &&
        close(r.headline.kcal, r.plans[3].kcal, 1e-12) && close(r.meals.perMealG * r.meals.count, r.headline.dryG, 1e-12);
    })());

    add('减重方案热量不超过维持热量，且不低于下限保护', r.plans[3].kcal <= r.plans[0].kcal + 1e-12 && r.plans[3].kcal >= r.gap.floorKcal - 1e-9,
      '目标方案 ' + round(r.plans[3].kcal, 4) + ' 维持 ' + round(r.plans[2].kcal, 4) + ' 下限 ' + round(r.gap.floorKcal, 4));

    add('周数与速率自洽：周数 = 需要减的比例 ÷ 实际速率', r.gap.direction !== 'lose' || close(r.gap.weeks * r.gap.actualRate, r.gap.needPct, 1e-9),
      r.gap.direction === 'lose' ? '' : '非减重方向，不适用');

    add('每餐量 × 餐数 = 每日总量', (function () {
      return close(r.meals.perMealG * r.meals.count, r.plans[3].dryG, 1e-9) && close(r.meals.perMealCans * r.meals.count, r.plans[3].cans, 1e-9);
    })());

    add('每 1000 kcal 单价口径：干粮 = 10 × 元每kg ÷ (kcal/100g)',
      close(r.unitCost.dryPer1000Kcal, 10 * num(inp.dryPricePerKg) / num(inp.dryKcalPer100g), 1e-9));

    add('每 1000 kcal 单价口径：罐头 = (1000 ÷ kcal每g) ÷ 罐净重 × 元每罐',
      close(r.unitCost.wetPer1000Kcal, (1000 / (num(inp.wetKcalPer100g) / 100)) / num(inp.canNetG) * num(inp.canPrice), 1e-9));

    add('时间线单调下降且落在当前体重与目标体重之间（减重方向）', (function () {
      if (r.gap.direction !== 'lose') return true;
      const t = r.timeline;
      if (t.length < 2) return false;
      for (let i = 1; i < t.length; i++) if (!(t[i].kg <= t[i - 1].kg + 1e-9)) return false;
      return close(t[0].kg, num(inp.weight), 1e-9) && close(t[t.length - 1].kg, num(inp.targetWeight), 1e-9);
    })());

    add('分餐数在 2–4 之间', r.meals.count >= 2 && r.meals.count <= 4, 'count=' + r.meals.count);

    return ck;
  }

  /* ─────────────── 格式化 ─────────────── */

  function round(x, d) {
    if (!isFinite(x)) return NaN;
    const f = Math.pow(10, d == null ? 0 : d);
    return Math.round(x * f) / f;
  }
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    const n = (d == null ? 2 : d);
    return Number(x).toFixed(n);
  }
  function fmtG(x) { return fmt(x, x >= 100 ? 0 : (x >= 10 ? 1 : 2)) + ' g'; }
  function fmtCans(x) { return fmt(x, 2) + ' 罐'; }
  function fmtKcal(x) { return fmt(x, 1) + ' kcal'; }
  function fmtMoney(x) { return fmt(x, 2) + ' 元'; }
  function fmtWeeks(x) { return (x == null || !isFinite(x)) ? '—' : fmt(x, 1) + ' 周'; }
  function fmtPct(x, d) { return fmt(x, d == null ? 2 : d) + '%'; }
  function fmtKg(x) { return fmt(x, 2) + ' kg'; }

  return {
    VERSION: VERSION, RER_K: RER_K, BW_EXP: BW_EXP, KCAL_PER_KG_FAT: KCAL_PER_KG_FAT,
    IDEAL_BF: IDEAL_BF, BAND: BAND, BCS_BF: BCS_BF, BCS_LABEL: BCS_LABEL,
    ADULT_BASE: ADULT_BASE, YOUNG_K: YOUNG_K, RATE: RATE, SAFE_MAX: SAFE_MAX, SAFE_MIN: SAFE_MIN,
    LIMITS: LIMITS, MEALS_BY_AGE: MEALS_BY_AGE, SPECIES: SPECIES, SPECIES_LABEL: SPECIES_LABEL,
    AGE_STAGES: AGE_STAGES, ACTIVITIES: ACTIVITIES, ACTIVITY_LABEL: ACTIVITY_LABEL, FIELDS: FIELDS,
    DEFAULTS: DEFAULTS,
    defaults: defaults, scenarios: scenarios,
    rer: rer, kFactor: kFactor, merKcal: merKcal, bcsInfo: bcsInfo, canKcalOf: canKcalOf,
    planOf: planOf, weightPlan: weightPlan, unitCostOf: unitCostOf, validate: validate,
    compute: compute, runChecks: runChecks, normalizeInput: normalizeInput, buildTimeline: buildTimeline,
    round: round, close: close,
    fmt: fmt, fmtG: fmtG, fmtCans: fmtCans, fmtKcal: fmtKcal, fmtMoney: fmtMoney,
    fmtWeeks: fmtWeeks, fmtPct: fmtPct, fmtKg: fmtKg,
  };
});
