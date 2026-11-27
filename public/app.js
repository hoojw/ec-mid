/* 多标签页管理（仅外壳执行；iframe 内无 frameWrap，跳过即可，勿 return——后面还有页面交互代码） */
(function () {
  var tabs = [];
  var seq = 0;
  var frameWrap = document.getElementById("frameWrap");
  var tabsBox = document.getElementById("tabs");
  if (frameWrap && tabsBox) {

  function canonicalNav(url) { try { var u = new URL(url, location.origin); return u.pathname + (u.searchParams.has('sub') ? '?sub=' + u.searchParams.get('sub') : ''); } catch (_) { return '/'; } }
  function syncNav(url) {
    window.__activeMenu = canonicalNav(url);
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.classList.toggle("active", canonicalNav(a.getAttribute("href")) === canonicalNav(url));
    });
  }

  function isHome(t) { return t.url === "/"; }

  function renderTabs() {
    tabsBox.innerHTML = "";
    tabs.forEach(function (t) {
      var el = document.createElement("div");
      el.className = "tab" + (t.active ? " active" : "");
      var ic = document.createElement("span");
      ic.className = "ic";
      ic.innerHTML = t.icon;
      var label = document.createElement("span");
      label.textContent = t.title;
      el.appendChild(ic);
      el.appendChild(label);
      if (!isHome(t)) { // 经营总览为常驻页签，不显示关闭 x
        var x = document.createElement("span");
        x.className = "x";
        x.innerHTML = "✕";
        x.title = "关闭";
        x.onclick = function (ev) { ev.stopPropagation(); closeTab(t); };
        el.appendChild(x);
      }
      el.onclick = function () { activate(t); };
      tabsBox.appendChild(el);
    });
  }

  function activate(t) {
    if (window.closeDesc) window.closeDesc();
    tabs.forEach(function (x) { x.active = (x === t); });
    document.querySelectorAll("iframe.frame").forEach(function (f) {
      f.classList.toggle("active", f.dataset.tab === String(t.id));
    });
    renderTabs();
    syncNav(t.url);
    // 记录当前激活页到地址栏 hash（不刷新整页），刷新后由启动逻辑恢复
    try {
      history.replaceState(null, "", t.url === "/" ? location.origin + "/" : location.origin + "/#" + t.url);
    } catch (e) {}
    document.title = (t.title || "经营总览") + " · 医药电商智能运营中台";
  }

  function openTab(url, title) {
    var exist = tabs.filter(function (t) { return t.url === url; })[0];
    if (!exist) {
      exist = { url: url, title: title, id: ++seq, icon: tabIcon(url) };
      tabs.push(exist);
      var iframe = document.createElement("iframe");
      iframe.className = "frame";
      iframe.dataset.tab = String(exist.id);
      iframe.src = url + (url.indexOf("?") > -1 ? "&" : "?") + "embed=1";
      frameWrap.appendChild(iframe);
    }
    activate(exist);
  }

  function closeTab(t) {
    if (isHome(t)) return; // 常驻页签不可关闭
    var idx = tabs.indexOf(t);
    tabs.splice(idx, 1);
    var f = document.querySelector('iframe.frame[data-tab="' + t.id + '"]');
    if (f) f.remove();
    if (tabs.length === 0) {
      openTab("/", "经营总览");
    } else if (t.active) {
      activate(tabs[Math.max(0, idx - 1)]);
    } else {
      renderTabs();
    }
  }

  /* ---- 标签右键菜单：刷新 / 关闭 / 关闭其他 / 关闭全部 ---- */
  var ctx = document.createElement("div");
  ctx.className = "ctx-menu";
  ctx.style.display = "none";
  document.body.appendChild(ctx);
  var ctxIcons = {
    refresh: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    closeOthers: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M9 9l6 6M15 9l-6 6" stroke-linecap="round"/></svg>',
    closeAll: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.6a8 8 0 1 0 11.4 0"/></svg>'
  };
  function refreshTab(t) {
    var f = document.querySelector('iframe.frame[data-tab="' + t.id + '"]');
    if (!f) return;
    try { f.contentWindow.location.reload(); } catch (_) { f.src = f.src; }
  }
  function hideCtx() { ctx.style.display = "none"; }
  document.addEventListener("click", hideCtx);
  window.addEventListener("blur", hideCtx);
  tabsBox.addEventListener("contextmenu", function (e) {
    var el = e.target.closest(".tab");
    if (!el) return;
    e.preventDefault();
    var t = tabs[Array.prototype.indexOf.call(tabsBox.children, el)];
    if (!t) return;
    var item = function (act, icon, txt, dis) {
      return '<div class="ctx-item' + (dis ? " dis" : "") + '" data-act="' + act + '">' +
        '<span class="ci">' + icon + '</span><span>' + txt + '</span></div>';
    };
    ctx.innerHTML =
      item("refresh", ctxIcons.refresh, "刷新") +
      item("close", ctxIcons.close, "关闭", isHome(t)) +
      item("closeOthers", ctxIcons.closeOthers, "关闭其他") +
      '<div class="ctx-sep"></div>' +
      item("closeAll", ctxIcons.closeAll, "关闭全部");
    ctx.__tab = t;
    ctx.style.display = "block";
    var r = ctx.getBoundingClientRect();
    ctx.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + "px";
    ctx.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + "px";
  });
  ctx.addEventListener("click", function (e) {
    var it = e.target.closest(".ctx-item");
    if (!it || it.classList.contains("dis")) { if (it) hideCtx(); return; }
    var act = it.dataset.act, t = ctx.__tab;
    hideCtx();
    if (act === "refresh") refreshTab(t);
    else if (act === "close") closeTab(t);
    else if (act === "closeOthers") {
      tabs.slice().filter(function (x) { return x !== t && !isHome(x); }).forEach(closeTab);
      activate(t);
    } else if (act === "closeAll") {
      tabs.slice().filter(function (x) { return !isHome(x); }).forEach(closeTab);
      activate(tabs[0]);
    }
  });

  // 绑定侧栏导航点击（菜单管理改结构后需重新绑定）
  // 标签栏图标：二级菜单统一用空心圆圈
  var ICON_CIRCLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7.5"/></svg>';
  function tabIcon(url) {
    return (window.__ICONS || {})[url] || ICON_CIRCLE;
  }

  function bindNav() {
    // 一级菜单（有二级）：只展开 / 收起，不打开页面；多组可同时展开，互不收起
    document.querySelectorAll(".nav-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var gid = btn.dataset.navToggle;
        var grp = document.querySelector('.nav-children[data-nav-group="' + gid + '"]');
        if (!grp) return;
        var willOpen = !grp.classList.contains("open");
        // 仅切换当前组，不收起其它已展开的一级菜单
        grp.classList.toggle("open", willOpen);
        btn.classList.toggle("open", willOpen);
      });
    });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        openTab(a.getAttribute("href"), a.dataset.title || a.textContent.trim());
      });
    });
  }
  bindNav();
  // 暴露给 iframe：菜单管理改结构后热更新父窗口侧栏
  window.refreshSidebar = function (activeHref) {
    if (activeHref) window.__activeMenu = activeHref;
    fetch("/api/nav?active=" + encodeURIComponent(window.__activeMenu || "/")).then(function (r) { return r.text(); }).then(function (html) {
      var old = document.querySelector(".sidebar nav.nav");
      if (old) {
        old.outerHTML = html; bindNav();
        var a = document.querySelector(".nav a.active");
        if (a) { var ch = a.closest(".nav-children"); if (ch) { var gid = ch.getAttribute("data-nav-group"); var grp = document.querySelector('.nav-children[data-nav-group="' + gid + '"]'); var tgl = document.querySelector('.nav-toggle[data-nav-toggle="' + gid + '"]'); if (grp) grp.classList.add("open"); if (tgl) tgl.classList.add("open"); } }
      }
    });
  };

  // 暴露给 embed 页：子页面里 data-goto 跳转用
  window.openTab = openTab;
  window.__TITLES = { "/": "经营总览", "/analysis": "交易分析", "/diagnosis": "经营诊断", "/competitor": "竞品监控", "/inventory": "库存管理", "/activity": "活动管理", "/compliance": "风控中心", "/sop": "运营 SOP", "/data": "数据与规则", "/about": "使用说明" };

  var initPath = window.__initPath || "/";
  var initTitle = window.__initTitle || "经营总览";
  // 多标签 iframe 流下地址栏 pathname 始终是外壳根；用 hash 记录当前页，刷新后恢复
  var _h = (location.hash || "").replace(/^#/, "");
  if (_h && _h !== "/" && _h !== initPath) {
    var _nav = Array.from(document.querySelectorAll('.nav a')).find(function(a) { return canonicalNav(a.getAttribute('href')) === canonicalNav(_h); });
    if (_nav) { initPath = _h; initTitle = _nav.dataset.title || _nav.textContent.trim(); }
    else if (history.replaceState) { history.replaceState(null, "", location.pathname + location.search); }
  }
  openTab("/", "经营总览");
  if (initPath !== "/") openTab(initPath, initTitle);
  // 刷新后按当前激活页展开其所属的一级菜单分组（其余分组保持原状）
  (function expandActiveGroup() {
    var a = document.querySelector(".nav a.active");
    if (!a) return;
    var ch = a.closest(".nav-children");
    if (!ch) return;
    var gid = ch.getAttribute("data-nav-group");
    var grp = document.querySelector('.nav-children[data-nav-group="' + gid + '"]');
    var tgl = document.querySelector('.nav-toggle[data-nav-toggle="' + gid + '"]');
    if (grp) grp.classList.add("open");
    if (tgl) tgl.classList.add("open");
  })();

  // 退出（演示）：轻量提示 + 重新登录
  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      if (!confirm("确定退出登录？")) return;
      var mask = document.createElement("div");
      mask.className = "logout-mask";
      mask.innerHTML = '<div class="logout-box"><div class="icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div><div class="t">已安全退出</div><button>重新登录</button></div>';
      mask.querySelector("button").addEventListener("click", function () { mask.remove(); });
      document.body.appendChild(mask);
    });
  }

  // 操作记录浮层（分页 + 滚动；点页面其他地方收起，且遮罩屏蔽页面操作）
  var logBtn = document.getElementById("logBtn");
  var logOverlay = document.getElementById("logOverlay");
  var logMask = document.getElementById("logMask");
  function closeLog() {
    logOverlay.classList.remove("open");
    if (logMask) logMask.classList.remove("open");
  }
  if (logBtn && logOverlay) {
    if (logMask) logMask.addEventListener("click", closeLog);
    var logPage = 1, logSize = 20;
    var loadLogs = function () {
      fetch("/api/logs?page=" + logPage + "&size=" + logSize).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) return;
        var items = d.logs.length ? d.logs.map(function (l) {
          return '<div class="log-item"><div class="log-t">' + escHtml(l.created_at) + '</div>' +
            '<div class="log-a"><b>' + escHtml(l.actor) + '</b> ' + escHtml(l.action) + ' · ' + escHtml(l.target) + '</div>' +
            '<div class="log-d">' + escHtml(l.detail || "") + '</div></div>';
        }).join("") : '<div class="note" style="padding:16px">暂无记录</div>';
        var pager = '<div class="log-pager">' +
          '<span>共 ' + d.total + ' 条 · 第 ' + d.page + '/' + d.pages + ' 页</span>' +
          '<span class="lp-btns">' +
          '<button class="act-btn" data-log-page="' + (d.page - 1) + '"' + (d.page <= 1 ? " disabled style='opacity:.4'" : "") + '>‹ 上一页</button>' +
          '<button class="act-btn" data-log-page="' + (d.page + 1) + '"' + (d.page >= d.pages ? " disabled style='opacity:.4'" : "") + '>下一页 ›</button>' +
          '</span></div>';
        logOverlay.innerHTML = '<div class="log-head"><span>操作记录</span><button class="log-close">✕</button></div>' +
          '<div class="log-body">' + items + '</div>' + pager;
        logOverlay.querySelector(".log-close").onclick = closeLog;
        logOverlay.querySelectorAll("[data-log-page]").forEach(function (b) {
          b.onclick = function () {
            if (b.disabled) return;
            logPage = Number(b.dataset.logPage);
            loadLogs();
          };
        });
      });
    };
    logBtn.addEventListener("click", function () {
      var willOpen = !logOverlay.classList.contains("open");
      logOverlay.classList.toggle("open");
      if (logMask) logMask.classList.toggle("open", willOpen);
      if (willOpen) { logPage = 1; loadLogs(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && logOverlay.classList.contains("open")) closeLog();
    });
  }
  }
})();

