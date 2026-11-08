import { firebaseConfig } from "./firebase-config.js";

const FB_VER = "10.14.1";
const ROOM_KEY = "wb.room";

const DEFAULT_EXPENSE_CATS = ["会場・料理", "衣装・美容", "写真・映像", "装花・装飾", "引出物・ギフト", "招待状・ペーパー", "演出・司会", "指輪", "前撮り", "新婚旅行", "その他"];
const DEFAULT_INCOME_CATS = ["ご祝儀", "親からの援助", "その他の収入"];

const $ = (s) => document.querySelector(s);
const yen = (n) => (n < 0 ? "−" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  items: [],
  settings: { nameA: "新郎", nameB: "新婦", expenseCats: DEFAULT_EXPENSE_CATS, incomeCats: DEFAULT_INCOME_CATS },
  filter: "all",
  editingId: null,
};

// カテゴリ一覧。設定にないカテゴリが付いた項目（削除済みカテゴリなど）も消さずに後ろへ並べる
function cats(type) {
  const base = type === "income" ? state.settings.incomeCats : state.settings.expenseCats;
  const extra = [...new Set(state.items.filter((x) => x.type === type && x.category && !base.includes(x.category)).map((x) => x.category))];
  return [...base, ...extra];
}
let store = null;

/* ---------------- 保存先（Firebase / お試し） ---------------- */

const useFirebase = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

function newRoomCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

async function firebaseStore() {
  const base = `https://www.gstatic.com/firebasejs/${FB_VER}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${base}/firebase-auth.js`);
  const fs = await import(`${base}/firebase-firestore.js`);

  const app = initializeApp(firebaseConfig);
  await signInAnonymously(getAuth(app));
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }

  let unsubs = [];
  let room = null;
  return {
    async exists(code) {
      const snap = await fs.getDoc(fs.doc(db, "rooms", code));
      return snap.exists();
    },
    async create(code, settings) {
      await fs.setDoc(fs.doc(db, "rooms", code), { ...settings, createdAt: fs.serverTimestamp() });
    },
    open(code, onItems, onSettings) {
      unsubs.forEach((u) => u());
      room = fs.doc(db, "rooms", code);
      unsubs = [
        fs.onSnapshot(fs.collection(room, "items"), (snap) => onItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => toast("読み込みエラー：" + e.code)),
        fs.onSnapshot(room, (snap) => snap.exists() && onSettings(snap.data())),
      ];
    },
    add: (item) => fs.addDoc(fs.collection(room, "items"), { ...item, createdAt: fs.serverTimestamp() }),
    update: (id, item) => fs.updateDoc(fs.doc(room, "items", id), item),
    remove: (id) => fs.deleteDoc(fs.doc(room, "items", id)),
    saveSettings: (s) => fs.setDoc(room, s, { merge: true }),
    close() { unsubs.forEach((u) => u()); unsubs = []; },
  };
}

function localStore() {
  let code, onItems, onSettings;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(`wb.${code}.${k}`)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(`wb.${code}.${k}`, JSON.stringify(v));
  const emit = () => { onItems(read("items", [])); onSettings(read("settings", {})); };
  return {
    async exists() { return true; },
    async create(c, settings) { code = c; write("settings", settings); },
    open(c, a, b) { code = c; onItems = a; onSettings = b; emit(); },
    async add(item) { const l = read("items", []); l.push({ ...item, id: crypto.randomUUID() }); write("items", l); emit(); },
    async update(id, item) { write("items", read("items", []).map((x) => (x.id === id ? { ...x, ...item } : x))); emit(); },
    async remove(id) { write("items", read("items", []).filter((x) => x.id !== id)); emit(); },
    async saveSettings(s) { write("settings", { ...read("settings", {}), ...s }); emit(); },
    close() {},
  };
}

/* ---------------- 画面 ---------------- */

function payerOptions() {
  const { nameA, nameB } = state.settings;
  return [
    ["A", nameA],
    ["B", nameB],
    ["both", "二人の共通口座"],
    ["familyA", `${nameA}の家族`],
    ["familyB", `${nameB}の家族`],
  ];
}
const payerName = (k) => (payerOptions().find(([v]) => v === k) || [k, "—"])[1];

function totals(items) {
  let income = 0, expense = 0, unpaid = 0;
  for (const it of items) {
    if (it.type === "income") income += it.amount;
    else { expense += it.amount; if (!it.paid) unpaid += it.amount; }
  }
  return { income, expense, unpaid, balance: income - expense };
}

function render() {
  const t = totals(state.items);
  $("#sumIncome").textContent = yen(t.income);
  $("#sumExpense").textContent = yen(t.expense);
  $("#sumUnpaid").textContent = yen(t.unpaid);
  const bal = $("#sumBalance");
  bal.textContent = yen(t.balance);
  bal.className = "big " + (t.balance < 0 ? "expense" : t.balance > 0 ? "income" : "");
  renderList();
  renderStats();
}

