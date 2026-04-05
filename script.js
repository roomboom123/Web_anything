(function () {
  "use strict";

  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBJD5-euVt9RWJiXIRbWyPo9d_cIeeESMo",
    authDomain: "webanything-466f5.firebaseapp.com",
    databaseURL: "https://webanything-466f5-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "webanything-466f5",
    storageBucket: "webanything-466f5.firebasestorage.app",
    messagingSenderId: "60644884106",
    appId: "1:60644884106:web:fa2497dc1854b67ea1b773"
  };

  var BOARD_PATH = "travel_checklist_compact_v1";
  var LEGACY_CHECKLIST_PATH = "checklist";
  var LEGACY_CUSTOM_PATH = "custom";
  var CACHE_KEY = "travel_checklist_compact_cache_v1";
  var PREFS_KEY = "travel_checklist_compact_prefs_v1";
  var ALL_CATEGORY_ID = "all";
  var DEFAULT_BOARD_TITLE = "제주 체크리스트";

  var CUSTOM_CATEGORY_DEFS = [
    { id: "custom_baby", name: "아기 | 직접 추가" },
    { id: "custom_mom", name: "엄마 | 직접 추가" },
    { id: "custom_dad", name: "아빠 | 직접 추가" },
    { id: "custom_shared", name: "공용 | 직접 추가" }
  ];

  var LEGACY_CATEGORY_BLUEPRINT = [];

  var state = {
    board: null,
    prefs: loadPrefs(),
    dbReady: false,
    boardRef: null,
    legacyChecklistRef: null,
    legacyCustomRef: null,
    boardListenerAttached: false,
    isConnected: false,
    isSyncing: false,
    pendingSync: false,
    remoteLoaded: false,
    editor: {
      open: false,
      mode: "create",
      categoryId: "",
      itemId: "",
      draft: null
    },
    printSnapshot: null
  };

  var els = {};

  init();

  function init() {
    cacheElements();
    state.board = loadCachedBoard() || createFallbackBoard();
    normalizePrefs();
    bindEvents();
    render();
    initFirebase();
  }

  function cacheElements() {
    els.appShell = document.getElementById("appShell");
    els.pageTitle = document.getElementById("pageTitle");
    els.syncBadge = document.getElementById("syncBadge");
    els.overallDone = document.getElementById("overallDone");
    els.overallPct = document.getElementById("overallPct");
    els.searchInput = document.getElementById("searchInput");
    els.hideCheckedToggle = document.getElementById("hideCheckedToggle");
    els.categoryTabs = document.getElementById("categoryTabs");
    els.visibleSummary = document.getElementById("visibleSummary");
    els.visibleHint = document.getElementById("visibleHint");
    els.clearSearchButton = document.getElementById("clearSearchButton");
    els.categoryList = document.getElementById("categoryList");
    els.editorPanel = document.getElementById("editorPanel");
    els.editorTitle = document.getElementById("editorTitle");
    els.editorHint = document.getElementById("editorHint");
    els.itemForm = document.getElementById("itemForm");
    els.itemCategory = document.getElementById("itemCategory");
    els.itemName = document.getElementById("itemName");
    els.itemMemo = document.getElementById("itemMemo");
    els.itemQty = document.getElementById("itemQty");
    els.itemTag = document.getElementById("itemTag");
    els.itemChecked = document.getElementById("itemChecked");
    els.deleteItemButton = document.getElementById("deleteItemButton");
  }

  function bindEvents() {
    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("input", onInput);
    els.itemForm.addEventListener("submit", onSubmitItem);
    window.addEventListener("beforeprint", preparePrint);
    window.addEventListener("afterprint", restorePrintState);
  }

  function initFirebase() {
    if (typeof firebase === "undefined") {
      setSyncState("offline", "파이어베이스를 불러오지 못했어요. 이 브라우저에만 저장됩니다.");
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      var db = firebase.database();
      state.boardRef = db.ref(BOARD_PATH);
      state.legacyChecklistRef = db.ref(LEGACY_CHECKLIST_PATH);
      state.legacyCustomRef = db.ref(LEGACY_CUSTOM_PATH);
      state.dbReady = true;

      db.ref(".info/connected").on("value", function (snapshot) {
        state.isConnected = snapshot.val() === true;
        if (state.isConnected) {
          if (state.pendingSync) {
            syncBoard("reconnect");
          } else if (!state.remoteLoaded) {
            setSyncState("syncing", "파이어베이스에 연결 중...");
          } else {
            setSyncState("synced", getSyncedLabel(state.board.updatedAt));
          }
        } else {
          setSyncState(
            state.remoteLoaded ? "offline" : "syncing",
            state.remoteLoaded
              ? "오프라인 상태예요. 변경 내용은 이 브라우저에 임시 보관됩니다."
              : "파이어베이스에 연결 중..."
          );
        }
      });

      loadRemoteData();
    } catch (error) {
      console.error(error);
      setSyncState("offline", "파이어베이스 초기화에 실패했어요. 로컬 캐시로만 동작합니다.");
    }
  }

  function loadRemoteData() {
    setSyncState("syncing", "기존 기록을 확인하는 중...");

    Promise.all([
      state.boardRef.once("value"),
      state.legacyChecklistRef.once("value"),
      state.legacyCustomRef.once("value")
    ]).then(function (snapshots) {
      var compactBoard = sanitizeBoard(snapshots[0].val());
      var legacyBoard = buildLegacyBoard(snapshots[1].val(), snapshots[2].val());

      state.pendingSync = false;

      if (shouldUseLegacyBoard(compactBoard, legacyBoard)) {
        state.board = legacyBoard;
        state.pendingSync = true;
      } else if (compactBoard) {
        state.board = compactBoard;
      } else {
        state.board = createFallbackBoard();
        state.pendingSync = true;
      }

      state.remoteLoaded = true;
      saveCachedBoard(state.board);
      normalizePrefs();
      attachBoardListener();
      render();

      if (state.pendingSync) {
        syncBoard("initial-load");
      } else {
        setSyncState(state.isConnected ? "synced" : "offline", getSyncedLabel(state.board.updatedAt));
      }
    }).catch(function (error) {
      console.error(error);
      state.remoteLoaded = true;
      attachBoardListener();
      render();
      setSyncState("offline", "기존 기록을 읽지 못했어요. 로컬 캐시를 보여주는 중입니다.");
    });
  }

  function attachBoardListener() {
    if (state.boardListenerAttached || !state.boardRef) return;
    state.boardListenerAttached = true;

    state.boardRef.on("value", function (snapshot) {
      var remote = sanitizeBoard(snapshot.val());
      if (!remote) {
        if (state.remoteLoaded && !state.pendingSync) {
          state.pendingSync = true;
          syncBoard("seed");
        }
        return;
      }

      var localUpdatedAt = Number(state.board.updatedAt || 0);
      var remoteUpdatedAt = Number(remote.updatedAt || 0);

      if (state.pendingSync && localUpdatedAt > remoteUpdatedAt) {
        syncBoard("keep-local");
        return;
      }

      state.remoteLoaded = true;
      state.board = remote;
      saveCachedBoard(remote);
      normalizePrefs();
      render();
      setSyncState(state.isConnected ? "synced" : "offline", getSyncedLabel(remoteUpdatedAt));
    }, function (error) {
      console.error(error);
      setSyncState("offline", "파이어베이스를 읽지 못했어요. 로컬 캐시로 계속 보여줍니다.");
    });
  }

  function onClick(event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;

    var action = target.getAttribute("data-action");
    if (action === "new-item") return openEditor({ mode: "create", categoryId: getDefaultCategoryId() });
    if (action === "close-editor") return closeEditor();
    if (action === "delete-item") return deleteCurrentItem();
    if (action === "print") return window.print();
    if (action === "expand-all") return setAllCollapsed(false);
    if (action === "collapse-all") return setAllCollapsed(true);
    if (action === "clear-search") return clearFilters();
    if (action === "select-category") return selectCategory(target.getAttribute("data-category-id"));
    if (action === "toggle-category") return toggleCategory(target.getAttribute("data-category-id"));
    if (action === "add-item-in-category") return openEditor({ mode: "create", categoryId: target.getAttribute("data-category-id") });
    if (action === "edit-item") {
      return openEditor({
        mode: "edit",
        categoryId: target.getAttribute("data-category-id"),
        itemId: target.getAttribute("data-item-id")
      });
    }
  }

  function onChange(event) {
    if (event.target === els.hideCheckedToggle) {
      state.prefs.hideChecked = !!event.target.checked;
      savePrefs();
      render();
      return;
    }

    if (event.target === els.itemCategory || event.target === els.itemChecked) {
      updateEditorDraftFromForm();
      return;
    }

    if (event.target.matches('[data-role="item-check"]')) {
      toggleItemChecked(
        event.target.getAttribute("data-category-id"),
        event.target.getAttribute("data-item-id"),
        event.target.checked
      );
    }
  }

  function onInput(event) {
    if (event.target === els.searchInput) {
      state.prefs.search = event.target.value;
      savePrefs();
      render();
      return;
    }

    if (
      event.target === els.itemName ||
      event.target === els.itemMemo ||
      event.target === els.itemQty ||
      event.target === els.itemTag
    ) {
      updateEditorDraftFromForm();
    }
  }

  function onSubmitItem(event) {
    event.preventDefault();
    updateEditorDraftFromForm();

    var draft = state.editor.draft || createEmptyDraft(getDefaultCategoryId());
    if (!draft.name) {
      els.itemName.focus();
      return;
    }

    applyBoardChange(function (board) {
      var category = findCategory(board, draft.categoryId);
      if (!category) return false;

      if (state.editor.mode === "edit") {
        var item = findItem(category, state.editor.itemId);
        if (!item) return false;
        item.name = draft.name;
        item.memo = draft.memo;
        item.qty = draft.qty;
        item.tag = draft.tag;
        item.checked = draft.checked;
      } else {
        category.items.push({
          id: createId("item"),
          name: draft.name,
          memo: draft.memo,
          qty: draft.qty,
          tag: draft.tag,
          checked: draft.checked
        });
      }

      category.items = category.items.map(sanitizeItem).sort(sortItems);
      return true;
    });

    closeEditor();
  }

  function render() {
    normalizePrefs();
    els.pageTitle.textContent = state.board.title;
    document.title = state.board.title + " | 체크리스트";
    els.searchInput.value = state.prefs.search;
    els.hideCheckedToggle.checked = !!state.prefs.hideChecked;
    renderTopStats();
    renderTabs();
    renderCategories();
    renderEditor();
    els.appShell.classList.toggle("is-editor-open", state.editor.open);
  }

  function renderTopStats() {
    var stats = getBoardStats(state.board);
    var visible = getVisibleSummary();

    els.overallDone.textContent = stats.done + " / " + stats.total;
    els.overallPct.textContent = stats.total ? stats.pct + "%" : "0%";
    els.visibleSummary.textContent = "보이는 항목 " + visible.items + "개";
    els.visibleHint.textContent = "카테고리 " + visible.categories + "개 표시 중";
    els.clearSearchButton.hidden = !(state.prefs.search.trim() || state.prefs.hideChecked);
  }

  function renderTabs() {
    var totalStats = getBoardStats(state.board);
    var html = [];

    html.push(renderCategoryPill(ALL_CATEGORY_ID, "전체", totalStats.done, totalStats.total, state.prefs.activeCategory === ALL_CATEGORY_ID));

    state.board.categories.forEach(function (category) {
      var stats = getCategoryStats(category);
      html.push(renderCategoryPill(category.id, category.name, stats.done, stats.total, state.prefs.activeCategory === category.id));
    });

    els.categoryTabs.innerHTML = html.join("");
  }

  function renderCategoryPill(id, name, done, total, isActive) {
    return [
      '<button type="button" class="category-pill',
      isActive ? " is-active" : "",
      '" data-action="select-category" data-category-id="',
      escapeHtml(id),
      '"><span class="category-pill__name">',
      escapeHtml(name),
      '</span><span class="category-pill__meta">',
      escapeHtml(done + " / " + total),
      "</span></button>"
    ].join("");
  }

  function renderCategories() {
    var categories = getFilteredCategories();

    if (!categories.length) {
      els.categoryList.innerHTML = '<section class="category-section"><div class="empty-state">현재 필터에 맞는 항목이 없어요.</div></section>';
      return;
    }

    els.categoryList.innerHTML = categories.map(renderCategorySection).join("");
  }

  function renderCategorySection(categoryEntry) {
    var category = categoryEntry.source;
    var stats = getCategoryStats(category);
    var collapsed = !!state.prefs.collapsed[category.id];
    var pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    var itemsHtml = collapsed
      ? ""
      : (categoryEntry.items.length
        ? '<ul class="category-items">' + categoryEntry.items.map(function (item) {
            return renderItemRow(category.id, item);
          }).join("") + "</ul>"
        : '<div class="empty-state">이 카테고리에는 지금 보이는 항목이 없어요.</div>');

    return [
      '<section class="category-section" id="category-',
      escapeHtml(category.id),
      '"><div class="category-header"><div class="category-header__left"><button type="button" class="btn category-toggle" data-action="toggle-category" data-category-id="',
      escapeHtml(category.id),
      '">',
      collapsed ? "펼치기" : "접기",
      '</button><div><div class="category-name">',
      escapeHtml(category.name),
      '</div><div class="category-progress"><span>',
      escapeHtml(stats.done + " / " + stats.total + " 완료"),
      '</span><span class="category-progress__bar"><i style="width:',
      String(pct),
      '%"></i></span></div></div></div><div class="category-header__right"><span class="badge">',
      escapeHtml(categoryEntry.items.length + "개 표시"),
      '</span><button type="button" class="btn" data-action="add-item-in-category" data-category-id="',
      escapeHtml(category.id),
      '">추가</button></div></div>',
      itemsHtml,
      "</section>"
    ].join("");
  }

  function renderItemRow(categoryId, item) {
    var meta = item.memo ? '<div class="item-meta"><span>' + escapeHtml(item.memo) + "</span></div>" : "";
    var badges = [];
    if (item.qty) badges.push('<span class="badge">수량 ' + escapeHtml(item.qty) + "</span>");
    if (item.tag) badges.push('<span class="badge">' + escapeHtml(item.tag) + "</span>");

    return [
      '<li class="item-row',
      item.checked ? " is-checked" : "",
      '"><input class="item-check" type="checkbox" data-role="item-check" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '"',
      item.checked ? " checked" : "",
      ' /><div class="item-main"><div class="item-main__line"><span class="item-name">',
      escapeHtml(item.name),
      "</span>",
      badges.length ? '<span class="badge-row">' + badges.join("") + "</span>" : "",
      "</div>",
      meta,
      '</div><button type="button" class="icon-btn" data-action="edit-item" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '">수정</button></li>'
    ].join("");
  }

  function renderEditor() {
    populateCategoryOptions();

    if (!state.editor.draft) {
      state.editor.draft = createEmptyDraft(state.editor.categoryId || getDefaultCategoryId());
    }

    var draft = state.editor.draft;
    els.editorPanel.setAttribute("aria-hidden", state.editor.open ? "false" : "true");
    els.editorTitle.textContent = state.editor.mode === "edit" ? "항목 수정" : "항목 추가";
    els.editorHint.textContent = state.editor.mode === "edit"
      ? "이름, 메모, 수량, 태그를 빠르게 수정할 수 있어요."
      : "현재 선택한 카테고리에 새 항목을 추가합니다.";
    els.deleteItemButton.hidden = state.editor.mode !== "edit";

    els.itemCategory.value = draft.categoryId || getDefaultCategoryId();
    els.itemName.value = draft.name;
    els.itemMemo.value = draft.memo;
    els.itemQty.value = draft.qty;
    els.itemTag.value = draft.tag;
    els.itemChecked.checked = !!draft.checked;
  }

  function populateCategoryOptions() {
    els.itemCategory.innerHTML = state.board.categories.map(function (category) {
      return '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + "</option>";
    }).join("");
  }

  function openEditor(options) {
    var draft = createEmptyDraft(options.categoryId || getDefaultCategoryId());

    if (options.mode === "edit") {
      var category = findCategory(state.board, options.categoryId);
      var item = category ? findItem(category, options.itemId) : null;
      if (item) {
        draft = {
          categoryId: category.id,
          name: item.name || "",
          memo: item.memo || "",
          qty: item.qty || "",
          tag: item.tag || "",
          checked: !!item.checked
        };
      }
    }

    state.editor.open = true;
    state.editor.mode = options.mode || "create";
    state.editor.categoryId = draft.categoryId;
    state.editor.itemId = options.itemId || "";
    state.editor.draft = draft;
    render();

    window.setTimeout(function () {
      els.itemName.focus();
      els.itemName.select();
    }, 10);
  }

  function closeEditor() {
    state.editor.open = false;
    state.editor.mode = "create";
    state.editor.categoryId = getDefaultCategoryId();
    state.editor.itemId = "";
    state.editor.draft = createEmptyDraft(state.editor.categoryId);
    render();
  }

  function deleteCurrentItem() {
    if (state.editor.mode !== "edit") return;
    if (!window.confirm("이 항목을 삭제할까요?")) return;

    var categoryId = state.editor.categoryId;
    var itemId = state.editor.itemId;

    applyBoardChange(function (board) {
      var category = findCategory(board, categoryId);
      if (!category) return false;
      var before = category.items.length;
      category.items = category.items.filter(function (item) {
        return item.id !== itemId;
      });
      return before !== category.items.length;
    });

    closeEditor();
  }

  function toggleItemChecked(categoryId, itemId, checked) {
    applyBoardChange(function (board) {
      var category = findCategory(board, categoryId);
      var item = category ? findItem(category, itemId) : null;
      if (!item) return false;
      item.checked = !!checked;
      return true;
    });
  }

  function selectCategory(categoryId) {
    state.prefs.activeCategory = categoryId || ALL_CATEGORY_ID;
    savePrefs();
    render();

    var section = document.getElementById("category-" + state.prefs.activeCategory);
    if (section) section.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function toggleCategory(categoryId) {
    state.prefs.collapsed[categoryId] = !state.prefs.collapsed[categoryId];
    savePrefs();
    render();
  }

  function setAllCollapsed(flag) {
    state.board.categories.forEach(function (category) {
      state.prefs.collapsed[category.id] = !!flag;
    });
    savePrefs();
    render();
  }

  function clearFilters() {
    state.prefs.search = "";
    state.prefs.hideChecked = false;
    state.prefs.activeCategory = ALL_CATEGORY_ID;
    savePrefs();
    render();
  }

  function updateEditorDraftFromForm() {
    state.editor.draft = {
      categoryId: els.itemCategory.value || getDefaultCategoryId(),
      name: els.itemName.value.trim(),
      memo: els.itemMemo.value.trim(),
      qty: els.itemQty.value.trim(),
      tag: els.itemTag.value.trim(),
      checked: !!els.itemChecked.checked
    };
    state.editor.categoryId = state.editor.draft.categoryId;
  }

  function getDefaultCategoryId() {
    if (state.prefs.activeCategory !== ALL_CATEGORY_ID && findCategory(state.board, state.prefs.activeCategory)) {
      return state.prefs.activeCategory;
    }
    return state.board.categories[0] ? state.board.categories[0].id : "";
  }

  function getFilteredCategories() {
    var query = state.prefs.search.trim().toLowerCase();
    var selectedId = state.prefs.activeCategory;
    var hideChecked = !!state.prefs.hideChecked;

    return state.board.categories
      .filter(function (category) {
        return selectedId === ALL_CATEGORY_ID || category.id === selectedId;
      })
      .map(function (category) {
        var items = category.items.filter(function (item) {
          if (hideChecked && item.checked) return false;
          if (!query) return true;
          var haystack = [item.name, item.memo, item.qty, item.tag].join(" ").toLowerCase();
          return haystack.indexOf(query) !== -1;
        });
        return { source: category, items: items };
      })
      .filter(function (entry) {
        return entry.items.length || !query;
      });
  }

  function getVisibleSummary() {
    var categories = getFilteredCategories();
    return {
      categories: categories.length,
      items: categories.reduce(function (sum, entry) {
        return sum + entry.items.length;
      }, 0)
    };
  }

  function getBoardStats(board) {
    var total = 0;
    var done = 0;

    board.categories.forEach(function (category) {
      category.items.forEach(function (item) {
        total += 1;
        if (item.checked) done += 1;
      });
    });

    return {
      total: total,
      done: done,
      pct: total ? Math.round((done / total) * 100) : 0
    };
  }

  function getCategoryStats(category) {
    var total = category.items.length;
    var done = category.items.filter(function (item) { return item.checked; }).length;
    return { total: total, done: done };
  }

  function applyBoardChange(mutator) {
    var nextBoard = clone(state.board);
    var changed = mutator(nextBoard);
    if (!changed) return;

    nextBoard.updatedAt = Date.now();
    nextBoard.categories = nextBoard.categories.map(function (category) {
      return {
        id: category.id,
        name: category.name,
        items: category.items.map(sanitizeItem).sort(sortItems)
      };
    });

    state.board = sanitizeBoard(nextBoard);
    saveCachedBoard(state.board);
    state.pendingSync = true;
    render();
    syncBoard("local-change");
  }

  function syncBoard(reason) {
    if (!state.dbReady || !state.boardRef || !state.isConnected || state.isSyncing) {
      if (state.pendingSync) {
        setSyncState("offline", "변경 내용은 이 브라우저에 저장됐어요. 연결되면 다시 동기화합니다.");
      }
      return;
    }

    state.isSyncing = true;
    state.pendingSync = false;
    setSyncState("syncing", reason === "initial-load" ? "기존 기록을 새 화면에 반영하는 중..." : "파이어베이스에 저장 중...");

    state.boardRef.set(clone(state.board)).then(function () {
      state.isSyncing = false;
      saveCachedBoard(state.board);
      setSyncState("synced", getSyncedLabel(state.board.updatedAt));
    }).catch(function (error) {
      console.error(error);
      state.isSyncing = false;
      state.pendingSync = true;
      setSyncState("offline", "동기화에 실패했어요. 연결되면 다시 시도합니다.");
    });
  }

  function setSyncState(kind, message) {
    els.syncBadge.textContent = message;
    els.syncBadge.className = "sync-badge";
    if (kind === "syncing") els.syncBadge.classList.add("is-syncing");
    if (kind === "synced") els.syncBadge.classList.add("is-synced");
    if (kind === "offline") els.syncBadge.classList.add("is-offline");
  }

  function preparePrint() {
    state.printSnapshot = {
      activeCategory: state.prefs.activeCategory,
      hideChecked: state.prefs.hideChecked,
      collapsed: clone(state.prefs.collapsed),
      editorOpen: state.editor.open
    };

    state.prefs.activeCategory = ALL_CATEGORY_ID;
    state.prefs.hideChecked = false;
    state.board.categories.forEach(function (category) {
      state.prefs.collapsed[category.id] = false;
    });
    state.editor.open = false;
    render();
  }

  function restorePrintState() {
    if (!state.printSnapshot) return;
    state.prefs.activeCategory = state.printSnapshot.activeCategory;
    state.prefs.hideChecked = state.printSnapshot.hideChecked;
    state.prefs.collapsed = state.printSnapshot.collapsed;
    state.editor.open = state.printSnapshot.editorOpen;
    state.printSnapshot = null;
    savePrefs();
    render();
  }

  function loadCachedBoard() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return sanitizeBoard(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveCachedBoard(board) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(board));
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return createDefaultPrefs();
      return Object.assign(createDefaultPrefs(), JSON.parse(raw));
    } catch (error) {
      return createDefaultPrefs();
    }
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  }

  function normalizePrefs() {
    var validIds = state.board.categories.map(function (category) {
      return category.id;
    });

    if (state.prefs.activeCategory !== ALL_CATEGORY_ID && validIds.indexOf(state.prefs.activeCategory) === -1) {
      state.prefs.activeCategory = ALL_CATEGORY_ID;
    }

    if (!state.prefs.collapsed || typeof state.prefs.collapsed !== "object") {
      state.prefs.collapsed = {};
    }

    savePrefs();
  }

  function createDefaultPrefs() {
    return {
      search: "",
      hideChecked: false,
      activeCategory: ALL_CATEGORY_ID,
      collapsed: {}
    };
  }

  function sanitizeBoard(raw) {
    if (!raw || !Array.isArray(raw.categories)) return null;

    return {
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : DEFAULT_BOARD_TITLE,
      updatedAt: Number(raw.updatedAt || 0),
      source: typeof raw.source === "string" ? raw.source : "",
      schemaVersion: Number(raw.schemaVersion || 1),
      categories: raw.categories.map(sanitizeCategory).filter(Boolean)
    };
  }

  function sanitizeCategory(raw) {
    if (!raw || !Array.isArray(raw.items)) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("cat"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "카테고리",
      items: raw.items.map(sanitizeItem).sort(sortItems)
    };
  }

  function sanitizeItem(raw) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("item"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "이름 없는 항목",
      memo: typeof raw.memo === "string" ? raw.memo.trim() : "",
      qty: typeof raw.qty === "string" ? raw.qty.trim() : "",
      tag: typeof raw.tag === "string" ? raw.tag.trim() : "",
      checked: !!raw.checked
    };
  }

  function sortItems(a, b) {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.name.localeCompare(b.name, "ko");
  }

  function findCategory(board, categoryId) {
    return board.categories.find(function (category) {
      return category.id === categoryId;
    }) || null;
  }

  function findItem(category, itemId) {
    return category.items.find(function (item) {
      return item.id === itemId;
    }) || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 10);
  }

  function createEmptyDraft(categoryId) {
    return {
      categoryId: categoryId || "",
      name: "",
      memo: "",
      qty: "",
      tag: "",
      checked: false
    };
  }

  function getSyncedLabel(updatedAt) {
    if (!updatedAt) return "준비 완료";
    var date = new Date(updatedAt);
    return "동기화 " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function makeLegacyItems(tag, rows) {
    return rows.map(function (row) {
      return {
        key: row[0],
        name: row[1],
        note: row[2] || "",
        tag: tag || ""
      };
    });
  }

  LEGACY_CATEGORY_BLUEPRINT = [
    { id: "carry", name: "기내 반입", items: makeLegacyItems("아기", [
      ["carry_baby_diaper", "기저귀 (기내용 6~10개)", "지연/환승 대비"],
      ["carry_baby_wipes", "휴대용 물티슈 2~3팩 + 휴지", "손/얼굴/기저귀"],
      ["carry_baby_change", "여벌 옷 1세트 + 속싸개/담요 1", "토/역류/누수"],
      ["carry_baby_pad", "기저귀 교환 패드(깔개)", "기내/공항"],
      ["carry_baby_toys", "흡착 장난감 1 + 헝겊책 1 + 치발기", "짧고 확실한 3종"]
    ]).concat(makeLegacyItems("부모", [
      ["carry_id", "신분증/면허증/카드", "렌터카 인수까지"],
      ["carry_charger", "충전기 + 보조배터리", "사진/지도/업무"],
      ["carry_parent_change", "부모 여벌 티셔츠 1(각 1) + 지퍼백", "아기 사고 대비"],
      ["carry_sanitizer", "손소독제/휴대용 손워시", "접촉 많을 때"]
    ])) },
    { id: "baby_clothes", name: "아기 | 의류 & 기저귀", items: makeLegacyItems("기저귀", [
      ["baby_day_diaper", "낮 기저귀 새거 1팩", "부피 크면 현지 조달"],
      ["baby_night_diaper", "밤 기저귀 8개", "흡수력 좋은 걸로"],
      ["baby_swim_diaper", "방수/수영용 기저귀", "물놀이 일정 있을 때"]
    ]).concat(makeLegacyItems("옷/잡화", [
      ["baby_inner", "내복", "여벌 2~3"],
      ["baby_pajama", "잠옷", "수면 중 땀/침 대비"],
      ["baby_outer", "겉옷", "제주 바람 대비"],
      ["baby_hat_socks", "모자, 양말", "체온 유지용"],
      ["baby_swimsuit", "수영복", "온수풀/스파 일정 시"],
      ["baby_bib_cloth", "턱받이(천)", "세탁 대비 3~5장"],
      ["baby_cloths", "손수건", "넉넉히"],
      ["baby_swaddle", "속싸개", "수면/안정/체온"]
    ])).concat(makeLegacyItems("세탁", [
      ["baby_laundry_net", "세탁망", "호텔 세탁/손빨래"],
      ["baby_detergent", "세탁세제", "소분 추천"]
    ])) },
    { id: "baby_food", name: "아기 | 이유식", items: makeLegacyItems("음식", [
      ["baby_food_packs", "실온 이유식 5팩", "여분 1~2팩 추가"],
      ["baby_snack", "떡뻥(휴대)", "차/비행기에서 유용"]
    ]).concat(makeLegacyItems("도구", [
      ["baby_spoon_case", "숟가락 + 케이스", "외식/이동"],
      ["baby_strawcup", "빨대컵", "누수 적게"],
      ["baby_bib_silicone", "턱받이(실리콘/일회용)", "외출은 일회용 편함"],
      ["baby_thermos", "보온병", "따뜻한 물"],
      ["baby_pot", "전기포트", "호텔 비치 불확실 시"],
      ["baby_dishkit", "설거지(수세미/세제/빨대솔)", "소분 추천"],
      ["baby_food_bag", "이유식용 가방", "보냉백이면 좋음"]
    ])) },
    { id: "baby_play", name: "아기 | 놀기", items: makeLegacyItems("놀잇감", [
      ["baby_cloth_book", "헝겊책(휴대)", "소리/촉감 요소"],
      ["baby_tulip", "튤립시리즈", "최애 아이템"],
      ["baby_dolls", "작은 인형들", "2개만 선택"],
      ["baby_teether", "실리콘 스트랩 + 치발기", "분실 방지"],
      ["baby_suction_toy", "비행기용 흡착장난감", "기내용"],
      ["baby_tube", "튜브", "계획 있을 때만"]
    ]) },
    { id: "baby_wash", name: "아기 | 씻기 & 위생", items: makeLegacyItems("위생", [
      ["baby_bodywash", "바디워시", "소분하면 가벼움"],
      ["baby_tub_cleaner", "욕조클리너", "욕조 사용 시"],
      ["baby_tooth", "칫솔/치약", "필요 시"],
      ["baby_steril_bowl", "소독용유리그릇", "열탕 소독"],
      ["baby_bumbo", "범보의자", "호텔방에서 잠깐"],
      ["baby_lotion", "로션", "건조/바람"],
      ["baby_cleanser", "엉덩이클렌저 소분", "휴대용"]
    ]) },
    { id: "baby_sleep", name: "아기 | 자기/외출", items: makeLegacyItems("수면", [
      ["baby_mat", "깔것 1", "눕힘/교환용"],
      ["baby_blanket", "담요(또는 큰 수건)", "온도차 대비"]
    ]).concat(makeLegacyItems("이동", [
      ["baby_stroller", "유모차(커버/케이스)", "트렁크 공간 체크"],
      ["baby_wipes_big", "물티슈 큰거 1통", "메인 재고"],
      ["baby_wipes_small", "물티슈 휴대용 3개", "외출 가방"],
      ["baby_handwash", "핸드워시(휴대)", "외출 시"]
    ])) },
    { id: "baby_meds", name: "아기 | 상비약", items: makeLegacyItems("상비약", [
      ["meds_physio", "피지오머 소분", "코막힘 대비"],
      ["meds_cotton", "면봉", "위생/케어"],
      ["meds_bepanthen", "비판텐", "발진/자극"],
      ["meds_fever", "해열제", "비상용"]
    ]) },
    { id: "mom", name: "엄마 | 여행 기본", items: makeLegacyItems("속옷/양말", [
      ["mom_underwear", "팬티 6~7장", "교체 잦음"],
      ["mom_bra", "브라 2~3개 (수유브라)", "땀/유즙/세탁"],
      ["mom_socks", "양말 6켤레", "실내·외출"],
      ["mom_pads", "수유패드(일회용)", "새는 날 대비"]
    ]).concat(makeLegacyItems("의류", [
      ["mom_tops", "상의 4~5벌", "수유/안기 편한 옷"],
      ["mom_bottoms", "하의 2~3벌", "운전/유모차"],
      ["mom_sleepwear", "잠옷 2벌", "밤 수유"],
      ["mom_outer", "가디건/바람막이 1", "제주 바람"]
    ])).concat(makeLegacyItems("세면/화장품", [
      ["mom_skincare", "스킨케어", "소분"],
      ["mom_sunscreen", "선크림", "유모차 산책"],
      ["mom_cleanser", "클렌징", "밤 체력 절약"],
      ["mom_lipbalm", "립밤", "바람"],
      ["mom_hairtie", "머리끈/집게핀", "필수"]
    ])).concat(makeLegacyItems("수유/회복", [
      ["mom_nursing_cover", "수유커버", "외부 수유"],
      ["mom_wrist_guard", "손목 보호대", "부담 완화"],
      ["mom_waterbottle", "텀블러/물병", "갈증 대비"]
    ])).concat(makeLegacyItems("개인 위생/상비", [
      ["mom_meds", "개인 상비약", "두통/소화"],
      ["mom_sanitary", "생리대/라이너", "필요 시"],
      ["mom_mask", "마스크", "비행기/실내"]
    ])) },
    { id: "dad", name: "아빠 | 여행 기본", items: makeLegacyItems("속옷/양말", [
      ["dad_underwear", "팬티 6~7장", "여유"],
      ["dad_socks", "양말 6켤레", "운전/외출"]
    ]).concat(makeLegacyItems("의류", [
      ["dad_tops", "상의 4~5벌", "미팅 있으면 셔츠"],
      ["dad_bottoms", "하의 2~3벌", "운전 편한 바지"],
      ["dad_sleepwear", "잠옷 1~2벌", "숙면"],
      ["dad_outer", "바람막이/후드 1", "제주 바람"],
      ["dad_shoes", "편한 신발 1", "이동"]
    ])).concat(makeLegacyItems("세면/위생", [
      ["dad_toiletries", "칫솔/치약/면도기", "기본"],
      ["dad_lotion", "로션/립밤", "건조"],
      ["dad_sunscreen", "선크림", "야외"]
    ])).concat(makeLegacyItems("역할 특화", [
      ["dad_license", "운전면허증", "렌터카"],
      ["dad_crossbag", "크로스백/허리팩", "즉시 대응용"],
      ["dad_sunglasses", "선글라스", "운전"],
      ["dad_hat", "모자", "햇빛"],
      ["dad_patches", "파스/근육통 패치", "허리/어깨"],
      ["dad_snacks", "간단 간식", "타이밍"]
    ])) },
    { id: "work", name: "공용 | 출장/전자", items: makeLegacyItems("공용", [
      ["work_laptop", "노트북/충전기", "업무"],
      ["work_docs", "출장 서류/명함/필기구", "고정 위치"],
      ["work_adapter", "멀티탭/어댑터", "포트 부족"]
    ]) }
  ];

  function normalizeLegacyCustomItems(raw) {
    var items = Array.isArray(raw)
      ? raw
      : (raw && typeof raw === "object" ? Object.values(raw) : []);

    return items.filter(function (item) {
      return item && item.category && item.name;
    });
  }

  function hasLegacyData(checksRaw, customRaw) {
    var hasChecks = !!checksRaw && typeof checksRaw === "object" && Object.keys(checksRaw).length > 0;
    var customItems = normalizeLegacyCustomItems(customRaw);
    return hasChecks || customItems.length > 0;
  }

  function buildLegacyBoard(checksRaw, customRaw) {
    if (!hasLegacyData(checksRaw, customRaw)) return null;

    var checks = checksRaw && typeof checksRaw === "object" ? checksRaw : {};
    var customItems = normalizeLegacyCustomItems(customRaw);
    var categories = LEGACY_CATEGORY_BLUEPRINT.map(function (category) {
      return {
        id: category.id,
        name: category.name,
        items: category.items.map(function (item) {
          return sanitizeItem({
            id: item.key,
            name: item.name,
            memo: item.note,
            qty: "",
            tag: item.tag,
            checked: !!checks[item.key]
          });
        }).sort(sortItems)
      };
    });

    CUSTOM_CATEGORY_DEFS.forEach(function (def) {
      var items = customItems
        .filter(function (item) { return item.category === def.id; })
        .map(function (item) {
          return sanitizeItem({
            id: item.id || createId("custom"),
            name: item.name,
            memo: item.note || "",
            qty: "",
            tag: "직접 추가",
            checked: !!item.checked
          });
        })
        .sort(sortItems);

      categories.push({
        id: def.id,
        name: def.name,
        items: items
      });
    });

    return sanitizeBoard({
      title: DEFAULT_BOARD_TITLE,
      updatedAt: Date.now(),
      source: "legacy-jeju",
      schemaVersion: 1,
      categories: categories
    });
  }

  function shouldUseLegacyBoard(compactBoard, legacyBoard) {
    if (!legacyBoard) return false;
    if (!compactBoard) return true;
    if (compactBoard.source === "legacy-jeju") return false;
    if (compactBoard.source === "sample-travel") return true;
    if (compactBoard.title === "Travel Checklist") return true;

    return compactBoard.categories.some(function (category) {
      return category.id === "documents" || category.name === "Documents";
    });
  }

  function createFallbackBoard() {
    return sanitizeBoard({
      title: "여행 준비 체크리스트",
      updatedAt: Date.now(),
      source: "sample-travel",
      schemaVersion: 1,
      categories: [
        { id: "documents", name: "서류 & 예약", items: makeSampleItems("서류", [
          ["신분증", "성인 인원 전부 확인", "1"],
          ["교통/숙소 예약 캡처", "오프라인에서도 확인 가능하게", ""],
          ["카드/현금/결제 앱", "예비 수단까지 챙기기", ""],
          ["숙소 주소와 비상 연락처", "택시/문자 전달용", ""]
        ]) },
        { id: "clothes", name: "의류", items: makeSampleItems("의류", [
          ["상의", "일수 + 1벌 정도", "4"],
          ["하의", "이동 편한 옷 중심", "2"],
          ["속옷/양말", "여벌 포함", "4세트"],
          ["겉옷", "일교차 대비", "1"],
          ["편한 신발", "많이 걷는 일정이면 필수", "1"]
        ]) },
        { id: "care", name: "세면 & 상비", items: makeSampleItems("세면", [
          ["칫솔/치약", "기본 세면도구", "1"],
          ["스킨케어/선크림", "소분 추천", "1세트"],
          ["개인 약/상비약", "두통, 소화, 밴드 등", "1파우치"],
          ["휴지/물티슈", "이동 중에도 쓰기 좋게", "1세트"]
        ]) },
        { id: "tech", name: "전자기기", items: makeSampleItems("전자", [
          ["휴대폰 충전기", "인원 수에 맞게", "1"],
          ["보조배터리", "이동이 길면 체감 큼", "1"],
          ["멀티탭/어댑터", "포트 부족 대비", "1"],
          ["이어폰", "교통 이동 중 사용", "1"]
        ]) },
        { id: "dayof", name: "당일 이동", items: makeSampleItems("당일", [
          ["물병", "보안 검색 후 채우기", "1"],
          ["간단 간식", "긴 이동 대비", "2"],
          ["목베개", "비행/장거리 이동 시", "1"],
          ["집 열쇠", "나가기 전 마지막 확인", "1"]
        ]) }
      ]
    });
  }

  function makeSampleItems(tag, rows) {
    return rows.map(function (row) {
      return sanitizeItem({
        id: createId("item"),
        name: row[0],
        memo: row[1],
        qty: row[2] || "",
        tag: tag,
        checked: false
      });
    });
  }
})();