/* ---- 价格雷达：本店店铺切换 + 竞品店铺多选（确认后刷新） ---- */
(function () {
  if (!document.getElementById("cmpCs") && !document.getElementById("cmpStore")) return;
  var bar = document.getElementById("cmpCs");
  var storeSel = document.getElementById("cmpStore");
  var embed = new URL(location.href).searchParams.get("embed") === "1";
  function buildUrl(storeId, csIds) {
    var u = "/competitor?sub=price&sel_store=" + storeId;
    if (csIds && csIds.length) u += "&sel_cs=" + csIds.join(",");
    if (embed) u += "&embed=1";
    return u;
  }
  function curCs() {
    return bar ? Array.prototype.slice.call(bar.querySelectorAll("input[type=checkbox]:checked")).map(function (i) { return i.value; }) : [];
  }
  if (storeSel) storeSel.onchange = function () { location.href = buildUrl(storeSel.value, curCs()); };
  if (bar) {
    var panel = bar.querySelector(".msel-panel");
    bar.querySelector("[data-msel-toggle]").onclick = function (e) { e.stopPropagation(); panel.hidden = !panel.hidden; };
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { if (panel) panel.hidden = true; });
    var all = bar.querySelector("[data-msel-all]"), none = bar.querySelector("[data-msel-none]"), okBtn = bar.querySelector("[data-msel-ok]");
    if (all) all.onclick = function () { panel.querySelectorAll("input").forEach(function (i) { i.checked = true; }); };
    if (none) none.onclick = function () { panel.querySelectorAll("input").forEach(function (i) { i.checked = false; }); };
    if (okBtn) okBtn.onclick = function () { location.href = buildUrl(storeSel ? storeSel.value : 0, curCs()); };
  }
})();

