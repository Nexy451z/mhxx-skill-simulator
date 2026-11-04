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
      if (state.type === 'blade' && skill.weapon === 'gunner') return false;
      if (state.type === 'gunner' && skill.weapon === 'blade') return false;

      if (!searching && category !== 'all') {
        if (category === 'recommended') {
          if (!skill.recommended) return false;
        } else if (skill.category !== category) {
          return false;
        }
      }

      if (!keyword) return true;
      var name = (skill.name || '').toLowerCase();
      var group = (skill.group || '').toLowerCase();
      return name.indexOf(keyword) !== -1 || group.indexOf(keyword) !== -1;
    });
  }

  function chipHTML(skill, isSelected, showSubGroup) {
    var sub = '';
    if (showSubGroup && skill.group && skill.group !== skill.name) {
      sub = '<small class="chip-sub">' + kit.esc(skill.group) + '</small>';
    }
    return '<div class="skill-chip' + (isSelected ? ' selected' : '') + '"' +
      ' data-name="' + kit.esc(skill.name) + '"' +
      ' data-group="' + kit.esc(skill.group) + '"' +
      ' data-threshold="' + (skill.threshold || 10) + '"' +
      ' title="' + kit.esc('系統: ' + skill.group + ' (必要 ' + (skill.threshold || 10) + 'pt)') + '"' +
      ' role="button" tabindex="0" aria-pressed="' + (isSelected ? 'true' : 'false') + '">' +
      kit.icon(isSelected ? 'check' : 'plus', 'chip-icon') +
      '<span>' + kit.esc(skill.name) + '</span>' +
      sub +
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
