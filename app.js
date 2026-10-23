'use strict';

/* =====================================================================
   1) ثوابت وتسميات
   ===================================================================== */
const KEY = 'wepplus_db_v1';
const AUTH_KEY = 'wepplus_auth_v1';
const SESSION_KEY = 'wepplus_session';
const PBKDF2_ITER = 200000;

const CYCLE = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const L = {
  cycle: { monthly: 'شهري', quarterly: 'ربع سنوي', semiannual: 'نصف سنوي', annual: 'سنوي' },
  website: { draft: 'قيد التجهيز', active: 'نشط', suspended: 'معلق لعدم الدفع', paused: 'متوقف بطلب العميل', maintenance: 'قيد النقل أو الصيانة', cancelled: 'ملغى' },
  websiteTone: { draft: 'info', active: 'ok', suspended: 'danger', paused: 'warn', maintenance: 'warn', cancelled: 'muted' },
  client: { potential: 'محتمل', interested: 'مهتم', proposal: 'عرض مقدم', active: 'عميل نشط', paused: 'متوقف', lost: 'مفقود' },
  source: { direct: 'تواصل مباشر', referral: 'إحالة', content: 'محتوى', ad: 'إعلان', other: 'مصدر آخر' },
  method: { cash: 'نقدي', bank: 'تحويل بنكي', ewallet: 'محفظة إلكترونية', other: 'أخرى' },
  payType: { payment: 'دفعة', refund: 'استرداد' },
  expenseCat: ['الاستضافة', 'الدومينات', 'البرامج والأدوات', 'التسويق', 'العمولات', 'أجور الموظفين', 'الصيانة', 'الرسوم المالية', 'مصروفات أخرى'],
  hostStatus: { active: 'نشط', inactive: 'متوقف' },
};

/* =====================================================================
   2) أدوات مساعدة
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);
const toCents = v => Math.round(parseFloat(String(v).replace(',', '.')) * 100) || 0;
const dollars = c => ((c || 0) / 100).toFixed(2);
const sumBy = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
const signed = p => (p.type === 'refund' ? -p.amountCents : p.amountCents);
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pairs = x => (Array.isArray(x) ? x.map(v => [v, v]) : Object.entries(x));
const withBlank = (list, label = '— بدون —') => [['', label], ...list];
const badge = (text, tone = '') => `<span class="badge ${tone}">${esc(text)}</span>`;

const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => fmtDate(new Date());
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addMonths = (s, n) => {
  const d = parseDate(s);
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return fmtDate(t);
};
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const monthKey = s => (s || '').slice(0, 7);
const normPhone = s => String(s || '').replace(/\D/g, '');

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">لا توجد بيانات مطابقة. أضف سجلًا جديدًا للبدء.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function owedCell(owed) {
  if (owed > 0) return `<span class="neg">${money(owed)}</span>`;
  if (owed < 0) return `<span class="pos">رصيد دائن ${money(-owed)}</span>`;
  return '<span class="pos">مسدد</span>';
}

/* =====================================================================
   3) قاعدة البيانات (localStorage)
   ===================================================================== */
function emptyDB() {
  return {
    clients: [], websites: [], payments: [], expenses: [], domains: [], hostings: [], audit: [],
    seq: { client: 0, website: 0 },
    settings: { companyName: 'WepPlus', defaultMonthlyCents: 2000, defaultDomainMonthlyCents: 100, sharedHostingYearlyCents: 5000 },
  };
}

function loadDB() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return emptyDB();
  try {
    return Object.assign(emptyDB(), JSON.parse(raw));
  } catch {
    localStorage.setItem(KEY + '_corrupt_' + Date.now(), raw);
    alert('تعذّر قراءة البيانات المحفوظة. تم حفظ نسخة منها قبل البدء بقاعدة فارغة.');
    return emptyDB();
  }
}

let db = loadDB();

const ui = {
  section: 'dashboard',
  clients: {}, websites: {}, payments: {}, expenses: {}, domains: {}, hosting: {},
  reports: { type: 'revenue', from: today().slice(0, 8) + '01', to: today() },
};

function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

function audit(action, text, clientId = null) {
  db.audit.unshift({ id: uid('a'), at: new Date().toISOString(), action, text, clientId });
  if (db.audit.length > 2000) db.audit.length = 2000;
}

/** يسجّل الحدث ويحفظ ويعيد الرسم */
function commit(action, text, clientId = null) {
  audit(action, text, clientId);
  save();
  renderSection();
}

const websiteById = id => db.websites.find(w => w.id === id);
const clientById = id => db.clients.find(c => c.id === id);
const clientName = id => clientById(id)?.name || '—';
const websiteName = id => websiteById(id)?.name || '—';

/* =====================================================================
   4) المنطق المالي
   - السعر التاريخي محفوظ في priceHistory، فتغيير السعر لا يعدّل الفواتير القديمة
   - الاستحقاق يحدث في تاريخ البداية ثم كل دورة، ولا يُعتبر الدفع تلقائيًا
   - المحصّل = مجموع الدفعات غير الملغاة (الاسترداد يُخصم)
   ===================================================================== */
function priceAt(w, date) {
  let cur = w.priceHistory[0];
  for (const p of w.priceHistory) if (p.from <= date) cur = p;
  return cur;
}
const currentPrice = w => w.priceHistory[w.priceHistory.length - 1];
const cyclePrice = (p, cycle) => Math.round(p.monthlyCents * CYCLE[cycle] * (1 - (p.discount || 0) / 100));
const monthlyEq = w => (w.status === 'active' ? cyclePrice(currentPrice(w), w.cycle) / CYCLE[w.cycle] : 0);

function paidOf(wid) {
  return sumBy(db.payments.filter(p => p.websiteId === wid && !p.voided), signed);
}

function finance(w, asOf = today()) {
  let total = 0, count = 0, nextDue = null;
  if (w.startDate && w.status !== 'draft') {
    const m = CYCLE[w.cycle];
    for (let k = 0; k < 1200; k++) {
      const due = addMonths(w.startDate, k * m);
      if (w.cancelDate && due > w.cancelDate) break;
      if (due > asOf) { nextDue = due; break; }
      total += cyclePrice(priceAt(w, due), w.cycle);
      count++;
    }
  }
  const paid = paidOf(w.id);
  return { total, count, paid, owed: total - paid, nextDue };
}

function clientTotals(cid) {
  return db.websites.filter(w => w.clientId === cid).reduce((a, w) => {
    const f = finance(w);
    a.total += f.total; a.paid += f.paid; a.owed += f.owed;
    return a;
  }, { total: 0, paid: 0, owed: 0 });
}

function hostingMonthly() {
  return sumBy(db.hostings.filter(h => h.status === 'active'), h => h.monthlyCostCents);
}
function hostingShare() {
  const act = db.websites.filter(w => w.status === 'active').length;
  return act ? Math.round(hostingMonthly() / act) : 0;
}
function domainMonthly(wid) {
  return Math.round(sumBy(db.domains.filter(d => d.websiteId === wid), d => d.annualCostCents) / 12);
}

/* =====================================================================
   5) النوافذ والنماذج
   ===================================================================== */
function openForm(title, fields, values, onSave) {
  $('#modal-title').textContent = title;
  const form = $('#modal-form');
  form.innerHTML = `<div class="grid-form">${fields.map(f => fieldHTML(f, values[f.name])).join('')}</div>
    <div class="form-error" id="form-error"></div>
    <div class="actions">
      <button type="submit" class="btn primary">حفظ</button>
      <button type="button" class="btn ghost" data-action="closeModal">إلغاء</button>
    </div>`;
  form.onsubmit = async e => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const el = form.querySelector(`[name="${f.name}"]`);
      data[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
    }
    const res = await onSave(data);
    if (res !== true) { $('#form-error').textContent = res || 'تحقق من البيانات'; return; }
    $('#modal').close();
    toast('تم الحفظ بنجاح');
  };
  $('#modal').showModal();
}

