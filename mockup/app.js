/* ================================================================
   موک‌آپ سامانه حواله خودرو — فاز ۱
   قواعد واقعی سند (مخفی‌سازی، سقف، اشتراک منقضی) اینجا زنده اجرا می‌شوند
   ================================================================ */

const S = {
  page: 'login',
  sub: 'active',          // active | expired  — وضعیت اشتراک «من»
  role: 'super',          // super | support | finance — نقش پنل مدیریت
  tab: 'offer',
  revealsToday: 4,
  limitDay: 30,
  q: '', fCar: '', fColor: '', fSolh: '', fCity: '',
  reveals: {},            // حواله‌هایی که در همین نشست باز شده‌اند
  modal: null, toast: null,
};

HAVALES.forEach(h => { if (h.revealed) S.reveals[h.id] = true; });

/* ------------------------------ کمکی ------------------------------ */

const fa = n => n == null ? '—' : n.toLocaleString('fa-IR');
const money = n => n == null ? '—' : n.toLocaleString('fa-IR');
const agent = id => AGENTS.find(a => a.id === id) || {};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* دسترسی‌ها — مستقیماً از جدول بند ۷ سند */
const can = {
  get create()  { return S.sub === 'active'; },
  get renew()   { return S.sub === 'active'; },
  get report()  { return S.sub === 'active'; },
  get reveal()  { return S.sub === 'active'; },
};
const isRevealed = id => !!S.reveals[id];

function toast(msg) {
  S.toast = msg; render();
  clearTimeout(window.__t);
  window.__t = setTimeout(() => { S.toast = null; render(); }, 2400);
}
function go(p) { S.page = p; window.scrollTo(0, 0); render(); }

/* ------------------------------ اقدام‌ها ------------------------------ */

function doReveal(id) {
  if (!can.reveal) {
    S.modal = { type: 'blocked' }; render(); return;
  }
  if (S.revealsToday >= S.limitDay) {
    S.modal = { type: 'limit' }; render(); return;
  }
  S.modal = { type: 'confirmReveal', id }; render();
}
function confirmReveal(id) {
  S.reveals[id] = true;
  S.revealsToday++;
  const h = HAVALES.find(x => x.id === id); if (h) h.views++;
  S.modal = null;
  toast('مشخصات باز شد — این اقدام در پنل مدیریت ثبت شد');
}
function tryBlocked(what) {
  if (S.sub !== 'active') { S.modal = { type: 'blocked', what }; render(); return true; }
  return false;
}

/* ================================================================
   اجزای مشترک
   ================================================================ */

function sidebar() {
  const admin = S.page.startsWith('adm');
  const items = admin ? [
    ['—', 'مدیریت'],
    ['adm-dash',    '▦', 'داشبورد', ''],
    ['adm-agents',  '⌸', 'نمایندگی‌ها', ''],
    ['adm-agent',   '❏', 'پرونده‌ی نماینده', ''],
    ['adm-new',     '＋', 'ساخت نمایندگی', ''],
    ['—', 'محتوا'],
    ['adm-havales', '☰', 'حواله‌ها', ''],
    ['adm-reports', '⚑', 'گزارش تخلف', '۲'],
    ['adm-tickets', '✉', 'تیکت‌ها', '۳'],
    ['—', 'نظارت و مالی'],
    ['adm-monitor', '◎', 'مانیتورینگ', ''],
    ['adm-seats',   '⛁', 'درخواست ظرفیت', '۱'],
    ['adm-settings','⚙', 'تنظیمات و پایه‌ها', ''],
  ] : [
    ['—', 'حواله'],
    ['dash',    '▦', 'داشبورد', ''],
    ['search',  '⌕', 'استعلام حواله‌ها', ''],
    ['new',     '＋', 'ثبت حواله جدید', ''],
    ['request', '⇩', 'ثبت درخواست خرید', ''],
    ['mine',    '☰', 'حواله‌های من', ''],
    ['—', 'حساب'],
    ['subs',    '◷', 'اشتراک من', ''],
    ['sublist', '⛁', 'زیرنمایندگی‌ها', ''],
    ['tickets', '✉', 'پشتیبانی', '۱'],
  ];

  return `
  <aside class="sidebar" id="sb">
    <div class="brand">
      <div class="mark"><span class="glyph">ح</span> سامانه حواله خودرو</div>
      <div class="sub">${admin ? 'پنل مدیریت' : 'پنل نمایندگی‌ها'}</div>
    </div>
    <nav class="nav">
      ${items.map(it => it[0] === '—'
        ? `<div class="group">${it[1]}</div>`
        : `<a class="${S.page === it[0] ? 'on' : ''}" onclick="go('${it[0]}')">
             <span class="ico">${it[1]}</span>${it[2]}
             ${it[3] ? `<span class="pill">${it[3]}</span>` : ''}
           </a>`).join('')}
    </nav>
    <div class="sidefoot">
      ${admin
        ? `<b>${S.role === 'super' ? 'مدیر کل' : S.role === 'support' ? 'پشتیبانی' : 'مالی'}</b>سطح دسترسی فعلی`
        : `<b>${ME.code}</b>${ME.agency} — ${ME.city}`}
    </div>
  </aside>`;
}

