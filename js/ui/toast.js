/* ==========================================================================
   UI: トースト通知（軽微な操作フィードバック）
   ========================================================================== */
(function (global) {
  'use strict';

  var MHXX = (global.MHXX = global.MHXX || {});
  MHXX.ui = MHXX.ui || {};

  var host = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  function show(message, type) {
    var container = ensureHost();
    var node = document.createElement('div');
    node.className = 'toast' + (type ? ' toast-' + type : '');
    node.setAttribute('role', 'status');
    node.textContent = message;
    container.appendChild(node);
    global.setTimeout(function () {
      node.classList.add('is-leaving');
      global.setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, 2600);
  }

  function init() { ensureHost(); }

  MHXX.ui.toast = { init: init, show: show };
})(window);
