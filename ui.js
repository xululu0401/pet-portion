/* 粮喂多了 · 界面层（只做读写 DOM 与排版，所有数字都来自 AppCore.compute） */
(function () {
  'use strict';
  const A = window.AppCore;
  const SLUG = 'pet-portion';
  const VERSION = '1.0.0';
  const STORE_KEY = 'pet-portion::v1';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const G = (x) => A.fmtG(x);
  const KC = (x) => A.fmtKcal(x);
  const MONEY = (x) => A.fmtMoney(x);

  const IDS = {
    species: 'p-species', weight: 'p-weight', bcs: 'p-bcs', ageStage: 'p-age', neutered: 'p-neuter',
    activity: 'p-activity', dryKcalPer100g: 'p-drykcal', dryPricePerKg: 'p-dryprice',
    wetKcalPer100g: 'p-wetkcal', canNetG: 'p-can', canPrice: 'p-canprice',
    wetPct: 'p-wetpct', targetWeight: 'p-target',
  };
  const NUM_FIELDS = ['weight', 'bcs', 'dryKcalPer100g', 'dryPricePerKg', 'wetKcalPer100g', 'canNetG', 'canPrice', 'wetPct', 'targetWeight'];

  const BOUNDS = [
    '算的是热量：先用 RER = 70 × 体重^0.75 得到静息需求，再乘一个「系数」得到维持需求。系数按物种、年龄阶段、是否绝育、活动量查表，取自公开兽医营养资料里常见的区间中值 —— 它是设计选择，不是唯一正确答案。',
    '体况评分到体脂率是分档表（1→5%、5→20%、7→35%、9→55%），理想体脂率按 20% 算，理想体重由「去脂体重不变」反推。评分靠手感，打偏了结论就偏。',
    '粮只看两个数：热量密度与价格。不评价配方、蛋白来源、适口性、品牌，也不判断某种粮适不适合你家这只。',
    '减重方案只排一个方向：按公开口径的常见速率（猫 0.75、狗 1.5 %体重/周）算出每日能量缺口，再乘下限保护（不低于 0.8×RER(理想体重)，也不低于维持热量的 60%），触底就按触底热量重算速率。目标体重不小于当前体重时不出时间线。',
    '不处理：疾病（肾病、糖尿病、胰腺炎、甲亢等）、处方粮、怀孕哺乳期、需要个体化方案的肥胖症治疗、生骨肉/自制粮的营养均衡性判断 —— 这些都需要兽医面诊，不是一道算术题。',
    '1 kg 体脂按 7700 kcal 折算，这是公开口径里常用的近似值；实际掉重不会完全来自脂肪，所以周数只能当量级参考。',
    '价格、热量密度、体重都是你自己填的；填的是开封后的市售价与包装标注热量，算出来的月花费才有可比性。',
  ];

  /* ── 读写输入 ── */
  function readInputs() {
    const o = {};
    o.species = $('p-species') ? $('p-species').value : 'cat';
    o.ageStage = $('p-age') ? $('p-age').value : '成年';
    o.activity = $('p-activity') ? $('p-activity').value : 'mid';
    o.neutered = ($('p-neuter') ? $('p-neuter').value : 'yes') === 'yes';
    NUM_FIELDS.forEach(function (f) {
      const el = $(IDS[f]);
      if (!el || el.value === '') { o[f] = NaN; return; }
      const n = Number(el.value);
      o[f] = isFinite(n) ? n : NaN;
    });
    return o;
  }

  function writeInputs(inp) {
    const src = inp || {};
    if ($('p-species')) $('p-species').value = (A.SPECIES.indexOf(src.species) >= 0 ? src.species : 'cat');
    if ($('p-age')) $('p-age').value = (A.AGE_STAGES.indexOf(src.ageStage) >= 0 ? src.ageStage : '成年');
    if ($('p-activity')) $('p-activity').value = (A.ACTIVITIES.indexOf(src.activity) >= 0 ? src.activity : 'mid');
    if ($('p-neuter')) $('p-neuter').value = src.neutered === false ? 'no' : 'yes';
    NUM_FIELDS.forEach(function (f) {
      const el = $(IDS[f]);
      if (!el) return;
      const v = src[f];
      el.value = (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) ? '' : String(v);
    });
  }

  /* ── 渲染 ── */
  function render() {
    const inp = readInputs();
    const r = A.compute(inp);
    window.__app.last = r;
    paint(r);
    try { autoSave(inp); } catch (e) { /* 隐私模式下 localStorage 可能不可用，不影响计算 */ }
    return r;
  }

  function paint(r) {
    /* 报错与提示 */
    const eb = $('errbox'), wb = $('warnbox');
    if (eb) {
      if (r.ok) { eb.classList.add('hidden'); eb.innerHTML = ''; }
      else {
        eb.classList.remove('hidden');
        eb.innerHTML = '<b>这几处填得不对，先改一下：</b><ul>' +
          r.errors.map((e) => '<li>' + esc((e.field === '_' ? '' : fieldLabel(e.field) + '：')) + esc(e.msg) + '</li>').join('') + '</ul>';
      }
    }
    if (wb) {
      if (!r.warnings.length) { wb.classList.add('hidden'); wb.innerHTML = ''; }
      else {
        wb.classList.remove('hidden');
        wb.innerHTML = '<b>算出来了，但有 ' + r.warnings.length + ' 处要提醒：</b><ul>' +
          r.warnings.map((w) => '<li>' + esc(w.msg) + '</li>').join('') + '</ul>';
      }
    }
    const cc = $('conclusion');
    if (cc) cc.classList.remove('invalid');
    if (!r.ok) { blankOut(); return; }

    /* 结论条 */
    const h = r.headline;
    set('out-dryline', h.dryLine);
    set('out-kcal', KC(h.kcal));
    set('out-meals', r.meals.count + ' 餐 × ' + G(r.meals.perMealG) + (r.meals.perMealCans > 0 ? ' + ' + A.fmtCans(r.meals.perMealCans) : ''));
    set('out-cost', MONEY(r.plans[3].monthlyCost) + '/月');
    set('out-mealsnote', r.meals.note);
    set('out-bcsline', h.bcsLine);
    set('out-weightline', h.weightLine);
    set('out-rateline', '按每 1000 kcal 比：干粮 ' + A.fmtMoney(r.unitCost.dryPer1000Kcal) + '、罐头 ' + A.fmtMoney(r.unitCost.wetPer1000Kcal) +
      (isFinite(r.unitCost.ratio) && r.unitCost.ratio > 0 ? '（罐头是干粮的 ' + A.fmt(r.unitCost.ratio, 2) + ' 倍）' : ''));
    set('concl-tag', r.speciesLabel + ' ' + A.fmtKg(r.input.weight) + ' · 体况 ' + r.bcs.bcs + ' / 9 · ' + r.input.ageStage);

    /* 对照表 */
    const tb = $('t-plan-body');
    if (tb) {
      tb.innerHTML = r.plans.map(function (p, i) {
        const isHead = i === 3;
        const adoptLabel = p.id === 'target' ? '把目标体重写成理想体重' : '把湿粮占比改成 ' + p.wetPct + '%';
        return '<tr class="' + (isHead ? 'pick' : '') + '">' +
          '<td class="name" data-l="方案">' + esc(p.label) + (isHead ? '<span class="badge">结论条用这套</span>' : '') + '</td>' +
          '<td class="num" data-l="每日热量">' + KC(p.kcal) + '</td>' +
          '<td class="num" data-l="干粮">' + (p.dryG > 0 ? G(p.dryG) : '—') + '</td>' +
          '<td class="num" data-l="罐头">' + (p.cans > 0 ? A.fmtCans(p.cans) : '—') + '</td>' +
          '<td class="num" data-l="每月粮钱">' + MONEY(p.monthlyCost) + '</td>' +
          '<td class="num" data-l="达标周数">' + A.fmtWeeks(p.weeks) + '</td>' +
          '<td class="note" data-l="说明">' + esc(p.note) +
            '<div class="adopt"><button class="sm" data-adopt="' + p.id + '" title="' + esc(adoptLabel) + '">采用</button></div></td>' +
          '</tr>';
      }).join('');
      Array.prototype.forEach.call(tb.querySelectorAll('button[data-adopt]'), function (b) {
        b.addEventListener('click', function () { adopt(b.getAttribute('data-adopt')); });
      });
    }

    /* 体况诊断 */
    const bb = $('bcs-body');
    if (bb) {
      const b = r.bcs;
      const diff = r.input.weight - b.idealKg;
      bb.innerHTML = [
        kv('体况评分', b.bcs + ' / 9（' + b.label + '）'),
        kv('体脂率（分档）', A.fmtPct(b.bf * 100, 0)),
        kv('去脂体重', A.fmtKg(b.leanKg)),
        kv('理想体重', A.fmtKg(b.idealKg)),
        kv('理想带宽（±15%）', A.fmtKg(b.idealLo) + ' – ' + A.fmtKg(b.idealHi)),
        kv('当前比理想', (diff > 0.005 ? '重 ' + A.fmtKg(diff) : (diff < -0.005 ? '轻 ' + A.fmtKg(-diff) : '基本一致'))),
      ].join('');
    }

    /* 「少喂点」口径对照 */
    const ab = $('aggr-body');
    if (ab) {
      const maxRate = A.SAFE_MAX[r.species];
      const over = r.aggressive.rate > maxRate;
      ab.innerHTML = [
        kv('0.8 × RER(理想体重)', KC(r.aggressive.kcal)),
        kv('折成掉重速率', A.fmt(r.aggressive.rate, 2) + ' %/周'),
        kv('这个物种的安全上限', A.fmt(maxRate, 2) + ' %/周'),
        kv('判定', over ? '超了 ' + A.fmt(r.aggressive.rate - maxRate, 2) + ' 个百分点，别按这个数喂' : '没超上限，仍在常见区间里'),
      ].join('');
    }

    /* 时间线 */
    const tl = $('tl-body');
    if (tl) {
      if (!r.timeline.length) {
        tl.innerHTML = '<p class="hint" style="font-size:12.5px;color:var(--ink3);margin:0">' +
          (r.gap.direction === 'lose' ? '算不出时间线。' : '目标体重不小于当前体重，本工具不排减重时间线（增重请按兽医建议）。') + '</p>';
        set('tl-tag', '');
      } else {
        tl.innerHTML = '<div class="tblwrap"><table class="tl"><thead><tr><th>第几周</th><th>体重</th><th>该周每日热量</th></tr></thead><tbody>' +
          r.timeline.map(function (p) {
            const isInt = Math.abs(p.week - Math.round(p.week)) < 1e-9;
            const w = p.week < 0.05 ? '起点' : '第 ' + (isInt ? String(Math.round(p.week)) : A.fmt(p.week, 1)) + ' 周';
            return '<tr><td>' + w + '</td><td>' + A.fmtKg(p.kg) + '</td><td>' + KC(p.kcal) + '</td></tr>';
          }).join('') +
          '</tbody></table></div>';
        set('tl-tag', '共 ' + A.fmtWeeks(r.gap.weeks) + ' · 按 ' + A.fmt(r.gap.actualRate, 2) + ' %/周');
      }
    }

    /* 自检 */
    const cb = $('check-body');
    if (cb) {
      cb.innerHTML = r.checks.map((c) => '<li class="' + (c.pass ? 'ok' : 'no') + '"><span class="m">' + (c.pass ? '✓' : '✗') + '</span><span>' + esc(c.name) +
        (c.pass || !c.detail ? '' : '｜' + esc(c.detail)) + '</span></li>').join('');
      const bad = r.checks.filter((c) => !c.pass).length;
      set('check-tag', (r.checks.length - bad) + ' / ' + r.checks.length + ' 通过' + (bad ? '（有 ' + bad + ' 条变红）' : ''));
    }

    const bd = $('bounds-body');
    if (bd) bd.innerHTML = '<ul class="note-list">' + BOUNDS.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
    set('dl-hint', '四种导出都会落到你的下载目录：' + SLUG + '-导出.csv / .md / 结果卡.png / -备份.json');
  }

  function fieldLabel(f) {
    const m = {
      species: '猫还是狗', weight: '当前体重', bcs: '体况评分', ageStage: '年龄阶段', neutered: '是否绝育',
      activity: '活动量', dryKcalPer100g: '干粮热量密度', dryPricePerKg: '干粮价格', wetKcalPer100g: '罐头热量密度',
      canNetG: '罐净重', canPrice: '罐头价格', wetPct: '湿粮热量占比', targetWeight: '目标体重',
    };
    return m[f] || f;
  }
  function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
  function set(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  const BAD = '输入有误，先改上面的字段。';
  function blankOut() {
    /* 非法输入时不要在结论条里留一排「—」：一句话说清，并把四个结果区都换成同一句占位 */
    const cc = $('conclusion');
    if (cc) cc.classList.add('invalid');
    ['concl-tag', 'tl-tag', 'check-tag'].forEach((id) => set(id, ''));
    set('out-dryline', BAD);
    ['out-kcal', 'out-meals', 'out-cost', 'out-mealsnote', 'out-bcsline', 'out-weightline', 'out-rateline'].forEach((id) => set(id, ''));
    const tb = $('t-plan-body');
    if (tb) tb.innerHTML = '<tr><td class="note" colspan="7">' + BAD + '</td></tr>';
    set('plan-hint', '');
    const bd = $('bcs-body');
    if (bd) bd.innerHTML = kv('状态', BAD);
    const ab = $('aggr-body');
    if (ab) ab.innerHTML = kv('状态', BAD);
    const cb = $('check-body');
    if (cb) cb.innerHTML = '<li class="no"><span class="m">✗</span><span>' + BAD + '未运行自检</span></li>';
    const tl = $('tl-body');
    if (tl) tl.innerHTML = '<p class="hint" style="font-size:12.5px;color:var(--ink3);margin:0">' + BAD + '</p>';
  }

  /* ── 「采用」：把这一套写回输入 ── */
  function adopt(id) {
    const r = window.__app.last;
    if (!r || !r.ok) return;
    const inp = readInputs();
    if (id === 'dry') inp.wetPct = 0;
    else if (id === 'wet') inp.wetPct = 100;
    else if (id === 'mix') inp.wetPct = 50;
    else if (id === 'target') inp.targetWeight = A.round(r.bcs.idealKg, 2);
    writeInputs(inp);
    render();
  }

  /* ── 存档 ── */
  function autoSave(inp) {
    if (!window.localStorage) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), input: inp }));
  }
  function safeGet() {
    try {
      if (!window.localStorage) return null;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && typeof o === 'object' && o.input) ? o : null;
    } catch (e) { return null; }
  }
  function saveNow() {
    autoSave(readInputs());
    set('save-hint', '已保存到本机（' + new Date().toLocaleString('zh-CN') + '），刷新或下次打开会自动恢复。');
  }
  function clearStore() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
    writeInputs(A.defaults());
    render();
    set('save-hint', '已清掉本机存档，回到示例默认值。');
  }

  /* ── 导出 ── */
  function download(name, text, type) {
    const blob = new Blob([text], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return blob.size;
  }

  function csv() {
    const r = window.__app.last;
    const L = [];
    /* 正文里不写导出时间戳：这样同一批输入两次导出的 CSV 可以逐字节比对（时间见 JSON 备份里的 savedAt） */
    L.push('粮喂多了 · 导出');
    L.push('说明,默认数据是虚构示例；本文件所有数字都由页面同一次计算输出，未做二次估算；导出时间见同批 JSON 备份的 savedAt');
    L.push('');
    L.push('输入项,值,单位');
    const units = { species: '', weight: 'kg', bcs: '1-9', ageStage: '', neutered: '', activity: '', dryKcalPer100g: 'kcal/100g', dryPricePerKg: '元/kg', wetKcalPer100g: 'kcal/100g', canNetG: 'g', canPrice: '元/罐', wetPct: '%热量', targetWeight: 'kg' };
    A.FIELDS.forEach(function (f) {
      const v = f === 'neutered' ? (r.input[f] ? '是' : '否') : r.input[f];
      L.push([f, v, units[f] || ''].join(','));
    });
    if (r.ok) {
      L.push('');
      L.push('关键结果,值,单位');
      L.push(['静息需求 RER', A.fmt(r.rer, 4), 'kcal/日'].join(','));
      L.push(['系数 k', r.k, ''].join(','));
      L.push(['维持需求 MER', A.fmt(r.mer, 4), 'kcal/日'].join(','));
      L.push(['体脂率', A.fmt(r.bcs.bf * 100, 1), '%'].join(','));
      L.push(['去脂体重', A.fmt(r.bcs.leanKg, 4), 'kg'].join(','));
      L.push(['理想体重', A.fmt(r.bcs.idealKg, 4), 'kg'].join(','));
      L.push(['每日能量缺口', A.fmt(r.gap.gapKcal, 4), 'kcal'].join(','));
      L.push(['目标方案热量', A.fmt(r.gap.planKcal, 4), 'kcal/日'].join(','));
      L.push(['实际掉重速率', A.fmt(r.gap.actualRate, 4), '%/周'].join(','));
      L.push(['到达目标需要', r.gap.weeks == null ? '—' : A.fmt(r.gap.weeks, 2), '周'].join(','));
      L.push('');
      L.push('方案,湿粮热量占比%,每日热量kcal,干粮g,罐头数,每月粮钱元,达标周数');
      r.plans.forEach(function (p) {
        L.push([p.label, p.wetPct, A.fmt(p.kcal, 4), A.fmt(p.dryG, 4), A.fmt(p.cans, 4), A.fmt(p.monthlyCost, 4), p.weeks == null ? '' : A.fmt(p.weeks, 2)].join(','));
      });
      L.push('');
      L.push('单价口径,元/1000kcal');
      L.push(['干粮', A.fmt(r.unitCost.dryPer1000Kcal, 4)].join(','));
      L.push(['罐头', A.fmt(r.unitCost.wetPer1000Kcal, 4)].join(','));
      L.push(['倍数（罐头/干粮）', isFinite(r.unitCost.ratio) ? A.fmt(r.unitCost.ratio, 4) : '—'].join(','));
      L.push('');
      L.push('引擎自检,' + r.checks.filter((c) => c.pass).length + '/' + r.checks.length + ' 通过');
      r.checks.forEach((c) => L.push([(c.pass ? 'PASS' : 'FAIL'), c.name].join(',')));
      if (r.warnings.length) {
        L.push('');
        L.push('提示');
        r.warnings.forEach((w) => L.push([w.code, w.msg].join(',')));
      }
    } else {
      L.push('');
      L.push('输入有误，未产生结果');
      r.errors.forEach((e) => L.push([e.field, e.msg].join(',')));
    }
    return download(SLUG + '-导出.csv', '\ufeff' + L.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function md() {
    const r = window.__app.last;
    const L = [];
    L.push('# 粮喂多了 · 结果');
    L.push('');
    L.push('> 默认数据是虚构示例；下面每个数字都来自页面同一次计算输出。导出时间见同批 JSON 备份的 savedAt。');
    L.push('');
    if (!r || !r.ok) {
      L.push('## 当前输入有误，未产生结果');
      (r ? r.errors : []).forEach((e) => L.push('- ' + e.msg));
      return download(SLUG + '-导出.md', L.join('\n'), 'text/markdown;charset=utf-8');
    }
    const h = r.headline;
    L.push('## 结论');
    L.push('');
    L.push('- 每天喂：**' + h.dryLine + '**');
    L.push('- 每日热量：**' + KC(h.kcal) + '**；分餐：' + r.meals.count + ' 餐 × ' + G(r.meals.perMealG) + (r.meals.perMealCans > 0 ? ' + ' + A.fmtCans(r.meals.perMealCans) : ''));
    L.push('- 每月粮钱：**' + MONEY(r.plans[3].monthlyCost) + '**');
    L.push('- ' + h.bcsLine);
    L.push('- ' + h.weightLine);
    L.push('');
    L.push('## 四套喂法对照');
    L.push('');
    L.push('| 方案 | 湿粮热量占比 | 每日热量 | 干粮 | 罐头 | 每月粮钱 | 达标周数 |');
    L.push('|---|---|---|---|---|---|---|');
    r.plans.forEach(function (p) {
      L.push('| ' + p.label + ' | ' + p.wetPct + '% | ' + KC(p.kcal) + ' | ' + (p.dryG > 0 ? G(p.dryG) : '—') + ' | ' + (p.cans > 0 ? A.fmtCans(p.cans) : '—') + ' | ' + MONEY(p.monthlyCost) + ' | ' + A.fmtWeeks(p.weeks) + ' |');
    });
    L.push('');
    L.push('## 体况与关键中间量');
    L.push('');
    L.push('- 体况评分：' + r.bcs.bcs + ' / 9（' + r.bcs.label + '），体脂率（分档）' + A.fmtPct(r.bcs.bf * 100, 0));
    L.push('- 去脂体重 ' + A.fmtKg(r.bcs.leanKg) + '；理想体重 ' + A.fmtKg(r.bcs.idealKg) + '（带宽 ' + A.fmtKg(r.bcs.idealLo) + ' – ' + A.fmtKg(r.bcs.idealHi) + '）');
    L.push('- RER = 70 × ' + A.fmtKg(r.input.weight) + '^0.75 = ' + KC(r.rer) + '；系数 k = ' + r.k + '；MER = ' + KC(r.mer));
    L.push('- 干湿换算：干粮 ' + A.fmt(r.input.dryKcalPer100g, 0) + ' kcal/100g → ' + A.fmt(r.input.dryKcalPer100g / 100, 2) + ' kcal/g；罐头 ' + A.fmt(r.canKcal, 2) + ' kcal/罐');
    L.push('- 每 1000 kcal 单价：干粮 ' + A.fmtMoney(r.unitCost.dryPer1000Kcal) + '、罐头 ' + A.fmtMoney(r.unitCost.wetPer1000Kcal) + (isFinite(r.unitCost.ratio) ? '（' + A.fmt(r.unitCost.ratio, 2) + ' 倍）' : ''));
    L.push('');
    L.push('## 减重时间线');
    L.push('');
    if (r.timeline.length) {
      L.push('| 周 | 体重 | 该周每日热量 |');
      L.push('|---|---|---|');
      r.timeline.forEach((p) => L.push('| ' + (p.week < 0.05 ? '起点' : A.fmt(p.week, 1)) + ' | ' + A.fmtKg(p.kg) + ' | ' + KC(p.kcal) + ' |'));
    } else {
      L.push('目标体重不小于当前体重，本工具不排减重时间线。');
    }
    L.push('');
    L.push('## 引擎自检（' + r.checks.filter((c) => c.pass).length + '/' + r.checks.length + '）');
    L.push('');
    r.checks.forEach((c) => L.push('- ' + (c.pass ? '✓' : '✗') + ' ' + c.name + (c.pass || !c.detail ? '' : '｜' + c.detail)));
    if (r.warnings.length) {
      L.push('');
      L.push('## 提示');
      L.push('');
      r.warnings.forEach((w) => L.push('- ' + w.msg));
    }
    L.push('');
    L.push('## 口径与不处理的情形');
    L.push('');
    BOUNDS.forEach((b) => L.push('- ' + b));
    L.push('');
    L.push('本工具只做算术，不做诊断、不开处方、不评价粮的品质。');
    return download(SLUG + '-导出.md', L.join('\n'), 'text/markdown;charset=utf-8');
  }

  function jsonBackup() {
    const inp = readInputs();
    const r = window.__app.last;
    const payload = {
      app: SLUG, version: VERSION, savedAt: new Date().toISOString(),
      note: '输入 + 关键结果备份；默认数据是虚构示例',
      input: inp,
      result: r && r.ok ? {
        rer: r.rer, k: r.k, mer: r.mer, bcs: r.bcs, gap: r.gap, plans: r.plans,
        unitCost: r.unitCost, meals: r.meals, headline: r.headline,
        checksPass: r.checks.filter((c) => c.pass).length, checksTotal: r.checks.length,
        warnings: r.warnings,
      } : { ok: false, errors: (r ? r.errors : []) },
    };
    return download(SLUG + '-备份.json', JSON.stringify(payload, null, 2), 'application/json');
  }

  function png() {
    const r = window.__app.last;
    const W = 1080, H = 1350;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#f5f2ea'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fffefb'; g.fillRect(48, 48, W - 96, H - 96);
    g.strokeStyle = '#dbe2db'; g.lineWidth = 2; g.strokeRect(48, 48, W - 96, H - 96);
    let y = 118;
    g.fillStyle = '#1f2e28'; g.font = 'bold 52px -apple-system,"PingFang SC",sans-serif';
    g.fillText('粮喂多了', 88, y);
    y += 44;
    g.fillStyle = '#7c8a82'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('猫狗每天喂多少 · 四套喂法对照', 88, y);
    y += 22;
    g.strokeStyle = '#1f2e28'; g.lineWidth = 3; g.beginPath(); g.moveTo(88, y); g.lineTo(W - 88, y); g.stroke();
    y += 56;

    if (!r || !r.ok) {
      g.fillStyle = '#8d1f1f'; g.font = '30px -apple-system,"PingFang SC",sans-serif';
      g.fillText('当前输入有误，未产生结果', 88, y);
    } else {
      const h = r.headline;
      g.fillStyle = '#49584f'; g.font = '28px -apple-system,"PingFang SC",sans-serif';
      g.fillText('结论：今天喂', 88, y);
      y += 56;
      g.fillStyle = '#154c34'; g.font = 'bold 62px -apple-system,"PingFang SC",sans-serif';
      g.fillText(h.dryLine, 88, y);
      y += 62;
      g.fillStyle = '#49584f'; g.font = '28px -apple-system,"PingFang SC",sans-serif';
      g.fillText('每日热量 ' + KC(h.kcal) + '　｜　分餐 ' + r.meals.count + ' 餐 × ' + G(r.meals.perMealG) + '　｜　每月粮钱 ' + MONEY(r.plans[3].monthlyCost), 88, y);
      y += 44;
      g.fillStyle = '#7c8a82'; g.font = '25px -apple-system,"PingFang SC",sans-serif';
      y = wrap(g, h.bcsLine, 88, y, W - 176, 34);
      y = wrap(g, h.weightLine, 88, y, W - 176, 34);
      y += 26;

      /* 对照表 */
      const cols = [88, 460, 590, 720, 850, 1000];
      const heads = ['方案', '每日热量', '干粮', '罐头', '每月', '周数'];
      g.fillStyle = '#7c8a82'; g.font = '24px -apple-system,"PingFang SC",sans-serif';
      heads.forEach((t, i) => g.fillText(t, cols[i], y));
      y += 16;
      g.strokeStyle = '#dbe2db'; g.beginPath(); g.moveTo(88, y); g.lineTo(W - 88, y); g.stroke();
      y += 38;
      r.plans.forEach(function (p, i) {
        if (i === 3) { g.fillStyle = '#f4f9f5'; g.fillRect(80, y - 30, W - 160, 46); }
        g.fillStyle = i === 3 ? '#154c34' : '#1f2e28';
        g.font = (i === 3 ? 'bold ' : '') + '26px -apple-system,"PingFang SC",sans-serif';
        g.fillText(clip(g, p.label, 350), cols[0], y);
        g.font = '26px -apple-system,"PingFang SC",sans-serif';
        g.fillText(KC(p.kcal), cols[1], y);
        g.fillText(p.dryG > 0 ? A.fmt(p.dryG, 0) + ' g' : '—', cols[2], y);
        g.fillText(p.cans > 0 ? A.fmt(p.cans, 2) : '—', cols[3], y);
        g.fillText(A.fmt(p.monthlyCost, 0) + ' 元', cols[4], y);
        g.fillText(p.weeks == null ? '—' : A.fmt(p.weeks, 1) + ' 周', cols[5], y);
        y += 46;
      });
      y += 20;
      g.strokeStyle = '#dbe2db'; g.beginPath(); g.moveTo(88, y); g.lineTo(W - 88, y); g.stroke();
      y += 46;
      g.fillStyle = '#49584f'; g.font = '26px -apple-system,"PingFang SC",sans-serif';
      y = wrap(g, '每 1000 kcal 单价：干粮 ' + A.fmtMoney(r.unitCost.dryPer1000Kcal) + '、罐头 ' + A.fmtMoney(r.unitCost.wetPer1000Kcal) +
        (isFinite(r.unitCost.ratio) ? '（' + A.fmt(r.unitCost.ratio, 1) + ' 倍）' : ''), 88, y, W - 176, 36);
      y = wrap(g, '到目标体重约 ' + A.fmtWeeks(r.gap.weeks) + '（按 ' + A.fmt(r.gap.actualRate, 2) + ' %/周）', 88, y, W - 176, 36);
      y = wrap(g, '体况 ' + r.bcs.bcs + '/9 · 体脂（分档）' + A.fmtPct(r.bcs.bf * 100, 0) + ' · 理想体重 ' + A.fmtKg(r.bcs.idealKg), 88, y, W - 176, 36);
      if (r.warnings.length) {
        y += 12;
        g.fillStyle = '#a2610c'; g.font = '24px -apple-system,"PingFang SC",sans-serif';
        r.warnings.slice(0, 3).forEach((w) => { y = wrap(g, '提示：' + w.msg, 88, y, W - 176, 32); });
      }
    }
    g.fillStyle = '#7c8a82'; g.font = '22px -apple-system,"PingFang SC",sans-serif';
    wrap(g, '默认数据是虚构示例；本卡片所有数字来自同一次计算。不构成诊疗建议。', 88, H - 116, W - 176, 30);
    g.fillStyle = '#a8b3ac'; g.font = '20px -apple-system,"PingFang SC",sans-serif';
    g.fillText('粮喂多了 v' + VERSION + '　本机生成', 88, H - 76);

    return download(SLUG + '-结果卡.png', dataUrlToBlob(cv.toDataURL('image/png')), 'image/png');
  }
  function clip(g, text, maxW) {
    let t = String(text);
    if (g.measureText(t).width <= maxW) return t;
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  function wrap(g, text, x, y, maxW, lh) {
    const t = String(text);
    let line = '';
    for (let i = 0; i < t.length; i++) {
      const test = line + t[i];
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, y); y += lh; line = t[i]; }
      else line = test;
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }
  function dataUrlToBlob(url) {
    const parts = url.split(',');
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'image/png' });
  }

  /* ── 初始化 ── */
  function buildSelects() {
    const ages = $('p-age');
    if (ages) ages.innerHTML = A.AGE_STAGES.map((a) => '<option value="' + a + '">' + a + '</option>').join('');
    const acts = $('p-activity');
    if (acts) acts.innerHTML = A.ACTIVITIES.map((a) => '<option value="' + a + '">' + esc(A.ACTIVITY_LABEL[a]) + '</option>').join('');
    const bcs = $('p-bcs');
    if (bcs) {
      let html = '';
      for (let i = 1; i <= 9; i++) html += '<option value="' + i + '">' + i + '（' + A.BCS_LABEL[i] + '）</option>';
      bcs.innerHTML = html;
    }
  }
  function attach() {
    Object.keys(IDS).forEach(function (k) {
      const el = $(IDS[k]);
      if (!el) return;
      /* 必须包一层：直接把 render 当监听器会把事件对象当成参数传进去（批次 59 的教训） */
      el.addEventListener('input', function () { set('save-hint', ''); render(); });
      el.addEventListener('change', function () { set('save-hint', ''); render(); });
    });
    const bind = function (id, fn) { const el = $(id); if (el) el.addEventListener('click', function () { fn(); }); };
    bind('b-default', function () { writeInputs(A.defaults()); render(); set('save-hint', '已恢复示例默认值。'); });
    A.scenarios().forEach(function (s, i) {
      bind(['b-s-demo', 'b-s-lean', 'b-s-dog'][i], function () { writeInputs(s.input); render(); set('save-hint', '已切到：' + s.label + '（虚构示例）'); });
    });
    bind('b-save', saveNow);
    bind('b-clear', clearStore);
    bind('b-csv', csv);
    bind('b-md', md);
    bind('b-png', png);
    bind('b-json', jsonBackup);
  }

  function init() {
    buildSelects();
    attach();
    const saved = safeGet();
    if (saved) {
      const merged = Object.assign(A.defaults(), saved.input || {});
      if (A.compute(merged).ok) { writeInputs(merged); set('save-hint', '已从本机存档恢复（存于 ' + String(saved.savedAt || '').replace('T', ' ').slice(0, 19) + '）。'); }
      else { writeInputs(A.defaults()); set('save-hint', '本机存档里的数已经不合法，已回到示例默认值。'); }
    } else {
      writeInputs(A.defaults());
      set('save-hint', '默认是虚构示例；改动会自动存到本机，刷新后还在。');
    }
    const bd = $('bounds-body');
    if (bd) bd.innerHTML = '<ul class="note-list">' + BOUNDS.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>';
    render();
  }

  window.__app = {
    readInputs: readInputs, writeInputs: writeInputs, render: render, adopt: adopt,
    csv: csv, md: md, jsonBackup: jsonBackup, png: png, init: init, last: null,
    bounds: BOUNDS, version: VERSION,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