/* ================= 原型说明：卡片悬浮按钮 + 右侧编辑抽屉（Markdown，真实入库） ================= */
(function () {
  /* ---------- 极简 Markdown 渲染（离线实现，不依赖外部库） ---------- */
  function mdInline(s) {
    s = String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // 允许少量行内标签（小字号/下划线/换行）
    s = s.replace(/&lt;(\/?)(small|u|sub|sup|br\s*\/?)&gt;/gi, "<$1$2>");
    return s;
  }
  function renderMd(md) {
    var lines = String(md || "").split("\n"), out = [], list = null;
    function closeList() { if (list) { out.push("</" + list + ">"); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var h = ln.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); var lv = Math.min(h[1].length + 1, 5); out.push("<h" + lv + ">" + mdInline(h[2]) + "</h" + lv + ">"); continue; }
      var q = ln.match(/^&gt;\s?(.*)$/) || ln.match(/^>\s?(.*)$/);
      if (q) { closeList(); out.push("<blockquote>" + mdInline(q[1]) + "</blockquote>"); continue; }
      if (/^(-{3,}|\*{3,})$/.test(ln.trim())) { closeList(); out.push("<hr>"); continue; }
      if (/^!\[[^\]]*\]\([^)\s]+\)\s*$/.test(ln.trim())) { closeList(); out.push('<p class="md-img">' + mdInline(ln.trim()) + "</p>"); continue; }
      var ul = ln.match(/^\s*[-*+]\s+(.*)$/), ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        var tag = ul ? "ul" : "ol";
        if (list !== tag) { closeList(); out.push("<" + tag + ">"); list = tag; }
        out.push("<li>" + mdInline((ul || ol)[1]) + "</li>");
        continue;
      }
      if (!ln.trim()) { closeList(); continue; }
      closeList();
      out.push("<p>" + mdInline(ln) + "</p>");
    }
    closeList();
    return out.join("");
  }

  /* ---------- 父窗口：抽屉本体 ---------- */
  var descPanel = document.getElementById("descPanel");
  if (descPanel && window.top === window) {
    var cur = { module: "", card_key: "", title: "" };
    var dirty = false;

    var TOOL = [
      { k: "h1", t: "H1", title: "大标题" },
      { k: "h2", t: "H2", title: "小标题" },
      { k: "h3", t: "H3", title: "次级标题" },
      { k: "p", t: "正文", title: "正文段落" },
      { k: "ol", t: "1.", title: "有序列表" },
      { k: "ul", t: "•", title: "无序列表" },
      { k: "b", t: "B", title: "加粗", cls: "md-b" },
      { k: "i", t: "I", title: "斜体", cls: "md-i" },
      { k: "quote", t: "❝", title: "引用" },
      { k: "small", t: "A⁻", title: "小字号" },
      { k: "hr", t: "—", title: "分割线" },
      { k: "clear", t: "清除", title: "清除格式" }
    ];

    // 直接编辑、即时看到样式（不显示 Markdown 源码）
    function panelHTML(title, meta, value) {
      return '<div class="desc-head"><div class="dh-t">原型说明</div>' +
        '<div class="dh-s">' + escHtml(title || "") + '<span class="dh-m">' + escHtml(meta || "") + "</span></div>" +
        '<button class="desc-close" title="收起">✕</button></div>' +
        '<div class="desc-bar">' + TOOL.map(function (b) {
          return '<button class="' + (b.cls || "") + '" data-md="' + b.k + '" title="' + b.title + '">' + b.t + "</button>";
        }).join("") +
        '<span class="db-sep"></span>' +
        '<span class="db-hint">插图：直接粘贴截图</span>' +
        '<span class="db-sp"></span>' +
        '<button class="md-save">保存</button>' +
        "</div>" +
        '<div class="desc-body"><div class="md-editor" contenteditable="true" spellcheck="false">' + value + "</div></div>" +
        '<div class="desc-foot"><span class="df-tip"></span></div>';
    }

    function setTip(txt, bad) {
      var tipEl = descPanel.querySelector(".df-tip");
      if (tipEl) { tipEl.textContent = txt || ""; tipEl.className = "df-tip" + (bad ? " bad" : ""); }
    }

    function editor() { return descPanel.querySelector(".md-editor"); }
    function exec(cmd, val) {
      var ed = editor();
      if (!ed) return;
      ed.focus();
      document.execCommand(cmd, false, val);
      markDirty();
    }
    function execBlock(tag) { exec("formatBlock", "<" + tag + ">"); }
    function wrapSmall() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      var txt = sel.toString();
      exec("insertHTML", "<small>" + escHtml(txt) + "</small>");
    }
    function markDirty() { dirty = true; setTip("有未保存的修改"); }

    function uploadImage(file) {
      if (!file) return;
      var rd = new FileReader();
      rd.onload = function () {
        fetch("/api/desc/upload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: rd.result, name: file.name })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d.ok) { setTip(d.msg, true); return; }
          var ed = editor();
          if (ed) { ed.focus(); document.execCommand("insertImage", false, d.url); }
          setTip("插图已插入");
        });
      };
      rd.readAsDataURL(file);
    }

    function bindPanel() {
      descPanel.querySelector(".desc-close").onclick = closeDesc;
      descPanel.querySelectorAll("[data-md]").forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.md;
          if (k === "h1") execBlock("h2");
          else if (k === "h2") execBlock("h3");
          else if (k === "h3") execBlock("h4");
          else if (k === "p") execBlock("p");
          else if (k === "ol") exec("insertOrderedList");
          else if (k === "ul") exec("insertUnorderedList");
          else if (k === "b") exec("bold");
          else if (k === "i") exec("italic");
          else if (k === "quote") execBlock("blockquote");
          else if (k === "small") wrapSmall();
          else if (k === "hr") exec("insertHorizontalRule");
          else if (k === "clear") exec("removeFormat");
        };
      });

      var ed = editor();
      // 粘贴截图 / 拖入图片：上传后直接插成图片
      ed.addEventListener("paste", function (ev) {
        var items = (ev.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].type && items[i].type.indexOf("image") === 0) {
            ev.preventDefault();
            uploadImage(items[i].getAsFile());
            return;
          }
        }
      });
      ed.addEventListener("drop", function (ev) {
        var fs = (ev.dataTransfer || {}).files || [];
        if (fs.length && fs[0].type.indexOf("image") === 0) { ev.preventDefault(); uploadImage(fs[0]); }
      });
      ed.addEventListener("input", markDirty);

      descPanel.querySelector(".md-save").onclick = function () {
        fetch("/api/desc/save", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ module: cur.module, card_key: cur.card_key, title: cur.title, content: editor().innerHTML })
        }).then(function (r) { return r.json(); }).then(function (d) {
          dirty = false;
          setTip(d.msg, !d.ok);
        });
      };
    }

    function closeDesc() {
      descPanel.classList.remove("open");
      descPanel.innerHTML = "";
    }
    window.closeDesc = closeDesc;

    window.openDesc = function (module, cardKey, title, preset) {
      cur = { module: module, card_key: cardKey, title: title };
      fetch("/api/desc/get?module=" + encodeURIComponent(module) + "&card_key=" + encodeURIComponent(cardKey))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          // 已保存的用原内容；否则把预设 Markdown 渲染成可直接编辑的样式
          var val = (d.ok && d.exists && d.content) ? d.content : renderMd(preset || "");
          descPanel.innerHTML = panelHTML(title, module + " · " + cardKey, val);
          descPanel.classList.add("open");
          bindPanel();
          setTip(d.ok && d.exists ? "已保存版本" + (d.updated_at ? " · " + String(d.updated_at).slice(0, 19) : "") : "当前为预设内容，保存后生效");
          dirty = false;
        });
    };
  }

  /* ---------- iframe 内：给每个卡片 / KPI 注入悬浮「说明」按钮 ---------- */
  function injectDescBtns() {
    if (!document.body.classList.contains("embed")) return;
    if (document.querySelector(".desc-btn")) return;
    var u = new URL(location.href);
    var module = u.pathname + (u.searchParams.get("sub") ? "?sub=" + u.searchParams.get("sub") : "");

    function titleOf(el, sel, drop) {
      var t = el.querySelector(sel);
      if (!t) return "";
      var c = t.cloneNode(true);
      c.querySelectorAll(drop.join(",")).forEach(function (n) { n.remove(); });
      return (c.textContent || "").replace(/\s+/g, " ").trim();
    }
    function norm(s) { return String(s || "").replace(/\d+/g, "#").trim(); }

    var used = {};
    function keyFor(raw) {
      var base = norm(raw) || "未命名";
      if (!used[base]) { used[base] = 1; return base; }
      used[base] += 1;
      return base + "-" + used[base];
    }
    function add(el, title) {
      if (!title) return;
      var b = document.createElement("button");
      b.className = "desc-btn";
      b.type = "button";
      b.textContent = "说明";
      b.dataset.descModule = module;
      b.dataset.descKey = keyFor(title);
      b.dataset.descTitle = title;
      b.dataset.descPreset = (window.__DESC_PRESET || {})[norm(title)] || matchPreset(norm(title));
      b.title = "原型说明：" + title;
      // 按钮自身拦截，避免顺带触发卡片的点击行为（下钻 / 跳页）
      b.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var p = window.parent;
        if (p && p.openDesc) p.openDesc(b.dataset.descModule, b.dataset.descKey, b.dataset.descTitle, b.dataset.descPreset);
      });
      el.appendChild(b);
    }
    function matchPreset(nk) {
      var P = window.__DESC_PRESET || {};
      if (P[nk]) return P[nk];
      for (var k in P) { if (nk.indexOf(k) === 0 || nk.slice(-k.length) === k) return P[k]; }
      return "## 板块介绍\n" + nk + "。\n\n## 数据来源\n待补充（需与业务确认）\n\n## 计算方式\n待补充（需与业务确认）";
    }

    document.querySelectorAll(".card").forEach(function (c) {
      add(c, titleOf(c, "h3, h4", [".sub", ".alert-note", ".badge", ".tip", ".note", "form", "button", "select", "input", "script"]));
    });
    document.querySelectorAll(".kpi").forEach(function (k) {
      add(k, titleOf(k, ".l", [".tip", "script"]));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectDescBtns);
  else injectDescBtns();
  window.__injectDescBtns = injectDescBtns;
})();

