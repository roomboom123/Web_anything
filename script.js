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

  var WORKSPACE_PATH = "travel_checklist_workspace_v2";
  var LEGACY_BOARD_PATH = "travel_checklist_compact_v1";
  var LEGACY_CHECKLIST_PATH = "checklist";
  var LEGACY_CUSTOM_PATH = "custom";
  var CACHE_KEY = "travel_checklist_compact_cache_v1";
  var PREFS_KEY = "travel_checklist_compact_prefs_v1";
  var ALL_CATEGORY_ID = "all";
  var DEFAULT_BOARD_TITLE = "제주 체크리스트";

  var CUSTOM_CATEGORY_DEFS = [
    { id: "custom_baby", name: "?꾧린 | 吏곸젒 異붽?" },
    { id: "custom_mom", name: "?꾨쭏 | 吏곸젒 異붽?" },
    { id: "custom_dad", name: "?꾨튌 | 吏곸젒 異붽?" },
    { id: "custom_shared", name: "怨듭슜 | 吏곸젒 異붽?" }
  ];
  DEFAULT_BOARD_TITLE = "제주 체크리스트";

  var LEGACY_CATEGORY_BLUEPRINT = [];
  var state = {
    workspace: null,
    board: null,
    prefs: null,
    dbReady: false,
    workspaceRef: null,
    legacyBoardRef: null,
    workspaceListenerAttached: false,
    isConnected: false,
    remoteLoaded: false,
    pendingSync: false,
    isSyncing: false,
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
            tag: "吏곸젒 異붽?",
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
      id: createId("board"),
      title: "\uC5EC\uD589 \uC900\uBE44 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8",
      updatedAt: Date.now(),
      source: "sample-travel",
      schemaVersion: 2,
      categories: [
        {
          id: "documents",
          name: "\uC11C\uB958/\uC608\uC57D",
          items: makeSampleItems("\uC11C\uB958", [
            ["\uC2E0\uBD84\uC99D", "\uCD9C\uBC1C \uC804\uC5D0 \uC720\uD6A8\uAE30\uAC04\uAE4C\uC9C0 \uD655\uC778", "1"],
            ["\uAD50\uD1B5/\uC219\uC18C \uC608\uC57D", "\uC624\uD504\uB77C\uC778\uC5D0\uC11C\uB3C4 \uBCFC \uC218 \uC788\uAC8C \uC800\uC7A5", ""],
            ["\uACB0\uC81C \uC218\uB2E8", "\uCE74\uB4DC\uC640 \uD604\uAE08\uC744 \uB098\uB220 \uCC59\uAE30\uAE30", ""]
          ])
        },
        {
          id: "clothes",
          name: "\uC758\uB958",
          items: makeSampleItems("\uC758\uB958", [
            ["\uC0C1\uC758", "\uC77C\uC815 \uAE30\uC900\uC73C\uB85C \uC5EC\uBC8C \uD3EC\uD568", "4"],
            ["\uD558\uC758", "\uD65C\uB3D9\uC131 \uC88B\uC740 \uC870\uD569", "2"],
            ["\uC18D\uC637/\uC591\uB9D0", "\uC608\uC0C1\uC77C\uC218\uBCF4\uB2E4 \uC870\uAE08 \uB113\uB113\uD558\uAC8C", "4\uC138\uD2B8"]
          ])
        },
        {
          id: "care",
          name: "\uC138\uBA74/\uC0C1\uBE44",
          items: makeSampleItems("\uAD00\uB9AC", [
            ["\uC138\uBA74\uB3C4\uAD6C", "\uC791\uC740 \uD30C\uC6B0\uCE58\uB85C \uBB36\uC5B4\uB450\uAE30", "1"],
            ["\uAC1C\uC778 \uC0C1\uBE44\uC57D", "\uD3C9\uC18C \uBA39\uB294 \uC57D \uC6B0\uC120", "1"],
            ["\uC120\uD06C\uB9BC", "\uC57C\uC678 \uC77C\uC815\uC774 \uC788\uC73C\uBA74 \uD544\uC218", "1"]
          ])
        },
        {
          id: "dayof",
          name: "\uC774\uB3D9 \uB2F9\uC77C",
          items: makeSampleItems("\uB2F9\uC77C", [
            ["\uBB3C/\uAC04\uC2DD", "\uAE34 \uC774\uB3D9\uC774\uBA74 \uBBF8\uB9AC \uCC59\uAE30\uAE30", "1"],
            ["\uCDA9\uC804\uAE30", "\uAC00\uBC29 \uC717\uCE78\uC5D0 \uBC14\uB85C \uAEBC\uB0BC \uC704\uCE58", "1"],
            ["\uCD9C\uBC1C \uC804 \uCCB4\uD06C", "\uBB38 \uC7A0\uAE08, \uC608\uB9E4, \uC9C0\uAC11 \uD655\uC778", "1"]
          ])
        }
      ]
    });
  }

  function getSyncedLabel(updatedAt) {
    if (!updatedAt) return "준비 완료";
    var date = new Date(updatedAt);
    return "업데이트 " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function resetEditorState() {
    state.editor.open = false;
    state.editor.mode = "create";
    state.editor.categoryId = getDefaultCategoryId();
    state.editor.itemId = "";
    state.editor.draft = createEmptyDraft(state.editor.categoryId);
  }

  function init() {
    state.prefs = loadPrefs();
    cacheElements();
    state.workspace = loadCachedWorkspace() || createFallbackWorkspace();
    normalizePrefs();
    syncActiveBoardFromWorkspace();
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
    els.boardTabs = document.getElementById("boardTabs");
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
      setSyncState("offline", "파이어베이스를 불러오지 못했어요. 브라우저 저장만 사용합니다.");
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      var db = firebase.database();
      state.workspaceRef = db.ref(WORKSPACE_PATH);
      state.legacyBoardRef = db.ref(LEGACY_BOARD_PATH);
      state.dbReady = true;

      db.ref(".info/connected").on("value", function (snapshot) {
        state.isConnected = snapshot.val() === true;
        if (state.isConnected) {
          if (state.pendingSync) {
            syncWorkspace("reconnect");
          } else if (state.remoteLoaded) {
            setSyncState("synced", getSyncedLabel(state.workspace && state.workspace.updatedAt));
          } else {
            setSyncState("syncing", "연결 중...");
          }
        } else {
          setSyncState(
            state.remoteLoaded ? "offline" : "syncing",
            state.remoteLoaded
              ? "오프라인 상태예요. 변경 내용은 브라우저에 임시 저장됩니다."
              : "파이어베이스 연결 중..."
          );
        }
      });

      loadRemoteData();
    } catch (error) {
      console.error(error);
      setSyncState("offline", "파이어베이스 초기화에 실패했어요. 로컬 캐시만 사용합니다.");
    }
  }

  function loadRemoteData() {
    setSyncState("syncing", "기존 기록을 확인하는 중...");

    Promise.all([
      state.workspaceRef.once("value"),
      state.legacyBoardRef.once("value")
    ]).then(function (snapshots) {
      var workspace = sanitizeWorkspace(snapshots[0].val());
      var legacyBoard = sanitizeBoard(snapshots[1].val());

      state.pendingSync = false;

      if (workspace) {
        state.workspace = workspace;
      } else if (legacyBoard) {
        state.workspace = createWorkspaceFromBoard(legacyBoard);
        state.pendingSync = true;
      } else {
        state.workspace = createFallbackWorkspace();
        state.pendingSync = true;
      }

      state.remoteLoaded = true;
      normalizePrefs();
      syncActiveBoardFromWorkspace();
      saveCachedWorkspace(state.workspace);
      attachWorkspaceListener();
      render();

      if (state.pendingSync) {
        syncWorkspace("initial-load");
      } else {
        setSyncState(state.isConnected ? "synced" : "offline", getSyncedLabel(state.workspace.updatedAt));
      }
    }).catch(function (error) {
      console.error(error);
      state.remoteLoaded = true;
      attachWorkspaceListener();
      render();
      setSyncState("offline", "원격 기록을 읽지 못했어요. 로컬 캐시를 보여주는 중입니다.");
    });
  }

  function attachWorkspaceListener() {
    if (state.workspaceListenerAttached || !state.workspaceRef) return;
    state.workspaceListenerAttached = true;

    state.workspaceRef.on("value", function (snapshot) {
      var remote = sanitizeWorkspace(snapshot.val());
      if (!remote) {
        if (state.remoteLoaded && !state.pendingSync) {
          state.pendingSync = true;
          syncWorkspace("seed");
        }
        return;
      }

      var localUpdatedAt = Number((state.workspace && state.workspace.updatedAt) || 0);
      var remoteUpdatedAt = Number(remote.updatedAt || 0);
      if (state.pendingSync && localUpdatedAt > remoteUpdatedAt) {
        syncWorkspace("keep-local");
        return;
      }

      state.remoteLoaded = true;
      state.workspace = remote;
      saveCachedWorkspace(remote);
      normalizePrefs();
      syncActiveBoardFromWorkspace();
      render();
      setSyncState(state.isConnected ? "synced" : "offline", getSyncedLabel(remoteUpdatedAt));
    }, function (error) {
      console.error(error);
      setSyncState("offline", "파이어베이스를 읽지 못했어요. 로컬 캐시로 계속 보여드립니다.");
    });
  }

  function onClick(event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;

    var action = target.getAttribute("data-action");
    if (action === "new-board") return createBoardFromPrompt();
    if (action === "rename-board") return renameCurrentBoard();
    if (action === "delete-board") return deleteCurrentBoard();
    if (action === "select-board") return selectBoard(target.getAttribute("data-board-id"));
    if (action === "new-category") return createCategoryFromPrompt();
    if (action === "rename-category") return renameCategoryFromPrompt(target.getAttribute("data-category-id"));
    if (action === "delete-category") return deleteCategory(target.getAttribute("data-category-id"));
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
    if (!state.board) return;

    normalizePrefs();
    els.pageTitle.textContent = state.board.title;
    document.title = state.board.title + " | 체크리스트";
    els.searchInput.value = state.prefs.search;
    els.hideCheckedToggle.checked = !!state.prefs.hideChecked;
    renderTopStats();
    renderBoardTabs();
    renderCategoryTabs();
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

  function renderBoardTabs() {
    var html = state.workspace.boards.map(function (board) {
      var stats = getBoardStats(board);
      return renderBoardPill(board.id, board.title, stats.done, stats.total, board.id === getActiveBoardId());
    });

    html.push('<button type="button" class="btn" data-action="new-board">체크리스트 추가</button>');
    html.push('<button type="button" class="btn" data-action="rename-board">이름 변경</button>');
    html.push('<button type="button" class="btn btn--danger" data-action="delete-board"' + (state.workspace.boards.length < 2 ? ' disabled' : '') + '>삭제</button>');
    els.boardTabs.innerHTML = html.join("");
  }

  function renderBoardPill(id, name, done, total, isActive) {
    return [
      '<button type="button" class="board-pill',
      isActive ? " is-active" : "",
      '" data-action="select-board" data-board-id="',
      escapeHtml(id),
      '"><span class="board-pill__name">',
      escapeHtml(name),
      '</span><span class="board-pill__meta">',
      escapeHtml(done + " / " + total),
      "</span></button>"
    ].join("");
  }

  function renderCategoryTabs() {
    var html = [];
    var totalStats = getBoardStats(state.board);
    var activeCategoryId = getActiveCategoryId();

    html.push(renderCategoryPill(ALL_CATEGORY_ID, "전체", totalStats.done, totalStats.total, activeCategoryId === ALL_CATEGORY_ID));
    state.board.categories.forEach(function (category) {
      var stats = getCategoryStats(category);
      html.push(renderCategoryPill(category.id, category.name, stats.done, stats.total, activeCategoryId === category.id));
    });
    html.push('<button type="button" class="btn" data-action="new-category">필터 추가</button>');
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
    var collapsed = !!getCollapsedMap()[category.id];
    var pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    var itemsHtml = collapsed
      ? ""
      : (categoryEntry.items.length
        ? '<ul class="category-items">' + categoryEntry.items.map(function (item) { return renderItemRow(category.id, item); }).join("") + '</ul>'
        : '<div class="empty-state">이 카테고리에는 아직 표시할 항목이 없어요.</div>');

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
      '">항목 추가</button><button type="button" class="btn" data-action="rename-category" data-category-id="',
      escapeHtml(category.id),
      '">이름 변경</button><button type="button" class="btn btn--danger" data-action="delete-category" data-category-id="',
      escapeHtml(category.id),
      '">삭제</button></div></div>',
      itemsHtml,
      '</section>'
    ].join("");
  }

  function renderItemRow(categoryId, item) {
    var meta = item.memo ? '<div class="item-meta"><span>' + escapeHtml(item.memo) + '</span></div>' : "";
    var badges = [];
    if (item.qty) badges.push('<span class="badge">수량 ' + escapeHtml(item.qty) + '</span>');
    if (item.tag) badges.push('<span class="badge">' + escapeHtml(item.tag) + '</span>');

    return [
      '<li class="item-row',
      item.checked ? ' is-checked' : '',
      '"><input class="item-check" type="checkbox" data-role="item-check" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '"',
      item.checked ? ' checked' : '',
      ' /><div class="item-main"><div class="item-main__line"><span class="item-name">',
      escapeHtml(item.name),
      '</span>',
      badges.length ? '<span class="badge-row">' + badges.join('') + '</span>' : '',
      '</div>',
      meta,
      '</div><button type="button" class="icon-btn" data-action="edit-item" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '">수정</button></li>'
    ].join("");
  }

  function renderEditor() {
    if (!state.board) return;
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
      return '<option value="' + escapeHtml(category.id) + '">' + escapeHtml(category.name) + '</option>';
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
    resetEditorState();
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

  function selectBoard(boardId) {
    if (!findBoard(state.workspace, boardId)) return;
    state.prefs.activeBoardId = boardId;
    normalizePrefs();
    syncActiveBoardFromWorkspace();
    resetEditorState();
    render();
  }

  function createBoardFromPrompt() {
    var name = window.prompt("새 체크리스트 이름을 입력하세요.", "새 체크리스트");
    if (name === null) return;
    name = name.trim();
    if (!name) return;

    var duplicateCurrent = !!state.board && window.confirm(
      "현재 체크리스트 구성을 복사할까요?\n확인을 누르면 현재 구조를 복사하고, 취소를 누르면 기본 틀로 시작합니다."
    );
    var newBoard = duplicateCurrent
      ? duplicateBoardForScenario(state.board, name)
      : createScenarioBoard(name);

    applyWorkspaceChange(function (workspace) {
      workspace.boards.push(newBoard);
      return true;
    }, { activeBoardId: newBoard.id, activeCategoryId: ALL_CATEGORY_ID, resetEditor: true });
  }

  function renameCurrentBoard() {
    if (!state.board) return;
    var name = window.prompt("체크리스트 이름을 바꿔주세요.", state.board.title);
    if (name === null) return;
    name = name.trim();
    if (!name || name === state.board.title) return;
    applyBoardChange(function (board) {
      board.title = name;
      return true;
    });
  }

  function deleteCurrentBoard() {
    if (!state.workspace || state.workspace.boards.length < 2) {
      window.alert("체크리스트는 최소 1개는 남아 있어야 해요.");
      return;
    }
    if (!window.confirm('"' + state.board.title + '" 체크리스트를 삭제할까요?')) return;

    var activeId = getActiveBoardId();
    var remaining = state.workspace.boards.filter(function (board) {
      return board.id !== activeId;
    });
    var nextBoardId = remaining[0] ? remaining[0].id : "";

    applyWorkspaceChange(function (workspace) {
      var before = workspace.boards.length;
      workspace.boards = workspace.boards.filter(function (board) {
        return board.id !== activeId;
      });
      return workspace.boards.length !== before;
    }, { activeBoardId: nextBoardId, activeCategoryId: ALL_CATEGORY_ID, resetEditor: true });
  }

  function createCategoryFromPrompt() {
    var name = window.prompt("새 필터 이름을 입력하세요.", "새 필터");
    if (name === null) return;
    name = name.trim();
    if (!name) return;

    var categoryId = createId("cat");
    applyBoardChange(function (board) {
      board.categories.push({ id: categoryId, name: name, items: [] });
      return true;
    }, { activeCategoryId: categoryId, resetEditor: true });
  }

  function renameCategoryFromPrompt(categoryId) {
    var category = findCategory(state.board, categoryId);
    if (!category) return;
    var name = window.prompt("필터 이름을 바꿔주세요.", category.name);
    if (name === null) return;
    name = name.trim();
    if (!name || name === category.name) return;
    applyBoardChange(function (board) {
      var target = findCategory(board, categoryId);
      if (!target) return false;
      target.name = name;
      return true;
    });
  }

  function deleteCategory(categoryId) {
    var category = findCategory(state.board, categoryId);
    if (!category) return;
    if (state.board.categories.length < 2) {
      window.alert("필터는 최소 1개는 남아 있어야 해요.");
      return;
    }

    var message = '"' + category.name + '" 필터를 삭제할까요?';
    if (category.items.length) message += "\n이 안의 항목 " + category.items.length + "개도 함께 삭제됩니다.";
    if (!window.confirm(message)) return;

    applyBoardChange(function (board) {
      var before = board.categories.length;
      board.categories = board.categories.filter(function (item) {
        return item.id !== categoryId;
      });
      return board.categories.length !== before;
    }, { activeCategoryId: ALL_CATEGORY_ID, resetEditor: true });
  }

  function selectCategory(categoryId) {
    setActiveCategoryId(categoryId || ALL_CATEGORY_ID);
    savePrefs();
    render();
    var section = document.getElementById("category-" + getActiveCategoryId());
    if (section) section.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function toggleCategory(categoryId) {
    var collapsedMap = getCollapsedMap();
    collapsedMap[categoryId] = !collapsedMap[categoryId];
    savePrefs();
    render();
  }

  function setAllCollapsed(flag) {
    state.board.categories.forEach(function (category) {
      getCollapsedMap()[category.id] = !!flag;
    });
    savePrefs();
    render();
  }

  function clearFilters() {
    state.prefs.search = "";
    state.prefs.hideChecked = false;
    setActiveCategoryId(ALL_CATEGORY_ID);
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
    var activeCategoryId = getActiveCategoryId();
    if (activeCategoryId !== ALL_CATEGORY_ID && findCategory(state.board, activeCategoryId)) {
      return activeCategoryId;
    }
    return state.board.categories[0] ? state.board.categories[0].id : "";
  }

  function getFilteredCategories() {
    var query = state.prefs.search.trim().toLowerCase();
    var selectedId = getActiveCategoryId();
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
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function getCategoryStats(category) {
    var total = category.items.length;
    var done = category.items.filter(function (item) { return item.checked; }).length;
    return { total: total, done: done };
  }

  function applyBoardChange(mutator, options) {
    applyWorkspaceChange(function (workspace) {
      var board = findBoard(workspace, getActiveBoardId());
      if (!board) return false;
      var changed = mutator(board, workspace);
      if (!changed) return false;
      board.updatedAt = Date.now();
      board.categories = board.categories.map(sanitizeCategory).filter(Boolean);
      return true;
    }, options);
  }

  function applyWorkspaceChange(mutator, options) {
    if (!state.workspace) return;
    var nextWorkspace = clone(state.workspace);
    var changed = mutator(nextWorkspace);
    if (!changed) return;
    nextWorkspace.updatedAt = Date.now();
    state.workspace = sanitizeWorkspace(nextWorkspace);
    if (!state.workspace) return;

    if (options && options.activeBoardId) state.prefs.activeBoardId = options.activeBoardId;
    normalizePrefs();
    syncActiveBoardFromWorkspace();
    if (options && Object.prototype.hasOwnProperty.call(options, "activeCategoryId")) {
      setActiveCategoryId(options.activeCategoryId, getActiveBoardId());
    }
    if (options && options.resetEditor) resetEditorState();

    saveCachedWorkspace(state.workspace);
    savePrefs();
    state.pendingSync = true;
    render();
    syncWorkspace("local-change");
  }

  function syncWorkspace(reason) {
    if (!state.dbReady || !state.workspaceRef || !state.isConnected || state.isSyncing) {
      if (state.pendingSync) setSyncState("offline", "변경 내용은 브라우저에 저장돼 있어요. 연결되면 다시 올립니다.");
      return;
    }

    state.isSyncing = true;
    state.pendingSync = false;
    setSyncState("syncing", reason === "initial-load" ? "기존 기록을 새 구조로 반영하는 중..." : "파이어베이스에 저장 중...");
    state.workspaceRef.set(clone(state.workspace)).then(function () {
      state.isSyncing = false;
      saveCachedWorkspace(state.workspace);
      setSyncState("synced", getSyncedLabel(state.workspace.updatedAt));
    }).catch(function (error) {
      console.error(error);
      state.isSyncing = false;
      state.pendingSync = true;
      setSyncState("offline", "업로드에 실패했어요. 연결되면 다시 시도합니다.");
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
      activeBoardId: state.prefs.activeBoardId,
      hideChecked: state.prefs.hideChecked,
      activeCategoryByBoard: clone(state.prefs.activeCategoryByBoard),
      collapsedByBoard: clone(state.prefs.collapsedByBoard),
      editorOpen: state.editor.open
    };

    setActiveCategoryId(ALL_CATEGORY_ID);
    state.prefs.hideChecked = false;
    state.board.categories.forEach(function (category) {
      getCollapsedMap()[category.id] = false;
    });
    state.editor.open = false;
    render();
  }

  function restorePrintState() {
    if (!state.printSnapshot) return;
    state.prefs.activeBoardId = state.printSnapshot.activeBoardId;
    state.prefs.hideChecked = state.printSnapshot.hideChecked;
    state.prefs.activeCategoryByBoard = state.printSnapshot.activeCategoryByBoard;
    state.prefs.collapsedByBoard = state.printSnapshot.collapsedByBoard;
    state.editor.open = state.printSnapshot.editorOpen;
    state.printSnapshot = null;
    syncActiveBoardFromWorkspace();
    savePrefs();
    render();
  }

  function loadCachedWorkspace() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      return sanitizeWorkspace(JSON.parse(raw));
    } catch (error) {
      return null;
    }
  }

  function saveCachedWorkspace(workspace) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(workspace));
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
    var boards = state.workspace && Array.isArray(state.workspace.boards) ? state.workspace.boards : [];
    var firstBoardId = boards[0] ? boards[0].id : "";
    if (!state.prefs.activeBoardId || !findBoard(state.workspace, state.prefs.activeBoardId)) {
      state.prefs.activeBoardId = firstBoardId;
    }
    if (!state.prefs.activeCategoryByBoard || typeof state.prefs.activeCategoryByBoard !== "object") {
      state.prefs.activeCategoryByBoard = {};
    }
    if (!state.prefs.collapsedByBoard || typeof state.prefs.collapsedByBoard !== "object") {
      state.prefs.collapsedByBoard = {};
    }
    boards.forEach(function (board) {
      ensureBoardPrefs(board.id);
      var validCategoryIds = board.categories.map(function (category) { return category.id; });
      var activeCategoryId = state.prefs.activeCategoryByBoard[board.id];
      if (activeCategoryId !== ALL_CATEGORY_ID && validCategoryIds.indexOf(activeCategoryId) === -1) {
        state.prefs.activeCategoryByBoard[board.id] = ALL_CATEGORY_ID;
      }
      Object.keys(state.prefs.collapsedByBoard[board.id]).forEach(function (categoryId) {
        if (validCategoryIds.indexOf(categoryId) === -1) delete state.prefs.collapsedByBoard[board.id][categoryId];
      });
    });
    savePrefs();
  }

  function createDefaultPrefs() {
    return {
      search: "",
      hideChecked: false,
      activeBoardId: "",
      activeCategoryByBoard: {},
      collapsedByBoard: {}
    };
  }

  function sanitizeWorkspace(raw) {
    if (!raw) return null;
    if (Array.isArray(raw.boards)) {
      var boards = raw.boards.map(sanitizeBoard).filter(Boolean);
      if (!boards.length) return null;
      return { schemaVersion: Number(raw.schemaVersion || 2), updatedAt: Number(raw.updatedAt || 0), boards: boards };
    }
    var singleBoard = sanitizeBoard(raw);
    if (!singleBoard) return null;
    return { schemaVersion: 2, updatedAt: Number(raw.updatedAt || singleBoard.updatedAt || 0), boards: [singleBoard] };
  }

  function sanitizeBoard(raw) {
    if (!raw || !Array.isArray(raw.categories)) return null;
    var categories = raw.categories.map(sanitizeCategory).filter(Boolean);
    if (!categories.length) categories = [createCategory("기본")];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("board"),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : DEFAULT_BOARD_TITLE,
      updatedAt: Number(raw.updatedAt || 0),
      source: typeof raw.source === "string" ? raw.source : "",
      schemaVersion: Number(raw.schemaVersion || 1),
      categories: categories
    };
  }

  function sanitizeCategory(raw) {
    if (!raw) return null;
    var items = Array.isArray(raw.items) ? raw.items.map(sanitizeItem).sort(sortItems) : [];
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("cat"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "새 필터",
      items: items
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

  function syncActiveBoardFromWorkspace() {
    state.board = findBoard(state.workspace, getActiveBoardId()) || (state.workspace && state.workspace.boards[0]) || null;
    if (state.board) {
      state.prefs.activeBoardId = state.board.id;
      ensureBoardPrefs(state.board.id);
    }
  }

  function getActiveBoardId() {
    return state.prefs.activeBoardId || "";
  }

  function ensureBoardPrefs(boardId) {
    if (!boardId) return;
    if (!state.prefs.activeCategoryByBoard[boardId]) state.prefs.activeCategoryByBoard[boardId] = ALL_CATEGORY_ID;
    if (!state.prefs.collapsedByBoard[boardId] || typeof state.prefs.collapsedByBoard[boardId] !== "object") {
      state.prefs.collapsedByBoard[boardId] = {};
    }
  }

  function getActiveCategoryId() {
    var boardId = getActiveBoardId();
    ensureBoardPrefs(boardId);
    return state.prefs.activeCategoryByBoard[boardId] || ALL_CATEGORY_ID;
  }

  function setActiveCategoryId(categoryId, boardId) {
    var targetBoardId = boardId || getActiveBoardId();
    ensureBoardPrefs(targetBoardId);
    state.prefs.activeCategoryByBoard[targetBoardId] = categoryId || ALL_CATEGORY_ID;
  }

  function getCollapsedMap(boardId) {
    var targetBoardId = boardId || getActiveBoardId();
    ensureBoardPrefs(targetBoardId);
    return state.prefs.collapsedByBoard[targetBoardId];
  }

  function findBoard(workspace, boardId) {
    if (!workspace || !Array.isArray(workspace.boards)) return null;
    return workspace.boards.find(function (board) { return board.id === boardId; }) || null;
  }

  function findCategory(board, categoryId) {
    return board.categories.find(function (category) { return category.id === categoryId; }) || null;
  }

  function findItem(category, itemId) {
    return category.items.find(function (item) { return item.id === itemId; }) || null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 10);
  }

  function createCategory(name) {
    return { id: createId("cat"), name: name || "새 필터", items: [] };
  }

  function createEmptyDraft(categoryId) {
    return { categoryId: categoryId || "", name: "", memo: "", qty: "", tag: "", checked: false };
  }

  function createWorkspaceFromBoard(board) {
    return sanitizeWorkspace({ schemaVersion: 2, updatedAt: Date.now(), boards: [board] });
  }

  function createFallbackWorkspace() {
    return createWorkspaceFromBoard(createFallbackBoard());
  }

  function createScenarioBoard(title) {
    return sanitizeBoard({
      id: createId("board"),
      title: title || "새 체크리스트",
      updatedAt: Date.now(),
      source: "scenario-template",
      schemaVersion: 2,
      categories: [
        createCategory("준비물"),
        createCategory("예약/서류"),
        createCategory("현장 할 일"),
        createCategory("직접 추가")
      ]
    });
  }

  function duplicateBoardForScenario(board, title) {
    return sanitizeBoard({
      id: createId("board"),
      title: title || board.title,
      updatedAt: Date.now(),
      source: "board-duplicate",
      schemaVersion: 2,
      categories: board.categories.map(function (category) {
        return {
          id: createId("cat"),
          name: category.name,
          items: category.items.map(function (item) {
            return sanitizeItem({
              id: createId("item"),
              name: item.name,
              memo: item.memo,
              qty: item.qty,
              tag: item.tag,
              checked: false
            });
          }).sort(sortItems)
        };
      })
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();