function renderList() {
  const f = state.filter;
  const items = state.items.filter((it) =>
    f === "all" ? true : f === "unpaid" ? it.type === "expense" && !it.paid : it.type === f
  );
  const order = { expense: cats("expense"), income: cats("income") };
  const groups = new Map();
  for (const it of items) {
    const key = `${it.type}|${it.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const [ta, ca] = a.split("|"), [tb, cb] = b.split("|");
    if (ta !== tb) return ta === "income" ? -1 : 1;
    return order[ta].indexOf(ca) - order[tb].indexOf(cb);
  });
  $("#emptyMsg").hidden = items.length > 0;
  $("#list").innerHTML = keys.map((key) => {
    const list = groups.get(key).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const [type, cat] = key.split("|");
    const sum = list.reduce((s, x) => s + x.amount, 0);
    return `<div class="group-head"><span>${type === "income" ? "収入" : "支出"}・${esc(cat)}</span><span>${yen(sum)}</span></div>
      <div class="card">${list.map((it) => `
        <div class="item" data-id="${esc(it.id)}">
          <div class="main">
            <div class="t">${esc(it.title)}</div>
            <div class="sub">${esc(payerName(it.payer))}${it.date ? "・" + esc(it.date.replaceAll("-", "/")) : ""}${it.type === "expense" && !it.paid ? '<span class="tag unpaid">未払い</span>' : ""}${it.memo ? '<span class="tag">メモ</span>' : ""}</div>
          </div>
          <div class="amt ${it.type}">${it.type === "income" ? "+" : "−"}${yen(it.amount).replace("−", "")}</div>
        </div>`).join("")}</div>`;
  }).join("");
}

function catStats(type, el) {
  const items = state.items.filter((x) => x.type === type);
  const total = items.reduce((s, x) => s + x.amount, 0);
  const rows = cats(type)
    .map((c) => [c, items.filter((x) => x.category === c).reduce((s, x) => s + x.amount, 0)])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  el.innerHTML = rows.length
    ? rows.map(([c, v]) => `<div class="stat-row"><div class="stat-line"><span>${esc(c)}</span><b>${yen(v)}<span class="muted small">（${Math.round((v / total) * 100)}%）</span></b></div><div class="bar"><i style="width:${(v / rows[0][1]) * 100}%"></i></div></div>`).join("")
    : `<div class="stat-row muted">まだありません</div>`;
}

function renderStats() {
  catStats("expense", $("#statsCategory"));
  catStats("income", $("#statsIncome"));
  renderCatEditor();
  const rows = payerOptions().map(([k, name]) => {
    const out = state.items.filter((x) => x.type === "expense" && x.payer === k).reduce((s, x) => s + x.amount, 0);
    const inc = state.items.filter((x) => x.type === "income" && x.payer === k).reduce((s, x) => s + x.amount, 0);
    return { name, out, inc, net: inc - out };
  }).filter((r) => r.out || r.inc);
  $("#statsPayer").innerHTML = rows.length
    ? `<div class="payer-grid"><span class="h"></span><span class="h r">払った</span><span class="h r">受け取った</span><span class="h r">お金の動き</span>
      ${rows.map((r) => `<span>${esc(r.name)}</span><span class="r">${yen(r.out)}</span><span class="r">${yen(r.inc)}</span><span class="r ${r.net < 0 ? "expense" : "income"}">${yen(r.net)}</span>`).join("")}</div>`
    : `<div class="stat-row muted">まだありません</div>`;
}

/* ---------------- カテゴリ編集 ---------------- */
// カテゴリの追加・削除・並べ替えは「設定（部屋の情報）」だけを書き換える。
// 入力済みの項目データには一切触れないので、カテゴリを消しても項目は消えない。

function renderCatEditor() {
  for (const type of ["expense", "income"]) {
    const key = type === "income" ? "incomeCats" : "expenseCats";
    const list = state.settings[key];
    $(`#catList-${type}`).innerHTML = list.map((c, i) => {
      const n = state.items.filter((x) => x.type === type && x.category === c).length;
      return `<li>
        <span class="cat-name">${esc(c)}${n ? `<span class="muted small">（${n}件）</span>` : ""}</span>
        <button type="button" class="icon-btn" data-act="up" data-type="${type}" data-i="${i}" aria-label="上へ" ${i === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="icon-btn" data-act="del" data-type="${type}" data-i="${i}" aria-label="削除">✕</button>
      </li>`;
    }).join("");
  }
}

async function saveCats(type, list) {
  const key = type === "income" ? "incomeCats" : "expenseCats";
  state.settings[key] = list;
  renderCatEditor();
  try { await store.saveSettings({ [key]: list }); }
  catch (e) { toast("保存に失敗しました：" + (e.code || e.message)); }
}