function fieldHTML(f, v) {
  if (v === undefined || v === null) v = '';
  const req = f.required ? 'required' : '';
  if (f.type === 'checkbox') {
    return `<label class="field check full"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  }
  let input;
  if (f.type === 'select') {
    input = `<select name="${f.name}">${f.options.map(([val, lab]) =>
      `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" rows="3">${esc(v)}</textarea>`;
  } else {
    input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req}
      ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}
      ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
  }
  return `<label class="field ${f.full ? 'full' : ''}"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}</label>`;
}

function openInfo(title, html) {
  $('#modal-title').textContent = title;
  const form = $('#modal-form');
  form.innerHTML = `<div class="info">${html}</div>
    <div class="actions"><button type="button" class="btn ghost" data-action="closeModal">إغلاق</button></div>`;
  form.onsubmit = e => e.preventDefault();
  $('#modal').showModal();
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'err' ? 'err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3200);
}

/* =====================================================================
   6) لوحة المعلومات
   ===================================================================== */
function renderDashboard() {
  const t = today(), m = monthKey(t);
  const live = db.websites.filter(w => w.status !== 'cancelled');
  const active = db.websites.filter(w => w.status === 'active');
  const fin = new Map(db.websites.map(w => [w.id, finance(w, t)]));
  const validPays = db.payments.filter(p => !p.voided);

  const collectedAll = sumBy(validPays, signed);
  const collectedMonth = sumBy(validPays.filter(p => monthKey(p.date) === m), signed);
  const expensesAll = sumBy(db.expenses, e => e.amountCents);
  const expensesMonth = sumBy(db.expenses.filter(e => monthKey(e.date) === m), e => e.amountCents);
  const owedTotal = sumBy(live, w => Math.max(0, fin.get(w.id).owed));
  const mrr = Math.round(sumBy(active, monthlyEq));
  const dueSoon = active.filter(w => { const d = fin.get(w.id).nextDue; return d && daysBetween(t, d) <= 7; });
  const overdue = live.filter(w => ['active', 'suspended'].includes(w.status) && fin.get(w.id).owed > 0);
  const newClients = db.clients.filter(c => monthKey(c.registeredAt) === m).length;
  const cancelled = db.websites.filter(w => w.status === 'cancelled').length;
  const profitMonth = collectedMonth - expensesMonth;

  const cards = [
    ['إجمالي العملاء', db.clients.length],
    ['العملاء النشطون', db.clients.filter(c => c.status === 'active').length],
    ['إجمالي المواقع', db.websites.length],
    ['المواقع النشطة', active.length],
    ['اشتراكات مستحقة خلال 7 أيام', dueSoon.length],
    ['اشتراكات متأخرة عن الدفع', overdue.length],
    ['محصّل فعليًا هذا الشهر', money(collectedMonth)],
    ['مستحق وغير محصّل (كل الفترات)', money(owedTotal)],
    ['مصروفات مسجّلة هذا الشهر', money(expensesMonth)],
    ['ربح تشغيلي نقدي هذا الشهر', money(profitMonth)],
    ['الإيراد الشهري المتكرر MRR', money(mrr)],
    ['الإيراد السنوي المتوقع ARR', money(mrr * 12)],
    ['متوسط الإيراد لكل موقع نشط', money(active.length ? Math.round(mrr / active.length) : 0)],
    ['عملاء جدد هذا الشهر', newClients],
    ['مواقع ملغاة', cancelled],
    ['صافي التدفق النقدي (كل الفترات)', money(collectedAll - expensesAll)],
  ];

  // التنبيهات
  const alerts = [];
  overdue.forEach(w => alerts.push(['danger', `${w.name}: عليه مبلغ مستحق ${money(fin.get(w.id).owed)}`]));
  dueSoon.forEach(w => alerts.push(['warn', `${w.name}: الاستحقاق القادم ${fin.get(w.id).nextDue}`]));
  db.domains.forEach(d => {
    const days = daysBetween(t, d.expiresAt);
    if (days < 0) alerts.push(['danger', `الدومين ${d.name} منتهٍ منذ ${-days} يوم`]);
    else if (days <= 30) alerts.push(['warn', `الدومين ${d.name} ينتهي خلال ${days} يوم`]);
  });

  // بيانات آخر 12 شهرًا
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = parseDate(t); d.setDate(1); d.setMonth(d.getMonth() - i);
    months.push(fmtDate(d).slice(0, 7));
  }
  const series = months.map(k => {
    const rev = sumBy(validPays.filter(p => monthKey(p.date) === k), signed);
    const exp = sumBy(db.expenses.filter(e => monthKey(e.date) === k), e => e.amountCents);
    const newC = db.clients.filter(c => monthKey(c.registeredAt) === k).length;
    return { k, rev, exp, profit: rev - exp, newC };
  });

  const statusBars = Object.keys(L.website).map(k => {
    const n = db.websites.filter(w => w.status === k).length;
    const pct = db.websites.length ? (n / db.websites.length) * 100 : 0;
    return `<div class="bar-row"><span class="label">${L.website[k]}</span>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div><span class="count">${n}</span></div>`;
  }).join('');

  $('#dashboard').innerHTML = `
    <div class="page-head"><div><h2>لوحة المعلومات</h2>
      <p class="muted">المحصّل فعليًا = دفعات مسجلة. المستحق = رصيد غير مدفوع. ARR متوقع وليس نقدًا.</p></div></div>
    <div class="kpis">${cards.map(([l, v]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong></div>`).join('')}</div>

    <div class="grid-2">
      <div class="card">
        <h3>الإيرادات المحصّلة مقابل المصروفات (12 شهرًا)</h3>
        <canvas id="chart-flow" class="chart"></canvas>
        <div class="legend"><span class="dot" style="background:#1e3a8a"></span>محصّل<span class="dot" style="background:#f59e0b"></span>مصروفات</div>
      </div>
      <div class="card"><h3>توزيع المواقع حسب الحالة</h3>${statusBars}</div>
    </div>

    <div class="card"><h3>تنبيهات تحتاج متابعة</h3>
      ${alerts.length ? alerts.slice(0, 15).map(([tone, txt]) => `<div class="alert ${tone}">${esc(txt)}</div>`).join('')
        : '<div class="muted">لا توجد تنبيهات حاليًا.</div>'}
    </div>

    <div class="card"><h3>تفاصيل الأشهر الأخيرة</h3>
      ${table(['الشهر', 'محصّل', 'مصروفات', 'ربح تشغيلي نقدي', 'عملاء جدد'],
        series.map(s => [s.k, money(s.rev), money(s.exp), money(s.profit), s.newC]))}
    </div>`;

  requestAnimationFrame(() => drawBars($('#chart-flow'), series.map(s => s.k.slice(5) + '/' + s.k.slice(2, 4)),
    [{ color: '#1e3a8a', values: series.map(s => s.rev) }, { color: '#f59e0b', values: series.map(s => s.exp) }]));
}

function drawBars(canvas, labels, seriesList) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(1, ...seriesList.flatMap(s => s.values));
  const pad = { t: 10, b: 28, l: 8, r: 8 };
  const plotH = h - pad.t - pad.b;
  const groupW = (w - pad.l - pad.r) / labels.length;
  const barW = Math.min(18, groupW / (seriesList.length + 1));
  labels.forEach((lab, i) => {
    const x0 = pad.l + i * groupW + (groupW - barW * seriesList.length) / 2;
    seriesList.forEach((s, j) => {
      const bh = (Math.max(0, s.values[i]) / max) * plotH;
      ctx.fillStyle = s.color;
      ctx.fillRect(x0 + j * barW, pad.t + plotH - bh, barW - 3, bh);
    });
    ctx.fillStyle = '#64748b';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(lab, pad.l + i * groupW + groupW / 2, h - 8);
  });
}

/* =====================================================================
   7) العملاء
   ===================================================================== */
function renderClients() {
  const s = ui.clients, q = (s.q || '').trim().toLowerCase();
  const rows = db.clients
    .filter(c => (!s.status || c.status === s.status) &&
      (!q || [c.name, c.phone, c.whatsapp, c.contact, c.city].some(v => String(v || '').toLowerCase().includes(q))))
    .sort((a, b) => a.number.localeCompare(b.number));

  $('#list-clients').innerHTML = table(
    ['الرقم', 'العميل', 'المسؤول', 'الهاتف', 'المدينة', 'المصدر', 'الحالة', 'عدد المواقع', 'المدفوع', 'المستحق', 'إجراءات'],
    rows.map(c => {
      const t = clientTotals(c.id);
      const n = db.websites.filter(w => w.clientId === c.id).length;
      return [
        esc(c.number), esc(c.name), esc(c.contact), esc(c.phone), esc(c.city),
        esc(L.source[c.source] || ''), badge(L.client[c.status] || '', c.status === 'active' ? 'ok' : ''),
        n, money(t.paid), owedCell(t.owed),
        `<div class="row-actions">
           <button data-action="clientDetail" data-id="${c.id}">ملف العميل</button>
           <button data-action="editClient" data-id="${c.id}">تعديل</button></div>`,
      ];
    }));
}

function clientForm(c) {
  openForm(c ? 'تعديل عميل' : 'عميل جديد', [
    { name: 'name', label: 'اسم الشركة أو العميل', required: true },
    { name: 'contact', label: 'اسم الشخص المسؤول' },
    { name: 'phone', label: 'رقم الهاتف', required: true },
    { name: 'whatsapp', label: 'رقم واتساب' },
    { name: 'email', label: 'البريد الإلكتروني', type: 'email' },
    { name: 'city', label: 'المدينة / المحافظة' },
    { name: 'businessType', label: 'نوع النشاط التجاري' },
    { name: 'registeredAt', label: 'تاريخ التسجيل', type: 'date', required: true },
    { name: 'source', label: 'المصدر', type: 'select', options: pairs(L.source) },
    { name: 'status', label: 'الحالة', type: 'select', options: pairs(L.client) },
    { name: 'notes', label: 'ملاحظات داخلية', type: 'textarea', full: true },
  ], c ? { ...c } : { registeredAt: today(), source: 'direct', status: 'potential' }, data => {
    if (!data.name) return 'اسم العميل مطلوب';
    const phone = normPhone(data.phone);
    if (!phone) return 'رقم الهاتف مطلوب';
    const dup = db.clients.find(x => x.id !== c?.id &&
      (normPhone(x.phone) === phone || x.name.trim().toLowerCase() === data.name.toLowerCase()));
    if (dup) {
      const byPhone = normPhone(dup.phone) === phone;
      return `يوجد عميل مسجل بنفس ${byPhone ? 'رقم الهاتف' : 'الاسم'} (${dup.number}). عدّل السجل القائم بدلًا من تكراره.`;
    }
    if (c) {
      Object.assign(c, data);
      commit('client.update', `تعديل العميل ${c.name}`, c.id);
    } else {
      const rec = { id: uid('c'), number: 'C-' + String(++db.seq.client).padStart(4, '0'), ...data, createdAt: new Date().toISOString() };
      db.clients.push(rec);
      commit('client.create', `إضافة عميل ${rec.name}`, rec.id);
    }
    return true;
  });
}

function clientDetail(id) {
  const c = clientById(id);
  if (!c) return;
  const ws = db.websites.filter(w => w.clientId === id);
  const pays = db.payments.filter(p => ws.some(w => w.id === p.websiteId));
  const t = clientTotals(id);
  const events = [
    ...db.audit.filter(a => a.clientId === id).map(a => ({ at: a.at.slice(0, 16).replace('T', ' '), text: a.text })),
    ...pays.map(p => ({ at: p.date, text: `${p.voided ? '(ملغاة) ' : ''}${L.payType[p.type]} ${money(p.amountCents)} على ${websiteName(p.websiteId)}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  openInfo(`ملف العميل: ${c.name}`, `
    <div class="kpis small">
      <div class="kpi"><span>الرقم</span><strong>${esc(c.number)}</strong></div>
      <div class="kpi"><span>الحالة</span><strong>${esc(L.client[c.status])}</strong></div>
      <div class="kpi"><span>المدفوع</span><strong>${money(t.paid)}</strong></div>
      <div class="kpi"><span>المستحق</span><strong>${owedCell(t.owed)}</strong></div>
    </div>
    <p>المسؤول: ${esc(c.contact || '—')} | الهاتف: ${esc(c.phone)}
      ${c.whatsapp ? ` | <a href="https://wa.me/${normPhone(c.whatsapp)}" target="_blank" rel="noopener">واتساب</a>` : ''}</p>
    <p>المدينة: ${esc(c.city || '—')} | النشاط: ${esc(c.businessType || '—')} | المصدر: ${esc(L.source[c.source] || '—')}</p>
    ${c.notes ? `<p class="muted">ملاحظات: ${esc(c.notes)}</p>` : ''}
    <h4>المواقع التابعة</h4>
    ${table(['الرقم', 'الموقع', 'الحالة', 'التجديد القادم', 'المستحق'], ws.map(w => {
      const f = finance(w);
      return [esc(w.number), esc(w.name), badge(L.website[w.status], L.websiteTone[w.status]), f.nextDue || '—', owedCell(f.owed)];
    }))}
    <h4>سجل التواصل والأحداث</h4>
    ${events.length ? `<ul>${events.slice(0, 80).map(e => `<li><span class="muted">${esc(e.at)}</span> — ${esc(e.text)}</li>`).join('')}</ul>`
      : '<div class="muted">لا توجد أحداث مسجلة بعد.</div>'}
  `);
}

