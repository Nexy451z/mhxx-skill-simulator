/* ==========================================================================
   UI: STEP 2 お守り選択 / インラインお守りビルダー / セーブデータ(system)読込
   - 初期状態はお守り0個（空）からスタート
   - 画面上のクイックビルダーで第1/第2スキル系統・ポイント・スロットを選んでワンタップ追加
   - 全検索モードと個別お守り固定モードの切り替え
   - system ファイルの選択・ドラッグ＆ドロップ → スロット別インポート
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var select = null;
  var detail = null;
  var drop = null;
  var fileInput = null;
  var slotsHost = null;
  var step2Count = null;
  var lastSave = null;
  var importMode = 'merge';

  /* インラインクイックビルダー要素 */
  var qcbSkill1 = null;
  var qcbPt1 = null;
  var qcbSkill2 = null;
  var qcbPt2 = null;
  var qcbSlotBtns = null;
  var qcbAddBtn = null;
  var qcbSelectedSlot = 3;

  function charms() {
    return MHXX.charmApi ? MHXX.charmApi.list() : [];
  }

  function label(charm) {
    return MHXX.charmApi && MHXX.charmApi.label ? MHXX.charmApi.label(charm) : String(charm && charm.name || '');
  }

  /* 護石で選択可能なスキル系統リスト（よく使う系統を先頭に並べる） */
  var POPULAR_SYSTEMS = [
    '痛撃', '達人', '斬れ味', '匠', '攻撃', '会心強化', '連撃', '聴覚保護',
    '溜め短縮', '通常弾強化', '貫通弾強化', '散弾強化', '重撃弾強化', '装填数',
    '反動', '装填速度', '射法', '速射', '弾薬節約', '回避性能', '回避距離',
    'ガード性能', 'ガード強化', '納刀', '納刀研磨', '研ぎ師', '鈍器', '抜刀会心',
    '属性会心', '特殊会心', '属性攻撃', '火属性攻撃', '水属性攻撃', '雷属性攻撃',
    '氷属性攻撃', '龍属性攻撃', '特殊攻撃', '砲術', '重撃', '闘魂', '本気',
    '無傷', '底力', '龍気', '逆上', '窮地', '泡沫', '根性', '体術', 'スタミナ',
    '気力回復', 'KO', '減気攻撃', '笛', '乗り', '跳躍', '食事', '茸食', '広域'
  ];

  function getCharmSystemList() {
    var limits = (MHXX.data && MHXX.data.charmSkillLimits) || null;
    var allGroups = (MHXX.skillIndex && MHXX.skillIndex.groups) || [];
    var pool = [];
    var seen = {};

    POPULAR_SYSTEMS.forEach(function (sys) {
      if (limits && !limits[sys]) return;
      seen[sys] = true;
      pool.push(sys);
    });

    if (limits) {
      Object.keys(limits).forEach(function (sys) {
        if (seen[sys]) return;
        seen[sys] = true;
        pool.push(sys);
      });
    } else {
      allGroups.forEach(function (sys) {
        if (seen[sys]) return;
        seen[sys] = true;
        pool.push(sys);
      });
    }
    return pool;
  }

  function getPointBounds(sysName, slotIndex) {
    var limits = (MHXX.data && MHXX.data.charmSkillLimits) || null;
    if (limits && sysName && limits[sysName]) {
      var info = limits[sysName];
      /* 第1スキル・第2スキルの順番を逆に入力しても最大値が選べるよう、両枠の最大・最小を統合 */
      var maxVal = Math.max(info.max1 != null ? info.max1 : -99, info.max2 != null ? info.max2 : -99);
      if (maxVal < 1) maxVal = 10;
      var minVal = Math.min(info.min1 != null ? info.min1 : 99, info.min2 != null ? info.min2 : 99);
      if (minVal > 1) minVal = -10;
      var defVal = slotIndex === 1
        ? (info.max1 != null ? info.max1 : maxVal)
        : (info.max2 != null ? info.max2 : maxVal);
      return { min: minVal, max: maxVal, def: defVal };
    }
    return slotIndex === 1
      ? { min: -10, max: 10, def: 6 }
      : { min: -10, max: 13, def: 10 };
  }

  function populatePointSelect(ptSelect, sysName, slotIndex, keepCurrent) {
    if (!ptSelect) return;
    if (!sysName) {
      ptSelect.innerHTML = '<option value="0">-</option>';
      ptSelect.disabled = true;
      return;
    }
    ptSelect.disabled = false;
    var bounds = getPointBounds(sysName, slotIndex);
    var prev = keepCurrent ? Number(ptSelect.value) : NaN;
    var targetVal = (!isNaN(prev) && prev !== 0 && prev >= bounds.min && prev <= bounds.max)
      ? prev
      : bounds.def;

    var options = [];
    for (var p = bounds.max; p >= bounds.min; p--) {
      if (p === 0) continue;
      var sign = p > 0 ? '+' + p : String(p);
      var suffix = (p === bounds.max) ? ' (最大)' : '';
      options.push('<option value="' + p + '"' + (p === targetVal ? ' selected' : '') + '>' + sign + suffix + '</option>');
    }
    ptSelect.innerHTML = options.join('');
  }

  function initQuickBuilder() {
    qcbSkill1 = document.getElementById('qcbSkill1');
    qcbPt1 = document.getElementById('qcbPt1');
    qcbSkill2 = document.getElementById('qcbSkill2');
    qcbPt2 = document.getElementById('qcbPt2');
    qcbSlotBtns = document.getElementById('qcbSlotBtns');
    qcbAddBtn = document.getElementById('qcbAddBtn');

    if (!qcbSkill1 || !qcbPt1 || !qcbSkill2 || !qcbPt2) return;

    var sysList = getCharmSystemList();
    var html1 = '<option value="">（スキル1なし）</option>' + sysList.map(function (s) {
      return '<option value="' + kit.esc(s) + '"' + (s === '痛撃' ? ' selected' : '') + '>' + kit.esc(s) + '</option>';
    }).join('');
    var html2 = '<option value="">（スキル2なし）</option>' + sysList.map(function (s) {
      return '<option value="' + kit.esc(s) + '">' + kit.esc(s) + '</option>';
    }).join('');

    qcbSkill1.innerHTML = html1;
    qcbSkill2.innerHTML = html2;

    populatePointSelect(qcbPt1, qcbSkill1.value, 1, false);
    populatePointSelect(qcbPt2, qcbSkill2.value, 2, false);

    qcbSkill1.addEventListener('change', function () {
      populatePointSelect(qcbPt1, qcbSkill1.value, 1, false);
    });
    qcbSkill2.addEventListener('change', function () {
      populatePointSelect(qcbPt2, qcbSkill2.value, 2, false);
    });

    if (qcbSlotBtns) {
      qcbSlotBtns.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button[data-qcb-slot]') : null;
        if (!btn) return;
        qcbSelectedSlot = Number(btn.getAttribute('data-qcb-slot')) || 0;
        kit.qa('button[data-qcb-slot]', qcbSlotBtns).forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
    }

    if (qcbAddBtn) {
      qcbAddBtn.addEventListener('click', function () {
        if (!MHXX.charmApi) return;
        var s1 = qcbSkill1.value;
        var p1 = s1 ? (Number(qcbPt1.value) || 0) : 0;
        var s2 = qcbSkill2.value;
        var p2 = s2 ? (Number(qcbPt2.value) || 0) : 0;
        var slots = qcbSelectedSlot;

        var skills = [];
        if (s1 && p1 !== 0) skills.push({ name: s1, pt: p1 });
        if (s2 && p2 !== 0) {
          if (s1 === s2 && skills.length) {
            skills[0].pt += p2;
          } else {
            skills.push({ name: s2, pt: p2 });
          }
        }
        skills = skills.filter(function (item) { return item.pt !== 0; });

        if (!skills.length && slots <= 0) {
          kit.toast('スキルまたはスロット数を1つ以上指定してください', 'error');
          return;
        }

        var created = MHXX.charmApi.add({
          type: '天の護石',
          name: '天の護石',
          kind: 10,
          slots: slots,
          skills: skills
        });

        if (!created) {
          kit.toast('お守りの追加に失敗しました', 'error');
          return;
        }

        MHXX.bus.emit('charms');
        renderSelect();
        renderDetail();
        if (MHXX.store) {
          MHXX.store.patch({ resultIndex: 0 });
          if (typeof MHXX.store.refresh === 'function') MHXX.store.refresh();
        }
        kit.toast('お守りを追加しました: ' + label(created));
      });
    }
  }

  function renderSelect() {
    var list = charms();
    if (step2Count) step2Count.textContent = String(list.length);
    if (!select) return;
    var state = MHXX.store.get();
    var allLabel = list.length
      ? '登録したお守りをすべて対象にする (全検索 - ' + list.length + '個)'
      : 'お守りなし（防具・武器スロのみで検索）';
    var html = '<option value="__all__">' + kit.esc(allLabel) + '</option>';

    if (list.length) {
      html += '<optgroup label="登録済みのお守り（1個固定で検索）">';
      html += list.map(function (charm) {
        return '<option value="' + kit.esc(String(charm.id)) + '">' + kit.esc(label(charm)) + '</option>';
      }).join('');
      html += '</optgroup>';
    }

    select.innerHTML = html;
    var targetVal = state.charmMode === 'single' && state.charmId ? String(state.charmId) : '__all__';
    select.value = targetVal;
    if (select.value !== targetVal) {
      select.value = '__all__';
    }
  }

  function renderDetail() {
    if (!detail) return;
    var state = MHXX.store.get();
    var list = charms();

    if (state.charmMode === 'single' && state.charmId) {
      var charm = list.filter(function (item) { return String(item.id) === String(state.charmId); })[0];
      if (charm) {
        var skills = (charm.skills || []).map(function (entry) {
          var group = Array.isArray(entry) ? entry[0] : (entry.group || entry.name);
          var points = Array.isArray(entry) ? entry[1] : (entry.points != null ? entry.points : entry.pt);
          return '<span class="charm-skill">' + kit.esc(group) +
            '<b>' + kit.signed(points) + '</b></span>';
        }).join('');
        detail.innerHTML =
          '<div class="charm-detail-head">' +
            '<div class="cd-left">' + kit.icon('charm', 'icon-sm') +
            '<strong>' + kit.esc(charm.type || charm.name || '護石') + '</strong>' +
            '<span class="charm-slots">' + kit.slotDots(charm.slots) + ' スロ' + (charm.slots || 0) + '</span></div>' +
            '<button type="button" class="link-btn danger-text" data-quick-delete="' + kit.esc(String(charm.id)) + '">削除</button>' +
          '</div>' +
          '<div class="charm-detail-skills">' + (skills || '<span class="muted">スキルなし</span>') + '</div>';
        return;
      }
    }

    if (!list.length) {
      detail.innerHTML =
        '<div class="charm-detail-head">' + kit.icon('charm', 'icon-sm') +
        '<strong>登録お守り: 0個（お守りなしで検索中）</strong></div>' +
        '<div class="charm-detail-skills"><span class="muted">' +
        '下の「お守りを自分で選んで追加」または「セーブデータ読込」からお守りを追加できます。</span></div>';
      return;
    }

    var previewChips = list.slice(0, 4).map(function (c) {
      var sText = (c.skills || []).map(function (s) {
        return (s.name || s.group) + kit.signed(s.points != null ? s.points : s.pt);
      }).join(' ');
      if (!sText) sText = 'スキルなし';
      return '<span class="charm-mini-tag" data-select-charm="' + kit.esc(String(c.id)) + '" title="クリックでこのお守りに固定">' +
        kit.esc(sText + ' スロ' + (c.slots || 0)) +
        '<button type="button" class="charm-mini-del" data-quick-delete="' + kit.esc(String(c.id)) + '" title="削除" aria-label="削除">×</button>' +
        '</span>';
    }).join('');
    var moreCount = list.length > 4 ? '<span class="muted" style="font-size:11px;">他' + (list.length - 4) + '個</span>' : '';

    detail.innerHTML =
      '<div class="charm-detail-head">' + kit.icon('search', 'icon-sm') +
      '<strong>手持ち ' + list.length + ' 個のお守りすべてを対象に検索中</strong></div>' +
      '<div class="charm-detail-skills">' + previewChips + moreCount + '</div>';
  }

  /* ---- セーブデータ ---- */

  function normalizeCharms(rawList) {
    if (!rawList) return [];
    return kit.toArray(rawList).map(function (raw) {
      if (MHXX.charmApi && MHXX.charmApi.normalize) return MHXX.charmApi.normalize(raw);
      return raw;
    }).filter(Boolean);
  }

  function normalizeSaveResult(raw) {
    var slots = [];
    if (!raw) return slots;

    var source = raw.slots || raw.data || raw.list || raw;
    if (!Array.isArray(source)) {
      if (raw.slot1 || raw.slot2 || raw.slot3) {
        source = [raw.slot1, raw.slot2, raw.slot3];
      } else {
        return slots;
      }
    }

    source.forEach(function (entry, index) {
      if (!entry) return;
      if (Array.isArray(entry)) {
        slots.push({ index: index + 1, charms: normalizeCharms(entry), count: entry.length });
      } else if (typeof entry === 'object') {
        var list = entry.charms || entry.list || entry.items || entry.records || [];
        var charms = normalizeCharms(list);
        slots.push({
          index: entry.slotNumber || entry.slot || entry.index || index + 1,
          charms: charms,
          count: Number(entry.count != null ? entry.count : entry.charmCount != null ? entry.charmCount : charms.length) ||
            charms.length
        });
      }
    });
    return slots;
  }

  function renderSlots() {
    if (!slotsHost) return;
    if (!lastSave || !lastSave.length) {
      slotsHost.hidden = true;
      slotsHost.innerHTML = '';
      return;
    }

    slotsHost.hidden = false;
    var total = lastSave.reduce(function (sum, slot) { return sum + slot.count; }, 0);
    slotsHost.innerHTML =
      '<div class="save-slots-head">' + kit.icon('check', 'icon-sm') +
      '<strong>スロット検出: ' + lastSave.length + '件 / 合計 ' + total + '個のお守り</strong></div>' +
      '<div class="save-import-mode" role="radiogroup" aria-label="セーブデータの取り込み方法">' +
        '<label class="save-import-option' + (importMode === 'merge' ? ' is-checked' : '') + '">' +
          '<input type="radio" id="saveImportMerge" name="saveImportMode" value="merge"' +
          (importMode === 'merge' ? ' checked' : '') + '>' +
          '<span><b>追加（重複スキップ）</b><small>登録済みと同じお守りは追加しません</small></span>' +
        '</label>' +
        '<label class="save-import-option' + (importMode === 'replace' ? ' is-checked' : '') + '">' +
          '<input type="radio" id="saveImportReplace" name="saveImportMode" value="replace"' +
          (importMode === 'replace' ? ' checked' : '') + '>' +
          '<span><b>上書き置換（既存をクリア）</b><small>登録済みを全削除してから取り込みます</small></span>' +
        '</label>' +
      '</div>' +
      '<div class="save-slot-list">' +
      lastSave.map(function (slot) {
        return '<div class="save-slot-card">' +
          '<div class="save-slot-title">スロット ' + kit.esc(slot.index) + '</div>' +
          '<div class="save-slot-count">' + kit.esc(slot.count) + ' 個</div>' +
          '<button type="button" class="btn btn-sm" data-import-slot="' + kit.esc(slot.index) + '"' +
          (slot.count ? '' : ' disabled') + '>このスロットを取込</button>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<button type="button" class="btn btn-primary btn-block" data-import-all="1">' +
      kit.icon('download', 'icon-sm') + ' 全スロットを統合してインポート (' + total + '個)</button>';
  }

  function readFile(file) {
    if (!file) return;
    if (!MHXX.saveApi || typeof MHXX.saveApi.parse !== 'function') {
      kit.toast('セーブデータパーサーが読み込まれていません', 'error');
      return;
    }

    var reader = new global.FileReader();
    reader.onload = function () {
      var buffer = reader.result;
      var result;
      try {
        result = MHXX.saveApi.parse(buffer);
      } catch (err) {
        console.error('[MHXX] save parse failed', err);
        kit.toast('セーブデータの解析に失敗しました: ' + (err && err.message ? err.message : err), 'error');
        return;
      }

      Promise.resolve(result).then(function (parsed) {
        if (parsed && parsed.valid === false) {
          kit.toast(parsed.error || 'system セーブとして認識できませんでした', 'error');
          slotsHost.hidden = true;
          return;
        }
        lastSave = normalizeSaveResult(parsed);
        if (!lastSave.length) {
          kit.toast('お守りを検出できませんでした（system ファイルか確認してください）', 'error');
          slotsHost.hidden = true;
          return;
        }
        renderSlots();
        kit.toast('system を解析しました。取り込むスロットを選択してください');
      }).catch(function (err) {
        console.error('[MHXX] save parse rejected', err);
        kit.toast('セーブデータの解析に失敗しました', 'error');
      });
    };
    reader.onerror = function () {
      kit.toast('ファイルの読み込みに失敗しました', 'error');
    };
    reader.readAsArrayBuffer(file);
  }

  function applyImport(list, scopeLabel) {
    if (!list || !list.length) {
      kit.toast('取り込むお守りがありません', 'error');
      return;
    }
    if (!MHXX.charmApi) {
      kit.toast('お守り API が読み込まれていません', 'error');
      return;
    }

    var mode = importMode === 'replace' ? 'replace' : 'merge';
    var result = null;
    try {
      if (typeof MHXX.charmApi.importFromSaveSlot === 'function') {
        result = MHXX.charmApi.importFromSaveSlot(list, mode);
      } else if (typeof MHXX.charmApi.importCharms === 'function') {
        result = MHXX.charmApi.importCharms(list, mode);
      }
    } catch (err) {
      console.error('[MHXX] save import failed', err);
      kit.toast('インポートに失敗しました: ' + (err && err.message ? err.message : err), 'error');
      return;
    }
    if (!result) {
      kit.toast('インポートに失敗しました', 'error');
      return;
    }
    if (result.error) {
      kit.toast('インポートに失敗しました: ' + result.error, 'error');
      return;
    }
    finishImport(result, scopeLabel, mode);
  }

  function importSlot(index) {
    var slot = lastSave.filter(function (item) { return String(item.index) === String(index); })[0];
    if (!slot || !slot.charms.length) return;
    applyImport(slot.charms, 'スロット' + slot.index);
  }

  function importAll() {
    var all = [];
    (lastSave || []).forEach(function (slot) { all = all.concat(slot.charms); });
    applyImport(all, '全スロット');
  }

  function finishImport(result, scopeLabel, mode) {
    var added = Number(result && result.added) || 0;
    var skipped = Number(result && result.skipped) || 0;

    MHXX.store.patch({ charmMode: 'all', charmId: null, resultIndex: 0 });
    MHXX.bus.emit('charms');
    renderSelect();
    renderDetail();

    var message;
    if (mode === 'replace') {
      message = scopeLabel + 'を上書き置換しました（' + added + '個・既存はクリア）';
    } else {
      message = scopeLabel + 'から ' + added + '個追加しました' +
        (skipped ? '（重複 ' + skipped + '件をスキップ）' : '');
    }
    kit.toast(message);
  }

  function init() {
    select = document.getElementById('charmSelect');
    detail = document.getElementById('charmDetail');
    drop = document.getElementById('saveDrop');
    fileInput = document.getElementById('saveFileInput');
    slotsHost = document.getElementById('saveSlots');
    step2Count = document.getElementById('step2CharmCount');

    initQuickBuilder();

    if (select) {
      select.addEventListener('change', function () {
        var value = select.value;
        if (value === '__all__') {
          MHXX.store.patch({ charmMode: 'all', charmId: null, resultIndex: 0 });
        } else {
          MHXX.store.patch({ charmMode: 'single', charmId: value, resultIndex: 0 });
        }
      });
    }

    if (detail) {
      kit.delegate(detail, 'click', '[data-quick-delete]', function (event, target) {
        event.preventDefault();
        event.stopPropagation();
        var id = target.getAttribute('data-quick-delete');
        if (!id || !MHXX.charmApi) return;
        MHXX.charmApi.remove(id);
        MHXX.bus.emit('charms');
        renderSelect();
        renderDetail();
        if (MHXX.store) MHXX.store.refresh();
        kit.toast('お守りを削除しました');
      });
      kit.delegate(detail, 'click', '[data-select-charm]', function (event, target) {
        if (event.target.closest('[data-quick-delete]')) return;
        var id = target.getAttribute('data-select-charm');
        if (!id) return;
        MHXX.store.patch({ charmMode: 'single', charmId: id, resultIndex: 0 });
      });
    }

    if (drop && fileInput) {
      var openPicker = function () { fileInput.click(); };

      drop.addEventListener('click', function (event) {
        if (event.target.closest('button, a, input')) return;
        openPicker();
      });
      drop.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      });

      var pickBtn = document.getElementById('saveFileBtn');
      if (pickBtn) {
        pickBtn.addEventListener('click', function (event) {
          event.stopPropagation();
          openPicker();
        });
      }

      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
        fileInput.value = '';
      });

      ['dragenter', 'dragover'].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          event.stopPropagation();
          drop.classList.add('is-dragover');
        });
      });
      ['dragleave', 'dragend'].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.classList.remove('is-dragover');
        });
      });
      drop.addEventListener('drop', function (event) {
        event.preventDefault();
        event.stopPropagation();
        drop.classList.remove('is-dragover');
        var files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length) readFile(files[0]);
      });
    }

    if (slotsHost) {
      kit.delegate(slotsHost, 'click', '[data-import-slot]', function (event, target) {
        event.preventDefault();
        importSlot(target.getAttribute('data-import-slot'));
      });
      kit.delegate(slotsHost, 'click', '[data-import-all]', function (event, target) {
        event.preventDefault();
        importAll();
      });
      kit.delegate(slotsHost, 'change', 'input[name="saveImportMode"]', function (event, target) {
        event.preventDefault();
        importMode = target.value === 'replace' ? 'replace' : 'merge';
        renderSlots();
      });
    }

    MHXX.bus.on('charms', function () {
      renderSelect();
      renderDetail();
    });
    MHXX.bus.on('state', function (state) {
      if (select) {
        var expected = state.charmMode === 'single' && state.charmId ? String(state.charmId) : '__all__';
        if (select.value !== expected) select.value = expected;
      }
      renderDetail();
    });

    renderSelect();
    renderDetail();
  }

  MHXX.ui.charmPanel = {
    init: init,
    renderSelect: renderSelect,
    renderDetail: renderDetail,
    getImportMode: function () { return importMode; },
    setImportMode: function (mode) {
      importMode = mode === 'replace' ? 'replace' : 'merge';
      renderSlots();
    }
  };
})(window);
