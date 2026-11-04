/* ==========================================================================
   UI: 理論値お守り逆引きモード
   --------------------------------------------------------------------------
   ・STEP 2 のトグル #charmSuggestToggle で ON/OFF（状態は state.charmSuggestMode）
   ・ON のとき「選択中のスキル ＋ 追加候補の系統 X」を成立させる理論値お守りを
     js/core/charm-theory.js で生成し、候補 X ごとに検索エンジンへ 1 回ずつ問い合わせる
       → 解が 1 件以上あれば「このお守りがあれば X を追加発動できる」
   ・候補は 1 件ずつ setTimeout(0) で分割し、進捗バー・キャンセル・
     条件変更時の破棄（世代トークン）・条件キー単位のキャッシュを備える
   ・結果行は見つかり次第インクリメンタル表示。並び順（系統名/防御/到達pt）を切替可
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var CACHE_VERSION = 'theory1';
  var TIME_LIMIT_MS = 150;      /* 1 候補あたりの探索上限（エンジンへ渡す） */
  var DEEP_TIME_LIMIT_MS = 600; /* 判定不能だった候補の再判定上限 */
  var DEEP_BUDGET_MS = 12000;   /* 再判定に使う総時間の上限 */
  var DEEP_MAX = 60;            /* 再判定する候補数の上限 */
  var DEBOUNCE_MS = 300;        /* 条件変更から再計算までの待ち */
  var MAX_CACHE = 6;            /* 条件キー単位の結果キャッシュ数 */
  var TICK_BUDGET_MS = 24;      /* 1 フレームで使う目安（候補 1 件は必ず処理する） */

  var toggleNode = null;
  var panelNode = null;
  var bodyNode = null;
  var countNode = null;

  var runSeq = 0;        /* 世代トークン（古い setTimeout を無効化する） */
  var job = null;        /* 実行中の計算 */
  var pendingTimer = null;
  var view = null;       /* 画面表示用の状態 */
  var lastKey = null;
  var sortMode = 'system';
  var cache = {};
  var cacheKeys = [];

  /* ======================================================================
     スキル定義ヘルパー（系統・しきい値・発動スキル名）
     ====================================================================== */

  function byGroup() {
    return (MHXX.skillIndex && MHXX.skillIndex.byGroup) || {};
  }

  function byName() {
    return (MHXX.skillIndex && MHXX.skillIndex.byName) || {};
  }

  function typeOf(state) {
    return state && state.type === 'gunner' ? 'gunner' : 'blade';
  }

  function weaponMatches(skill, type) {
    var weapon = (skill && skill.weapon) || 'both';
    return weapon === 'both' || weapon === type;
  }

  function groupSkills(group, type) {
    var list = byGroup()[group] || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (weaponMatches(list[i], type)) out.push(list[i]);
    }
    return out;
  }

  function isKnownGroup(group, type) {
    return groupSkills(group, type).length > 0;
  }

  function thresholdOf(group, type) {
    var list = groupSkills(group, type);
    if (list.length) return Number(list[0].threshold) || 10;
    var def = byName()[group];
    if (def) return Number(def.threshold) || 10;
    return 10;
  }

  /* points に達したときに発動するスキル（同じ系統で最も高いしきい値のもの） */
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

  /* ======================================================================
     計算対象（選択スキル・候補系統・検索キー）
     ====================================================================== */

  function selectedSkills(state) {
    var out = [];
    var skills = (state && state.skills) || [];
    for (var i = 0; i < skills.length; i++) {
      var skill = skills[i];
      if (!skill || !skill.name) continue;
      var def = byName()[skill.name];
      var group = skill.group || (def && def.group) || skill.name;
      if (!group) continue;
      out.push({
        name: skill.name,
        group: group,
        threshold: Number(skill.threshold) || (def && def.threshold) || thresholdOf(group, typeOf(state))
      });
    }
    return out;
  }

  /* エンジンへ渡す requiredSkills の 1 要素。
     スキル名がデータに無い場合は系統名（系統の最小しきい値）で解釈させる。 */
  function requiredName(skill) {
    return byName()[skill.name] ? skill.name : skill.group;
  }

  /* 候補系統 = スキル定義がある全系統（data.skills を system でグルーピングした
     skillIndex.byGroup と同義。202 系統）。護石では振れない系統でも、防具・装飾品で
     発動できるなら「追加できるスキル」として妥当なので候補に含める。
     そのうち現在のタイプ（剣士/ガンナー）で使えるスキルを持つ系統だけに絞る。 */
  function candidateGroups(state, selectedGroups) {
    var groups = byGroup();
    var type = typeOf(state);
    var out = [];
    for (var group in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, group)) continue;
      if (selectedGroups[group]) continue;
      if (!isKnownGroup(group, type)) continue;
      out.push(group);
    }
    out.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    return out;
  }

  function computeKey(state, skills) {
    var signature = [];
    for (var i = 0; i < skills.length; i++) {
      signature.push(skills[i].name + ':' + skills[i].group + ':' + skills[i].threshold);
    }
    signature.sort();
    return [
      CACHE_VERSION,
      String(state.type || ''),
      String(state.gender || ''),
      String(Number(state.weaponSlots) || 0),
      (state.weaponSlotSizes || []).join(','),
      signature.join('|')
    ].join('~');
  }

  function buildContext(state, skills) {
    var selectedGroups = {};
    var systems = [];
    var names = [];
    for (var i = 0; i < skills.length; i++) {
      selectedGroups[skills[i].group] = true;
      systems.push(skills[i].group);
      names.push(requiredName(skills[i]));
    }
    return {
      key: computeKey(state, skills),
      type: typeOf(state),
      equipType: state.type === 'gunner' ? 2 : 1,
      gender: state.gender === 'female' ? 2 : 1,
      weaponSlots: Math.max(0, Math.min(3, Number(state.weaponSlots) || 0)),
      weaponSlotSizes: (state.weaponSlotSizes && state.weaponSlotSizes.length)
        ? state.weaponSlotSizes.slice() : null,
      systems: systems,
      skillNames: names,
      candidates: candidateGroups(state, selectedGroups)
    };
  }

  /* ======================================================================
     1 候補ぶんの判定（理論値お守りを生成 → 検索 1 回）
     ====================================================================== */

  function clock() {
    return Date.now();
  }

  function skillsKey(skills) {
    var source = skills || {};
    var keys = [];
    for (var system in source) {
      if (Object.prototype.hasOwnProperty.call(source, system)) keys.push(system);
    }
    keys.sort();
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      out.push(keys[i] + ':' + (Number(source[keys[i]]) || 0));
    }
    return out.join(',');
  }

  /* 検索結果で実際に使われたお守りを、生成した理論値お守りへ対応付ける */
  function matchCharm(part, charms) {
    if (!part) return null;
    var slots = Number(part.slots) || 0;
    var key = slots + '|' + skillsKey(part.skills);
    for (var i = 0; i < charms.length; i++) {
      /* kindId=null は「スキルなしのお守り」ダミー。
         エンジンの『なし』(slots0/skills{}) とキーが衝突するため除外する */
      if (!charms[i] || charms[i].kindId == null) continue;
      if ((charms[i].slots + '|' + skillsKey(charms[i].skills)) === key) return charms[i];
    }
    var name = part.name || '';
    for (var j = 0; j < charms.length; j++) {
      if (!charms[j] || charms[j].kindId == null) continue;
      if (charms[j].name === name) return charms[j];
    }
    return null;
  }

  /* 結果のお守りが生成セットに無い（= お守りなし / 予期しない形）ときの表示文言。
     ここで charms[0] を代用すると「実際には使っていないお守り」を例に出してしまう。 */
  function describeCharmPart(part) {
    if (!part) return 'お守り不要（防具・装飾品のみ）';
    var name = part.name ? String(part.name) : '';
    var slots = Number(part.slots) || 0;
    var text = (MHXX.charmTheory && MHXX.charmTheory.skillsText)
      ? MHXX.charmTheory.skillsText(part.skills) : '';
    if (text) return (name || 'お守り') + ' ' + text + ' スロ' + slots;
    if (!slots) return 'お守り不要（防具・装飾品のみ）';
    if (name && name !== 'なし' && name !== '装備なし') return name + ' スキルなし スロ' + slots;
    return 'スロ' + slots + 'のみのお守り';
  }

  function buildRow(result, candidate, charms, ctx) {
    var totals = result.totals || result.skills || {};
    var reached = Number(totals[candidate]) || 0;
    var skill = bestSkillOf(candidate, reached, ctx.type);
    var part = result.equipments && result.equipments.charm;
    var charm = matchCharm(part, charms);
    return {
      state: 'found',
      group: candidate,
      name: skill ? skill.name : candidate,
      threshold: skill ? skill.threshold : thresholdOf(candidate, ctx.type),
      reached: reached,
      defense: Number(result.defense) || 0,
      charm: charm,
      label: charm
        ? ((MHXX.charmTheory && MHXX.charmTheory.charmLabel)
          ? MHXX.charmTheory.charmLabel(charm) : 'お守り')
        : describeCharmPart(part)
    };
  }

  function searchCandidate(ctx, candidate, capMs) {
    var engine = MHXX.searchEngine;
    var theory = MHXX.charmTheory;
    var cap = Number(capMs) > 0 ? Number(capMs) : TIME_LIMIT_MS;
    if (!engine || typeof engine.searchSync !== 'function' || !theory) return { state: 'error' };

    /* 候補系統 X はお守りのスキルでなくても成立する
       （装飾品で満たす / お守りが他の必須系統を補填して防具側で X を満たす など）ため、
       理論値お守りは絞り込まず全件を検索に渡す。 */
    var systems = ctx.systems.concat([candidate]);
    var charms = theory.buildCharms(systems, MHXX.data);
    if (!charms.length) return { state: 'unavailable' };

    var options = {
      equipType: ctx.equipType,
      gender: ctx.gender,
      weaponSlots: ctx.weaponSlots,
      requiredSkills: ctx.skillNames.concat([candidate]),
      charmMode: 'all',
      charms: charms.map(function (charm) {
        return { name: charm.name, slots: charm.slots, skills: charm.skills };
      }),
      maxResults: 1,
      timeLimitMs: cap,
      sortBy: 'def',
      seed: true,
      extraSuggestions: false,
      stopOnFirst: true
    };
    if (ctx.weaponSlotSizes) options.weaponSlotSizes = ctx.weaponSlotSizes;

    var started = clock();
    var result;
    try {
      result = engine.searchSync(options);
    } catch (err) {
      console.error('[MHXX] charmSuggest search failed', err);
      return { state: 'error' };
    }
    var elapsed = clock() - started;
    var list = (result && result.results) || [];
    if (!list.length) {
      return { state: elapsed >= cap - 5 ? 'timeout' : 'none' };
    }
    return buildRow(list[0], candidate, charms, ctx);
  }

  /* ======================================================================
     計算ジョブ（候補ごとに setTimeout(0) で分割）
     ====================================================================== */

  function cancelJob(discard) {
    if (!job) return;
    if (job.timer) {
      global.clearTimeout(job.timer);
      job.timer = null;
    }
    job.cancelled = true;
    job = null;
    runSeq += 1;
    if (discard) {
      view = null;
      lastKey = null;
    }
  }

  function startJob(state, skills) {
    cancelJob(true);
    var ctx = buildContext(state, skills);

    if (!ctx.candidates.length) {
      view = {
        mode: 'empty-candidates', key: ctx.key, total: 0, done: 0, rows: [],
        timeouts: 0, unavailable: 0, errors: 0, elapsedMs: 0, cached: false
      };
      lastKey = ctx.key;
      render();
      return;
    }

    job = {
      token: runSeq + 1,
      key: ctx.key,
      ctx: ctx,
      phase: 'main',
      index: 0,
      rows: [],
      timeouts: 0,
      unavailable: 0,
      errors: 0,
      timeoutList: [],
      deepList: [],
      deepIndex: 0,
      deepStartedAt: 0,
      startedAt: clock(),
      timer: null
    };
    runSeq = job.token;
    lastKey = ctx.key;

    view = {
      mode: 'running', phase: 'main', key: ctx.key, total: ctx.candidates.length, done: 0,
      rows: job.rows, timeouts: 0, unavailable: 0, errors: 0, elapsedMs: 0, cached: false
    };
    render();
    job.timer = global.setTimeout(stepJob, 0);
  }

  function scheduleStep() {
    if (!job) return;
    job.timer = global.setTimeout(stepJob, 0);
  }

  /* 判定不能だった候補を、より長い上限で再判定するフェーズへ切り替える。
     総時間は DEEP_BUDGET_MS で打ち切り、超過分は判定不能として数える。 */
  function startDeepPhase() {
    var list = job.timeoutList.slice(0, DEEP_MAX);
    if (!list.length) return false;
    job.phase = 'deep';
    job.deepList = list;
    job.deepIndex = 0;
    job.deepStartedAt = clock();
    /* 再判定に回さなかった分は判定不能として残す */
    job.timeouts = Math.max(0, job.timeoutList.length - list.length);
    job.timeoutList = [];
    view.phase = 'deep';
    view.total = list.length;
    view.done = 0;
    view.timeouts = job.timeouts;
    return true;
  }

  function stepJob() {
    if (!job) return;
    var token = job.token;
    if (token !== runSeq) { job = null; return; }

    var tickStarted = clock();
    var changed = false;
    var candidate;
    var row;

    if (job.phase === 'deep') {
      while (job.deepIndex < job.deepList.length) {
        if (clock() - job.deepStartedAt > DEEP_BUDGET_MS) break;
        candidate = job.deepList[job.deepIndex];
        job.deepIndex += 1;
        row = searchCandidate(job.ctx, candidate, DEEP_TIME_LIMIT_MS);
        if (row.state === 'found') { job.rows.push(row); changed = true; }
        else if (row.state === 'timeout') { job.timeouts += 1; }
        else if (row.state === 'unavailable') { job.unavailable += 1; }
        else if (row.state === 'error') { job.errors += 1; }
        if (clock() - tickStarted >= TICK_BUDGET_MS) break;
      }
      if (!job) return;
      view.done = job.deepIndex;
      view.timeouts = job.timeouts;
      view.unavailable = job.unavailable;
      view.errors = job.errors;
      view.elapsedMs = clock() - job.startedAt;
      if (job.deepIndex >= job.deepList.length || clock() - job.deepStartedAt > DEEP_BUDGET_MS) {
        job.timeouts += Math.max(0, job.deepList.length - job.deepIndex);
        finishJob(false);
        return;
      }
      updateProgress();
      if (changed) renderRows();
      scheduleStep();
      return;
    }

    while (job.index < job.ctx.candidates.length) {
      candidate = job.ctx.candidates[job.index];
      job.index += 1;
      row = searchCandidate(job.ctx, candidate);
      if (row.state === 'found') {
        job.rows.push(row);
        changed = true;
      } else if (row.state === 'timeout') {
        job.timeouts += 1;
        job.timeoutList.push(candidate);
      } else if (row.state === 'unavailable') {
        job.unavailable += 1;
      } else if (row.state === 'error') {
        job.errors += 1;
      }
      if (clock() - tickStarted >= TICK_BUDGET_MS) break;
    }

    if (!job) return;

    view.done = job.index;
    view.timeouts = job.timeouts;
    view.unavailable = job.unavailable;
    view.errors = job.errors;
    view.elapsedMs = clock() - job.startedAt;

    if (job.index >= job.ctx.candidates.length) {
      if (startDeepPhase()) {
        updateProgress();
        if (changed) renderRows();
        scheduleStep();
        return;
      }
      finishJob(false);
      return;
    }
    updateProgress();
    if (changed) renderRows();
    scheduleStep();
  }

  function finishJob(cancelled) {
    if (!job) return;
    var summary = {
      key: job.key,
      rows: job.rows,
      total: job.ctx.candidates.length,
      done: job.index,
      timeouts: job.timeouts,
      unavailable: job.unavailable,
      errors: job.errors,
      elapsedMs: clock() - job.startedAt
    };
    if (job.timer) {
      global.clearTimeout(job.timer);
      job.timer = null;
    }
    job = null;
    runSeq += 1;

    view = {
      mode: cancelled ? 'cancelled' : 'done',
      key: summary.key,
      total: summary.total,
      done: summary.done,
      rows: summary.rows,
      timeouts: summary.timeouts,
      unavailable: summary.unavailable,
      errors: summary.errors,
      elapsedMs: summary.elapsedMs,
      cached: false
    };
    lastKey = summary.key;
    if (!cancelled) putCache(summary);
    render();
  }

  /* ======================================================================
     キャッシュ（条件キー単位）
     ====================================================================== */

  function putCache(summary) {
    if (!summary || !summary.key) return;
    if (!cache[summary.key]) {
      cacheKeys.push(summary.key);
      while (cacheKeys.length > MAX_CACHE) {
        var old = cacheKeys.shift();
        if (old && old !== summary.key) delete cache[old];
      }
    }
    cache[summary.key] = summary;
  }

  function applyCache(key) {
    var summary = cache[key];
    if (!summary) return;
    view = {
      mode: 'done',
      key: key,
      total: summary.total,
      done: summary.done,
      rows: summary.rows,
      timeouts: summary.timeouts,
      unavailable: summary.unavailable || 0,
      errors: summary.errors || 0,
      elapsedMs: summary.elapsedMs,
      cached: true
    };
    lastKey = key;
  }

  /* ======================================================================
     進捗・結果の描画
     ====================================================================== */

  function emptyHTML(message, hint) {
    return '<div class="empty-state small cs-empty">' +
      '<span class="muted">' + kit.esc(message) + '</span>' +
      (hint ? '<span class="muted cs-empty-hint">' + kit.esc(hint) + '</span>' : '') +
      '</div>';
  }

  function percent() {
    if (!view || !view.total) return 0;
    return Math.max(0, Math.min(100, Math.round((view.done / view.total) * 100)));
  }

  function secondsText() {
    if (!view) return '';
    return (Math.max(0, view.elapsedMs) / 1000).toFixed(1) + '秒';
  }

  function progressText() {
    if (!view) return '';
    var found = (view.rows || []).length;
    if (view.mode === 'running' && view.phase === 'deep') {
      return '判定不能だった候補を再判定中 ' + view.done + ' / ' + view.total + '（追加可能 ' + found + '件）';
    }
    if (view.mode === 'running') {
      return '理論値お守りを計算中 ' + view.done + ' / ' + view.total + '（追加可能 ' + found + '件）';
    }
    return '理論値お守り ' + view.done + ' / ' + view.total + ' を判定（追加可能 ' + found + '件' +
      (view.cached ? '・キャッシュ' : '') + '）';
  }

  function noteText() {
    if (!view) return '';
    var notes = [];
    if (view.mode === 'running' && view.phase === 'deep') {
      notes.push('短い上限で判定できなかった候補を、より長い上限で再判定しています。');
    }
    if (view.mode === 'cancelled') {
      notes.push('キャンセルしました。条件を変えるか「再計算」で最初からやり直せます。');
    }
    notes.push('未所持でもよい理論値お守り（各系統の最大ポイント）を含めて成立するかを判定しています。');
    var charmless = 0;
    for (var i = 0; i < (view.rows || []).length; i++) {
      if (!view.rows[i].charm) charmless += 1;
    }
    if (charmless) {
      notes.push('お守りを使わずに成立した系統: ' + charmless + '件（「お守り不要」と表示）');
    }
    if (view.timeouts) {
      notes.push('時間内に判定できなかった系統: ' + view.timeouts + '件（「再計算」で再試行できます）');
    }
    if (view.unavailable) {
      notes.push('理論値お守りを作れなかった系統: ' + view.unavailable + '件');
    }
    if (view.errors) {
      notes.push('検索に失敗した系統: ' + view.errors + '件');
    }
    return notes.join(' ');
  }

  function toolbarHTML() {
    return '<div class="cs-toolbar">' +
      '<label class="cs-sort-wrap"><span>並び順</span>' +
        '<select class="cs-sort" data-role="sort">' +
          '<option value="system"' + (sortMode === 'system' ? ' selected' : '') + '>系統名順</option>' +
          '<option value="defense"' + (sortMode === 'defense' ? ' selected' : '') + '>防御力順</option>' +
          '<option value="points"' + (sortMode === 'points' ? ' selected' : '') + '>到達pt順</option>' +
        '</select>' +
      '</label>' +
      '<button type="button" class="link-btn" data-action="retry">再計算</button>' +
      '</div>';
  }

  function progressHTML() {
    var running = view.mode === 'running';
    return '<div class="cs-progress">' +
      '<div class="cs-progress-head">' +
        '<span class="cs-progress-label" data-role="progress" aria-live="polite">' + kit.esc(progressText()) + '</span>' +
        '<span class="cs-progress-meta" data-role="meta">' + kit.esc(secondsText()) + '</span>' +
        (running ? '<button type="button" class="link-btn cs-cancel" data-action="cancel">キャンセル</button>' : '') +
      '</div>' +
      '<div class="cs-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"' +
        ' aria-valuenow="' + percent() + '" aria-label="理論値お守りの計算進捗">' +
        '<span class="cs-progress-bar" data-role="bar" style="width:' + percent() + '%"></span></div>' +
      '</div>';
  }

  function rowHTML(row) {
    var example = '例: ' + (row.label || 'お守り') + '（防御 ' + row.defense + '）';
    return '<div class="cs-row" data-group="' + kit.esc(row.group) + '">' +
      '<div class="cs-row-head">' +
        '<span class="cs-charm-label">' + kit.icon('charm', 'icon-sm') +
          '<span class="cs-chip-group">' + kit.esc(row.group) + '</span>' +
          '<span class="cs-skill-name">' + kit.esc(row.name) + '</span>' +
          '<span class="chip-sub cs-pt">到達 ' + kit.esc(String(row.reached)) + 'pt</span>' +
        '</span>' +
        '<span class="cs-example" title="' + kit.esc(example) + '">' + kit.esc(example) + '</span>' +
      '</div>' +
      '<div class="cs-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="add-skill" data-group="' +
          kit.esc(row.group) + '">条件に追加</button>' +
        (row.charm
          ? '<button type="button" class="btn btn-sm" data-action="add-charm" data-group="' +
            kit.esc(row.group) + '">このお守りを登録</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  function compareGroup(a, b) {
    return a.group < b.group ? -1 : (a.group > b.group ? 1 : 0);
  }

  function sortedRows() {
    var list = ((view && view.rows) || []).slice();
    if (sortMode === 'defense') {
      list.sort(function (a, b) {
        if (b.defense !== a.defense) return b.defense - a.defense;
        return compareGroup(a, b);
      });
    } else if (sortMode === 'points') {
      list.sort(function (a, b) {
        if (b.reached !== a.reached) return b.reached - a.reached;
        return compareGroup(a, b);
      });
    } else {
      list.sort(compareGroup);
    }
    return list;
  }

  function renderCount() {
    if (!countNode) return;
    if (!view) {
      countNode.textContent = '';
      return;
    }
    if (view.mode === 'running') {
      countNode.textContent = view.done + ' / ' + view.total;
    } else if (view.mode === 'done' || view.mode === 'cancelled') {
      countNode.textContent = (view.rows || []).length + '件';
    } else {
      countNode.textContent = '';
    }
  }

  function renderRows() {
    if (!bodyNode || !view) return;
    var box = bodyNode.querySelector('[data-role="rows"]');
    if (!box) {
      render();
      return;
    }
    var rows = sortedRows();
    box.innerHTML = rows.map(rowHTML).join('');
    var noteNode = bodyNode.querySelector('[data-role="note"]');
    if (noteNode) noteNode.textContent = noteText();
  }

  function updateProgress() {
    if (!bodyNode || !view) return;
    var label = bodyNode.querySelector('[data-role="progress"]');
    var meta = bodyNode.querySelector('[data-role="meta"]');
    var bar = bodyNode.querySelector('[data-role="bar"]');
    if (label) label.textContent = progressText();
    if (meta) meta.textContent = secondsText();
    if (bar) bar.style.width = percent() + '%';
    var track = bodyNode.querySelector('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', String(percent()));
    renderCount();
  }

  function render() {
    var state = MHXX.store ? MHXX.store.get() : null;
    var on = !!(state && state.charmSuggestMode);
    syncToggle(on);
    if (panelNode) panelNode.hidden = !on;
    renderCount();
    if (!on || !bodyNode) return;

    if (!view || view.mode === 'idle') {
      bodyNode.innerHTML = emptyHTML(
        'スキルを選ぶと、未所持のお守りを含めて「このお守りがあれば追加できるスキル」を計算します',
        'STEP 3 でスキルを 1 つ以上選ぶと計算が始まります'
      );
      return;
    }
    if (view.mode === 'no-skills') {
      bodyNode.innerHTML = emptyHTML(
        'スキルを選ぶと、未所持のお守りを含めて「このお守りがあれば追加できるスキル」を計算します',
        '選んだスキルと、その候補系統を載せた理論値お守りで成立するかを判定します'
      );
      return;
    }
    if (view.mode === 'empty-candidates') {
      bodyNode.innerHTML = emptyHTML(
        '候補になるスキル系統がありません',
        'すべての系統が選択済みか、現在のタイプ（剣士/ガンナー）で使える系統がありません'
      );
      return;
    }

    var rows = sortedRows();
    var html = progressHTML() + toolbarHTML();
    if (rows.length) {
      html += '<div class="cs-rows" data-role="rows">' + rows.map(rowHTML).join('') + '</div>';
    } else {
      html += emptyHTML(
        view.mode === 'running'
          ? '計算中です（見つかった時点で追加されます）'
          : 'この条件で追加発動できるスキルは見つかりませんでした',
        view.mode === 'running'
          ? '候補 ' + view.total + '件を上から順に判定しています'
          : 'スキルを減らすか、武器スロを増やして再計算してください'
      );
    }
    html += '<p class="cs-note muted" data-role="note">' + kit.esc(noteText()) + '</p>';
    bodyNode.innerHTML = html;
  }

  function syncToggle(on) {
    if (toggleNode) toggleNode.checked = on;
    var row = (toggleNode && toggleNode.closest) ? toggleNode.closest('.switch-row') : null;
    if (!row) return;
    if (on) row.classList.add('is-on');
    else row.classList.remove('is-on');
  }

  /* ======================================================================
     状態監視（トグル・条件変更で再計算）
     ====================================================================== */

  function handleState() {
    var state = MHXX.store ? MHXX.store.get() : null;
    var on = !!(state && state.charmSuggestMode);
    syncToggle(on);
    if (panelNode) panelNode.hidden = !on;

    if (!on) {
      if (pendingTimer) { global.clearTimeout(pendingTimer); pendingTimer = null; }
      cancelJob(true);
      view = null;
      lastKey = null;
      renderCount();
      return;
    }

    var skills = selectedSkills(state);
    if (!skills.length) {
      if (!job && view && view.mode === 'no-skills') { renderCount(); return; }
      if (pendingTimer) { global.clearTimeout(pendingTimer); pendingTimer = null; }
      cancelJob(true);
      view = {
        mode: 'no-skills', key: '', total: 0, done: 0, rows: [],
        timeouts: 0, unavailable: 0, errors: 0, elapsedMs: 0, cached: false
      };
      lastKey = '';
      render();
      return;
    }

    var key = computeKey(state, skills);

    if (job) {
      if (job.key === key) { renderCount(); return; }
      cancelJob(true);           /* 条件が変わったら古い計算は破棄 */
    }
    if (view && view.key === key && (view.mode === 'done' || view.mode === 'cancelled')) {
      renderCount();
      return;
    }

    if (pendingTimer) { global.clearTimeout(pendingTimer); pendingTimer = null; }
    pendingTimer = global.setTimeout(function () {
      pendingTimer = null;
      runFor(state, skills, key);
    }, DEBOUNCE_MS);
  }

  function runFor(state, skills, key) {
    var current = MHXX.store ? MHXX.store.get() : null;
    if (!current || !current.charmSuggestMode) return;
    if (cache[key]) {
      applyCache(key);
      render();
      return;
    }
    startJob(state, skills);
  }

  function forceRecompute() {
    var state = MHXX.store ? MHXX.store.get() : null;
    if (!state || !state.charmSuggestMode) return;
    var skills = selectedSkills(state);
    if (!skills.length) return;
    var key = computeKey(state, skills);
    if (pendingTimer) { global.clearTimeout(pendingTimer); pendingTimer = null; }
    if (cache[key]) {
      delete cache[key];
      var index = cacheKeys.indexOf(key);
      if (index !== -1) cacheKeys.splice(index, 1);
    }
    startJob(state, skills);
  }

  /* ======================================================================
     行の操作（条件に追加 / お守りを登録）
     ====================================================================== */

  function findRow(group) {
    var rows = (view && view.rows) || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].group === group) return rows[i];
    }
    return null;
  }

  function addSkillCondition(row) {
    if (!row || !MHXX.store) return;
    var state = MHXX.store.get();
    var next = (state.skills || []).filter(function (skill) {
      return skill && skill.group !== row.group;
    }).concat([{ name: row.name, group: row.group, threshold: row.threshold }]);
    MHXX.store.patch({ skills: next, resultIndex: 0 });
    MHXX.bus.emit('skills:sync');
    kit.toast(row.name + ' を条件に追加しました');
  }

  function registerCharm(row) {
    var charmApi = MHXX.charmApi;
    var theory = MHXX.charmTheory;
    if (!row || !row.charm || row.charm.kindId == null || !charmApi || typeof charmApi.add !== 'function' || !theory) return;
    var payload = theory.toCharmPayload(row.charm);
    var created = charmApi.add(payload);
    if (!created) {
      kit.toast('お守りの登録に失敗しました', 'error');
      return;
    }
    MHXX.bus.emit('charms');
    var label = typeof charmApi.label === 'function' ? charmApi.label(created) : payload.type;
    kit.toast('お守りを登録しました: ' + label);
  }

  /* ======================================================================
     起動
     ====================================================================== */

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
      kit.delegate(bodyNode, 'click', '[data-action]', function (event, target) {
        var action = target.getAttribute('data-action');
        if (!action) return;
        event.preventDefault();
        if (action === 'cancel') {
          finishJob(true);
          return;
        }
        if (action === 'retry') {
          forceRecompute();
          return;
        }
        var row = findRow(target.getAttribute('data-group'));
        if (!row) return;
        if (action === 'add-skill') addSkillCondition(row);
        else if (action === 'add-charm') registerCharm(row);
      });

      bodyNode.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || target.getAttribute('data-role') !== 'sort') return;
        sortMode = target.value || 'system';
        render();
      });
    }

    MHXX.bus.on('state', handleState);
    handleState();
  }

  MHXX.ui.charmSuggest = {
    init: init,
    render: render,
    recompute: forceRecompute,
    cancel: function () { finishJob(true); }
  };
})(window);
