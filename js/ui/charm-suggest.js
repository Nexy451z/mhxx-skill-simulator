/* ==========================================================================
   UI: お守り逆引きモード（このお守りがあったら追加できるスキル）
   --------------------------------------------------------------------------
   ・STEP 2 のトグル #charmSuggestToggle で ON/OFF（状態は state.charmSuggestMode）
   ・ON のとき右カラムの #charmSuggestPanel に、登録済みお守りごとに
     「そのお守りを装備したら追加発動できるスキル」を寄与の大きい順に表示する
   ・算出: 現在の検索結果（state.results[state.resultIndex]）の totals から
     「その結果に含まれているお守りの寄与（護石の素pt + 護石スロットの装飾品pt）」
     を差し引いた値をベースラインにし、候補お守りの寄与
     （護石スキルpt + 護石スロットに最良の装飾品を詰めた最大pt）を加算する。
     検索結果が無い場合は候補お守りの寄与だけで判定する。
   ・チップクリックで「そのお守りを固定 + そのスキルを条件に追加」して再検索
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var MAX_CHARM_ROWS = 12;
  var MAX_SKILL_CHIPS = 6;
  var MAX_SLOT_SIZE = 3;
  var DEFAULT_THRESHOLD = 10;

  var toggleNode = null;
  var panelNode = null;
  var bodyNode = null;
  var countNode = null;

  /* 系統名 -> [0, 1スロの最大pt, 2スロ, 3スロ] */
  var decoBest = null;
  var decoBestSource = null;

  /* ---- スキル定義（系統名・しきい値） ----------------------------------- */

  function byGroup() {
    return (MHXX.skillIndex && MHXX.skillIndex.byGroup) || {};
  }

  function byName() {
    return (MHXX.skillIndex && MHXX.skillIndex.byName) || {};
  }

  /* 現在のタイプ（剣士 / ガンナー）で有効なスキルだけを返す */
  function typeOf(state) {
    return state && state.type === 'gunner' ? 'gunner' : 'blade';
  }

  function weaponMatches(skill, type) {
    var weapon = (skill && skill.weapon) || 'both';
    return weapon === 'both' || weapon === type;
  }

  /* 系統に属するスキル（剣士専用 / ガンナー専用は現在のタイプで絞る） */
  function groupSkills(group, type) {
    var list = byGroup()[group] || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (weaponMatches(list[i], type)) out.push(list[i]);
    }
    return out;
  }

  /* しきい値を持つスキルがある系統か（無い系統は判定できないので表示しない） */
  function isKnownGroup(group, type) {
    if (groupSkills(group, type).length) return true;
    var def = byName()[group];
    return !!(def && weaponMatches(def, type));
  }

  /* 系統の最小しきい値（データに無ければ 10pt） */
  function thresholdOf(group, type) {
    var list = groupSkills(group, type);
    if (list.length) return Number(list[0].threshold) || DEFAULT_THRESHOLD;
    var def = byName()[group];
    if (def) return Number(def.threshold) || DEFAULT_THRESHOLD;
    return DEFAULT_THRESHOLD;
  }

  /* その系統で points に達したときに発動するスキル（最も高いしきい値のもの） */
  function bestSkillOf(group, points, type) {
    var list = groupSkills(group, type);
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].threshold) <= points) best = list[i];
    }
    if (!best) {
      var def = byName()[group];
      if (def && weaponMatches(def, type) && Number(def.threshold) <= points) best = def;
    }
    if (!best) return null;
    return { name: best.name, group: group, threshold: best.threshold };
  }

  /* ---- 装飾品: 系統ごとの「スロット数 -> 最大ポイント」表 ----------------
     js/data/sim-data.js の decos はコンパクト配列
     [name, slotCost, metaA, metaB, skills]（skills が 5 番目 = インデックス 4）。
     系統ごとに 1〜3 スロへ最良の珠を詰めた最大 pt を DP で求める。
     3 スロなら【3】珠1 or 【2】+【1】 or 【1】×3 の最良を自動で選ぶ。
     -------------------------------------------------------------------- */

  function normalizeDeco(raw) {
    if (!raw) return null;
    var cost = 1;
    var skills = null;

    if (Array.isArray(raw)) {
      cost = Number(raw[1]) || 1;
      skills = raw[4] || null;
    } else if (typeof raw === 'object') {
      cost = Number(raw.slotCost || raw.size || raw.cost || raw.level || raw.slots) || 1;
      skills = raw.skills || raw.systemSkills || raw.skillPoints || raw.points || raw.effect || null;
    }

    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) return null;
    cost = Math.round(cost);
    if (!(cost >= 1)) cost = 1;
    if (cost > MAX_SLOT_SIZE) cost = MAX_SLOT_SIZE;
    return { slotCost: cost, skills: skills };
  }

  function buildDecoBest() {
    var data = MHXX.data || {};
    if (decoBest && decoBestSource === data) return decoBest;

    var pool = {};
    var decos = data.decos || [];
    for (var i = 0; i < decos.length; i++) {
      var deco = normalizeDeco(decos[i]);
      if (!deco) continue;
      var skills = deco.skills;
      for (var group in skills) {
        if (!Object.prototype.hasOwnProperty.call(skills, group)) continue;
        var points = Number(skills[group]) || 0;
        /* マイナス補正の系統は「最大 pt」に寄与しないので捨てる */
        if (points <= 0) continue;
        (pool[group] || (pool[group] = [])).push({ cost: deco.slotCost, points: points });
      }
    }

    var best = {};
    for (var system in pool) {
      if (!Object.prototype.hasOwnProperty.call(pool, system)) continue;
      var items = pool[system];
      var table = [0, 0, 0, 0];
      for (var size = 1; size <= MAX_SLOT_SIZE; size++) {
        var max = 0;
        for (var j = 0; j < items.length; j++) {
          if (items[j].cost > size) continue;
          var value = table[size - items[j].cost] + items[j].points;
          if (value > max) max = value;
        }
        table[size] = max;
      }
      best[system] = table;
    }

    decoBest = best;
    decoBestSource = data;
    return decoBest;
  }

  /* お守り1個の系統別寄与pt（護石スキル + 護石スロットに詰めた装飾品の最大pt） */
  function charmContribution(charm) {
    var best = buildDecoBest();
    var out = {};

    (charm.skills || []).forEach(function (skill) {
      if (!skill) return;
      var group = Array.isArray(skill) ? skill[0] : (skill.group || skill.name);
      var points = Array.isArray(skill)
        ? Number(skill[1]) || 0
        : (Number(skill.pt != null ? skill.pt : skill.points) || 0);
      if (!group || !points) return;
      out[group] = (out[group] || 0) + points;
    });

    var slots = Math.max(0, Math.min(MAX_SLOT_SIZE, Number(charm.slots) || 0));
    if (slots > 0) {
      for (var group2 in best) {
        if (!Object.prototype.hasOwnProperty.call(best, group2)) continue;
        var add = best[group2][slots] || 0;
        if (add > 0) out[group2] = (out[group2] || 0) + add;
      }
    }
    return out;
  }

  /* ---- ベースライン（検索結果の totals - その結果のお守り分） ----------- */

  function currentResult(state) {
    var results = (state && state.results) || [];
    var index = Number(state && state.resultIndex) || 0;
    if (index < 0) index = 0;
    return results[index] || null;
  }

  /* 結果に含まれているお守りの寄与（護石の素pt + 護石スロットの装飾品pt）。
     skillMatrix 適用時は basePoints / decoPoints に分かれるのでその合計を使う。 */
  function charmPartPoints(result) {
    var part = result && result.parts && result.parts.charm;
    if (!part) return null;

    var base = (part.basePoints && typeof part.basePoints === 'object')
      ? part.basePoints : (part.points || {});
    var deco = (part.decoPoints && typeof part.decoPoints === 'object')
      ? part.decoPoints : (part.decoSkills || {});

    var groups = {};
    Object.keys(base || {}).forEach(function (group) { groups[group] = true; });
    Object.keys(deco || {}).forEach(function (group) { groups[group] = true; });

    var out = {};
    Object.keys(groups).forEach(function (group) {
      out[group] = (Number(base && base[group]) || 0) + (Number(deco && deco[group]) || 0);
    });
    return out;
  }

  function buildBaseline(state) {
    var result = currentResult(state);
    var totals = (result && result.totals) || null;

    var resultTotals = {};
    if (totals) {
      Object.keys(totals).forEach(function (group) {
        resultTotals[group] = Number(totals[group]) || 0;
      });
    }

    var baseline = {};
    Object.keys(resultTotals).forEach(function (group) {
      baseline[group] = resultTotals[group];
    });

    /* 候補お守りと置き換えて評価するため、結果のお守りの寄与は取り除く */
    var charmPoints = charmPartPoints(result);
    if (charmPoints) {
      Object.keys(charmPoints).forEach(function (group) {
        baseline[group] = (baseline[group] || 0) - charmPoints[group];
      });
    }

    return {
      result: result,
      resultTotals: resultTotals,
      baseline: baseline,
      type: typeOf(state)
    };
  }

  function selectedGroupsOf(state) {
    var map = {};
    ((state && state.skills) || []).forEach(function (skill) {
      if (skill && skill.group) map[skill.group] = true;
    });
    return map;
  }

  /* お守り1個について「このお守りで追加発動できるスキル」を求める */
  function evaluateCharm(charm, ctx, selectedGroups) {
    var contribution = charmContribution(charm);
    var chips = [];

    Object.keys(contribution).forEach(function (group) {
      var add = contribution[group];
      if (!(add > 0)) return;
      if (!isKnownGroup(group, ctx.type)) return;
      /* すでに条件へ入っている系統は「追加」ではないので除外 */
      if (selectedGroups[group]) return;

      var threshold = thresholdOf(group, ctx.type);
      var base = Number(ctx.baseline[group]) || 0;
      if (base >= threshold) return;

      var reached = base + add;
      if (reached < threshold) return;

      /* 現在の検索結果ですでに発動している系統は「追加」ではないので除外 */
      if (ctx.result && (Number(ctx.resultTotals[group]) || 0) >= threshold) return;

      var skill = bestSkillOf(group, reached, ctx.type);
      if (!skill) return;

      chips.push({
        group: group,
        name: skill.name,
        threshold: threshold,
        points: reached,
        add: add
      });
    });

    chips.sort(function (a, b) {
      if (b.add !== a.add) return b.add - a.add;
      if (b.points !== a.points) return b.points - a.points;
      return a.group < b.group ? -1 : (a.group > b.group ? 1 : 0);
    });

    var score = 0;
    chips.forEach(function (chip) { score += chip.add; });

    return { charm: charm, chips: chips.slice(0, MAX_SKILL_CHIPS), score: score };
  }

  /* ---- 描画 ------------------------------------------------------------- */

  function charmLabel(charm) {
    if (MHXX.charmApi && typeof MHXX.charmApi.label === 'function') {
      return MHXX.charmApi.label(charm) || '';
    }
    return String((charm && (charm.type || charm.name)) || '護石');
  }

  function emptyHTML(message, hint) {
    return '<div class="empty-state small cs-empty">' +
      '<span class="muted">' + kit.esc(message) + '</span>' +
      (hint ? '<span class="muted cs-empty-hint">' + kit.esc(hint) + '</span>' : '') +
      '</div>';
  }

  function chipHTML(row, chip) {
    /* 到達pt（装備ベースライン + このお守りの寄与）であることが分かる表記にする */
    var pointsText = '到達 ' + chip.points + 'pt';
    return '<div class="skill-chip cs-chip" role="button" tabindex="0"' +
      ' data-charm-id="' + kit.esc(String(row.charm.id)) + '"' +
      ' data-name="' + kit.esc(chip.name) + '"' +
      ' data-group="' + kit.esc(chip.group) + '"' +
      ' data-threshold="' + kit.esc(String(chip.threshold)) + '"' +
      ' title="' + kit.esc(chip.name + ' を条件に追加（必要 ' + chip.threshold +
        'pt / 到達 ' + chip.points + 'pt）') + '">' +
      kit.icon('plus', 'chip-icon') +
      '<span class="cs-chip-group">' + kit.esc(chip.group) + '</span>' +
      (chip.name !== chip.group ? '<small class="chip-reason">' + kit.esc(chip.name) + '</small>' : '') +
      '<span class="chip-sub">' + kit.esc(pointsText) + '</span>' +
      '</div>';
  }

  function rowHTML(row) {
    var label = charmLabel(row.charm);
    return '<div class="cs-row" data-charm-id="' + kit.esc(String(row.charm.id)) + '">' +
      '<div class="cs-row-head">' +
        '<span class="cs-charm-label" title="' + kit.esc(label) + '">' +
          kit.icon('charm', 'icon-sm') +
          '<span class="cs-charm-name">' + kit.esc(label) + '</span>' +
        '</span>' +
        '<span class="cs-score" title="このお守りで増やせるスキルポイントの上限（系統別の最大値の合計）">' +
          '寄与上限 +' + kit.esc(String(row.score)) + 'pt</span>' +
      '</div>' +
      '<div class="cs-chips">' +
        row.chips.map(function (chip) { return chipHTML(row, chip); }).join('') +
      '</div>' +
      '</div>';
  }

  function buildPanel(state) {
    var charms = (MHXX.charmApi && typeof MHXX.charmApi.list === 'function')
      ? (MHXX.charmApi.list() || []) : [];

    if (!charms.length) {
      return {
        count: '',
        html: emptyHTML(
          'お守りを追加すると、このお守りで追加できるスキルが表示されます',
          'STEP 2 のクイックビルダー、またはセーブデータ読込から登録できます'
        )
      };
    }

    var ctx = buildBaseline(state);
    var selectedGroups = selectedGroupsOf(state);
    var rows = [];

    charms.forEach(function (charm) {
      var row = evaluateCharm(charm, ctx, selectedGroups);
      if (row.chips.length) rows.push(row);
    });

    rows.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.chips.length !== a.chips.length) return b.chips.length - a.chips.length;
      var al = charmLabel(a.charm);
      var bl = charmLabel(b.charm);
      return al < bl ? -1 : (al > bl ? 1 : 0);
    });

    var visible = rows.slice(0, MAX_CHARM_ROWS);
    var count = rows.length
      ? (rows.length > visible.length
        ? visible.length + ' / ' + rows.length + '件'
        : rows.length + '件')
      : '';

    if (!visible.length) {
      return {
        count: count,
        html: emptyHTML(
          'このお守りで新たに発動できるスキルはありません',
          ctx.result
            ? '空きスロットが無いか、しきい値に届いていません'
            : 'スキルを選んで検索すると、装備と合わせて判定できます'
        )
      };
    }

    var note = ctx.result
      ? ''
      : '<p class="cs-note muted">' +
        '検索結果が無いため、お守り単体で発動できるスキルを表示しています</p>';

    return {
      count: count,
      html: note + '<div class="cs-rows">' + visible.map(rowHTML).join('') + '</div>'
    };
  }

  function syncToggle(on) {
    if (toggleNode) toggleNode.checked = on;
    var row = (toggleNode && toggleNode.closest) ? toggleNode.closest('.switch-row') : null;
    if (!row) return;
    if (on) row.classList.add('is-on');
    else row.classList.remove('is-on');
  }

  var renderTimer = null;

  /* 'state' と 'results' が連続で発火しても描画を 1 回にまとめる */
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = global.setTimeout(function () {
      renderTimer = null;
      render();
    }, 0);
  }

  function render() {
    var state = MHXX.store ? MHXX.store.get() : null;
    var on = !!(state && state.charmSuggestMode);

    syncToggle(on);
    if (panelNode) panelNode.hidden = !on;
    if (!on || !bodyNode) return;

    var built;
    try {
      built = buildPanel(state);
    } catch (err) {
      console.error('[MHXX] charmSuggest render failed', err);
      bodyNode.innerHTML = emptyHTML('お守り逆引きの計算に失敗しました');
      return;
    }
    bodyNode.innerHTML = built.html;
    if (countNode) countNode.textContent = built.count;
  }

  /* ---- 操作 ------------------------------------------------------------- */

  /* チップクリック: そのお守りを固定 + そのスキルを条件に追加して再検索 */
  function applyChip(chip) {
    if (!chip || !MHXX.store) return;
    var charmId = chip.getAttribute('data-charm-id');
    var name = chip.getAttribute('data-name');
    var group = chip.getAttribute('data-group');
    var threshold = Number(chip.getAttribute('data-threshold')) || DEFAULT_THRESHOLD;
    if (!charmId || !name || !group) return;

    var charm = (MHXX.charmApi && typeof MHXX.charmApi.getById === 'function')
      ? MHXX.charmApi.getById(charmId) : null;
    if (!charm) {
      kit.toast('お守りが見つかりませんでした。一覧を更新してください', 'error');
      return;
    }

    var state = MHXX.store.get();
    var next = (state.skills || []).filter(function (skill) {
      return skill && skill.group !== group;
    }).concat([{ name: name, group: group, threshold: threshold }]);

    MHXX.store.patch({
      charmMode: 'single',
      charmId: String(charmId),
      skills: next,
      resultIndex: 0
    });
    MHXX.bus.emit('skills:sync');
    kit.toast(charmLabel(charm) + ' を固定して ' + name + ' を条件に追加しました');
  }

  function init() {
    toggleNode = document.getElementById('charmSuggestToggle');
    panelNode = document.getElementById('charmSuggestPanel');
    bodyNode = document.getElementById('charmSuggestBody');
    countNode = document.getElementById('charmSuggestCount');

    if (toggleNode) {
      toggleNode.checked = !!(MHXX.store && MHXX.store.get().charmSuggestMode);
      toggleNode.addEventListener('change', function () {
        /* トグル状態は store に保持（SEARCH_KEYS ではないので検索は走らない） */
        MHXX.store.patch({ charmSuggestMode: !!toggleNode.checked });
      });
    }

    if (bodyNode) {
      kit.delegate(bodyNode, 'click', '.cs-chip', function (event, chip) {
        event.preventDefault();
        applyChip(chip);
      });
      bodyNode.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var chip = event.target.closest('.cs-chip');
        if (!chip) return;
        event.preventDefault();
        applyChip(chip);
      });
    }

    MHXX.bus.on('state', scheduleRender);
    MHXX.bus.on('results', scheduleRender);
    MHXX.bus.on('charms', scheduleRender);

    render();
  }

  MHXX.ui.charmSuggest = { init: init, render: render };
})(window);