/* ================= 页面级交互（embed 页） ================= */
function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toast(msg, isErr) {
  // iframe 内则挂到父窗口显示：子页面刷新后反馈不丢
  var inFrame = !!(window.parent && window.parent !== window);
  var host = inFrame ? window.parent.document : document;
  // 永远只显示一个：新的直接取代旧的，先清掉全部旧 toast
  host.body.querySelectorAll(".toast").forEach(function (t) { if (t.parentNode) t.parentNode.removeChild(t); });
  var el = host.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  host.body.appendChild(el);
  // 自动消失由 CSS 动画完成（1 秒），不依赖任何定时器——iframe 刷新也不会出现僵尸
  // 这里的 remove 只是顺手清理 DOM，即使不执行，元素也已不可见，且会被下一条 toast 清掉
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
}
function postJSON(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  }).then(function (r) { return r.json(); });
}
/* 轻量 modal：字段数组 → Promise(values|null) */
function openModal(opts) {
  return new Promise(function (resolve) {
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    var fields = (opts.fields || []).map(function (f) {
      return '<label>' + escHtml(f.label) +
        (f.type === "textarea" ? '<textarea data-f="' + f.key + '" rows="3"></textarea>' :
          '<input type="' + (f.type || "text") + '" data-f="' + f.key + '" value="' + (f.value || "") + '">') + '</label>';
    }).join("");
    mask.innerHTML = '<div class="modal-box"><div class="modal-t">' + escHtml(opts.title) + '</div>' +
      (opts.tip ? '<div class="modal-tip">' + escHtml(opts.tip) + '</div>' : "") + fields +
      '<div class="modal-btns"><button class="m-cancel">取消</button><button class="m-ok">确定</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector(".m-cancel").onclick = function () { mask.remove(); resolve(null); };
    mask.querySelector(".m-ok").onclick = function () {
      var vals = {};
      mask.querySelectorAll("[data-f]").forEach(function (inp) { vals[inp.dataset.f] = inp.value.trim(); });
      mask.remove();
      resolve(vals);
    };
    var first = mask.querySelector("input,textarea");
    if (first) first.focus();
  });
}
/* 操作后刷新当前 embed 页 */
function reloadSelf() {
  var f = window.frameElement;
  if (f) f.contentWindow.location.reload();
  else location.reload();
}

/* ---- 通用按钮委派：data-api + data-status + data-need + data-need-qty + data-act ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-api]");
  if (!btn) return;
  // 下拉 <select data-api> 走 change 委派，避免点开下拉时误触发 click（无 status → 非法状态）
  if (btn.tagName.toLowerCase() === "select") return;
  var api = btn.dataset.api, id = btn.dataset.id;
  var body = { id: Number(id) };
  if (btn.dataset.status) body.status = btn.dataset.status;
  if (btn.dataset.act) body.action = btn.dataset.act;
  var needNote = btn.dataset.need, needQty = btn.dataset.needQty;
  if (needQty) {
    openModal({ title: needQty, tip: "输入调整后的补货量", fields: [{ key: "qty", type: "number", label: "补货量" }] }).then(function (v) {
      if (!v || !v.qty) return;
      postJSON(api, { id: Number(id), action: "adjust", qty: Number(v.qty) }).then(function (d) {
        toast(d.ok ? (d.msg || "已调整") : d.msg, !d.ok);
        if (d.ok) reloadSelf();
      });
    });
    return;
  }
  if (needNote) {
    openModal({ title: needNote, fields: [{ key: "note", type: "textarea", label: needNote }] }).then(function (v) {
      if (!v || !v.note) { toast("已取消（该项必须填写）", true); return; }
      body.note = v.note;
      postJSON(api, body).then(function (d) {
        toast(d.ok ? (d.msg || "操作成功") : d.msg, !d.ok);
        if (d.ok) reloadSelf();
      });
    });
    return;
  }
  postJSON(api, body).then(function (d) {
    toast(d.ok ? (d.msg || "操作成功") : d.msg, !d.ok);
    if (d.ok) reloadSelf();
  });
});

/* ---- 评分下钻 ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-drill]");
  if (!btn) return;
  var panel = document.getElementById("drillPanel");
  if (!panel) return;
  if (panel.dataset.open === btn.dataset.drill) { panel.innerHTML = ""; panel.dataset.open = ""; return; }
  panel.innerHTML = '<div class="note" style="padding:14px">加载中…</div>';
  fetch("/api/score/detail?store_id=" + btn.dataset.drill).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { panel.innerHTML = '<div class="note" style="padding:14px">' + escHtml(d.msg) + "</div>"; return; }
    var html = '<div class="drill-head">' + escHtml(d.store.store_name) + " · " + escHtml(d.store.platform) +
      '<span class="note">二级指标与问题定位（分数 < 75 的指标标红）</span></div><div class="drill-grid">';
    d.dims.forEach(function (dim) {
      html += '<div class="drill-dim"><div class="dd-t">' + escHtml(dim.dim) + "</div>";
      dim.indicators.forEach(function (ind) {
        var bad = Number(ind.score) < 75;
        html += '<div class="dd-row' + (bad ? " bad" : "") + '"><span class="dd-n">' + escHtml(ind.indicator) +
          '<span class="dd-b">基准 ' + escHtml(ind.benchmark) + "</span></span><span class='dd-s'>" + Number(ind.score).toFixed(1) + "</span></div>";
        if (bad && ind.note) html += '<div class="dd-note">↳ ' + escHtml(ind.note) + "</div>";
      });
      html += "</div>";
    });
    panel.innerHTML = html + "</div>";
    panel.dataset.open = btn.dataset.drill;
  });
});

/* ---- 活动报名清单 ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-signup]");
  if (!btn) return;
  fetch("/api/activity/products?activity_id=" + btn.dataset.signup).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { toast(d.msg, true); return; }
    var list = d.products.map(function (p) {
      return '<label class="signup-item' + (p.match ? "" : " nomatch") + '">' +
        '<input type="checkbox" value="' + p.id + '" ' + (p.signed ? "disabled checked" : p.match ? "checked" : "") + ">" +
        "<span class='si-code'>" + escHtml(p.code69) + "</span>" +
        "<span class='si-name'>" + escHtml(p.name) + "</span>" +
        "<span class='si-stock'>可用库存 " + Number(p.stock) + "</span>" +
        (p.match ? "" : "<span class='si-warn'>不满足报名条件</span>") + "</label>";
    }).join("");
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML = '<div class="modal-box wide"><div class="modal-t">报名清单 · ' + escHtml(d.activity.name) + "</div>" +
      '<div class="modal-tip">已自动勾选满足条件的商品（有库存且已设底价），可手动调整</div>' +
      '<div class="signup-list">' + list + '</div>' +
      '<div class="modal-btns"><button class="m-cancel">取消</button><button class="m-ok">提交报名</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector(".m-cancel").onclick = function () { mask.remove(); };
    mask.querySelector(".m-ok").onclick = function () {
      var ids = [];
      mask.querySelectorAll("input[type=checkbox]:checked").forEach(function (cb) { ids.push(Number(cb.value)); });
      postJSON("/api/activity/signup", { activity_id: Number(btn.dataset.signup), product_ids: ids }).then(function (r) {
        mask.remove();
        toast(r.ok ? (r.msg || "已提交") : r.msg, !r.ok);
        if (r.ok) reloadSelf();
      });
    };
  });
});

/* ---- 页内 tab 切换（库存/看板/各页面分区通用） ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest(".tabs-inline .tab-btn");
  if (!btn) return;
  var scope = btn.closest("[data-tabs]");
  if (!scope) return;
  scope.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.toggle("active", b === btn); });
  scope.querySelectorAll(".tab-pane").forEach(function (p) {
    p.classList.toggle("active", p.id === btn.dataset.target);
  });
});

/* ---- 店铺经营看板：切换数据日期（保留 embed 参数） ---- */
document.addEventListener("submit", function (ev) {
  var form = ev.target.closest("form[data-board-date]");
  if (!form) return;
  ev.preventDefault();
  var v = form.querySelector("input[name=date]").value;
  if (!v) return;
  var p = new URLSearchParams(location.search.replace(/^\?/, ""));
  var bp = form.querySelector("input[name=board_period]");
  if (bp) p.set("board_period", bp.value);
  p.set("date", v);
  location.search = p.toString();
});

