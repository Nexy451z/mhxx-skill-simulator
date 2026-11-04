/* ==========================================================================
   UI: お守りの登録・管理モーダル
   --------------------------------------------------------------------------
   ・手動追加 / 編集（護石種類 / 第1・第2スキル系統 / スロット数）
   ・登録済み一覧（検索・編集・個別削除・全削除）
   ・テキスト入出力（泣シミュ互換 / マイナスポイント・スキルなし対応）

   保存先は MHXX.charmStore（js/core/charm-store.js）。
   STEP 2 の #charmSelect と同じ一覧を参照するため、登録・編集・削除は
   即座に双方（セレクト / 一覧 / 検索結果）へ反映される。
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var backdrop = null;
  var lastFocus = null;
  var activeTab = 'add';
  var editingId = null;

  var POINT_MIN = -20;
  var POINT_MAX = 20;

  function api() { return MHXX.charmApi || null; }

  function listCharms() {
    var charmApi = api();
    return charmApi && typeof charmApi.list === 'function' ? charmApi.list() : [];
  }

  function node(id) { return document.getElementById(id); }

  function valueOf(id) {
    var el = node(id);
    return el ? String(el.value == null ? '' : el.value) : '';
  }

  function setValue(id, value) {
    var el = node(id);
    if (el) el.value = String(value);
  }

  function groups() {
    return (MHXX.skillIndex && MHXX.skillIndex.groups) || [];
  }

  /* 護石の種類（kind 0 = 装備なし を含む）。charm-store と同じ並び。 */
  function charmTypes() {
    var list = null;
    if (api() && typeof api().kindNames === 'function') {
      list = api().kindNames();
    }
    if (!Array.isArray(list) || !list.length) {
      list = MHXX.charmKindNames || MHXX.charmTypes || ['装備なし', '龍の護石'];
    }
    var out = [];
    list.forEach(function (name) {
      if (name && out.indexOf(name) === -1) out.push(name);
    });
    return out.length ? out : ['装備なし', '龍の護石'];
  }

  /* 護石種類名 -> kind（charmKindNames の添字がゲーム内 kind） */
  function resolveKind(type) {
    var index = charmTypes().indexOf(type);
    return index < 0 ? null : index;
  }

  function fillSelect(select, list, selected) {
    if (!select) return;
    var current = selected != null ? selected : select.value;
    var values = list.slice();
    if (current && values.indexOf(current) === -1) values.unshift(current);
    select.innerHTML = values.map(function (value) {
      var optionValue = typeof value === 'string' ? value : value.value;
      var label = typeof value === 'string' ? value : value.label;
      return '<option value="' + kit.esc(optionValue) + '"' +
        (String(optionValue) === String(current) ? ' selected' : '') + '>' +
        kit.esc(label) + '</option>';
    }).join('');
  }

  function fillFormSelects() {
    fillSelect(node('charmType'), charmTypes(), null);
    var types = charmTypes();
    var preferred = null;
    ['天の護石', '龍の護石', '王の護石'].some(function (name) {
      if (types.indexOf(name) !== -1) { preferred = name; return true; }
      return false;
    });
    if (!preferred) preferred = types[types.length - 1];
    var typeSelect = node('charmType');
    if (typeSelect && !typeSelect.value) fillSelect(typeSelect, types, preferred);

    var slotSelect = node('charmSlots');
    if (slotSelect) {
      slotSelect.innerHTML = [0, 1, 2, 3].map(function (count) {
        return '<option value="' + count + '">' + count + '</option>';
      }).join('');
    }

    var groupList = groups();
    var preferredGroup = null;
    ['攻撃', '達人', '斬れ味', '痛撃', '聴覚保護'].some(function (name) {
      if (groupList.indexOf(name) !== -1) { preferredGroup = name; return true; }
      return false;
    });
    if (!preferredGroup) preferredGroup = groupList[0] || '';
    fillSelect(node('charmGroup1'), [''].concat(groupList), preferredGroup);
    fillSelect(node('charmGroup2'), [''].concat(groupList), '');
  }

  function refreshCount() {
    var countNode = node('charmCount');
    if (countNode) countNode.textContent = String(listCharms().length);
  }

  /* ---- タブ ---- */
  function switchTab(tab) {
    activeTab = tab;
    kit.qa('.modal-tab', backdrop).forEach(function (tabNode) {
      var active = tabNode.getAttribute('data-tab') === tab;
      tabNode.classList.toggle('active', active);
      tabNode.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    kit.qa('.modal-pane', backdrop).forEach(function (pane) {
      pane.classList.toggle('active', pane.getAttribute('data-pane') === tab);
    });
    if (tab === 'list') renderList();
    if (tab === 'text') fillText();
    if (tab === 'add') refreshCount();
  }

  /* ---- 一覧 ---- */
  function filteredCharms() {
    var list = listCharms();
    var keyword = (valueOf('charmListSearch') || '').trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(function (charm) {
      var text = (api() && api().label ? api().label(charm) : '') + ' ' + (charm.tag || '');
      return text.toLowerCase().indexOf(keyword) !== -1;
    });
  }

  function skillChipsHTML(charm) {
    var html = (charm.skills || []).map(function (entry) {
      var group = entry.name || entry.group || '';
      var points = Number(entry.points != null ? entry.points : entry.pt) || 0;
      return '<span class="charm-skill">' + kit.esc(group) + '<b>' + kit.signed(points) + '</b></span>';
    }).join('');
    return html || '<span class="muted">スキルなし</span>';
  }

  function renderList() {
    var host = node('charmList');
    if (!host) return;
    var list = filteredCharms();
    refreshCount();

    if (!list.length) {
      host.innerHTML = '<div class="empty-state">' +
        kit.icon('charm', 'icon-lg') +
        '<p>該当するお守りがありません</p>' +
        '<span class="muted">「手動で追加」タブから登録できます</span></div>';
      return;
    }

    host.innerHTML = list.map(function (charm) {
      var id = kit.esc(String(charm.id));
      var isEditing = editingId !== null && String(editingId) === String(charm.id);
      var meta = '';
      if (charm.tag) meta += '<span class="muted">' + kit.esc(charm.tag) + '</span>';
      if (charm.preset) meta += '<span class="muted">プリセット</span>';

      return '<div class="charm-item" data-id="' + id + '"' +
        (isEditing ? ' aria-current="true"' : '') + '>' +
        '<div class="charm-item-main">' +
        '<div class="charm-item-head">' + kit.icon('charm', 'icon-sm') +
        '<strong>' + kit.esc(charm.type || charm.name || '護石') + '</strong>' +
        '<span class="charm-slots">' + kit.slotDots(charm.slots) + ' スロ' + (charm.slots || 0) + '</span>' +
        meta +
        '</div>' +
        '<div class="charm-item-skills">' + skillChipsHTML(charm) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-sm" data-edit="' + id + '"' +
        ' title="このお守りを編集">' + (isEditing ? '編集中' : '編集') + '</button>' +
        '<button type="button" class="icon-btn danger" data-remove="' + id + '"' +
        ' aria-label="このお守りを削除">' + kit.icon('trash', 'icon-sm') + '</button>' +
        '</div>';
    }).join('');
  }

  /* ---- フォーム ---- */
  function readPair(groupId, pointId) {
    var group = valueOf(groupId);
    if (!group) return null;
    var points = Number(valueOf(pointId));
    if (!isFinite(points)) points = 0;
    points = Math.max(POINT_MIN, Math.min(POINT_MAX, Math.round(points)));
    return { group: group, points: points };
  }

  function updateFormMode(editing) {
    var submitLabel = node('charmSubmitLabel');
    if (submitLabel) submitLabel.textContent = editing ? '更新保存' : 'このお守りを登録';
    var cancel = node('charmCancelEdit');
    if (cancel) cancel.hidden = !editing;
    var editId = node('charmEditId');
    if (editId) editId.value = editing ? String(editingId) : '';
    var form = node('charmForm');
    if (form) form.classList.toggle('is-editing', !!editing);
    var hint = node('charmFormHint');
    if (hint) {
      hint.innerHTML = editing
        ? '編集中: 内容を変更して「更新保存」を押してください。保存すると STEP 2 のセレクトと検索結果へ即時反映されます。'
        : 'スキルポイントはマイナス値（例: -10）も入力できます。スキルなしのスロット3お守りも登録できます。';
    }
  }

  function resetForm() {
    editingId = null;
    fillFormSelects();
    var slotSelect = node('charmSlots');
    if (slotSelect) slotSelect.value = '3';
    setValue('charmPoints1', 6);
    setValue('charmPoints2', 0);
    updateFormMode(false);
  }

  function startEdit(id) {
    var charmApi = api();
    var charm = charmApi && typeof charmApi.getById === 'function' ? charmApi.getById(id) : null;
    if (!charm) {
      kit.toast('お守りが見つかりませんでした', 'error');
      renderList();
      return;
    }
    editingId = String(charm.id);

    fillFormSelects();
    fillSelect(node('charmType'), charmTypes(), charm.type || charm.name);
    var slotSelect = node('charmSlots');
    if (slotSelect) slotSelect.value = String(Number(charm.slots) || 0);

    var skills = charm.skills || [];
    var first = skills[0] || null;
    var second = skills[1] || null;
    var groupList = groups();
    fillSelect(node('charmGroup1'), [''].concat(groupList), first ? (first.name || first.group) : '');
    fillSelect(node('charmGroup2'), [''].concat(groupList), second ? (second.name || second.group) : '');
    setValue('charmPoints1', first ? (Number(first.points != null ? first.points : first.pt) || 0) : 0);
    setValue('charmPoints2', second ? (Number(second.points != null ? second.points : second.pt) || 0) : 0);

    updateFormMode(true);
    renderList();
    switchTab('add');
    var points1 = node('charmPoints1');
    if (points1 && points1.focus) points1.focus();
    if (points1 && points1.select) points1.select();
  }

  function cancelEdit() {
    resetForm();
    renderList();
    switchTab('list');
    kit.toast('編集をキャンセルしました');
  }

  function submitForm(event) {
    if (event) event.preventDefault();
    var charmApi = api();
    if (!charmApi) {
      kit.toast('お守り API が読み込まれていません', 'error');
      return;
    }

    var type = valueOf('charmType') || charmTypes()[0];
    var slots = Number(valueOf('charmSlots'));
    if (!isFinite(slots)) slots = 0;
    slots = Math.max(0, Math.min(3, Math.round(slots)));

    var pairs = [readPair('charmGroup1', 'charmPoints1'), readPair('charmGroup2', 'charmPoints2')];
    var skills = [];
    pairs.forEach(function (pair) {
      if (!pair || !pair.group) return;
      var existing = null;
      skills.forEach(function (item) { if (item.group === pair.group) existing = item; });
      if (existing) existing.points += pair.points;
      else skills.push({ group: pair.group, points: pair.points });
    });
    skills = skills.filter(function (item) { return item.points !== 0; });

    var kind = resolveKind(type);
    if (!skills.length && slots <= 0 && kind !== 0) {
      kit.toast('スキルかスロット数を 1 つ以上入力してください', 'error');
      return;
    }

    var payload = {
      type: type,
      name: type,
      kind: kind,
      slots: slots,
      skills: skills.map(function (item) { return { name: item.group, pt: item.points }; })
    };

    if (editingId) {
      var updated = charmApi.update(editingId, payload);
      if (!updated) {
        kit.toast('お守りの更新に失敗しました', 'error');
        return;
      }
      var updatedId = updated.id;
      afterCharmChange('お守りを更新しました: ' + (charmApi.label(updated) || ''));
      resetForm();
      switchTab('list');
      if (updatedId && MHXX.store && typeof MHXX.store.refresh === 'function') MHXX.store.refresh();
      return;
    }

    var created = charmApi.add(payload);
    if (!created) {
      kit.toast('お守りの登録に失敗しました', 'error');
      return;
    }
    afterCharmChange('お守りを登録しました: ' + (charmApi.label(created) || ''));
    resetForm();
    switchTab('list');
  }

  function afterCharmChange(message) {
    if (MHXX.bus) MHXX.bus.emit('charms');
    refreshCount();
    renderList();
    if (MHXX.store) {
      MHXX.store.patch({ resultIndex: 0 });
      if (typeof MHXX.store.refresh === 'function') MHXX.store.refresh();
    }
    if (message) kit.toast(message);
  }

  /* ---- テキスト入出力 ---- */
  function parseCharmText(text) {
    var charmApi = api();
    if (charmApi && typeof charmApi.parseText === 'function') {
      try {
        return charmApi.parseText(text);
      } catch (err) {
        console.warn('[MHXX] parseText failed', err);
      }
    }
    var out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      var source = line.replace(/^\s+|\s+$/g, '');
      if (!source || source.charAt(0) === '#') return;
      var tokens = source.split(/[,\t]+/).map(function (token) {
        return token.replace(/^\s+|\s+$/g, '');
      }).filter(function (token) { return token !== ''; });
      if (!tokens.length) return;

      var type = null;
      if (charmTypes().indexOf(tokens[0]) !== -1) type = tokens.shift();

      var slots = 0;
      var skills = [];
      tokens.forEach(function (token) {
        var slotMatch = token.match(/^(?:スロ|slot|s)([0-3])$/i);
        if (slotMatch) { slots = Number(slotMatch[1]); return; }
        var match = token.match(/^(.+?)([+-][0-9]+)$/);
        if (match) {
          skills.push([match[1].trim(), Number(match[2])]);
          return;
        }
        if (/^[0-9]+$/.test(token)) {
          slots = Math.min(3, Number(token));
          return;
        }
        skills.push([token, 0]);
      });

      if (!skills.length && !slots) return;
      out.push({
        type: type || charmTypes()[0] || '龍の護石',
        slots: slots,
        skills: skills
      });
    });
    return out;
  }

  function formatCharmText(charm) {
    var fields = [charm.type || charm.name || '護石'];
    (charm.skills || []).forEach(function (entry) {
      var group = entry.name || entry.group;
      var points = Number(entry.points != null ? entry.points : entry.pt) || 0;
      if (!group || !points) return;
      fields.push(group, String(points));
    });
    fields.push(String(Number(charm.slots) || 0));
    return fields.join(',');
  }

  function fillText() {
    var area = node('charmText');
    if (!area) return;
    var charmApi = api();
    if (charmApi && typeof charmApi.exportText === 'function') {
      try {
        area.value = charmApi.exportText();
        return;
      } catch (err) {
        console.warn('[MHXX] exportText failed, fallback to local formatter', err);
      }
    }
    area.value = listCharms().map(formatCharmText).join('\n');
  }

  function importText() {
    var area = node('charmText');
    if (!area) return;
    var text = area.value;
    var charmApi = api();

    if (charmApi && typeof charmApi.importText === 'function') {
      var result = null;
      try {
        result = charmApi.importText(text, 'merge');
      } catch (err) {
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
      var added = Number(result.added) || 0;
      var skipped = Number(result.skipped) || 0;
      if (!added) {
        kit.toast(skipped
          ? skipped + '件は既に登録済みでした'
          : 'インポートできる行が見つかりませんでした',
          skipped ? undefined : 'error');
        return;
      }
      afterCharmChange(added + '個のお守りをインポートしました' +
        (skipped ? '（重複 ' + skipped + '件をスキップ）' : ''));
      fillText();
      return;
    }

    var parsed = parseCharmText(text);
    if (!parsed.length) {
      kit.toast('インポートできる行が見つかりませんでした', 'error');
      return;
    }
    var summary = charmApi ? charmApi.importCharms(parsed, 'merge') : null;
    var count = summary && summary.added ? summary.added : parsed.length;
    afterCharmChange(count + '個のお守りをインポートしました');
    fillText();
  }

  /* ---- 開閉 ---- */
  function open(tab) {
    if (!backdrop) return;
    lastFocus = document.activeElement;
    refreshCount();
    resetForm();
    renderList();
    backdrop.hidden = false;
    document.body.classList.add('modal-open');
    switchTab(tab || 'add');
    global.setTimeout(function () {
      var focusable = backdrop.querySelector('input, select, button');
      if (focusable) focusable.focus();
    }, 30);
  }

  function close() {
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove('modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function init() {
    backdrop = node('charmModal');
    if (!backdrop) return;

    var opener = node('openCharmModal');
    if (opener) {
      opener.addEventListener('click', function (event) {
        event.preventDefault();
        open('add');
      });
    }

    kit.delegate(backdrop, 'click', '[data-modal-close]', function (event) {
      event.preventDefault();
      close();
    });

    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) close();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !backdrop.hidden) close();
    });

    kit.delegate(backdrop, 'click', '.modal-tab', function (event, tabNode) {
      event.preventDefault();
      switchTab(tabNode.getAttribute('data-tab'));
    });

    var form = node('charmForm');
    if (form) form.addEventListener('submit', submitForm);

    var cancelBtn = node('charmCancelEdit');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function (event) {
        event.preventDefault();
        cancelEdit();
      });
    }

    var search = node('charmListSearch');
    if (search) search.addEventListener('input', kit.debounce(renderList, 80));

    kit.delegate(backdrop, 'click', '[data-edit]', function (event, target) {
      event.preventDefault();
      startEdit(target.getAttribute('data-edit'));
    });

    kit.delegate(backdrop, 'click', '[data-remove]', function (event, target) {
      event.preventDefault();
      var id = target.getAttribute('data-remove');
      var charmApi = api();
      if (!charmApi) return;
      var charm = typeof charmApi.getById === 'function' ? charmApi.getById(id) : null;
      var name = charm && charmApi.label ? charmApi.label(charm) : 'このお守り';
      if (!global.confirm(name + ' を削除します。よろしいですか？')) return;
      if (editingId !== null && String(editingId) === String(id)) resetForm();
      charmApi.remove(id);
      afterCharmChange('お守りを削除しました');
    });

    var clearAll = node('charmClearAll');
    if (clearAll) {
      clearAll.addEventListener('click', function () {
        var charmApi = api();
        var count = listCharms().length;
        if (!count) {
          kit.toast('削除するお守りがありません');
          return;
        }
        if (!global.confirm('登録済みのお守り ' + count + ' 個をすべて削除します。よろしいですか？')) return;
        if (editingId !== null) resetForm();
        if (charmApi) charmApi.clear();
        afterCharmChange('お守りをすべて削除しました');
      });
    }

    var importBtn = node('charmImportText');
    if (importBtn) importBtn.addEventListener('click', importText);

    var exportBtn = node('charmExportText');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        fillText();
        kit.toast('登録済みのお守りをテキストに出力しました');
      });
    }

    var copyBtn = node('charmCopyText');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var area = node('charmText');
        if (!area) return;
        var text = area.value;
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
          global.navigator.clipboard.writeText(text).then(function () {
            kit.toast('クリップボードにコピーしました');
          }).catch(function () {
            area.select();
            kit.toast('テキストを選択しました。コピーしてください');
          });
        } else {
          area.select();
          kit.toast('テキストを選択しました。コピーしてください');
        }
      });
    }

    if (MHXX.bus) {
      MHXX.bus.on('charms', function () {
        refreshCount();
        if (editingId !== null) {
          var exists = listCharms().some(function (charm) {
            return String(charm.id) === String(editingId);
          });
          if (!exists) resetForm();
        }
        if (!backdrop.hidden) {
          renderList();
          if (activeTab === 'text') fillText();
        }
      });
    }

    fillFormSelects();
    resetForm();
    renderList();
    refreshCount();
  }

  MHXX.ui.charmModal = {
    init: init,
    open: open,
    close: close,
    startEdit: startEdit,
    cancelEdit: cancelEdit,
    resetForm: resetForm,
    parseCharmText: parseCharmText,
    formatCharmText: formatCharmText
  };
})(window);