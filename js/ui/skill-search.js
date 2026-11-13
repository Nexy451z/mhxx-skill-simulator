/* ==========================================================================
   UI: STEP 3 スキル一覧（カテゴリタブ + インクリメンタルサーチ）
   - MHXX.skillIndex / MHXX.categories を元に描画
   - 系統名（達人・痛撃など）でもヒットし、チップに系統名・必要ptを補助表示
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};
  var kit = MHXX.uiKit || {};

  var grid = null;
  var tabs = null;
  var input = null;
  var clearBtn = null;
  var empty = null;
  var count = null;

  function selectedNames() {
    var map = {};
    (MHXX.store.get().skills || []).forEach(function (skill) { map[skill.name] = true; });
    return map;
  }

  function filterSkills(state) {
    var all = (MHXX.skillIndex && MHXX.skillIndex.all) || [];
    var keyword = (state.keyword || '').trim().toLowerCase();
    var category = state.category || 'recommended';
    var searching = !!keyword;

    return all.filter(function (skill) {
      var negative = !!skill.negative;

      /* マイナススキルの表示ルール:
         ・検索中 / 「すべて」/「マイナス」タブでは表示する
         ・「マイナス」タブではマイナスだけを表示する
         ・それ以外のカテゴリタブでは表示しない */
      if (!searching) {
        if (category === 'minus') {
          if (!negative) return false;
        } else if (category !== 'all') {
          if (negative) return false;
          if (category === 'recommended') {
            if (!skill.recommended) return false;
          } else if (skill.category !== category) {
            return false;
          }
        }
      }

      if (!keyword) return true;
      var name = (skill.name || '').toLowerCase();
      var group = (skill.group || '').toLowerCase();
      return name.indexOf(keyword) !== -1 || group.indexOf(keyword) !== -1;
    });
  }

  /* 剣士専用 / ガンナー専用スキルのバッジ（タイプを跨いで一覧に表示するため） */
  function typeBadge(skill) {
    if (skill.weapon === 'blade') {
      return '<small class="chip-type chip-type-blade">剣士専用</small>';
    }
    if (skill.weapon === 'gunner') {
      return '<small class="chip-type chip-type-gunner">ガンナー専用</small>';
    }
    return '';
  }

  function chipHTML(skill, isSelected, showSubGroup) {
    var sub = '';
    if (showSubGroup && skill.group && skill.group !== skill.name) {
      sub = '<small class="chip-sub">' + kit.esc(skill.group) + '</small>';
    }

    var negative = !!skill.negative;
    var threshold = Number(skill.threshold) || 10;
    /* マイナススキルは「合計が -Npt 以下」で発動するバッドスキルなので title も専用文にする */
    var title = '系統: ' + skill.group + (negative
      ? ' / マイナススキル（合計が ' + threshold + 'pt 以下で発動）'
      : ' (必要 ' + threshold + 'pt)' +
        (skill.weapon === 'blade' ? ' / 剣士専用' : skill.weapon === 'gunner' ? ' / ガンナー専用' : ''));

    return '<div class="skill-chip' + (isSelected ? ' selected' : '') +
      (negative ? ' is-minus' : '') + '"' +
      ' data-name="' + kit.esc(skill.name) + '"' +
      ' data-group="' + kit.esc(skill.group) + '"' +
      ' data-weapon="' + kit.esc(skill.weapon || 'both') + '"' +
      ' data-threshold="' + threshold + '"' +
      ' title="' + kit.esc(title) + '"' +
      ' role="button" tabindex="0" aria-pressed="' + (isSelected ? 'true' : 'false') + '">' +
      kit.icon(isSelected ? 'check' : 'plus', 'chip-icon') +
      '<span>' + kit.esc(skill.name) + '</span>' +
      sub +
      typeBadge(skill) +
      (negative ? '<small class="chip-type chip-type-minus">マイナス</small>' : '') +
      '</div>';
  }

  function renderTabs(state) {
    if (!tabs) return;
    var categories = MHXX.categories || [];
    var searching = !!(state.keyword && state.keyword.trim());
    tabs.innerHTML = categories.map(function (category) {
      var active = !searching && (state.category || 'recommended') === category.id;
      return '<button type="button" class="cat-tab-btn' + (active ? ' active' : '') + '"' +
        ' data-category="' + kit.esc(category.id) + '"' +
        ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' +
        kit.esc(category.label) + '</button>';
    }).join('');
  }

  function renderGrid() {
    if (!grid) return;
    var state = MHXX.store.get();
    var selected = selectedNames();
    var list = filterSkills(state);
    var searching = !!(state.keyword && state.keyword.trim());

    grid.innerHTML = list.map(function (skill) {
      return chipHTML(skill, !!selected[skill.name], searching);
    }).join('');

    if (empty) empty.hidden = list.length !== 0;
    if (count) {
      count.textContent = searching
        ? '検索ヒット: ' + list.length + '件（全カテゴリ横断）'
        : list.length + '件';
    }
  }

  function render() {
    var state = MHXX.store.get();
    if (clearBtn && input) {
      clearBtn.hidden = !input.value;
    }
    renderTabs(state);
    renderGrid();
  }

  function syncSelection() {
    if (!grid) return;
    var selected = selectedNames();
    kit.qa('.skill-chip', grid).forEach(function (chip) {
      var isSelected = !!selected[chip.getAttribute('data-name')];
      chip.classList.toggle('selected', isSelected);
      chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      var use = chip.querySelector('use');
      if (use) use.setAttribute('href', isSelected ? '#icon-check' : '#icon-plus');
    });
  }

  function init() {
    grid = document.getElementById('skillGrid');
    tabs = document.getElementById('categoryTabs');
    input = document.getElementById('skillSearch');
    clearBtn = document.getElementById('skillSearchClear');
    empty = document.getElementById('skillEmpty');
    count = document.getElementById('skillCount');
    if (!grid) return;

    if (tabs) {
      kit.delegate(tabs, 'click', '[data-category]', function (event, target) {
        event.preventDefault();
        if (input && input.value) {
          input.value = '';
          if (clearBtn) clearBtn.hidden = true;
        }
        MHXX.store.patch({ category: target.getAttribute('data-category'), keyword: '' });
      });
    }

    if (input) {
      input.addEventListener('input', function () {
        if (clearBtn) clearBtn.hidden = !input.value;
        MHXX.store.patch({ keyword: input.value.trim() });
      });
      input.addEventListener('search', function () {
        if (clearBtn) clearBtn.hidden = !input.value;
        MHXX.store.patch({ keyword: input.value.trim() });
      });
    }

    if (clearBtn && input) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        clearBtn.hidden = true;
        MHXX.store.patch({ keyword: '' });
        input.focus();
      });
    }

    MHXX.bus.on('state', function (state) {
      renderTabs(state);
      renderGrid();
    });
    MHXX.bus.on('skills:sync', syncSelection);

    render();
  }

  MHXX.ui.skillSearch = { init: init, render: render, syncSelection: syncSelection };
})(window);