/* =====================================================================
   8) المواقع والاشتراكات
   ===================================================================== */
function renderWebsites() {
  const s = ui.websites, q = (s.q || '').trim().toLowerCase();
  const rows = db.websites
    .filter(w => (!s.status || w.status === s.status) &&
      (!q || [w.name, w.number, w.url, w.primaryDomain, clientName(w.clientId)].join(' ').toLowerCase().includes(q)));

  $('#list-websites').innerHTML = table(
    ['الرقم', 'الموقع', 'العميل', 'الحالة', 'الدورة', 'سعر الدورة', 'التجديد القادم', 'المدفوع', 'المستحق', 'إجراءات'],
    rows.map(w => {
      const f = finance(w);
      const cur = currentPrice(w);
      return [
        esc(w.number), esc(w.name), esc(clientName(w.clientId)),
        badge(L.website[w.status], L.websiteTone[w.status]),
        L.cycle[w.cycle], money(cyclePrice(cur, w.cycle)),
        f.nextDue || '—', money(f.paid), owedCell(f.owed),
        `<div class="row-actions">
          <button data-action="editWebsite" data-id="${w.id}">تعديل</button>
          ${w.status !== 'cancelled' ? `<button data-action="payWebsite" data-id="${w.id}">دفعة</button>` : ''}
          <button data-action="statement" data-id="${w.id}">السجل المالي</button>
          ${w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">فتح</a>
                     <button data-action="copyUrl" data-id="${w.id}">نسخ</button>` : ''}
          ${w.status !== 'cancelled' ? `<button data-action="cancelWebsite" data-id="${w.id}">إلغاء</button>` : ''}
        </div>`,
      ];
    }));
}

function websiteForm(w) {
  const cur = w ? currentPrice(w) : null;
  const clientOpts = withBlank(db.clients.map(c => [c.id, c.name]), '— اختر العميل —');
  openForm(w ? 'تعديل موقع' : 'موقع جديد', [
    { name: 'name', label: 'اسم الموقع', required: true },
    { name: 'clientId', label: 'العميل', type: 'select', options: clientOpts, required: true },
    { name: 'businessType', label: 'نوع النشاط' },
    { name: 'url', label: 'رابط الموقع', type: 'url', placeholder: 'https://' },
    { name: 'primaryDomain', label: 'الدومين الأساسي' },
    { name: 'extraDomains', label: 'دومينات إضافية (مفصولة بفاصلة)' },
    { name: 'template', label: 'نوع القالب' },
    { name: 'startDate', label: 'تاريخ بداية الاشتراك', type: 'date', required: true },
    { name: 'cycle', label: 'دورة الفوترة', type: 'select', options: pairs(L.cycle) },
    { name: 'monthly', label: 'السعر الشهري (USD)', type: 'number', step: '0.01', min: '0', required: true },
    { name: 'discount', label: 'الخصم %', type: 'number', step: '0.01', min: '0', max: '100' },
    { name: 'status', label: 'حالة الموقع', type: 'select', options: pairs(L.website) },
    { name: 'note', label: 'ملاحظات إدارية', type: 'textarea', full: true },
  ], w ? {
    ...w,
    clientId: w.clientId, monthly: dollars(cur.monthlyCents), discount: cur.discount || 0,
    extraDomains: (w.extraDomains || []).join(', '), note: w.note || '',
  } : { cycle: 'monthly', status: 'draft', startDate: today(), discount: 0, monthly: dollars(db.settings.defaultMonthlyCents) },
  data => {
    if (!data.name) return 'اسم الموقع مطلوب';
    if (!data.clientId) return 'اختر العميل';
    if (!data.startDate) return 'تاريخ البداية مطلوب';
    const monthlyCents = toCents(data.monthly);
    if (!(monthlyCents > 0)) return 'السعر الشهري يجب أن يكون أكبر من صفر';
    const discount = Number(data.discount) || 0;
    if (discount < 0 || discount > 100) return 'نسبة الخصم يجب أن تكون بين 0 و100';

    const fields = {
      name: data.name, clientId: data.clientId, businessType: data.businessType,
      url: data.url, primaryDomain: data.primaryDomain,
      extraDomains: data.extraDomains.split(',').map(x => x.trim()).filter(Boolean),
      template: data.template, startDate: data.startDate, cycle: data.cycle, discount,
      status: data.status, note: data.note,
      cancelDate: data.status === 'cancelled' ? (w?.cancelDate || today()) : null,
    };

    if (w) {
      Object.assign(w, fields);
      const last = currentPrice(w);
      // تغيير السعر أو الخصم يُسجَّل بتاريخ سريان جديد دون تعديل الفواتير السابقة
      if (last.monthlyCents !== monthlyCents || (last.discount || 0) !== discount) {
        w.priceHistory.push({ from: today(), monthlyCents, discount });
      }
      commit('website.update', `تعديل الموقع ${w.name}`, w.clientId);
    } else {
      const rec = {
        id: uid('w'), number: 'WP-' + String(++db.seq.website).padStart(4, '0'), ...fields,
        priceHistory: [{ from: data.startDate, monthlyCents, discount }],
        createdAt: new Date().toISOString(),
      };
      db.websites.push(rec);
      commit('website.create', `إضافة الموقع ${rec.name}`, rec.clientId);
    }
    return true;
  });
}

function statement(id) {
  const w = websiteById(id);
  if (!w) return;
  const f = finance(w);
  const pays = db.payments.filter(p => p.websiteId === id).sort((a, b) => b.date.localeCompare(a.date));
  openInfo(`السجل المالي: ${w.name}`, `
    <div class="kpis small">
      <div class="kpi"><span>إجمالي الفواتير المستحقة عن الفترات</span><strong>${money(f.total)}</strong></div>
      <div class="kpi"><span>المدفوع (صافي)</span><strong>${money(f.paid)}</strong></div>
      <div class="kpi"><span>الرصيد</span><strong>${owedCell(f.owed)}</strong></div>
      <div class="kpi"><span>التجديد القادم</span><strong>${f.nextDue || '—'}</strong></div>
    </div>
    <h4>سجل الأسعار (لا تُعدَّل الفواتير السابقة عند تغيير السعر)</h4>
    ${table(['يسري من', 'السعر الشهري', 'الخصم', 'سعر الدورة'],
      w.priceHistory.map(p => [p.from, money(p.monthlyCents), (p.discount || 0) + '%', money(cyclePrice(p, w.cycle))]))}
    <h4>الدفعات</h4>
    ${table(['التاريخ', 'النوع', 'المبلغ', 'الطريقة', 'المرجع', 'الحالة'],
      pays.map(p => [p.date, L.payType[p.type], money(p.amountCents), L.method[p.method] || '', esc(p.ref || ''),
        p.voided ? badge('ملغاة', 'muted') : badge('سارية', 'ok')]))}
  `);
}

function cancelWebsite(id) {
  const w = websiteById(id);
  if (!w) return;
  if (!confirm(`إلغاء اشتراك الموقع ${w.name}؟ سيبقى السجل المالي محفوظًا ولن تُضاف فواتير جديدة بعد اليوم.`)) return;
  w.status = 'cancelled';
  w.cancelDate = today();
  commit('website.cancel', `إلغاء اشتراك ${w.name}`, w.clientId);
}

function copyUrl(id) {
  const w = websiteById(id);
  if (!w?.url) return toast('لا يوجد رابط لهذا الموقع', 'err');
  navigator.clipboard?.writeText(w.url)
    .then(() => toast('تم نسخ الرابط'))
    .catch(() => toast('تعذّر النسخ', 'err'));
}

/* =====================================================================
   9) المدفوعات
   ===================================================================== */
function renderPayments() {
  const s = ui.payments, q = (s.q || '').trim().toLowerCase();
  const rows = db.payments
    .filter(p => (!s.type || p.type === s.type) && (!q || [p.ref, websiteName(p.websiteId), clientName(p.clientId)].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));

  $('#list-payments').innerHTML = table(
    ['التاريخ', 'الموقع', 'العميل', 'النوع', 'المبلغ', 'الطريقة', 'المرجع', 'الحالة', 'إجراءات'],
    rows.map(p => [
      p.date, esc(websiteName(p.websiteId)), esc(clientName(p.clientId)), L.payType[p.type],
      money(p.amountCents), L.method[p.method] || '', esc(p.ref || ''),
      p.voided ? badge('ملغاة', 'muted') : badge('سارية', 'ok'),
      p.voided ? '' : `<div class="row-actions"><button data-action="voidPayment" data-id="${p.id}">إلغاء</button></div>`,
    ]));
}

function paymentForm(websiteId = '') {
  if (!db.websites.length) return toast('أضف موقعًا أولًا', 'err');
  const w = websiteById(websiteId);
  const due = w ? Math.max(0, finance(w).owed) : 0;
  openForm('تسجيل دفعة', [
    { name: 'websiteId', label: 'الموقع', type: 'select', required: true,
      options: withBlank(db.websites.map(x => [x.id, `${x.number} - ${x.name}`]), '— اختر الموقع —') },
    { name: 'date', label: 'تاريخ الدفع', type: 'date', required: true },
    { name: 'amount', label: 'المبلغ (USD)', type: 'number', step: '0.01', min: '0', required: true },
    { name: 'type', label: 'النوع', type: 'select', options: pairs(L.payType) },
    { name: 'method', label: 'طريقة الدفع', type: 'select', options: pairs(L.method) },
    { name: 'ref', label: 'رقم مرجعي' },
    { name: 'note', label: 'ملاحظات', type: 'textarea', full: true },
  ], { websiteId, date: today(), amount: due ? dollars(due) : '', type: 'payment', method: 'cash' }, data => {
    const ww = websiteById(data.websiteId);
    if (!ww) return 'اختر الموقع';
    const cents = toCents(data.amount);
    if (!(cents > 0)) return 'المبلغ يجب أن يكون أكبر من صفر';
    if (!data.date) return 'تاريخ الدفع مطلوب';
    if (data.type === 'refund' && cents > paidOf(ww.id)) return 'المبلغ المسترد أكبر من المدفوع لهذا الموقع';
    db.payments.push({
      id: uid('p'), websiteId: ww.id, clientId: ww.clientId, amountCents: cents, type: data.type,
      date: data.date, method: data.method, ref: data.ref, note: data.note,
      voided: false, sample: false, createdAt: new Date().toISOString(),
    });
    commit('payment.create', `${L.payType[data.type]} ${money(cents)} للموقع ${ww.name}`, ww.clientId);
    return true;
  });
}

function voidPayment(id) {
  const p = db.payments.find(x => x.id === id);
  if (!p || p.voided) return;
  if (!confirm('إلغاء هذه الدفعة؟ ستبقى في السجل ولن تُحتسب ضمن المحصّل.')) return;
  p.voided = true;
  p.voidedAt = new Date().toISOString();
  commit('payment.void', `إلغاء دفعة ${money(p.amountCents)} للموقع ${websiteName(p.websiteId)}`, p.clientId);
}

/* =====================================================================
   10) المصروفات
   ===================================================================== */
function renderExpenses() {
  const s = ui.expenses, q = (s.q || '').trim().toLowerCase();
  const rows = db.expenses
    .filter(e => (!s.cat || e.category === s.cat) && (!q || [e.name, e.payee].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = sumBy(rows, e => e.amountCents);

  $('#list-expenses').innerHTML = `<div class="muted" style="margin-bottom:8px">إجمالي المعروض: ${money(total)}</div>` + table(
    ['التاريخ', 'البند', 'التصنيف', 'الجهة', 'الموقع', 'المبلغ', 'متكرر', 'إجراءات'],
    rows.map(e => [
      e.date, esc(e.name), esc(e.category), esc(e.payee || '—'), esc(websiteName(e.websiteId)) || '—',
      money(e.amountCents), e.recurring ? 'نعم' : 'لا',
      `<div class="row-actions">
        <button data-action="editExpense" data-id="${e.id}">تعديل</button>
        <button data-action="delExpense" data-id="${e.id}">حذف</button></div>`,
    ]));
}

function expenseForm(ex) {
  openForm(ex ? 'تعديل مصروف' : 'مصروف جديد', [
    { name: 'name', label: 'بيان المصروف', required: true },
    { name: 'category', label: 'التصنيف', type: 'select', options: pairs(L.expenseCat) },
    { name: 'amount', label: 'المبلغ (USD)', type: 'number', step: '0.01', min: '0', required: true },
    { name: 'date', label: 'التاريخ', type: 'date', required: true },
    { name: 'method', label: 'طريقة الدفع', type: 'select', options: pairs(L.method) },
    { name: 'payee', label: 'الجهة المستفيدة' },
    { name: 'websiteId', label: 'الموقع المرتبط (اختياري)', type: 'select',
      options: withBlank(db.websites.map(w => [w.id, w.name])) },
    { name: 'recurring', label: 'مصروف متكرر', type: 'checkbox', full: true },
    { name: 'note', label: 'ملاحظات', type: 'textarea', full: true },
  ], ex ? { ...ex, amount: dollars(ex.amountCents), websiteId: ex.websiteId || '' }
    : { category: L.expenseCat[0], date: today(), method: 'cash', recurring: false },
  data => {
    if (!data.name) return 'بيان المصروف مطلوب';
    const cents = toCents(data.amount);
    if (!(cents > 0)) return 'المبلغ غير صحيح';
    if (!data.date) return 'التاريخ مطلوب';
    const rec = {
      name: data.name, category: data.category, amountCents: cents, date: data.date, method: data.method,
      payee: data.payee, websiteId: data.websiteId || null, recurring: !!data.recurring, note: data.note,
    };
    if (ex) { Object.assign(ex, rec); commit('expense.update', `تعديل مصروف ${rec.name}`); }
    else { db.expenses.push({ id: uid('e'), ...rec, createdAt: new Date().toISOString() }); commit('expense.create', `إضافة مصروف ${rec.name} ${money(cents)}`); }
    return true;
  });
}

/** حذف مع أثر في سجل التدقيق */
function removeRecord(coll, id, label) {
  const r = db[coll].find(x => x.id === id);
  if (!r) return;
  if (!confirm(`حذف ${label} "${r.name}"؟ سيُسجَّل الحذف في سجل التدقيق.`)) return;
  db[coll] = db[coll].filter(x => x.id !== id);
  commit(`${coll}.delete`, `حذف ${label}: ${r.name}`);
}

/* =====================================================================
   11) الدومينات
   ===================================================================== */
function renderDomains() {
  const t = today();
  const rows = [...db.domains].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  $('#list-domains').innerHTML = table(
    ['الدومين', 'الموقع', 'الجهة المسجّلة', 'تاريخ الانتهاء', 'الأيام المتبقية', 'التكلفة السنوية', 'إجراءات'],
    rows.map(d => {
      const days = daysBetween(t, d.expiresAt);
      const tone = days < 0 || days <= 7 ? 'danger' : days <= 30 ? 'warn' : 'ok';
      const label = days < 0 ? 'منتهٍ' : `${days} يوم`;
      return [
        esc(d.name), esc(websiteName(d.websiteId)), esc(d.registrar || '—'), d.expiresAt,
        badge(label, tone), money(d.annualCostCents),
        `<div class="row-actions">
          <button data-action="editDomain" data-id="${d.id}">تعديل</button>
          <button data-action="delDomain" data-id="${d.id}">حذف</button></div>`,
      ];
    }));
}

function domainForm(d) {
  openForm(d ? 'تعديل دومين' : 'دومين جديد', [
    { name: 'name', label: 'اسم الدومين', required: true, placeholder: 'example.com' },
    { name: 'websiteId', label: 'الموقع المرتبط', type: 'select', options: withBlank(db.websites.map(w => [w.id, w.name])) },
    { name: 'registrar', label: 'جهة التسجيل / المزود' },
    { name: 'registeredAt', label: 'تاريخ التسجيل', type: 'date' },
    { name: 'expiresAt', label: 'تاريخ الانتهاء', type: 'date', required: true },
    { name: 'annual', label: 'التكلفة السنوية (USD)', type: 'number', step: '0.01', min: '0' },
    { name: 'note', label: 'ملاحظات', type: 'textarea', full: true },
  ], d ? { ...d, websiteId: d.websiteId || '', annual: dollars(d.annualCostCents) }
    : { annual: dollars(db.settings.defaultDomainMonthlyCents * 12), registeredAt: today(), expiresAt: addDays(today(), 365) },
  data => {
    if (!data.name) return 'اسم الدومين مطلوب';
    if (!data.expiresAt) return 'تاريخ الانتهاء مطلوب';
    if (data.registeredAt && data.expiresAt < data.registeredAt) return 'تاريخ الانتهاء قبل تاريخ التسجيل';
    const rec = {
      name: data.name.toLowerCase(), websiteId: data.websiteId || null, registrar: data.registrar,
      registeredAt: data.registeredAt, expiresAt: data.expiresAt,
      annualCostCents: toCents(data.annual), note: data.note,
    };
    if (d) { Object.assign(d, rec); commit('domain.update', `تعديل الدومين ${rec.name}`); }
    else { db.domains.push({ id: uid('d'), ...rec, createdAt: new Date().toISOString() }); commit('domain.create', `إضافة الدومين ${rec.name}`); }
    return true;
  });
}

/* =====================================================================
   12) الاستضافة
   ===================================================================== */
function renderHosting() {
  const act = db.websites.filter(w => w.status === 'active').length;
  const share = act ? Math.round(hostingMonthly() / act) : 0;
  $('#list-hosting').innerHTML = `
    <div class="note">حصة الموقع الواحد = إجمالي تكلفة الاستضافة النشطة ÷ عدد المواقع النشطة (${act}) = ${money(share)} شهريًا. تُحسب مرة واحدة فقط في الربحية.</div>` +
    table(['المزود', 'الخطة', 'التكلفة الشهرية', 'بداية الخطة', 'نهاية الخطة', 'الحالة', 'إجراءات'],
      db.hostings.map(h => [
        esc(h.provider), esc(h.plan), money(h.monthlyCostCents), h.startDate || '—', h.endDate || '—',
        badge(L.hostStatus[h.status], h.status === 'active' ? 'ok' : 'muted'),
        `<div class="row-actions">
          <button data-action="editHosting" data-id="${h.id}">تعديل</button>
          <button data-action="delHosting" data-id="${h.id}">حذف</button></div>`,
      ]));
}

function hostingForm(h) {
  openForm(h ? 'تعديل خطة استضافة' : 'خطة استضافة جديدة', [
    { name: 'provider', label: 'اسم المزود', required: true },
    { name: 'plan', label: 'اسم الخطة', required: true },
    { name: 'monthly', label: 'التكلفة الشهرية (USD)', type: 'number', step: '0.01', min: '0', required: true },
    { name: 'startDate', label: 'بداية الخطة', type: 'date' },
    { name: 'endDate', label: 'نهاية الخطة', type: 'date' },
    { name: 'status', label: 'الحالة', type: 'select', options: pairs(L.hostStatus) },
    { name: 'note', label: 'ملاحظات', type: 'textarea', full: true },
  ], h ? { ...h, monthly: dollars(h.monthlyCostCents) }
    : { monthly: dollars(Math.round(db.settings.sharedHostingYearlyCents / 12)), startDate: today(), status: 'active' },
  data => {
    if (!data.provider || !data.plan) return 'المزود والخطة مطلوبان';
    const cents = toCents(data.monthly);
    if (!(cents >= 0)) return 'التكلفة غير صحيحة';
    if (data.endDate && data.startDate && data.endDate < data.startDate) return 'نهاية الخطة قبل بدايتها';
    const rec = { provider: data.provider, plan: data.plan, monthlyCostCents: cents, startDate: data.startDate, endDate: data.endDate, status: data.status, note: data.note };
    if (h) { Object.assign(h, rec); commit('hosting.update', `تعديل خطة ${rec.plan}`); }
    else { db.hostings.push({ id: uid('h'), ...rec }); commit('hosting.create', `إضافة خطة ${rec.plan}`); }
    return true;
  });
}

/* =====================================================================
   13) التقارير والتصدير
   ===================================================================== */
function buildReport() {
  const { type, from, to } = ui.reports;
  const inRange = d => (!from || d >= from) && (!to || d <= to);
  const pays = db.payments.filter(p => !p.voided && inRange(p.date)).sort((a, b) => a.date.localeCompare(b.date));
  const exps = db.expenses.filter(e => inRange(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  const live = db.websites.filter(w => w.status !== 'cancelled');
  const act = db.websites.filter(w => w.status === 'active');

  switch (type) {
    case 'revenue':
      return {
        file: 'revenue', title: 'الإيرادات المحصّلة',
        summary: `صافي المحصّل في الفترة: ${money(sumBy(pays, signed))}`,
        headers: ['التاريخ', 'الرقم', 'الموقع', 'العميل', 'النوع', 'المبلغ', 'الطريقة', 'المرجع'],
        rows: pays.map(p => {
          const w = websiteById(p.websiteId);
          return [p.date, w?.number || '', w?.name || '', clientName(p.clientId), L.payType[p.type], money(signed(p)), L.method[p.method] || '', p.ref || ''];
        }),
      };
    case 'expenses':
      return {
        file: 'expenses', title: 'المصروفات',
        summary: `إجمالي المصروفات في الفترة: ${money(sumBy(exps, e => e.amountCents))}`,
        headers: ['التاريخ', 'البند', 'التصنيف', 'الجهة', 'الموقع', 'المبلغ', 'متكرر'],
        rows: exps.map(e => [e.date, e.name, e.category, e.payee || '', websiteName(e.websiteId), money(e.amountCents), e.recurring ? 'نعم' : 'لا']),
      };
    case 'pnl': {
      const rev = sumBy(pays, signed), ex = sumBy(exps, e => e.amountCents), profit = rev - ex;
      return {
        file: 'pnl', title: 'الأرباح والخسائر التشغيلية (أساس نقدي)',
        summary: 'هذا التقرير يعتمد على الدفعات الفعلية، وليس الإيرادات المستحقة.',
        headers: ['البند', 'القيمة'],
        rows: [
          ['الإيرادات المحصّلة', money(rev)],
          ['المصروفات المسجّلة', money(ex)],
          ['الربح التشغيلي النقدي', money(profit)],
          ['هامش الربح', rev ? (profit / rev * 100).toFixed(1) + '%' : '—'],
        ],
      };
    }
    case 'outstanding':
      return {
        file: 'outstanding', title: 'الفواتير المستحقة والمتأخرة',
        summary: 'الرصيد الحالي لكل موقع حتى اليوم.',
        headers: ['الرقم', 'الموقع', 'العميل', 'الدورة', 'إجمالي المستحق عن الفترات', 'المدفوع', 'الرصيد', 'التجديد القادم'],
        rows: live.map(w => ({ w, f: finance(w) })).filter(x => x.f.owed > 0).map(({ w, f }) =>
          [w.number, w.name, clientName(w.clientId), L.cycle[w.cycle], money(f.total), money(f.paid), money(f.owed), f.nextDue || '—']),
      };
    case 'subscriptions':
      return {
        file: 'subscriptions', title: 'الاشتراكات النشطة والملغاة',
        summary: `نشطة: ${act.length} | ملغاة: ${db.websites.filter(w => w.status === 'cancelled').length}`,
        headers: ['الرقم', 'الموقع', 'العميل', 'الحالة', 'الدورة', 'سعر الدورة', 'التجديد القادم', 'الرصيد'],
        rows: db.websites.map(w => {
          const f = finance(w);
          return [w.number, w.name, clientName(w.clientId), L.website[w.status], L.cycle[w.cycle],
            money(cyclePrice(currentPrice(w), w.cycle)), f.nextDue || '—', money(f.owed)];
        }),
      };
    case 'profitability': {
      const share = hostingShare();
      return {
        file: 'profitability', title: 'ربحية المواقع (تقديرية شهرية)',
        summary: `حصة الاستضافة لكل موقع نشط: ${money(share)} شهريًا. الربح التقديري = الإيراد الشهري − حصة الاستضافة − الدومين.`,
        headers: ['الموقع', 'العميل', 'الإيراد الشهري', 'حصة الاستضافة', 'الدومين شهريًا', 'الربح التقديري', 'الهامش'],
        rows: act.map(w => {
          const rev = Math.round(monthlyEq(w)), dom = domainMonthly(w.id);
          const profit = rev - share - dom;
          return [w.name, clientName(w.clientId), money(rev), money(share), money(dom), money(profit),
            rev ? (profit / rev * 100).toFixed(1) + '%' : '—'];
        }),
      };
    }
    case 'domains':
      return {
        file: 'domains', title: 'الدومينات',
        summary: '',
        headers: ['الدومين', 'الموقع', 'الجهة', 'تاريخ الانتهاء', 'الأيام المتبقية', 'التكلفة السنوية'],
        rows: [...db.domains].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).map(d =>
          [d.name, websiteName(d.websiteId), d.registrar || '', d.expiresAt, daysBetween(today(), d.expiresAt), money(d.annualCostCents)]),
      };
  }
}

function renderReports() {
  const r = buildReport();
  $('#report-output').innerHTML = `<h3>${esc(r.title)}</h3>
    ${r.summary ? `<p class="muted">${esc(r.summary)}</p>` : ''}
    ${table(r.headers, r.rows.map(row => row.map(c => esc(c))))}`;
}

function downloadFile(name, content, type) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCSV() {
  const r = buildReport();
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [r.headers, ...r.rows].map(row => row.map(cell).join(',')).join('\r\n');
  downloadFile(`wepplus-${r.file}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
  toast('تم تصدير الملف');
}

/* =====================================================================
   14) الإعدادات والنسخ الاحتياطي والبيانات التجريبية
   ===================================================================== */
function renderSettings() {
  const s = db.settings;
  $('#settings-body').innerHTML = `
    <div class="card"><h3>الإعدادات الافتراضية</h3>
      <p>اسم الشركة: ${esc(s.companyName)}</p>
      <p>السعر الشهري الافتراضي للموقع: ${money(s.defaultMonthlyCents)}</p>
      <p>تكلفة الدومين الشهرية الافتراضية: ${money(s.defaultDomainMonthlyCents)}</p>
      <p>تكلفة الاستضافة المشتركة السنوية الافتراضية: ${money(s.sharedHostingYearlyCents)}</p>
      <p class="muted">العملة الأساسية: USD. هذه قيم افتراضية قابلة للتعديل وليست ثوابت برمجية.</p>
      <button class="btn primary" data-action="editSettings">تعديل الإعدادات</button>
    </div>
    <div class="card"><h3>الأمان والنسخ الاحتياطي</h3>
      <div class="row-actions">
        <button class="btn" data-action="changePassword">تغيير كلمة المرور</button>
        <button class="btn" data-action="exportBackup">تصدير نسخة احتياطية (JSON)</button>
        <button class="btn" data-action="importBackup">استيراد نسخة احتياطية</button>
      </div>
    </div>
    <div class="card"><h3>بيانات تجريبية</h3>
      <p class="muted">تُنشأ بيانات تجريبية مميزة (تحمل علامة تجريبية) لاختبار النظام، ويمكن حذفها دون التأثير في بياناتك الحقيقية.</p>
      <div class="row-actions">
        <button class="btn" data-action="loadSample">إنشاء بيانات تجريبية</button>
        <button class="btn" data-action="clearSample">حذف البيانات التجريبية</button>
        <button class="btn danger" data-action="resetAll">حذف جميع البيانات</button>
      </div>
    </div>
    <div class="card"><h3>سجل التدقيق (آخر 100 حدث)</h3>
      ${table(['الوقت', 'الإجراء', 'التفاصيل'], db.audit.slice(0, 100).map(a =>
        [esc(a.at.slice(0, 16).replace('T', ' ')), esc(a.action), esc(a.text)]))}
    </div>`;
}

function editSettings() {
  const s = db.settings;
  openForm('إعدادات الأسعار الافتراضية', [
    { name: 'companyName', label: 'اسم الشركة' },
    { name: 'monthly', label: 'السعر الشهري الافتراضي للموقع (USD)', type: 'number', step: '0.01', min: '0' },
    { name: 'domain', label: 'تكلفة الدومين الشهرية الافتراضية (USD)', type: 'number', step: '0.01', min: '0' },
    { name: 'hosting', label: 'تكلفة الاستضافة المشتركة السنوية (USD)', type: 'number', step: '0.01', min: '0' },
  ], { companyName: s.companyName, monthly: dollars(s.defaultMonthlyCents), domain: dollars(s.defaultDomainMonthlyCents), hosting: dollars(s.sharedHostingYearlyCents) },
  data => {
    if (!data.companyName) return 'اسم الشركة مطلوب';
    db.settings = {
      companyName: data.companyName,
      defaultMonthlyCents: toCents(data.monthly),
      defaultDomainMonthlyCents: toCents(data.domain),
      sharedHostingYearlyCents: toCents(data.hosting),
    };
    commit('settings.update', 'تعديل الإعدادات الافتراضية');
    return true;
  });
}

function loadSample() {
  if (db.clients.some(c => c.sample)) return toast('البيانات التجريبية موجودة بالفعل', 'err');
  const t0 = today();
  const clientsData = [
    { name: 'مطعم النخلة', contact: 'أحمد الحلبي', phone: '0944000001', city: 'حلب', businessType: 'مطعم' },
    { name: 'صالون لمسة', contact: 'رنا الخطيب', phone: '0944000002', city: 'دمشق', businessType: 'تجميل' },
    { name: 'متجر الأناقة', contact: 'محمد الدرويش', phone: '0944000003', city: 'حمص', businessType: 'متجر ملابس' },
    { name: 'شركة النور للتجارة', contact: 'سامر العلي', phone: '0944000004', city: 'اللاذقية', businessType: 'شركة' },
    { name: 'عيادة الشفاء', contact: 'هبة الأسعد', phone: '0944000005', city: 'دمشق', businessType: 'عيادة' },
  ].map((c, i) => {
    const rec = { id: uid('c'), number: 'C-' + String(++db.seq.client).padStart(4, '0'), ...c,
      email: '', whatsapp: c.phone, source: 'direct', status: 'active', notes: 'بيانات تجريبية',
      registeredAt: addMonths(t0, -(i + 2)), createdAt: new Date().toISOString(), sample: true };
    db.clients.push(rec);
    return rec;
  });

  // [عميل، اسم، الدورة، سعر شهري، أشهر منذ البداية، الحالة، نسبة الدفع من المستحق]
  const sites = [
    [0, 'مطعم النخلة', 'monthly', 20, 4, 'active', 1],
    [0, 'مطعم النخلة - الفرع الثاني', 'quarterly', 25, 2, 'active', 0.5],
    [1, 'صالون لمسة', 'monthly', 20, 6, 'active', 0.4],
    [2, 'متجر الأناقة', 'annual', 20, 14, 'active', 1],
    [3, 'شركة النور', 'semiannual', 20, 8, 'suspended', 0.3],
    [4, 'عيادة الشفاء', 'monthly', 20, 1, 'draft', 0],
    [4, 'بوابة الشفاء', 'monthly', 20, 3, 'cancelled', 0.5],
    [2, 'متجر الأناقة الإلكتروني', 'monthly', 25, 5, 'maintenance', 1],
  ];
  const created = sites.map(([ci, name, cycle, price, monthsAgo, status, share], i) => {
    const start = addMonths(t0, -monthsAgo);
    const w = {
      id: uid('w'), number: 'WP-' + String(++db.seq.website).padStart(4, '0'), name,
      clientId: clientsData[ci].id, businessType: clientsData[ci].businessType,
      url: `https://sample-${i + 1}.example.com`, primaryDomain: `sample-${i + 1}.example.com`, extraDomains: [],
      template: 'قالب تجريبي', startDate: start, cycle, discount: 0, status, note: 'بيانات تجريبية',
      cancelDate: status === 'cancelled' ? addMonths(t0, -1) : null,
      priceHistory: [{ from: start, monthlyCents: price * 100, discount: 0 }],
      createdAt: new Date().toISOString(), sample: true,
    };
    db.websites.push(w);
    if (share > 0) {
      const f = finance(w);
      const amount = Math.round(f.total * share);
      if (amount > 0) db.payments.push({ id: uid('p'), websiteId: w.id, clientId: w.clientId, amountCents: amount, type: 'payment',
        date: t0, method: 'bank', ref: 'SAMPLE-' + (i + 1), note: 'دفعة تجريبية', voided: false, sample: true, createdAt: new Date().toISOString() });
    }
    return w;
  });

  db.hostings.push({ id: uid('h'), provider: 'مزود تجريبي', plan: 'Shared Basic', monthlyCostCents: 500,
    startDate: addMonths(t0, -12), endDate: null, status: 'active', note: 'تجريبي', sample: true });
  db.expenses.push({ id: uid('e'), name: 'استضافة شهرية (تجريبي)', category: 'الاستضافة', amountCents: 500, date: t0,
    method: 'bank', payee: 'مزود تجريبي', websiteId: null, recurring: true, note: '', sample: true, createdAt: new Date().toISOString() });
  db.expenses.push({ id: uid('e'), name: 'حملة تسويق (تجريبي)', category: 'التسويق', amountCents: 3000, date: t0,
    method: 'cash', payee: 'مصمم مستقل', websiteId: null, recurring: false, note: '', sample: true, createdAt: new Date().toISOString() });
  [[0, 5, 1200], [1, 20, 1200], [2, 90, 1200]].forEach(([wi, days, cents], i) => {
    db.domains.push({ id: uid('d'), name: `sample-${i + 1}.example.com`, websiteId: created[wi].id, registrar: 'مسجل تجريبي',
      registeredAt: addDays(t0, -(365 - days)), expiresAt: addDays(t0, days), annualCostCents: cents, note: 'تجريبي', sample: true });
  });
  commit('sample.create', 'إنشاء بيانات تجريبية منفصلة');
  toast('تم إنشاء البيانات التجريبية');
}

function clearSample() {
  const before = db.clients.length + db.websites.length + db.payments.length;
  if (!before) return;
  if (!confirm('حذف جميع السجلات التجريبية فقط؟ البيانات الحقيقية لن تتأثر.')) return;
  const keep = x => !x.sample;
  db.clients = db.clients.filter(keep);
  db.websites = db.websites.filter(keep);
  db.payments = db.payments.filter(keep);
  db.expenses = db.expenses.filter(keep);
  db.domains = db.domains.filter(keep);
  db.hostings = db.hostings.filter(keep);
  commit('sample.clear', 'حذف البيانات التجريبية');
  toast('تم حذف البيانات التجريبية');
}

function exportBackup() {
  downloadFile(`wepplus-backup-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
  audit('backup.export', 'تصدير نسخة احتياطية');
  save();
}

function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.clients) || !Array.isArray(data.websites) || !Array.isArray(data.payments))
        throw new Error('invalid');
      if (!confirm('سيتم استبدال البيانات الحالية بالنسخة المستوردة. هل تريد المتابعة؟')) return;
      db = Object.assign(emptyDB(), data);
      commit('backup.import', 'استيراد نسخة احتياطية');
      toast('تم الاستيراد بنجاح');
    } catch {
      toast('الملف غير صالح', 'err');
    }
  };
  inp.click();
}

function resetAll() {
  if (prompt('لحذف جميع البيانات نهائيًا اكتب كلمة: حذف') !== 'حذف') return;
  db = emptyDB();
  commit('system.reset', 'حذف جميع البيانات');
  toast('تم حذف جميع البيانات');
}

/* =====================================================================
   15) الأمان: كلمة المرور (PBKDF2 عبر Web Crypto)
   ملاحظة: هذا أمان على مستوى المتصفح فقط، وليس بديلًا عن Supabase Auth.
   ===================================================================== */
const randHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const hexBytes = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));

async function hashPw(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexBytes(saltHex), iterations: iter, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function changePassword() {
  openForm('تغيير كلمة المرور', [
    { name: 'current', label: 'كلمة المرور الحالية', type: 'password', required: true },
    { name: 'next', label: 'كلمة المرور الجديدة (8 أحرف على الأقل)', type: 'password', required: true },
    { name: 'confirm', label: 'تأكيد كلمة المرور الجديدة', type: 'password', required: true },
  ], {}, async data => {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY));
    if ((await hashPw(data.current, auth.salt, auth.iter)) !== auth.hash) return 'كلمة المرور الحالية غير صحيحة';
    if (data.next.length < 8) return 'كلمة المرور الجديدة قصيرة جدًا';
    if (data.next !== data.confirm) return 'كلمتا المرور غير متطابقتين';
    const salt = randHex(16);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ salt, iter: PBKDF2_ITER, hash: await hashPw(data.next, salt, PBKDF2_ITER) }));
    audit('auth.password', 'تغيير كلمة المرور');
    save();
    return true;
  });
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  initAuth();
}

/* =====================================================================
   16) التوجيه والعرض
   ===================================================================== */
const renderers = {
  dashboard: renderDashboard, clients: renderClients, websites: renderWebsites, payments: renderPayments,
  expenses: renderExpenses, domains: renderDomains, hosting: renderHosting, reports: renderReports, settings: renderSettings,
};

function renderSection(n = ui.section) { renderers[n]?.(); }

function go(section) {
  ui.section = section;
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + section));
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === section));
  renderSection(section);
  if (window.innerWidth <= 900) document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
}

const actions = {
  closeModal: () => $('#modal').close(),
  toggleSidebar: () => {
    if (window.innerWidth <= 900) document.body.classList.toggle('nav-open');
    else document.body.classList.toggle('nav-collapsed');
  },
  newClient: () => clientForm(),
  editClient: id => clientForm(clientById(id)),
  clientDetail: id => clientDetail(id),
  newWebsite: () => websiteForm(),
  editWebsite: id => websiteForm(websiteById(id)),
  statement: id => statement(id),
  payWebsite: id => paymentForm(id),
  cancelWebsite: id => cancelWebsite(id),
  copyUrl: id => copyUrl(id),
  newPayment: () => paymentForm(),
  voidPayment: id => voidPayment(id),
  newExpense: () => expenseForm(),
  editExpense: id => expenseForm(db.expenses.find(x => x.id === id)),
  delExpense: id => removeRecord('expenses', id, 'مصروف'),
  newDomain: () => domainForm(),
  editDomain: id => domainForm(db.domains.find(x => x.id === id)),
  delDomain: id => removeRecord('domains', id, 'دومين'),
  newHosting: () => hostingForm(),
  editHosting: id => hostingForm(db.hostings.find(x => x.id === id)),
  delHosting: id => removeRecord('hostings', id, 'خطة استضافة'),
  exportCSV: () => exportCSV(),
  printReport: () => window.print(),
  editSettings: () => editSettings(),
  changePassword: () => changePassword(),
  exportBackup: () => exportBackup(),
  importBackup: () => importBackup(),
  loadSample: () => loadSample(),
  clearSample: () => clearSample(),
  resetAll: () => resetAll(),
  logout: () => logout(),
};

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) return go(nav.dataset.nav);
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el.dataset.id, el); }
});

// فلاتر وبحث: كل عنصر يحمل data-bind="القسم.المفتاح"
function onBind(e) {
  const k = e.target.dataset?.bind;
  if (!k) return;
  const [sec, key] = k.split('.');
  ui[sec][key] = e.target.value;
  if (sec === 'reports') renderReports();
  else renderSection(sec);
}
document.addEventListener('input', onBind);
document.addEventListener('change', onBind);

window.addEventListener('resize', () => { if (ui.section === 'dashboard') renderDashboard(); });

/* =====================================================================
   17) الدخول والتشغيل
   ===================================================================== */
function showApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  go('dashboard');
}

function initAuth() {
  $('#app').classList.add('hidden');
  const hasAuth = !!localStorage.getItem(AUTH_KEY);
  $('#setup-form').classList.toggle('hidden', hasAuth);
  $('#login-form').classList.toggle('hidden', !hasAuth);
  $('#auth').classList.remove('hidden');
  if (!window.crypto?.subtle) {
    $('#auth-warning').textContent = 'افتح هذه الصفحة عبر localhost أو https حتى تعمل خاصية تشفير كلمة المرور.';
  }
  if (hasAuth && sessionStorage.getItem(SESSION_KEY) === '1') showApp();
}

$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#setup-pw').value, pw2 = $('#setup-pw2').value;
  if (pw.length < 8) return ($('#setup-error').textContent = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  if (pw !== pw2) return ($('#setup-error').textContent = 'كلمتا المرور غير متطابقتين');
  const salt = randHex(16);
  localStorage.setItem(AUTH_KEY, JSON.stringify({ salt, iter: PBKDF2_ITER, hash: await hashPw(pw, salt, PBKDF2_ITER) }));
  sessionStorage.setItem(SESSION_KEY, '1');
  showApp();
});

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const auth = JSON.parse(localStorage.getItem(AUTH_KEY));
  const h = await hashPw($('#login-pw').value, auth.salt, auth.iter);
  if (h !== auth.hash) {
    $('#login-error').textContent = 'كلمة المرور غير صحيحة';
    return;
  }
  $('#login-error').textContent = '';
  $('#login-pw').value = '';
  sessionStorage.setItem(SESSION_KEY, '1');
  showApp();
});

$('#global-search').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  ui.websites.q = q;
  ui.clients.q = q;
  const box = $('[data-bind="websites.q"]');
  if (box) box.value = q;
  go('websites');
});

// ملء قوائم الفلاتر بالخيارات
$$('select[data-opts]').forEach(sel => {
  const src = L[sel.dataset.opts];
  sel.insertAdjacentHTML('beforeend', `<option value="">الكل</option>` +
    pairs(src).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''));
});

initAuth();