function topbar(title, crumb) {
  const admin = S.page.startsWith('adm');
  return `
  <div class="topbar">
    <button class="btn sm menubtn" onclick="document.getElementById('sb').classList.toggle('show')">☰</button>
    <div>
      <h1>${title}</h1>
      ${crumb ? `<div class="crumb">${crumb}</div>` : ''}
    </div>
    <div class="spacer"></div>
    ${!admin ? `<span class="tag ${S.sub === 'active' ? 'g' : 'r'}">
        ${S.sub === 'active' ? 'اشتراک فعال تا ' + ME.ends : 'اشتراک منقضی'}
      </span>` : ''}
    <div class="who">
      <div class="av">${admin ? 'م' : 'س'}</div>
      <div>
        <div class="nm">${admin ? 'مدیر سامانه' : ME.name}</div>
        <div class="rl">${admin ? (S.role === 'super' ? 'مدیر کل' : S.role === 'support' ? 'پشتیبانی' : 'مالی') : ME.agency}</div>
      </div>
    </div>
  </div>`;
}

/* نوار هشدار اشتراک منقضی — بند ۷.۳ */
function expiredBanner() {
  if (S.sub === 'active') return '';
  return `
  <div class="banner warn">
    <span class="b-ico">⚠</span>
    <div class="b-txt">
      <b>اشتراک شما تمام شده است</b>
      حواله‌ها را می‌بینید، ولی <b>مشخصات تماس و کد نمایندگی مخفی است</b> و امکان ثبت حواله، ثبت درخواست خرید و تمدید آگهی ندارید.
    </div>
    <button class="btn primary" onclick="go('subs')">تمدید اشتراک</button>
  </div>`;
}

/* ================================================================
   ۱ و ۲ — ورود
   ================================================================ */

function pageLogin() {
  return `
  <div class="auth">
    <div class="authbox">
      <div class="head">
        <div class="glyph">ح</div>
        <h1>سامانه حواله خودرو</h1>
        <p>ورود نمایندگی‌ها</p>
      </div>
      <div class="body">
        <div class="field">
          <label>نام کاربری</label>
          <input class="in" value="goodarzi" dir="ltr">
        </div>
        <div class="field">
          <label>رمز عبور</label>
          <input class="in" type="password" value="••••••••" dir="ltr">
        </div>
        <button class="btn primary" style="padding:10px" onclick="go('otp')">ورود به سامانه</button>
        <div style="font-size:11.5px;color:var(--ink-3);text-align:center">
          رمز را فراموش کرده‌اید؟ <b>بازیابی با پیامک</b>
        </div>
      </div>
      <div class="foot">هر حساب همزمان فقط یک نشست فعال دارد</div>
    </div>
  </div>`;
}

function pageOtp() {
  return `
  <div class="auth">
    <div class="authbox">
      <div class="head">
        <div class="glyph">◷</div>
        <h1>کد تأیید</h1>
        <p>کد ۶ رقمی به ۰۹۱۲۳۳۴۵۵۶۷ پیامک شد</p>
      </div>
      <div class="body">
        <div class="otpbox">
          ${[4,8,1,9,2,'_'].map(v => `<input value="${v === '_' ? '' : v}" maxlength="1">`).join('')}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--ink-3)">
          ارسال مجدد تا <b class="num">۰۱:۲۳</b> دیگر
        </div>
        <button class="btn primary" style="padding:10px" onclick="go('changepass')">تأیید و ورود</button>
        <button class="btn ghost" onclick="go('login')">بازگشت</button>
      </div>
      <div class="foot">اعتبار کد ۲ دقیقه — حداکثر ۵ تلاش</div>
    </div>
  </div>`;
}

/* ۳ — تغییر اجباری رمز در اولین ورود */
function pageChangePass() {
  return `
  <div class="auth">
    <div class="authbox">
      <div class="head">
        <div class="glyph">⚿</div>
        <h1>تغییر رمز عبور</h1>
        <p>در اولین ورود، تغییر رمز اجباری است</p>
      </div>
      <div class="body">
        <div class="field"><label>رمز جدید</label><input class="in" type="password" dir="ltr"></div>
        <div class="field"><label>تکرار رمز جدید</label><input class="in" type="password" dir="ltr"></div>
        <button class="btn primary" style="padding:10px" onclick="go('dash')">ثبت و ورود به پنل</button>
      </div>
      <div class="foot">حداقل ۸ کاراکتر، شامل حرف و عدد</div>
    </div>
  </div>`;
}

/* ================================================================
   ۴ — داشبورد نماینده
   ================================================================ */

