/* ==========================================================================
   UI: STEP 2 お守りプリセット選択 / セーブデータ(system)読込
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
  var lastSave = null;
  /* セーブ取込モード: 'merge' = 追加（重複スキップ） / 'replace' = 上書き置換 */
  var importMode = 'merge';

  function charms() {
    return MHXX.charmApi ? MHXX.charmApi.list() : [];
  }

  function label(charm) {
    return MHXX.charmApi && MHXX.charmApi.label ? MHXX.charmApi.label(charm) : String(charm && charm.name || '');
  }

  function renderSelect() {
    if (!select) return;
    var state = MHXX.store.get();
    var list = charms();
    var html = '<option value="__all__">手持ちのお守りをすべて対象にする (全検索 - ' + list.length + '個)</option>';

    if (list.length) {
      html += '<optgroup label="登録済みのお守り">';
      html += list.map(function (charm) {
        return '<option value="' + kit.esc(String(charm.id)) + '">' + kit.esc(label(charm)) + '</option>';
      }).join('');
      html += '</optgroup>';
    }

    select.innerHTML = html;
    select.value = state.charmMode === 'single' && state.charmId ? String(state.charmId) : '__all__';
    if (select.value !== (state.charmMode === 'single' && state.charmId ? String(state.charmId) : '__all__')) {
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
          var group = Array.isArray(entry) ? entry[0] : entry.group;
          var points = Array.isArray(entry) ? entry[1] : entry.points;
          return '<span class="charm-skill">' + kit.esc(group) +
            '<b>' + kit.signed(points) + '</b></span>';
        }).join('');
        detail.innerHTML =
          '<div class="charm-detail-head">' + kit.icon('charm', 'icon-sm') +
          '<strong>' + kit.esc(charm.type || charm.name || '護石') + '</strong>' +
          '<span class="charm-slots">' + kit.slotDots(charm.slots) + ' スロ' + (charm.slots || 0) + '</span></div>' +
          '<div class="charm-detail-skills">' + (skills || '<span class="muted">スキルなし</span>') + '</div>';
        return;
      }
    }

    detail.innerHTML =
      '<div class="charm-detail-head">' + kit.icon('search', 'icon-sm') +
      '<strong>全 ' + list.length + ' 個のお守りから最適な組み合わせを検索</strong></div>' +
      '<div class="charm-detail-skills"><span class="muted">' +
      'お守りを固定したい場合は上のセレクトから個別に選択してください。</span></div>';
  }

  /* ---- セーブデータ ---- */

  function normalizeCharms(rawList) {
    if (!rawList) return [];
    return kit.toArray(rawList).map(function (raw, index) {
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

    /* 取込後は「全検索」に戻して #charmSelect と検索結果を即時同期する */
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