async function onCatEditorClick(e) {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const type = b.dataset.type, i = Number(b.dataset.i);
  const list = [...state.settings[type === "income" ? "incomeCats" : "expenseCats"]];
  if (b.dataset.act === "up" && i > 0) {
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    await saveCats(type, list);
  } else if (b.dataset.act === "del") {
    if (list.length <= 1) return toast("カテゴリは1つ以上必要です");
    const name = list[i];
    const n = state.items.filter((x) => x.type === type && x.category === name).length;
    const msg = n
      ? `「${name}」を選択肢から外しますか？\n\nこのカテゴリの項目${n}件は消えません。一覧や集計にはそのまま表示されます。`
      : `「${name}」を選択肢から外しますか？`;
    if (!confirm(msg)) return;
    list.splice(i, 1);
    await saveCats(type, list);
  }
}

async function onCatAdd(type) {
  const input = $(`#catNew-${type}`);
  const name = input.value.trim().slice(0, 20);
  if (!name) return;
  const list = state.settings[type === "income" ? "incomeCats" : "expenseCats"];
  if (list.includes(name)) return toast("同じ名前のカテゴリがあります");
  input.value = "";
  await saveCats(type, [...list, name]);
  toast(`「${name}」を追加しました`);
}

/* ---------------- 入力シート ---------------- */

function fillSelect(sel, opts, value) {
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (value != null && opts.some(([v]) => v === value)) sel.value = value;
}

function syncSheetType(type, keepCategory) {
  const f = $("#sheet");
  const list = cats(type);
  if (keepCategory && !list.includes(keepCategory)) list.push(keepCategory);
  fillSelect($("#fCategory"), list.map((c) => [c, c]), keepCategory);
  $("#payerLabel").textContent = type === "income" ? "受け取った人" : "払った人";
  $("#paidLabel").textContent = type === "income" ? "受け取り済み" : "支払い済み";
  f.paid.closest(".check").hidden = type === "income";
}

function openSheet(item) {
  const f = $("#sheet");
  state.editingId = item?.id ?? null;
  f.reset();
  const type = item?.type ?? (state.filter === "income" ? "income" : "expense");
  f.type.value = type;
  syncSheetType(type, item?.category);
  fillSelect($("#fPayer"), payerOptions(), item?.payer);
  f.title.value = item?.title ?? "";
  f.amount.value = item ? item.amount.toLocaleString("ja-JP") : "";
  f.date.value = item?.date ?? new Date().toLocaleDateString("sv-SE");
  f.paid.checked = item ? !!item.paid : state.filter !== "unpaid";
  f.memo.value = item?.memo ?? "";
  $("#sheetTitle").textContent = item ? "項目を編集" : "項目を追加";
  $("#deleteBtn").hidden = !item;
  $("#sheet").hidden = $("#sheetBackdrop").hidden = false;
  if (!item) setTimeout(() => f.title.focus(), 50);
}
function closeSheet() { $("#sheet").hidden = $("#sheetBackdrop").hidden = true; }