/* ---- 店铺经营看板：环比周期切换（日 / 周 / 月 / 年） ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-board-period]");
  if (!btn) return;
  var form = btn.closest("form[data-board-date]");
  var p = new URLSearchParams(location.search.replace(/^\?/, ""));
  var dateInp = form && form.querySelector("input[name=date]");
  if (dateInp && dateInp.value) p.set("date", dateInp.value);
  p.set("board_period", btn.dataset.boardPeriod);
  location.search = p.toString();
});

/* ---- 风控中心校验记录：状态筛选（全部 / 提醒中 / 已处理 / 已删除） ---- */
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-cf-filter]");
  if (!btn) return;
  var p = new URLSearchParams(location.search.replace(/^\?/, ""));
  p.set("sub", "check");
  p.set("cf_filter", btn.dataset.cfFilter);
  location.search = p.toString();
});

/* ---- 活动核算：平台 / 店铺筛选 ---- */
document.addEventListener("change", function (ev) {
  var sel = ev.target.closest("#actPlatform, #actStore, #actMode");
  if (!sel) return;
  var p = new URLSearchParams(location.search.replace(/^\?/, ""));
  p.set("sub", "calc");
  if (sel.id === "actPlatform") { p.set("act_platform", sel.value); p.delete("act_store"); }
  else if (sel.id === "actStore") { p.set("act_store", sel.value); }
  else { p.set("act_mode", sel.value); }
  location.search = p.toString();
});

/* ---- 活动核算：平台补贴价（活动价）点击查看近 30 天走势 ---- */
document.addEventListener("click", function (ev) {
  var el = ev.target.closest("[data-price-trend]");
  if (!el) return;
  var parts = el.dataset.priceTrend.split("|");
  var pid = parts[0], platform = parts[1];
  fetch("/api/activity/price-trend?product_id=" + encodeURIComponent(pid) + "&platform=" + encodeURIComponent(platform))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { toast(d.msg, true); return; }
      openChartModal("近 30 天平台补贴价（活动价）走势",
        "平台 × 商品维度，不区分店铺；演示合成走势，真实数据接入后替换").then(function (box) {
        if (!box) return;
        box.innerHTML = '<div class="chart-area">' + lineChartSVG(d.rows) + '</div>' +
          '<p class="note" style="padding:12px">当前基准价 ¥' + Number(d.base).toLocaleString("zh-CN", { minimumFractionDigits: 2 }) +
          '；数据为演示合成，待「活动成本按店」数据接入。</p>';
        enhanceChart(box);
      });
    });
});

/* ---- 健康度列表：每页条数切换 ---- */
document.addEventListener("change", function (ev) {
  var sel = ev.target.closest("select[data-page-size]");
  if (!sel) return;
  var p = new URLSearchParams(location.search.replace(/^\?/, ""));
  p.set("size", sel.value);
  p.set("page", "1");
  location.search = p.toString();
});

/* ---- 竞品勾选：控制对比列显示 ---- */
document.querySelectorAll(".cmp-toggle").forEach(function (cb) {
  cb.addEventListener("change", function () {
    var id = cb.dataset.cs;
    document.querySelectorAll('.cmp-col[data-cs="' + id + '"]').forEach(function (el) {
      el.style.display = cb.checked ? "" : "none";
    });
  });
});

/* ================= SVG 折线图（无外部依赖） ================= */
function lineChartSVG(rows, opt) {
  opt = opt || {};
  var W = 1160, H = opt.height || 260, PL = 64, PR = 16, PT = 14, PB = 26;
  var vals = rows.map(function (r) { return Number(r.amount) || 0; });
  if (!vals.length) return '<div class="note" style="padding:20px;text-align:center">所选区间无数据</div>';
  var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
  if (mx === mn) { mx += 1; mn -= 1; }
  var pad = (mx - mn) * 0.12; mx += pad; mn = Math.max(0, mn - pad);
  var iw = W - PL - PR, ih = H - PT - PB;
  var x = function (i) { return PL + (vals.length === 1 ? iw / 2 : i / (vals.length - 1) * iw); };
  var y = function (v) { return PT + ih - (v - mn) / (mx - mn) * ih; };
  var grid = "", ticks = 4;
  for (var g = 0; g <= ticks; g++) {
    var gv = mn + (mx - mn) * g / ticks, gy = y(gv);
    grid += '<line x1="' + PL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + gy.toFixed(1) + '" stroke="#EDF1EE"/>' +
      '<text x="' + (PL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10.5" fill="#8A9A90">' +
      (gv >= 10000 ? (gv / 10000).toFixed(1) + "万" : gv.toFixed(0)) + "</text>";
  }
  var pts = rows.map(function (r, i) { return x(i).toFixed(1) + "," + y(Number(r.amount)).toFixed(1); }).join(" ");
  var dots = rows.map(function (r, i) {
    return '<circle class="cpt" cx="' + x(i).toFixed(1) + '" cy="' + y(Number(r.amount)).toFixed(1) +
      '" r="3.5" fill="#157347" data-d="' + escHtml(r.date) + '" data-v="' + Number(r.amount).toFixed(2) + '"></circle>';
  }).join("");
  var labels = rows.map(function (r, i) {
    var every = Math.ceil(rows.length / 7);
    if (i % every !== 0 && i !== rows.length - 1) return "";
    return '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10.5" fill="#8A9A90">' + escHtml(r.date.slice(5)) + "</text>";
  }).join("");
  var total = vals.reduce(function (a, b) { return a + b; }, 0);
  return '<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '">' +
    grid + '<polyline points="' + pts + '" fill="none" stroke="#157347" stroke-width="2" stroke-linejoin="round"/>' +
    '<line class="chart-cross" x1="0" y1="' + PT + '" x2="0" y2="' + (H - PB) + '" stroke="#9CCBB2" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>' +
    dots + labels + "</svg>" +
    '<div class="chart-tip" style="display:none"></div></div>' +
    '<div class="note" style="text-align:center; margin-top:14px">区间合计 ¥' + total.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) +
    " · 共 " + rows.length + " 天 · 鼠标移到图上即时显示当日金额</div>";
}
/* 悬停跟随：鼠标移动即找最近数据点，显示竖线 + 数值框 */
function enhanceChart(container) {
  (container || document).querySelectorAll(".chart-wrap").forEach(function (wrap) {
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = "1";
    var svg = wrap.querySelector("svg"), tip = wrap.querySelector(".chart-tip"),
        cross = wrap.querySelector(".chart-cross"), pts = wrap.querySelectorAll(".cpt");
    if (!svg || !pts.length) return;
    function onMove(ev) {
      var rect = svg.getBoundingClientRect();
      var vb = svg.getAttribute("viewBox").split(" ");
      var VW = parseFloat(vb[2]) || 1160, VH = parseFloat(vb[3]) || 260;
      var vx = (ev.clientX - rect.left) / rect.width * VW; // 视图坐标
      var best = null, bd = 1e9;
      pts.forEach(function (p) {
        var d = Math.abs(parseFloat(p.getAttribute("cx")) - vx);
        if (d < bd) { bd = d; best = p; }
      });
      if (!best) return;
      var cx = parseFloat(best.getAttribute("cx")), cy = parseFloat(best.getAttribute("cy"));
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
      cross.setAttribute("visibility", "visible");
      tip.style.display = "block";
      tip.innerHTML = "<b>" + best.dataset.d + "</b> ¥" + Number(best.dataset.v).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
      // 数值框定位（视图坐标 → 像素），靠右时往左偏
      var px = cx / VW * rect.width, py = cy / VH * rect.height;
      var flip = px > rect.width - 130;
      tip.style.left = (flip ? px - tip.offsetWidth - 12 : px + 12) + "px";
      tip.style.top = Math.max(0, py - 14) + "px";
    }
    function onLeave() {
      tip.style.display = "none";
      cross.setAttribute("visibility", "hidden");
    }
    svg.addEventListener("mousemove", onMove);
    svg.addEventListener("mouseleave", onLeave);
  });
}
function openChartModal(title, tipText, size) {
  return new Promise(function (resolve) {
    var mask = document.createElement("div");
    mask.className = "modal-mask";
    mask.innerHTML = '<div class="modal-box wide ' + (size || "") + '"><div class="modal-t">' + escHtml(title) + "</div>" +
      (tipText ? '<div class="modal-tip">' + escHtml(tipText) + "</div>" : "") +
      '<div class="chart-body"></div>' +
      '<div class="modal-btns"><button class="m-cancel">关闭</button></div></div>';
    document.body.appendChild(mask);
    mask.querySelector(".m-cancel").onclick = function () { mask.remove(); resolve(null); };
    resolve(mask.querySelector(".chart-body"));
  });
}

