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

  var DB_PATH = "travel_checklist_compact_v1";
  var CACHE_KEY = "travel_checklist_compact_cache_v1";
  var PREFS_KEY = "travel_checklist_compact_prefs_v1";

  var state = {
    board: null,
    prefs: loadPrefs(),
    dbReady: false,
    boardRef: null,
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
    state.board = loadCachedBoard() || createSampleBoard();
    normalizePrefs();
    bindEvents();
    render();
    initFirebase();
  }

  function cacheElements() {
    els.appShell = document.getElementById("appShell");
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
      setSyncState("offline", "Firebase unavailable. Local cache only.");
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      var db = firebase.database();
      state.boardRef = db.ref(DB_PATH);
      state.dbReady = true;

      db.ref(".info/connected").on("value", function (snapshot) {
        state.isConnected = snapshot.val() === true;
        if (state.isConnected) {
          if (state.pendingSync) {
            syncBoard("reconnect");
          } else if (!state.remoteLoaded) {
            setSyncState("syncing", "Connecting to Firebase...");
          } else {
            setSyncState("synced", getSyncedLabel(state.board.updatedAt));
          }
        } else {
          setSyncState(
            state.remoteLoaded ? "offline" : "syncing",
            state.remoteLoaded
              ? "Offline. Changes stay in this browser until reconnected."
              : "Connecting to Firebase..."
          );
        }
      });

      state.boardRef.on("value", function (snapshot) {
        var remote = sanitizeBoard(snapshot.val());
        state.remoteLoaded = true;

        if (!remote) {
          if (!state.pendingSync) state.pendingSync = true;
          syncBoard("seed");
          return;
        }

        var localUpdatedAt = Number(state.board.updatedAt || 0);
        var remoteUpdatedAt = Number(remote.updatedAt || 0);

        if (state.pendingSync && localUpdatedAt > remoteUpdatedAt) {
          syncBoard("keep-local");
          return;
        }

        state.board = remote;
        saveCachedBoard(state.board);
        normalizePrefs();
        render();
        setSyncState(state.isConnected ? "synced" : "offline", getSyncedLabel(remoteUpdatedAt));
      }, function () {
        setSyncState("offline", "Cannot read Firebase. Using local cache.");
      });
    } catch (error) {
      console.error(error);
      setSyncState("offline", "Firebase init failed. Using local cache.");
    }
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
      toggleItemChecked(event.target.getAttribute("data-category-id"), event.target.getAttribute("data-item-id"), event.target.checked);
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
    var categoryId = draft.categoryId;
    var name = draft.name;
    var memo = draft.memo;
    var qty = draft.qty;
    var tag = draft.tag;
    var checked = draft.checked;

    if (!name) {
      els.itemName.focus();
      return;
    }

    applyBoardChange(function (board) {
      var category = findCategory(board, categoryId);
      if (!category) return false;

      if (state.editor.mode === "edit") {
        var item = findItem(category, state.editor.itemId);
        if (!item) return false;
        item.name = name;
        item.memo = memo;
        item.qty = qty;
        item.tag = tag;
        item.checked = checked;
      } else {
        category.items.push({
          id: createId("item"),
          name: name,
          memo: memo,
          qty: qty,
          tag: tag,
          checked: checked
        });
      }

      category.items.sort(sortItems);
      return true;
    });

    closeEditor();
  }

  function render() {
    normalizePrefs();
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
    els.overallDone.textContent = stats.done + " / " + stats.total;
    els.overallPct.textContent = stats.total ? stats.pct + "%" : "0%";

    var visible = getVisibleSummary();
    els.visibleSummary.textContent = visible.items + " visible item" + (visible.items === 1 ? "" : "s");
    els.visibleHint.textContent = visible.categories + " categor" + (visible.categories === 1 ? "y" : "ies") + " shown";

    var hasFilters = !!state.prefs.search.trim() || !!state.prefs.hideChecked;
    els.clearSearchButton.hidden = !hasFilters;
  }

  function renderTabs() {
    var allStats = getBoardStats(state.board);
    var html = [];
    html.push(renderCategoryPill("all", "All", allStats.done, allStats.total, state.prefs.activeCategory === "all"));

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
      '">',
      '<span class="category-pill__name">',
      escapeHtml(name),
      "</span>",
      '<span class="category-pill__meta">',
      escapeHtml(done + " / " + total),
      "</span>",
      "</button>"
    ].join("");
  }

  function renderCategories() {
    var categories = getFilteredCategories();

    if (!categories.length) {
      els.categoryList.innerHTML = '<section class="category-section"><div class="empty-state">No items match the current filters.</div></section>';
      return;
    }

    els.categoryList.innerHTML = categories.map(renderCategorySection).join("");
  }

  function renderCategorySection(category) {
    var stats = getCategoryStats(category.source);
    var collapsed = !!state.prefs.collapsed[category.source.id];
    var pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    var itemsHtml = collapsed
      ? ""
      : (category.items.length
        ? '<ul class="category-items">' + category.items.map(function (item) {
            return renderItemRow(category.source.id, item);
          }).join("") + "</ul>"
        : '<div class="empty-state">Nothing to show in this category right now.</div>');

    return [
      '<section class="category-section" id="category-',
      escapeHtml(category.source.id),
      '">',
      '<div class="category-header">',
      '<div class="category-header__left">',
      '<button type="button" class="btn category-toggle" data-action="toggle-category" data-category-id="',
      escapeHtml(category.source.id),
      '">',
      collapsed ? "Expand" : "Collapse",
      "</button>",
      '<div><div class="category-name">',
      escapeHtml(category.source.name),
      "</div>",
      '<div class="category-progress"><span>',
      escapeHtml(stats.done + " / " + stats.total + " packed"),
      '</span><span class="category-progress__bar"><i style="width:',
      String(pct),
      '%"></i></span></div></div>',
      "</div>",
      '<div class="category-header__right">',
      '<span class="badge">',
      escapeHtml(String(category.items.length) + " shown"),
      "</span>",
      '<button type="button" class="btn" data-action="add-item-in-category" data-category-id="',
      escapeHtml(category.source.id),
      '">Add</button>',
      "</div>",
      "</div>",
      itemsHtml,
      "</section>"
    ].join("");
  }

  function renderItemRow(categoryId, item) {
    var meta = [];
    if (item.memo) meta.push('<span>' + escapeHtml(item.memo) + "</span>");
    if (item.qty) meta.push('<span>Qty ' + escapeHtml(item.qty) + "</span>");
    if (item.tag) meta.push('<span>Tag ' + escapeHtml(item.tag) + "</span>");

    var badges = [];
    if (item.qty) badges.push('<span class="badge">Qty ' + escapeHtml(item.qty) + "</span>");
    if (item.tag) badges.push('<span class="badge">' + escapeHtml(item.tag) + "</span>");

    return [
      '<li class="item-row',
      item.checked ? " is-checked" : "",
      '">',
      '<input class="item-check" type="checkbox" data-role="item-check" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '"',
      item.checked ? " checked" : "",
      " />",
      '<div class="item-main">',
      '<div class="item-main__line">',
      '<span class="item-name">',
      escapeHtml(item.name),
      "</span>",
      badges.length ? '<span class="badge-row">' + badges.join("") + "</span>" : "",
      "</div>",
      meta.length ? '<div class="item-meta">' + meta.join("") + "</div>" : "",
      "</div>",
      '<button type="button" class="icon-btn" data-action="edit-item" data-category-id="',
      escapeHtml(categoryId),
      '" data-item-id="',
      escapeHtml(item.id),
      '">Edit</button>',
      "</li>"
    ].join("");
  }

  function renderEditor() {
    populateCategoryOptions();

    if (!state.editor.draft) {
      state.editor.draft = createEmptyDraft(state.editor.categoryId || getDefaultCategoryId());
    }

    var draft = state.editor.draft;

    els.editorPanel.setAttribute("aria-hidden", state.editor.open ? "false" : "true");
    els.editorTitle.textContent = state.editor.mode === "edit" ? "Edit item" : "Add item";
    els.editorHint.textContent = state.editor.mode === "edit"
      ? "Update name, memo, qty, or tag."
      : "Add a compact row to the selected category.";
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
    if (!window.confirm("Delete this item?")) return;

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
    state.prefs.activeCategory = categoryId || "all";
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

  function setAllCollapsed(value) {
    state.board.categories.forEach(function (category) {
      state.prefs.collapsed[category.id] = !!value;
    });
    savePrefs();
    render();
  }

  function clearFilters() {
    state.prefs.search = "";
    state.prefs.hideChecked = false;
    state.prefs.activeCategory = "all";
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
    if (state.prefs.activeCategory !== "all" && findCategory(state.board, state.prefs.activeCategory)) {
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
        return selectedId === "all" || category.id === selectedId;
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
      items: categories.reduce(function (sum, category) {
        return sum + category.items.length;
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
    return {
      total: total,
      done: done
    };
  }

  function applyBoardChange(mutator) {
    var nextBoard = clone(state.board);
    var changed = mutator(nextBoard);
    if (!changed) return;

    nextBoard.updatedAt = Date.now();
    nextBoard.categories.forEach(function (category) {
      category.items = category.items.map(sanitizeItem).sort(sortItems);
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
        setSyncState("offline", "Saved locally. Waiting for Firebase connection.");
      }
      return;
    }

    state.isSyncing = true;
    state.pendingSync = false;
    setSyncState("syncing", reason === "seed" ? "Seeding Firebase..." : "Syncing...");

    state.boardRef.set(clone(state.board)).then(function () {
      state.isSyncing = false;
      saveCachedBoard(state.board);
      setSyncState("synced", getSyncedLabel(state.board.updatedAt));
    }).catch(function (error) {
      console.error(error);
      state.isSyncing = false;
      state.pendingSync = true;
      setSyncState("offline", "Sync failed. Changes kept in local cache.");
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

    state.prefs.activeCategory = "all";
    state.prefs.hideChecked = false;
    setAllCollapsed(false);
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
    var validIds = state.board.categories.map(function (category) { return category.id; });
    if (state.prefs.activeCategory !== "all" && validIds.indexOf(state.prefs.activeCategory) === -1) {
      state.prefs.activeCategory = "all";
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
      activeCategory: "all",
      collapsed: {}
    };
  }

  function sanitizeBoard(raw) {
    if (!raw || !Array.isArray(raw.categories)) return null;

    return {
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Travel Checklist",
      updatedAt: Number(raw.updatedAt || 0),
      categories: raw.categories.map(sanitizeCategory).filter(Boolean)
    };
  }

  function sanitizeCategory(raw) {
    if (!raw || !Array.isArray(raw.items)) return null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("cat"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Category",
      items: raw.items.map(sanitizeItem).sort(sortItems)
    };
  }

  function sanitizeItem(raw) {
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : createId("item"),
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Untitled item",
      memo: typeof raw.memo === "string" ? raw.memo.trim() : "",
      qty: typeof raw.qty === "string" ? raw.qty.trim() : "",
      tag: typeof raw.tag === "string" ? raw.tag.trim() : "",
      checked: !!raw.checked
    };
  }

  function sortItems(a, b) {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return a.name.localeCompare(b.name);
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
    if (!updatedAt) return "Ready";
    var date = new Date(updatedAt);
    return "Synced " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createSampleBoard() {
    return {
      title: "Travel Checklist",
      updatedAt: Date.now(),
      categories: [
        {
          id: "documents",
          name: "Documents",
          items: [
            { id: createId("item"), name: "Passport", memo: "Check expiry date", qty: "1", tag: "Required", checked: false },
            { id: createId("item"), name: "Boarding pass", memo: "Screenshot backup", qty: "", tag: "Airport", checked: false },
            { id: createId("item"), name: "Hotel confirmation", memo: "Email + PDF copy", qty: "", tag: "Booking", checked: false },
            { id: createId("item"), name: "Credit card", memo: "Travel card if available", qty: "2", tag: "Payment", checked: false }
          ]
        },
        {
          id: "clothes",
          name: "Clothes",
          items: [
            { id: createId("item"), name: "T-shirts", memo: "Daily rotation", qty: "4", tag: "Clothes", checked: false },
            { id: createId("item"), name: "Underwear", memo: "", qty: "4", tag: "Clothes", checked: false },
            { id: createId("item"), name: "Socks", memo: "", qty: "4 pairs", tag: "Clothes", checked: false },
            { id: createId("item"), name: "Light jacket", memo: "For plane or night", qty: "1", tag: "Layer", checked: false },
            { id: createId("item"), name: "Sleepwear", memo: "", qty: "1", tag: "Hotel", checked: true }
          ]
        },
        {
          id: "toiletries",
          name: "Toiletries",
          items: [
            { id: createId("item"), name: "Toothbrush", memo: "Compact case", qty: "1", tag: "Bathroom", checked: false },
            { id: createId("item"), name: "Toothpaste", memo: "Travel size", qty: "1", tag: "Bathroom", checked: false },
            { id: createId("item"), name: "Sunscreen", memo: "", qty: "1", tag: "Skincare", checked: false },
            { id: createId("item"), name: "Medicine pouch", memo: "Painkiller, motion sickness", qty: "1", tag: "Health", checked: false }
          ]
        },
        {
          id: "tech",
          name: "Tech",
          items: [
            { id: createId("item"), name: "Phone charger", memo: "", qty: "1", tag: "Essential", checked: false },
            { id: createId("item"), name: "Power bank", memo: "Charge before departure", qty: "1", tag: "Carry-on", checked: false },
            { id: createId("item"), name: "Plug adapter", memo: "If overseas", qty: "1", tag: "Adapter", checked: false },
            { id: createId("item"), name: "Earbuds", memo: "", qty: "1", tag: "Flight", checked: true }
          ]
        },
        {
          id: "dayof",
          name: "Day-of Travel",
          items: [
            { id: createId("item"), name: "Water bottle", memo: "Fill after security", qty: "1", tag: "Carry-on", checked: false },
            { id: createId("item"), name: "Snacks", memo: "Long transfer backup", qty: "2", tag: "Carry-on", checked: false },
            { id: createId("item"), name: "Neck pillow", memo: "", qty: "1", tag: "Flight", checked: false },
            { id: createId("item"), name: "House keys", memo: "Front pocket", qty: "1", tag: "Before leaving", checked: true }
          ]
        }
      ]
    };
  }
})();