function parseAmount(s) {
  const n = parseInt(String(s).normalize("NFKC").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : NaN;
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const amount = parseAmount(f.amount.value);
  if (!(amount > 0)) return toast("金額を入力してください");
  const type = f.type.value;
  const item = {
    type,
    category: f.category.value,
    title: f.title.value.trim(),
    amount,
    payer: f.payer.value,
    date: f.date.value || "",
    paid: type === "income" ? true : f.paid.checked,
    memo: f.memo.value.trim(),
  };
  closeSheet();
  try {
    if (state.editingId) await store.update(state.editingId, item);
    else await store.add(item);
  } catch (err) { toast("保存に失敗しました：" + (err.code || err.message)); }
}

/* ---------------- その他 ---------------- */

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

function exportCsv() {
  const head = ["種別", "カテゴリ", "内容", "金額", "払った/受け取った人", "日付", "支払い済み", "メモ"];
  const rows = state.items.map((x) => [x.type === "income" ? "収入" : "支出", x.category, x.title, x.amount, payerName(x.payer), x.date, x.paid ? "済" : "未", x.memo]);
  const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "wedding-budget.csv" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function shareUrl(code) { return `${location.origin}${location.pathname}#join=${code}`; }

function showMain(code) {
  localStorage.setItem(ROOM_KEY, code);
  $("#joinView").hidden = true;
  $("#mainView").hidden = false;
  $("#modeBanner").hidden = useFirebase;
  $("#roomCodeView").textContent = code;
  store.open(
    code,
    (items) => { state.items = items.map((x) => ({ ...x, amount: Number(x.amount) || 0 })); render(); },
    (s) => {
      state.settings = {
        nameA: s.nameA || "新郎",
        nameB: s.nameB || "新婦",
        expenseCats: Array.isArray(s.expenseCats) && s.expenseCats.length ? s.expenseCats : DEFAULT_EXPENSE_CATS,
        incomeCats: Array.isArray(s.incomeCats) && s.incomeCats.length ? s.incomeCats : DEFAULT_INCOME_CATS,
      };
      $("#nameA").value = state.settings.nameA;
      $("#nameB").value = state.settings.nameB;
      render();
    }
  );
}

function showJoin(prefill = "") {
  $("#mainView").hidden = true;
  $("#joinView").hidden = false;
  $("#joinCode").value = prefill;
}

function bind() {
  $("#createRoomBtn").onclick = async () => {
    const code = newRoomCode();
    try { await store.create(code, { nameA: "新郎", nameB: "新婦" }); showMain(code); }
    catch (e) { $("#joinError").hidden = false; $("#joinError").textContent = "作成に失敗しました：" + (e.code || e.message); }
  };
  $("#joinRoomBtn").onclick = async () => {
    const code = $("#joinCode").value.trim().toLowerCase().replace(/\s/g, "");
    const err = $("#joinError");
    err.hidden = true;
    if (code.length < 16) { err.hidden = false; err.textContent = "合言葉が短すぎます"; return; }
    try {
      if (!(await store.exists(code))) { err.hidden = false; err.textContent = "その合言葉は見つかりませんでした"; return; }
      showMain(code);
    } catch (e) { err.hidden = false; err.textContent = "参加に失敗しました：" + (e.code || e.message); }
  };

  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("active", x === c));
    state.filter = c.dataset.filter;
    renderList();
  }));
  document.querySelectorAll(".nav-btn").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".nav-btn").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== b.dataset.tab));
    $("#fab").hidden = b.dataset.tab !== "tabList";
    window.scrollTo(0, 0);
  }));

  $("#list").onclick = (e) => {
    const el = e.target.closest(".item");
    if (el) openSheet(state.items.find((x) => x.id === el.dataset.id));
  };
  $("#fab").onclick = () => openSheet(null);
  $("#sheetClose").onclick = closeSheet;
  $("#sheetBackdrop").onclick = closeSheet;
  $("#sheet").onsubmit = onSubmit;
  $("#sheet").addEventListener("change", (e) => { if (e.target.name === "type") syncSheetType(e.target.value); });
  $("#sheet").amount.addEventListener("blur", (e) => {
    const n = parseAmount(e.target.value);
    if (n > 0) e.target.value = n.toLocaleString("ja-JP");
  });
  $("#deleteBtn").onclick = async () => {
    if (!confirm("この項目を削除しますか？")) return;
    const id = state.editingId;
    closeSheet();
    try { await store.remove(id); } catch (e) { toast("削除に失敗しました"); }
  };

  $("#saveNamesBtn").onclick = async () => {
    const s = { nameA: $("#nameA").value.trim() || "新郎", nameB: $("#nameB").value.trim() || "新婦" };
    await store.saveSettings(s);
    toast("保存しました");
  };
  $("#shareBtn").onclick = async () => {
    const url = shareUrl(localStorage.getItem(ROOM_KEY));
    if (navigator.share) {
      try { await navigator.share({ title: "結婚式の収支", text: "このリンクから一緒に管理しよう", url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast("リンクをコピーしました");
    }
  };
  $("#copyBtn").onclick = async () => {
    await navigator.clipboard.writeText(localStorage.getItem(ROOM_KEY));
    toast("合言葉をコピーしました");
  };
  $("#exportBtn").onclick = exportCsv;
  $("#catEditor").onclick = onCatEditorClick;
  for (const type of ["expense", "income"]) {
    $(`#catAdd-${type}`).onclick = () => onCatAdd(type);
    $(`#catNew-${type}`).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); onCatAdd(type); } });
  }
  $("#leaveBtn").onclick = () => {
    if (!confirm("この端末から退出しますか？（データは消えません）")) return;
    store.close();
    localStorage.removeItem(ROOM_KEY);
    state.items = [];
    showJoin();
  };
}

async function main() {
  bind();
  try {
    store = useFirebase ? await firebaseStore() : localStore();
  } catch (e) {
    console.error(e);
    showJoin();
    $("#joinError").hidden = false;
    $("#joinError").textContent = "サーバーに接続できませんでした。通信状況とFirebaseの設定を確認してください。";
    return;
  }

  const m = location.hash.match(/join=([a-z0-9]+)/);
  if (m) history.replaceState(null, "", location.pathname);
  const saved = localStorage.getItem(ROOM_KEY);
  if (m && m[1] !== saved) showJoin(m[1]);
  else if (saved) showMain(saved);
  else showJoin();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

main();