/* ---- KPI 点击：交易趋势（平台/店铺/时间区间筛选） ---- */
document.addEventListener("click", function (ev) {
  var el = ev.target.closest("[data-trend]");
  if (!el) return;
  var mode = el.dataset.trend; // month | week
  var today = new Date();
  var ymd = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var sub = function (d, n) { var x = new Date(d); x.setDate(x.getDate() - n); return x; };
  var from = mode === "month" ? ymd(new Date(today.getFullYear(), today.getMonth(), 1)) : ymd(sub(today, 6));
  var to = ymd(today);
  openChartModal("交易趋势", "选择平台 / 店铺 / 时间区间后自动刷新；数据为各店每日上报口径").then(function (body) {
    if (!body) return;
    fetch("/api/stores").then(function (r) { return r.json(); }).then(function (sd) {
      var pfOpts = ["全部", "京东", "美团", "天猫", "拼多多"].map(function (p) { return '<option>' + p + "</option>"; }).join("");
      var stOpts = sd.stores.map(function (s) { return '<option value="' + s.id + '">' + escHtml(s.store_name) + "（" + escHtml(s.platform) + "）</option>"; }).join("");
      body.innerHTML = '<div class="chart-filter">' +
        '<label>平台 <select data-f="platform">' + pfOpts + "</select></label>" +
        '<label>店铺 <select data-f="store_id"><option value="">全部店铺</option>' + stOpts + "</select></label>" +
        "<label>从 <input type=\"date\" data-f=\"from\" value=\"" + from + "\"></label>" +
        "<label>到 <input type=\"date\" data-f=\"to\" value=\"" + to + "\"></label></div>" +
        '<div class="chart-area"><div class="note" style="padding:20px;text-align:center">加载中…</div></div>';
      var area = body.querySelector(".chart-area");
      var platform = body.querySelector('[data-f="platform"]'), store = body.querySelector('[data-f="store_id"]');
      var fi = body.querySelector('[data-f="from"]'), ti = body.querySelector('[data-f="to"]');
      function load() {
        var u = "/api/trend?from=" + fi.value + "&to=" + ti.value;
        if (platform.value !== "全部") u += "&platform=" + encodeURIComponent(platform.value);
        if (store.value) u += "&store_id=" + store.value;
        area.innerHTML = '<div class="note" style="padding:20px;text-align:center">加载中…</div>';
        fetch(u).then(function (r) { return r.json(); }).then(function (d) {
          area.innerHTML = d.ok ? lineChartSVG(d.rows) : '<div class="note" style="padding:20px">' + escHtml(d.msg) + "</div>";
          if (d.ok) enhanceChart(area);
        });
      }
      platform.onchange = function () { store.value = ""; load(); };
      store.onchange = load; fi.onchange = load; ti.onchange = load;
      load();
    });
  });
});

/* ---- KPI 点击：待闭环事项明细（分组 + 跳转处理页） ---- */
document.addEventListener("click", function (ev) {
  var el = ev.target.closest("[data-pending]");
  if (!el) return;
  fetch("/api/pending").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { toast(d.msg, true); return; }
    var total = d.groups.reduce(function (a, g) { return a + g.items.length; }, 0);
    var body = d.groups.map(function (g) {
      return '<div class="pg-title">' + escHtml(g.name) + '<span class="pg-cnt">' + g.items.length + "</span>" +
        '<button class="link-btn pg-goto" data-page="' + g.page + '">去处理</button></div>' +
        g.items.map(function (it) {
          return '<div class="pg-item"><span class="pg-t">' + escHtml(it.text) + "</span><span class='pg-e'>" + escHtml(it.extra || "") + "</span></div>";
        }).join("");
    }).join("");
    openChartModal("待闭环事项明细（共 " + total + " 项）", "点击「去处理」跳到对应页面处理；处理完成后本列表自动减少").then(function (box) {
      if (!box) return;
      box.innerHTML = '<div class="pending-list">' + (body || '<div class="note" style="padding:16px">暂无待闭环事项</div>') + "</div>";
      box.querySelectorAll(".pg-goto").forEach(function (b) {
        b.onclick = function () {
          var page = b.dataset.page;
          var p = window.parent;
          if (p && p.openTab) {
            p.openTab(page, (p.__TITLES || {})[page] || page);
            var mask = b.closest(".modal-mask");
            if (mask) mask.remove();
          }
        };
      });
    });
  });
});

/* ---- 店铺卡：趋势（支持时间区间）+ 指定日期明细 ---- */
document.addEventListener("click", function (ev) {
  var el = ev.target.closest(".store-detail");
  if (!el) return;
  var sid = el.dataset.id;
  fetch("/api/trend?store_id=" + sid + "&days=30").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { toast(d.msg, true); return; }
    var rows = d.rows || [];
    var last = rows.length ? rows[rows.length - 1].date : "";
    var first = rows.length ? rows[0].date : "";
    openChartModal("店铺经营详情", "", "lg").then(function (box) {
      if (!box) return;
      // 给弹窗本身加一个「说明」按钮：锚定到 modal 右上角，复用父窗口说明抽屉
      var mb = box.closest(".modal-box");
      if (mb) {
        mb.style.position = "relative";
        var db = document.createElement("button");
        db.type = "button";
        db.className = "desc-btn";
        db.textContent = "说明";
        db.title = "原型说明：店铺经营详情";
        db.addEventListener("click", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var p = window.parent;
          if (p && p.openDesc) p.openDesc("/analysis", "店铺经营详情", "店铺经营详情",
            "## 板块介绍\n点交易分析表中任意店铺名弹出。上方折线图为该店每日交易额趋势（默认近 30 日，可改时间区间）；下方「日经营明细」选择查看日期，展示该日经营指标。\n\n" +
            "## 数据来源\n各平台店铺每日爬虫快照（京东 / 美团 / 天猫 / 拼多多），交易额取平台后台「昨日交易额」口径。\n\n" +
            "## 计算方式\n环比为同日对比：日环比=较前一日、7日环比=较 7 天前、30日环比=较 30 天前，任一日缺失即显示 —；动销率=有动销商品数/经营商品数；非替尔泊肽占比=非替尔泊肽类商品交易额占比。");
        });
        mb.appendChild(db);
      }
      box.innerHTML =
        '<div class="chart-filter"><label>从 <input type="date" data-f="from" value="' + first + '"></label>' +
        '<label>到 <input type="date" data-f="to" value="' + last + '"></label></div>' +
        '<div class="chart-area" data-chart><div class="note" style="padding:16px">加载中…</div></div>' +
        '<div class="day-title">日经营明细</div>' +
        '<div class="day-pick"><span class="dp-label">查看日期</span><input type="date" data-f="d" value="' + last + '" max="' + last + '"></div>' +
        '<div class="day-area"><div class="note" style="padding:16px">加载中…</div></div>';
      var chartArea = box.querySelector("[data-chart]");
      var dayArea = box.querySelector(".day-area");
      var fromInp = box.querySelector('[data-f="from"]');
      var toInp = box.querySelector('[data-f="to"]');
      var dateInp = box.querySelector('[data-f="d"]');
      var money = function (x) { return "¥" + Number(x).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
      var pctTxt = function (x) { return x == null ? "—" : (x >= 0 ? "+" : "") + Number(x).toFixed(1) + "%"; };
      function loadTrend() {
        chartArea.innerHTML = '<div class="note" style="padding:16px">加载中…</div>';
        var u = "/api/trend?store_id=" + sid + "&from=" + fromInp.value + "&to=" + toInp.value;
        fetch(u).then(function (r) { return r.json(); }).then(function (td) {
          chartArea.innerHTML = td.ok ? lineChartSVG(td.rows) : '<div class="note" style="padding:16px">' + escHtml(td.msg) + "</div>";
          if (td.ok && window.enhanceChart) enhanceChart(chartArea);
        });
      }
      function loadDay() {
        dayArea.innerHTML = '<div class="note" style="padding:16px">加载中…</div>';
        fetch("/api/store/day?store_id=" + sid + "&date=" + dateInp.value).then(function (r) { return r.json(); }).then(function (dd) {
          if (!dd.ok) { dayArea.innerHTML = '<div class="note" style="padding:16px">' + escHtml(dd.msg) + "</div>"; return; }
          var v = dd.day, ra = dd.ratios || {};
          var moneyOr = function (x) { return x == null ? "—" : money(x); };
          var pctOr = function (x) { return x == null ? "—" : Number(x).toFixed(1) + "%"; };
          dayArea.innerHTML = '<div class="day-grid">' +
            '<div class="kpi"><div class="l">昨日交易额</div><div class="v">' + moneyOr(v.昨日交易额) + "</div></div>" +
            '<div class="kpi"><div class="l">近30天交易额</div><div class="v">' + moneyOr(v.近30天交易额) + "</div></div>" +
            '<div class="kpi"><div class="l">日环比</div><div class="v">' + pctTxt(ra.day) + "</div></div>" +
            '<div class="kpi"><div class="l">7日环比</div><div class="v">' + pctTxt(ra.week) + "</div></div>" +
            '<div class="kpi"><div class="l">30日环比</div><div class="v">' + pctTxt(ra.m30) + "</div></div>" +
            '<div class="kpi"><div class="l">动销率</div><div class="v">' + pctOr(v.商品动销率 == null ? null : Number(v.商品动销率) * 100) + "</div></div>" +
            '<div class="kpi"><div class="l">非替尔泊肽占比</div><div class="v">' + pctOr(v.非替尔泊肽销售金额占比 == null ? null : Number(v.非替尔泊肽销售金额占比) * 100) + "</div></div>" +
            '<div class="kpi"><div class="l">经营商品数</div><div class="v">' + (v.经营商品数量 == null ? "—" : Number(v.经营商品数量)) + "</div></div>" +
            '<div class="kpi"><div class="l">数据更新</div><div class="v" style="font-size:14px">' + escHtml(String(v.修改日期 || "—").slice(0, 19)) + "</div></div>" +
            "</div>";
        });
      }
      fromInp.onchange = loadTrend; toInp.onchange = loadTrend; dateInp.onchange = loadDay;
      loadTrend(); loadDay();
    });
  });
});