function pageDash() {
  const mine = HAVALES.filter(h => h.owner === 'a1');
  const opened = HAVALES.filter(h => isRevealed(h.id) && h.owner !== 'a1');
  const closing = mine.filter(h => h.status === 'active' && h.left <= 1);

  return `${expiredBanner()}
  ${closing.length ? `
  <div class="banner info">
    <span class="b-ico">◷</span>
    <div class="b-txt"><b>${fa(closing.length)} آگهی شما به نیمه‌ی عمرش رسیده</b>
      هشدار در داشبورد و با پیامک فرستاده شد. با یک کلیک تمدید کنید.</div>
    <button class="btn" onclick="go('mine')">حواله‌های من</button>
  </div>` : ''}

  <div class="stats">
    <div class="stat"><div class="lbl">حواله‌های فعال من</div><div class="val num">${fa(mine.filter(h=>h.status==='active').length)}</div><div class="delta">از مجموع ${fa(mine.length)} حواله</div></div>
    <div class="stat c-copper"><div class="lbl">درخواست‌های خرید من</div><div class="val num">${fa(HAVALES.filter(h=>h.owner==='a1'&&h.kind==='request').length)}</div><div class="delta">فعال</div></div>
    <div class="stat c-ok"><div class="lbl">بازدید از حواله‌های من</div><div class="val num">${fa(mine.reduce((s,h)=>s+h.views,0))}</div><div class="delta">فقط تعداد — هویت نمایش داده نمی‌شود</div></div>
    <div class="stat ${S.revealsToday >= S.limitDay ? 'c-danger' : ''}"><div class="lbl">سقف باقی‌مانده‌ی امروز</div><div class="val num">${fa(S.limitDay - S.revealsToday)} <small>از ${fa(S.limitDay)}</small></div><div class="delta">روز تقویمی، وقت ایران</div></div>
  </div>

  <div class="cols c3">
    <div>
      <div class="card">
        <header><h2>مشخصاتی که برای من باز شده</h2><span class="hint">با اطلاعات تماس کامل</span><div class="spacer"></div>
          <span class="tag b">${fa(opened.length)} مورد</span></header>
        <div class="body tight">
          ${opened.length ? `<div class="tblwrap"><table class="tbl">
            <thead><tr><th>حواله</th><th>خودرو</th><th>نمایندگی / شهر</th><th>تماس</th><th class="c">مبلغ</th></tr></thead>
            <tbody>${opened.map(h => { const o = agent(h.owner); return `
              <tr>
                <td class="mono">HV-${fa(h.id)}</td>
                <td class="strong">${esc(h.car)}</td>
                <td>${S.sub === 'active'
                  ? `${esc(o.agency)}<div style="color:var(--ink-3);font-size:11px">${esc(o.code)} — ${esc(o.city)}</div>`
                  : `<span class="tag n">مخفی</span>`}</td>
                <td>${S.sub === 'active'
                  ? `<div class="num" style="font-weight:700">${esc(o.phone)}</div><div style="color:var(--ink-3);font-size:11px">${esc(o.coord)}</div>`
                  : `<span class="tag n">مخفی — اشتراک منقضی</span>`}</td>
                <td class="c mono">${money(h.price)}</td>
              </tr>`; }).join('')}</tbody></table></div>`
            : `<div class="empty"><span class="big">◌</span>هنوز مشخصات هیچ حواله‌ای را باز نکرده‌اید</div>`}
        </div>
      </div>

      <div class="card">
        <header><h2>آخرین حواله‌های سامانه</h2><span class="hint">مشخصات مخفی است</span></header>
        <div class="body tight">
          <div class="tblwrap"><table class="tbl">
            <thead><tr><th>حواله</th><th>خودرو</th><th>رنگ</th><th>مدل</th><th class="c">مبلغ</th><th class="c">تحویل</th><th class="c">مشخصات</th></tr></thead>
            <tbody>${HAVALES.filter(h=>h.kind==='offer'&&h.status==='active'&&h.owner!=='a1').slice(0,6).map(h=>`
              <tr>
                <td class="mono">HV-${fa(h.id)}</td>
                <td class="strong">${esc(h.car)}</td>
                <td>${esc(h.color)}</td>
                <td class="mono">${esc(h.year)}</td>
                <td class="c mono">${money(h.price)}</td>
                <td class="c mono">${fa(h.delivery)} روز</td>
                <td class="c">${isRevealed(h.id)
                  ? `<span class="tag g">باز شده</span>`
                  : `<button class="btn sm" onclick="doReveal(${h.id})">نمایش</button>`}</td>
              </tr>`).join('')}</tbody></table></div>
        </div>
      </div>
    </div>

    <div>
      <div class="card">
        <header><h2>ظرفیت زیرنمایندگی</h2></header>
        <div class="body">
          <div class="stats" style="grid-template-columns:1fr 1fr;margin:0">
            <div class="stat"><div class="lbl">پیش‌خرید ماه</div><div class="val num">${fa(50)}</div></div>
            <div class="stat c-copper"><div class="lbl">مصرف‌شده</div><div class="val num">${fa(SUBAGENTS.length)}</div></div>
          </div>
          <div style="margin-top:11px;font-size:12px;color:var(--ink-3)">
            صورتحساب این دوره: اشتراک ۲۵٬۰۰۰٬۰۰۰ + ظرفیت ۵۰٬۰۰۰٬۰۰۰ =
            <b style="color:var(--ink)">۷۵٬۰۰۰٬۰۰۰ تومان</b>
          </div>
          <button class="btn" style="width:100%;margin-top:10px" onclick="go('sublist')">مدیریت زیرنمایندگی‌ها</button>
        </div>
      </div>

      <div class="card">
        <header><h2>تیکت‌های اخیر</h2></header>
        <div class="body tight">
          <table class="tbl"><tbody>
            ${TICKETS.slice(0,3).map(t=>`<tr onclick="go('ticket')" style="cursor:pointer">
              <td><div class="strong">${esc(t.subject)}</div><div style="color:var(--ink-3);font-size:11px">#${fa(t.id)} — ${t.at}</div></td>
              <td class="c">${ticketTag(t.st)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>

      <div class="card">
        <header><h2>گزارش‌های تخلف من</h2></header>
        <div class="body tight">
          <table class="tbl"><tbody>
            ${REPORTS.filter(r=>r.by==='a1'||r.on==='a1').slice(0,3).map(r=>`<tr>
              <td><div class="strong">HV-${fa(r.hv)}</div><div style="color:var(--ink-3);font-size:11px">${esc(r.reason)}</div></td>
              <td class="c">${reportTag(r.st)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>
    </div>
  </div>`;
}

function ticketTag(st) {
  return st === 'open' ? '<span class="tag o">باز</span>'
    : st === 'answered' ? '<span class="tag b">پاسخ داده شد</span>'
    : '<span class="tag n">بسته</span>';
}
function reportTag(st) {
  return st === 'pending' ? '<span class="tag o">در بررسی</span>'
    : st === 'confirmed' ? '<span class="tag r">تخلف تأیید شد</span>'
    : st === 'rejected' ? '<span class="tag n">رد شد</span>'
    : '<span class="tag r">بی‌مورد</span>';
}
function solhTag(s) {
  return s === 'solh'
    ? '<span class="tag g">صلح</span>'
    : '<span class="tag o">وکالتی</span>';
}

/* ================================================================
   ۵ — استعلام حواله‌ها
   ================================================================ */

function filtered() {
  return HAVALES.filter(h => {
    if (h.status !== 'active') return false;
    if (S.tab === 'mine') { if (h.owner !== 'a1') return false; }
    else if (h.kind !== S.tab) return false;
    if (S.tab !== 'mine' && h.owner === 'a1') return false;

    const o = agent(h.owner);
    if (S.q) {
      const hay = `${h.car} ${h.co || ''} HV-${h.id} ${h.id}`;
      if (!hay.includes(S.q)) return false;
    }
    if (S.fCar && h.car !== S.fCar) return false;
    /* درخواست بدون رنگ = «هر رنگ» و در همه‌ی فیلترهای رنگ دیده می‌شود — بند ۵.۱۴ */
    if (S.fColor && h.color && h.color !== S.fColor) return false;
    if (S.fSolh && h.solh !== S.fSolh) return false;
    if (S.fCity && o.city !== S.fCity) return false;
    return true;
  });
}

function pageSearch() {
  const list = filtered();
  const cnt = k => HAVALES.filter(h => h.status === 'active' && (k === 'mine' ? h.owner === 'a1' : h.kind === k && h.owner !== 'a1')).length;

  return `${expiredBanner()}
  <div class="card">
    <div class="tabs">
      <button class="${S.tab==='offer'?'on':''}" onclick="S.tab='offer';render()">حواله‌های فروش <span class="cnt">(${fa(cnt('offer'))})</span></button>
      <button class="${S.tab==='request'?'on':''}" onclick="S.tab='request';render()">درخواست‌های خرید <span class="cnt">(${fa(cnt('request'))})</span></button>
      <button class="${S.tab==='mine'?'on':''}" onclick="S.tab='mine';render()">حواله‌های من <span class="cnt">(${fa(cnt('mine'))})</span></button>
    </div>
    <div class="body">
      <div class="searchrow">
        <input class="in" placeholder="جستجو در نوع خودرو، شرکت، شماره حواله…" value="${esc(S.q)}"
               oninput="S.q=this.value;render();document.getElementById('sq').focus()" id="sq">
        <button class="btn" onclick="S.q='';S.fCar='';S.fColor='';S.fSolh='';S.fCity='';render()">پاک کردن فیلترها</button>
      </div>
      <div class="filters">
        ${sel('fCar', 'نوع خودرو', CARS)}
        ${sel('fColor', 'رنگ', COLORS)}
        ${selPairs('fSolh', 'امکان صلح', [['solh','صلح'],['vek','وکالتی']])}
        ${sel('fCity', 'شهر', CITIES)}
      </div>
    </div>
  </div>

  <div style="display:flex;align-items:center;gap:9px;margin-bottom:11px">
    <b style="font-size:13px">${fa(list.length)} نتیجه</b>
    <span style="font-size:11.5px;color:var(--ink-3)">
      ${S.sub === 'active'
        ? `سقف باقی‌مانده‌ی امروز: <b class="num">${fa(S.limitDay - S.revealsToday)}</b> از ${fa(S.limitDay)}`
        : 'در حالت اشتراک منقضی، مشخصات تماس و نمایندگی مخفی است'}
    </span>
  </div>

  ${list.length ? `<div class="hcards">${list.map(hcard).join('')}</div>`
    : `<div class="card"><div class="empty"><span class="big">⌕</span>حواله‌ای با این فیلترها پیدا نشد</div></div>`}`;
}

function sel(key, label, opts) {
  return `<select onchange="S['${key}']=this.value;render()">
    <option value="">${label}: همه</option>
    ${opts.map(o => `<option ${S[key]===o?'selected':''}>${esc(o)}</option>`).join('')}
  </select>`;
}
function selPairs(key, label, pairs) {
  return `<select onchange="S['${key}']=this.value;render()">
    <option value="">${label}: همه</option>
    ${pairs.map(([v,t]) => `<option value="${v}" ${S[key]===v?'selected':''}>${t}</option>`).join('')}
  </select>`;
}

function hcard(h) {
  const o = agent(h.owner);
  const own = h.owner === 'a1';
  const open = own || (isRevealed(h.id) && S.sub === 'active');
  const req = h.kind === 'request';

  return `
  <div class="hcard">
    <div class="top">
      <div style="flex:1">
        <div class="car">${esc(h.car)}</div>
        <div class="meta">${esc(h.color || 'هر رنگ')} • مدل ${esc(h.year || '—')} • ${esc(h.co || 'هر شرکتی')}</div>
      </div>
      <div style="text-align:left">
        <div class="code">HV-${fa(h.id)}</div>
        <div style="margin-top:3px">${req ? '<span class="tag o">درخواست خرید</span>' : solhTag(h.solh)}</div>
      </div>
    </div>

    <div class="price">${money(h.price)} <small>تومان</small></div>

    <div class="specs">
      <div><span>زمان تحویل</span><span class="num">${h.delivery ? fa(h.delivery) + ' روز' : '—'}</span></div>
      <div><span>مدت واریز</span><span class="num">${h.deposit ? fa(h.deposit) + ' روز' : '—'}</span></div>
      <div><span>پرداختی</span><span class="num">${money(h.paid)}</span></div>
      <div><span>عمر باقی‌مانده</span><span class="num">${fa(h.left)} روز</span></div>
    </div>

    ${open ? `
      <div class="contact open">
        <span style="font-size:15px">☏</span>
        <div class="c-txt">
          <b>${esc(o.agency)} — ${esc(o.city)}</b>
          <span class="ph">${esc(o.phone)}</span> · ${esc(o.coord)} · کد ${esc(o.code)}
        </div>
      </div>`
    : `
      <div class="contact">
        <span style="font-size:15px">⚿</span>
        <div class="c-txt hidden-note">
          ${S.sub === 'active'
            ? 'اطلاعات تماس و کد نمایندگی مخفی است'
            : 'با اشتراک منقضی، مشخصات نمایش داده نمی‌شود'}
        </div>
        <button class="btn ${S.sub === 'active' ? 'primary' : ''} sm" onclick="doReveal(${h.id})">
          ${S.sub === 'active' ? 'نمایش مشخصات' : 'قفل'}
        </button>
      </div>`}

    <div class="btnrow" style="justify-content:space-between;align-items:center">
      <span style="font-size:11px;color:var(--ink-3)">${esc(h.age)} • ${fa(h.views)} بازدید</span>
      <button class="btn sm ${can.report ? '' : ''}" onclick="reportModal(${h.id})">گزارش تخلف</button>
    </div>
  </div>`;
}

/* ================================================================
   ۶ و ۷ — ثبت حواله / درخواست خرید
   ================================================================ */

function formHavale(kind) {
  const req = kind === 'request';
  const R = '<span class="req">*</span>';
  const blocked = S.sub !== 'active';

  return `${expiredBanner()}
  ${blocked ? `<div class="banner bad"><span class="b-ico">⛔</span>
    <div class="b-txt"><b>ثبت ${req ? 'درخواست خرید' : 'حواله'} با اشتراک تمام‌شده ممکن نیست</b>
      فرم را می‌بینید ولی دکمه‌ی ثبت غیرفعال است.</div></div>` : ''}

  <div class="card">
    <header>
      <h2>${req ? 'ثبت درخواست خرید حواله' : 'ثبت حواله جدید (فروش)'}</h2>
      <span class="hint">${req ? 'فقط نوع خودرو و امکان صلح الزامی است' : 'همه‌ی فیلدها جز توضیحات الزامی است'}</span>
    </header>
    <div class="body">
      <div class="grid g3">
        <div class="field"><label>نوع خودرو ${R}</label>
          <select>${CARS.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>امکان صلح ${R}</label>
          <select><option>صلح</option><option>وکالتی</option></select></div>
        <div class="field"><label>رنگ خودرو ${req ? '' : R}</label>
          <select><option>${req ? 'فرقی ندارد — هر رنگ' : 'انتخاب کنید'}</option>${COLORS.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
          ${req ? '<div class="help">اگر خالی بماند، درخواست شما در جستجوی همه‌ی رنگ‌ها دیده می‌شود</div>' : ''}</div>
      </div>

      <div class="grid g3" style="margin-top:13px">
        <div class="field"><label>مدل (سال) ${req ? '' : R}</label>
          <select><option>${req ? 'فرقی ندارد' : 'انتخاب کنید'}</option>${YEARS.map(y=>`<option>${esc(y)}</option>`).join('')}</select></div>
        <div class="field"><label>شرکت عرضه کننده ${req ? '' : R}</label>
          <select>${COMPANIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>مبلغ حواله (تومان) ${req ? '' : R}</label>
          <input class="in num" placeholder="۱٬۲۸۵٬۰۰۰٬۰۰۰">
          <div class="help">یک میلیارد و دویست و هشتاد و پنج میلیون تومان</div></div>
      </div>

      <div class="grid g3" style="margin-top:13px">
        <div class="field"><label>مبلغ پرداخت شده به شرکت (تومان) ${req ? '' : R}</label>
          <input class="in num" placeholder="۶۴۰٬۰۰۰٬۰۰۰"></div>
        <div class="field"><label>زمان تحویل (روز) ${req ? '' : R}</label>
          <input class="in num" placeholder="۹۰"></div>
        <div class="field"><label>مدت زمان واریز (روز) ${req ? '' : R}</label>
          <input class="in num" placeholder="۳">
          <div class="help copper">بین ۱ تا ۳۰ روز — عمر آگهی هم همین است</div></div>
      </div>

      <div class="grid g2" style="margin-top:13px">
        <div class="field"><label>کد نمایندگی / شهر <span class="lock">🔒 قفل</span></label>
          <input class="in" value="${esc(ME.code)} — ${esc(ME.city)}" readonly>
          <div class="help">از پروفایل شما خوانده می‌شود</div></div>
        <div class="field"><label>اطلاعات تماس مسئول هماهنگی <span class="lock">🔒 قفل</span></label>
          <input class="in" value="${esc(ME.coord)} — ${esc(ME.phone)}" readonly>
          <div class="help">تغییرش فقط با تیکت و تأیید ادمین؛ با تأیید، همه‌ی آگهی‌ها یکجا به‌روز می‌شوند</div></div>
      </div>

      <div class="field" style="margin-top:13px"><label>توضیحات</label>
        <textarea rows="3" placeholder="توضیح اختیاری…"></textarea></div>

      <div class="btnrow" style="margin-top:16px">
        <button class="btn primary" ${blocked ? 'disabled' : ''} onclick="toast('${req ? 'درخواست خرید' : 'حواله'} ثبت شد — نمونه‌ی موک‌آپ')">
          ثبت ${req ? 'درخواست' : 'حواله'}
        </button>
        <button class="btn">انصراف</button>
        ${!req ? '<span style="font-size:11.5px;color:var(--ink-3);align-self:center">عمر آگهی = مدت زمان واریز</span>'
               : '<span style="font-size:11.5px;color:var(--ink-3);align-self:center">عمر درخواست خرید: ۷ روز</span>'}
      </div>
    </div>
  </div>`;
}

/* ================================================================
   ۸ — حواله‌های من
   ================================================================ */

function pageMine() {
  const mine = HAVALES.filter(h => h.owner === 'a1');
  return `${expiredBanner()}
  <div class="card">
    <header><h2>حواله‌های من</h2><span class="hint">آگهی‌های منقضی پاک نمی‌شوند — انتخابی دوباره فعال می‌شوند</span></header>
    <div class="body tight"><div class="tblwrap">
      <table class="tbl">
        <thead><tr><th>حواله</th><th>خودرو</th><th>نوع</th><th class="c">مبلغ</th><th class="c">بازدید</th><th class="c">وضعیت</th><th class="c">عمر</th><th></th></tr></thead>
        <tbody>${mine.map(h => `
          <tr>
            <td class="mono">HV-${fa(h.id)}</td>
            <td class="strong">${esc(h.car)}<div style="color:var(--ink-3);font-size:11px">${esc(h.color||'هر رنگ')} • ${esc(h.year||'—')}</div></td>
            <td>${h.kind === 'offer' ? '<span class="tag b">فروش</span>' : '<span class="tag o">درخواست خرید</span>'}</td>
            <td class="c mono">${money(h.price)}</td>
            <td class="c mono">${fa(h.views)}</td>
            <td class="c">${
              h.status === 'active' ? '<span class="tag g">فعال</span>'
              : h.status === 'expired' ? '<span class="tag n">منقضی</span>'
              : '<span class="tag b">فروخته شد</span>'}</td>
            <td class="c mono">${h.status === 'active' ? fa(h.left) + ' روز' : '—'}</td>
            <td>
              <div class="btnrow">
                ${h.status === 'expired'
                  ? `<button class="btn sm ${can.renew?'primary':''}" ${can.renew?'':'disabled'} onclick="renewModal(${h.id})">فعال‌سازی مجدد</button>`
                  : h.status === 'active'
                    ? `<button class="btn sm" ${can.renew?'':'disabled'} onclick="renewModal(${h.id})">تمدید</button>
                       <button class="btn sm" onclick="toast('علامت «فروخته شد» ثبت شد')">فروخته شد</button>`
                    : ''}
              </div>
            </td>
          </tr>`).join('')}</tbody>
      </table>
    </div></div>
  </div>
  <div class="banner info"><span class="b-ico">☏</span><div class="b-txt">
    <b>بازدیدکنندگان: فقط تعداد</b>
    شما فقط عدد بازدید را می‌بینید، نه اینکه چه کسی مشخصات را باز کرده. این اطلاعات فقط در پنل مدیریت موجود است.
  </div></div>`;
}

/* ================================================================
   ۹ — زیرنمایندگی‌ها
   ================================================================ */

function pageSubList() {
  return `${expiredBanner()}
  <div class="stats">
    <div class="stat"><div class="lbl">ظرفیت پیش‌خریدشده‌ی این دوره</div><div class="val num">${fa(50)}</div><div class="delta">دوره‌ی جاری</div></div>
    <div class="stat c-copper"><div class="lbl">مصرف‌شده</div><div class="val num">${fa(SUBAGENTS.length)}</div><div class="delta">${fa(SUBAGENTS.filter(s=>s.st==='active').length)} فعال</div></div>
    <div class="stat c-ok"><div class="lbl">باقی‌مانده</div><div class="val num">${fa(50 - SUBAGENTS.length)}</div></div>
    <div class="stat"><div class="lbl">صورتحساب دوره</div><div class="val num">۷۵</div><div class="delta">میلیون تومان — اشتراک + ظرفیت</div></div>
  </div>

  <div class="banner info"><span class="b-ico">⛁</span><div class="b-txt">
    <b>ظرفیت پیش‌پرداخت است</b>
    تعلیق زیرنماینده وسط ماه پول برنمی‌گرداند و ظرفیتش تا پایان ماه آزاد نمی‌شود.
  </div>
  <button class="btn primary" onclick="S.modal={type:'buySeats'};render()">خرید ظرفیت بیشتر</button></div>

  <div class="card">
    <header><h2>زیرنمایندگی‌های من</h2><div class="spacer"></div>
      <button class="btn primary sm" ${can.create?'':'disabled'} onclick="S.modal={type:'newSub'};render()">＋ ساخت زیرنماینده</button></header>
    <div class="body tight"><div class="tblwrap">
      <table class="tbl">
        <thead><tr><th>کد</th><th>نام</th><th>شهر</th><th class="c">حواله فعال</th><th>آخرین ورود</th><th class="c">وضعیت</th><th></th></tr></thead>
        <tbody>${SUBAGENTS.map(s=>`
          <tr>
            <td class="mono strong">${esc(s.code)}</td>
            <td>${esc(s.name)}</td>
            <td>${esc(s.city)}</td>
            <td class="c mono">${fa(s.hv)}</td>
            <td style="color:var(--ink-3)">${esc(s.last)}</td>
            <td class="c">${s.st==='active'?'<span class="tag g">فعال</span>':'<span class="tag r">تعلیق</span>'}</td>
            <td><div class="btnrow">
              <button class="btn sm" onclick="toast('رمز جدید ثبت شد')">ریست رمز</button>
              <button class="btn sm" onclick="toast('وضعیت تغییر کرد')">${s.st==='active'?'تعلیق':'فعال‌سازی'}</button>
            </div></td>
          </tr>`).join('')}</tbody>
      </table>
    </div></div>
  </div>

  <div class="card">
    <header><h2>تاریخچه‌ی خرید ظرفیت</h2></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>#</th><th>تعداد</th><th class="c">مبلغ کل</th><th>تاریخ</th><th class="c">وضعیت</th></tr></thead>
      <tbody>${SEAT_ORDERS.filter(o=>o.agent==='a1').map(o=>`
        <tr><td class="mono">${fa(o.id)}</td><td class="mono">${fa(o.seats)} ظرفیت</td>
        <td class="c mono">${money(o.total)}</td><td>${esc(o.at)}</td>
        <td class="c">${o.st==='paid'?'<span class="tag g">پرداخت شد</span>':o.st==='pending'?'<span class="tag o">در انتظار</span>':'<span class="tag r">رد شد</span>'}</td></tr>`).join('')}
      </tbody></table></div>
  </div>`;
}

/* ================================================================
   ۱۰ و ۱۱ — تیکت‌ها
   ================================================================ */

function pageTickets() {
  return `
  <div class="card">
    <header><h2>تیکت‌های پشتیبانی</h2><div class="spacer"></div>
      <button class="btn primary sm" onclick="S.modal={type:'newTicket'};render()">＋ تیکت جدید</button></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>#</th><th>موضوع</th><th class="c">اولویت</th><th>آخرین پاسخ</th><th class="c">وضعیت</th></tr></thead>
      <tbody>${TICKETS.map(t=>`
        <tr onclick="go('ticket')" style="cursor:pointer">
          <td class="mono">${fa(t.id)}</td>
          <td class="strong">${esc(t.subject)} ${t.unread?'<span class="tag b">جدید</span>':''}</td>
          <td class="c">${t.pr==='high'?'<span class="tag r">زیاد</span>':t.pr==='normal'?'<span class="tag n">معمولی</span>':'<span class="tag n">کم</span>'}</td>
          <td style="color:var(--ink-3)">${esc(t.at)}</td>
          <td class="c">${ticketTag(t.st)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}

function pageTicket() {
  const t = TICKETS[0];
  return `
  <div class="card">
    <header>
      <h2>#${fa(t.id)} — ${esc(t.subject)}</h2>
      <div class="spacer"></div>${ticketTag(t.st)}
      <button class="btn sm" onclick="go('tickets')">بازگشت</button>
    </header>
    <div class="chat">
      ${t.msgs.map(m=>`
        <div class="msg ${m.me?'me':'staff'}">
          <div class="who">${esc(m.who)} — ${esc(m.t)}</div>
          ${esc(m.b)}
        </div>`).join('')}
    </div>
    <div class="body" style="border-top:1px solid var(--line-2)">
      <div class="field"><textarea rows="3" placeholder="پاسخ خود را بنویسید…"></textarea></div>
      <div class="btnrow" style="margin-top:9px">
        <button class="btn primary" onclick="toast('پاسخ ارسال شد')">ارسال پاسخ</button>
        <button class="btn">بستن تیکت</button>
      </div>
    </div>
  </div>`;
}

/* ================================================================
   ۱۲ — اشتراک من
   ================================================================ */

function pageSubs() {
  return `${expiredBanner()}
  <div class="cols c2">
    <div class="card">
      <header><h2>وضعیت اشتراک</h2></header>
      <div class="body">
        <div class="stats" style="margin:0">
          <div class="stat ${S.sub==='active'?'c-ok':'c-danger'}">
            <div class="lbl">وضعیت</div>
            <div class="val" style="font-size:19px">${S.sub==='active'?'فعال':'منقضی'}</div>
            <div class="delta">${S.sub==='active'?'تا '+ME.ends:'از ۱۴۰۴/۰۴/۰۲'}</div>
          </div>
          <div class="stat"><div class="lbl">روز باقی‌مانده</div><div class="val num">${S.sub==='active'?'۳۷':'۰'}</div></div>
        </div>
        <div style="margin-top:14px;font-size:13px;line-height:2">
          <div style="display:flex;justify-content:space-between;border-bottom:1px dotted var(--line);padding:4px 0">
            <span style="color:var(--ink-3)">پلن</span><b>ماهیانه</b></div>
          <div style="display:flex;justify-content:space-between;border-bottom:1px dotted var(--line);padding:4px 0">
            <span style="color:var(--ink-3)">مبلغ اشتراک</span><b class="num">۲۵٬۰۰۰٬۰۰۰ تومان</b></div>
          <div style="display:flex;justify-content:space-between;border-bottom:1px dotted var(--line);padding:4px 0">
            <span style="color:var(--ink-3)">ظرفیت زیرنمایندگی (۵۰ نفر)</span><b class="num">۵۰٬۰۰۰٬۰۰۰ تومان</b></div>
          <div style="display:flex;justify-content:space-between;padding:7px 0;font-size:15px">
            <span>مجموع ماهانه</span><b class="num">۷۵٬۰۰۰٬۰۰۰ تومان</b></div>
        </div>
        <button class="btn primary" style="width:100%;margin-top:12px" onclick="toast('درخواست تمدید برای ادمین ارسال شد')">درخواست تمدید</button>
        <div style="font-size:11.5px;color:var(--ink-3);margin-top:7px;text-align:center">
          پرداخت دستی است — پس از واریز، ادمین تأیید می‌کند
        </div>
      </div>
    </div>

    <div class="card">
      <header><h2>سقف نمایش مشخصات</h2></header>
      <div class="body">
        <div class="stats" style="margin:0;grid-template-columns:1fr 1fr">
          <div class="stat"><div class="lbl">امروز</div><div class="val num">${fa(S.revealsToday)} <small>از ${fa(S.limitDay)}</small></div><div class="delta">روز تقویمی</div></div>
          <div class="stat c-copper"><div class="lbl">این دوره</div><div class="val num">۸۴ <small>از ۳۰۰</small></div><div class="delta">دوره‌ی ۳۰ روزه</div></div>
        </div>
        <div class="banner info" style="margin:13px 0 0">
          <span class="b-ico">◷</span>
          <div class="b-txt">سقف روزانه نیمه‌شب صفر می‌شود و سقف دوره‌ای در روز تمدید اشتراک — به وقت ایران.</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <header><h2>تاریخچه‌ی اشتراک</h2></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>دوره</th><th>پلن</th><th class="c">اشتراک</th><th class="c">ظرفیت</th><th class="c">مجموع</th><th class="c">وضعیت</th></tr></thead>
      <tbody>
        <tr><td>مرداد ۱۴۰۴</td><td>ماهیانه</td><td class="c mono">۲۵٬۰۰۰٬۰۰۰</td><td class="c mono">۵۰٬۰۰۰٬۰۰۰</td><td class="c mono strong">۷۵٬۰۰۰٬۰۰۰</td><td class="c"><span class="tag g">پرداخت شد</span></td></tr>
        <tr><td>تیر ۱۴۰۴</td><td>ماهیانه</td><td class="c mono">۲۵٬۰۰۰٬۰۰۰</td><td class="c mono">۵۰٬۰۰۰٬۰۰۰</td><td class="c mono strong">۷۵٬۰۰۰٬۰۰۰</td><td class="c"><span class="tag g">پرداخت شد</span></td></tr>
        <tr><td>خرداد ۱۴۰۴</td><td>ماهیانه</td><td class="c mono">۲۵٬۰۰۰٬۰۰۰</td><td class="c mono">۴۵٬۰۰۰٬۰۰۰</td><td class="c mono strong">۷۰٬۰۰۰٬۰۰۰</td><td class="c"><span class="tag g">پرداخت شد</span></td></tr>
      </tbody></table></div>
  </div>`;
}