/* ---- 售后状态下拉：可逆切换，即时生效 ---- */
document.addEventListener("change", function (ev) {
  var sel = ev.target.closest("select.st-select");
  if (!sel) return;
  postJSON(sel.dataset.api, { id: Number(sel.dataset.id), status: sel.value }).then(function (d) {
    toast(d.ok ? (d.msg || "状态已更新") : d.msg, !d.ok);
    if (d.ok) reloadSelf();
    else { /* 失败时恢复原值：刷新即可 */ reloadSelf(); }
  });
});

/* ---- SOP 清单勾选（真实写库，可取消） ---- */
document.addEventListener("click", function (ev) {
  var box = ev.target.closest(".check-li .box");
  if (!box) return;
  var done = box.dataset.done === "1";
  postJSON("/api/sop/toggle", { id: Number(box.dataset.sop), done: !done }).then(function (d) {
    toast(d.ok ? (d.msg || "已更新") : d.msg, !d.ok);
    if (d.ok) reloadSelf();
  });
});

/* ---- data-goto：iframe 内跳转到其他页签 ---- */
document.addEventListener("click", function (ev) {
  var el = ev.target.closest("[data-goto]");
  if (!el) return;
  var page = el.dataset.goto;
  var p = window.parent;
  if (p && p.openTab) p.openTab(page, el.dataset.title || (p.__TITLES || {})[page] || page);
});

/* ---- 菜单管理：调整层级与顺序（列表即时刷新 + 父窗口侧栏热更新） ---- */
function refreshMenuList() {
  fetch("/api/menu/html").then(function (r) { return r.text(); }).then(function (html) {
    var box = document.getElementById("menuList");
    if (box) box.innerHTML = html;
    if (window.parent && window.parent.refreshSidebar) window.parent.refreshSidebar();
  });
}
document.addEventListener("click", function (ev) {
  var btn = ev.target.closest("[data-m]");
  if (!btn) return;
  var id = btn.dataset.id, action = btn.dataset.m;
  if (action === "del") {
    if (!confirm("确定删除该菜单及其下级？")) return;
    postJSON("/api/menu/del", { id: Number(id) }).then(function (d) { toast(d.ok ? d.msg : d.msg, !d.ok); if (d.ok) refreshMenuList(); });
    return;
  }
  if (action === "up" || action === "down") {
    postJSON("/api/menu/reorder", { id: Number(id), dir: action }).then(function (d) { toast(d.ok ? d.msg : d.msg, !d.ok); if (d.ok) refreshMenuList(); });
    return;
  }
  if (action === "indent" || action === "outdent") {
    postJSON("/api/menu/" + action, { id: Number(id) }).then(function (d) { toast(d.ok ? d.msg : d.msg, !d.ok); if (d.ok) refreshMenuList(); });
    return;
  }
});
document.addEventListener("change", function (ev) {
  var cb = ev.target.closest("input[data-m='mvp'], input[data-m='enabled']");
  if (!cb) return;
  var id = cb.dataset.id, val = cb.checked;
  var api = cb.dataset.m === "mvp" ? "/api/menu/mvp" : "/api/menu/enabled";
  postJSON(api, { id: Number(id), val: val }).then(function (d) { toast(d.ok ? d.msg : d.msg, !d.ok); if (d.ok) refreshMenuList(); });
});
document.addEventListener("change", function (ev) {
  var ti = ev.target.closest("input[data-m='title']");
  if (!ti) return;
  if (ti.dataset.dirty === "1") return; // 避免回显触发
  postJSON("/api/menu/title", { id: Number(ti.dataset.id), title: ti.value }).then(function (d) {
    toast(d.ok ? d.msg : d.msg, !d.ok);
    if (d.ok) { ti.dataset.dirty = "1"; ti.value = ti.value; }
    else refreshMenuList();
  });
});
document.addEventListener("click", function (ev) {
  var b = ev.target.closest("[data-menu-add]");
  if (!b) return;
  postJSON("/api/menu/add", { parent_id: 0 }).then(function (d) { if (d.ok) refreshMenuList(); else toast(d.msg, true); });
});

/* ---- 商品主数据：禁售区域（省级黑名单）弹窗设置：按大区分组，高亮边框代表选中 ---- */
var PROV_GROUPS = [
  { n: "华北", p: ["北京", "天津", "河北", "山西", "内蒙古"] },
  { n: "东北", p: ["辽宁", "吉林", "黑龙江"] },
  { n: "华东", p: ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"] },
  { n: "华中", p: ["河南", "湖北", "湖南"] },
  { n: "华南", p: ["广东", "广西", "海南"] },
  { n: "西南", p: ["重庆", "四川", "贵州", "云南", "西藏"] },
  { n: "西北", p: ["陕西", "甘肃", "青海", "宁夏", "新疆"] },
  { n: "港澳台", p: ["中国台湾", "中国香港", "中国澳门"] }
];
var ALL_PROV = PROV_GROUPS.reduce(function (a, g) { return a.concat(g.p); }, []);
function openProvinceEditor(pid, current) {
  var cur = (current || "").split(",").filter(Boolean);
  var groups = PROV_GROUPS.map(function (g) {
    var allOn = g.p.every(function (p) { return cur.indexOf(p) > -1; });
    return '<div class="prov-group"><div class="pg-h"><b>' + g.n + '</b>' +
      '<button type="button" class="pg-all" data-g="' + escHtml(g.n) + '">' + (allOn ? "取消本区" : "全选本区") + "</button></div>" +
      '<div class="pg-body">' + g.p.map(function (p) {
        return '<span class="prov' + (cur.indexOf(p) > -1 ? " on" : "") + '" data-p="' + p + '">' + p + "</span>";
      }).join("") + "</div></div>";
  }).join("");
  var mask = document.createElement("div");
  mask.className = "modal-mask";
  mask.innerHTML = '<div class="modal-box wide"><div class="modal-t">设置禁售区域（省级黑名单）</div>' +
    '<div class="modal-tip">点省份即选中（高亮边框 = 已禁售），再点取消；不选中 = 全国可售。</div>' +
    '<div class="prov-wrap">' + groups + "</div>" +
    '<div class="modal-btns"><span class="pv-count">已选 0 个省</span><span class="sp"></span>' +
    '<button class="m-none">清空</button><button class="m-cancel">取消</button><button class="m-ok">保存</button></div></div>';
  document.body.appendChild(mask);
  function curCount() { return mask.querySelectorAll(".prov.on").length; }
  function syncCount() {
    var c = curCount();
    var el = mask.querySelector(".pv-count");
    if (el) el.textContent = "已选 " + c + " 个省";
    mask.querySelectorAll(".pg-all").forEach(function (b) {
      var grp = b.closest(".prov-group");
      var all = Array.prototype.slice.call(grp.querySelectorAll(".prov"));
      b.textContent = all.every(function (x) { return x.classList.contains("on"); }) ? "取消本区" : "全选本区";
    });
  }
  syncCount();
  // 省份点击切换选中
  mask.querySelector(".prov-wrap").addEventListener("click", function (e) {
    var pv = e.target.closest(".prov");
    if (!pv) return;
    pv.classList.toggle("on");
    syncCount();
  });
  mask.querySelectorAll(".pg-all").forEach(function (b) {
    b.onclick = function (e) {
      e.stopPropagation();
      var all = Array.prototype.slice.call(b.closest(".prov-group").querySelectorAll(".prov"));
      var turnOn = !all.every(function (x) { return x.classList.contains("on"); });
      all.forEach(function (x) { x.classList.toggle("on", turnOn); });
      syncCount();
    };
  });
  mask.querySelector(".m-none").onclick = function () {
    mask.querySelectorAll(".prov.on").forEach(function (x) { x.classList.remove("on"); });
    syncCount();
  };
  mask.querySelector(".m-cancel").onclick = function () { mask.remove(); };
  mask.querySelector(".m-ok").onclick = function () {
    var sel = [];
    mask.querySelectorAll(".prov.on").forEach(function (x) { sel.push(x.dataset.p); });
    postJSON("/api/product/ban", { id: Number(pid), ban: sel }).then(function (d) {
      mask.remove();
      toast(d.ok ? d.msg : d.msg, !d.ok);
      if (d.ok && d.ban !== undefined) {
        var cell = document.querySelector('.ban-cell[data-pid="' + pid + '"]');
        if (cell) {
          cell.dataset.ban = d.ban;
          cell.querySelector(".ban-tags").innerHTML = d.ban
            ? d.ban.split(",").map(function (b) { return '<span class="tag-ban">' + escHtml(b) + "</span>"; }).join("")
            : '<span class="muted">—</span>';
        }
      }
    });
  };
}
document.addEventListener("click", function (ev) {
  var b = ev.target.closest(".ban-edit");
  if (!b) return;
  var pid = b.dataset.pid;
  var cell = document.querySelector('.ban-cell[data-pid="' + pid + '"]');
  openProvinceEditor(pid, cell ? cell.dataset.ban : "");
});

/* ---- 活动前测算器 ---- */
(function () {
  var price = document.getElementById("ci-price");
  if (!price) return;
  var ids = ["ci-purchase", "ci-express", "ci-price", "ci-logistics", "ci-subsidy", "ci-rate", "ci-floor", "ci-qty"];
  var val = function (i) { var el = document.getElementById(i); return el ? Number(el.value) || 0 : 0; };
  var out = document.getElementById("calcOut");
  function render() {
    if (ids.some(function(i) { return !document.getElementById(i).value.trim(); })) {
      out.innerHTML = '<div class="empty-tip">未接入</div>'; return;
    }
    var purchase = val("ci-purchase"), express = val("ci-express"), sale = val("ci-price");
    var logi = val("ci-logistics"), subsidy = val("ci-subsidy"), rate = val("ci-rate");
    var floor = val("ci-floor"), qty = val("ci-qty");
    var totalCost = purchase + express;
    var orig = sale + logi;                                   // 订单原始应收
    var recvBase = orig;                                      // 应收基数（无活动支出时）
    var tech = recvBase * rate / 100;
    var income = recvBase - tech;
    var profit = income - totalCost;
    var margin = sale > 0 ? profit / sale * 100 : 0;
    var totalProfit = profit * qty;
    var roi = totalCost > 0 ? totalProfit / (totalCost * qty) * 100 : 0;
    var belowFloor = sale < floor;
    var row = function (l, v, cls) { return '<div class="co ' + (cls || "") + '"><span>' + l + '</span><b>' + v + "</b></div>"; };
    out.innerHTML =
      row("商品总成本", totalCost.toFixed(2) + " 元") +
      row("订单原始应收", orig.toFixed(2) + " 元") +
      row("技术服务费", tech.toFixed(2) + " 元") +
      row("预计商家收入", income.toFixed(2) + " 元") +
      row("单件毛利", profit.toFixed(2) + " 元", profit < 0 ? "bad" : "good") +
      row("毛利率", margin.toFixed(1) + "%", margin < 3 ? "bad" : "good") +
      row("总毛利（" + qty + " 件）", totalProfit.toFixed(2) + " 元", totalProfit < 0 ? "bad" : "good") +
      row("ROI", roi.toFixed(1) + "%", roi < 20 ? "bad" : "good") +
      (belowFloor ? '<div class="co floor-alert">⚠ 定价 ' + sale.toFixed(2) + " 元已击穿底价红线 " + floor.toFixed(2) + " 元，试算预警，请人工核验</div>" : "") +
      (subsidy > sale ? '<div class="co floor-alert">⚠ 平台补贴价 ' + subsidy.toFixed(2) + " 元高于定价 " + sale.toFixed(2) + " 元，请核对</div>" : "");
  }
  ids.forEach(function (i) {
    var el = document.getElementById(i);
    if (el) el.addEventListener("input", render);
  });
  render();
})();

/* ---- 表格数值列排序（点击表头 正序/倒序 切换） ---- */
document.addEventListener("click", function (ev) {
  var th = ev.target.closest("th.sortable");
  if (!th) return;
  var table = th.closest("table");
  if (!table) return;
  var col = Number(th.dataset.col);
  var tbody = table.querySelector("tbody");
  var rows = Array.prototype.slice.call(tbody.querySelectorAll("tr"));
  var cur = th.getAttribute("data-dir");
  var dir = cur === "asc" ? "desc" : "asc"; // 每次点击切换；首次默认升序
  table.querySelectorAll("th.sortable").forEach(function (h) {
    if (h !== th) h.removeAttribute("data-dir");
  });
  th.setAttribute("data-dir", dir);
  var parse = function (cell) {
    var txt = (cell.textContent || "").replace(/[¥,\s]/g, "");
    var m = txt.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  };
  rows.sort(function (a, b) {
    var va = parse(a.children[col]), vb = parse(b.children[col]);
    if (isNaN(va) && isNaN(vb)) return 0;
    if (isNaN(va)) return 1;
    if (isNaN(vb)) return -1;
    return dir === "asc" ? va - vb : vb - va;
  });
  rows.forEach(function (r) { tbody.appendChild(r); });
});

/* ---- 交易分析：数据日期筛选（置于平台 tab 之上，切换即重载该日快照） ---- */
document.addEventListener("change", function (ev) {
  var el = ev.target.closest('form[data-az-date] input[name="date"]');
  if (!el) return;
  var sp = new URLSearchParams(location.search);
  sp.set("date", el.value);
  if (!sp.has("embed")) sp.set("embed", "1");
  location.search = sp.toString();
});
