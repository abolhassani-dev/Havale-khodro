/* ================================================================
   پنل مدیریت — صفحه‌های ۱۳ تا ۲۱
   ================================================================ */

/* دسترسی بر اساس نقش — جدول بند ۱۱.۱۲ */
const RIGHTS = {
  super:   { tickets:1, reports:1, subs:1, seats:1, agents:1, monitor:1, excel:1, contacts:1, settings:1 },
  support: { tickets:1, reports:1, subs:0, seats:0, agents:0, monitor:0, excel:0, contacts:0, settings:0 },
  finance: { tickets:0, reports:0, subs:1, seats:1, agents:0, monitor:0, excel:0, contacts:0, settings:0 },
};
const may = k => !!RIGHTS[S.role][k];

function denied(what) {
  return `<div class="card"><div class="empty">
    <span class="big">⚿</span>
    <b style="display:block;color:var(--ink);font-size:14px;margin-bottom:4px">دسترسی ندارید</b>
    نقش «${S.role === 'support' ? 'پشتیبانی' : 'مالی'}» به ${what} دسترسی ندارد.
    <div style="margin-top:11px"><button class="btn" onclick="S.role='super';render()">تغییر نقش به مدیر کل</button></div>
  </div></div>`;
}

/* ---------------------------- ۱۳ داشبورد ---------------------------- */

function admDash() {
  return `
  <div class="stats">
    <div class="stat"><div class="lbl">نمایندگی فعال</div><div class="val num">${fa(4)}</div><div class="delta">۱ منقضی، ۷ زیرنماینده</div></div>
    <div class="stat c-copper"><div class="lbl">حواله‌های امروز</div><div class="val num">${fa(3)}</div><div class="delta">۱ درخواست خرید</div></div>
    <div class="stat c-danger"><div class="lbl">گزارش تخلف در انتظار</div><div class="val num">${fa(REPORTS.filter(r=>r.st==='pending').length)}</div><div class="delta">نیازمند بررسی</div></div>
    <div class="stat"><div class="lbl">تیکت باز</div><div class="val num">${fa(ADMIN_TICKETS.filter(t=>t.st==='open').length)}</div></div>
    <div class="stat c-ok"><div class="lbl">درآمد مرداد</div><div class="val num">۱۵۵</div><div class="delta">میلیون تومان</div></div>
    <div class="stat c-copper"><div class="lbl">درخواست ظرفیت</div><div class="val num">${fa(SEAT_ORDERS.filter(o=>o.st==='pending').length)}</div><div class="delta">در انتظار تأیید</div></div>
  </div>

  <div class="cols c3">
    <div class="card">
      <header><h2>روند ثبت حواله — ۱۴ روز اخیر</h2></header>
      <div class="body">
        <div style="display:flex;align-items:flex-end;gap:5px;height:132px">
          ${[4,7,3,9,6,11,8,5,12,7,10,6,9,3].map((v,i)=>`
            <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
              <div style="height:${v*8}%;background:linear-gradient(180deg,#2a9d8f,#0f5a52);border-radius:4px 4px 0 0;opacity:${.55+i/28}"></div>
            </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-3);margin-top:6px">
          <span>۱۴ روز پیش</span><span>امروز</span>
        </div>
      </div>
    </div>

    <div class="card">
      <header><h2>اشتراک‌های نزدیک به انقضا</h2><span class="hint">۷ روز آینده</span></header>
      <div class="body tight"><table class="tbl"><tbody>
        <tr><td><b>${esc(AGENTS[1].agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(AGENTS[1].code)}</div></td>
            <td class="c"><span class="tag o">۵ روز</span></td></tr>
        <tr><td><b>${esc(AGENTS[3].agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(AGENTS[3].code)}</div></td>
            <td class="c"><span class="tag o">۷ روز</span></td></tr>
        <tr><td><b>${esc(AGENTS[2].agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(AGENTS[2].code)}</div></td>
            <td class="c"><span class="tag r">منقضی</span></td></tr>
      </tbody></table></div>
    </div>
  </div>`;
}

/* ---------------------------- ۱۴ لیست نمایندگی‌ها ---------------------------- */

function admAgents() {
  if (!may('agents')) return denied('مدیریت نمایندگی‌ها');
  return `
  <div class="card">
    <header><h2>نمایندگی‌ها</h2><div class="spacer"></div>
      <button class="btn sm" ${may('excel')?'':'disabled'} onclick="toast('خروجی اکسل ساخته شد')">خروجی اکسل</button>
      <button class="btn primary sm" onclick="go('adm-new')">＋ نمایندگی جدید</button></header>
    <div class="body">
      <div class="filters">
        <input class="in" placeholder="جستجو در نام، کد، موبایل…">
        <select><option>وضعیت اشتراک: همه</option><option>فعال</option><option>منقضی</option></select>
        <select><option>شهر: همه</option>${CITIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
        <select><option>نوع: همه</option><option>نماینده</option><option>زیرنماینده</option></select>
      </div>
    </div>
    <div class="body tight"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>کد</th><th>نمایندگی</th><th>شهر</th><th class="c">اشتراک</th><th class="c">زیرنماینده</th><th class="c">حواله</th><th></th></tr></thead>
      <tbody>${AGENTS.map(a=>`
        <tr>
          <td class="mono strong">${esc(a.code)}${a.parent?'<div style="color:var(--ink-3);font-size:10.5px">زیرمجموعه</div>':''}</td>
          <td><b>${esc(a.agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(a.name)} — ${esc(a.phone)}</div></td>
          <td>${esc(a.city)}</td>
          <td class="c">${a.sub==='active'?`<span class="tag g">تا ${esc(a.ends)}</span>`:'<span class="tag r">منقضی</span>'}</td>
          <td class="c mono">${a.reseller?fa(a.kids):'—'}</td>
          <td class="c mono">${fa(HAVALES.filter(h=>h.owner===a.id).length)}</td>
          <td><div class="btnrow">
            <button class="btn sm" onclick="go('adm-agent')">پرونده</button>
            <button class="btn sm" onclick="toast('نشست کاربر بسته شد')">خروج اجباری</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div></div>
  </div>`;
}

/* ---------------------------- ۱۵ ساخت نمایندگی ---------------------------- */

function admNew() {
  if (!may('agents')) return denied('ساخت نمایندگی');
  const R = '<span class="req">*</span>';
  return `
  <div class="card">
    <header><h2>ساخت نمایندگی جدید</h2><span class="hint">حساب فقط توسط ما ساخته می‌شود — ثبت‌نام عمومی وجود ندارد</span></header>
    <div class="body">
      <div class="grid g3">
        <div class="field"><label>نام و نام خانوادگی ${R}</label><input class="in"></div>
        <div class="field"><label>نام نمایندگی ${R}</label><input class="in"></div>
        <div class="field"><label>کد نمایندگی ${R}</label><input class="in num" placeholder="MK-1300" dir="ltr">
          <div class="help copper">برای همه الزامی است — کد زیرنماینده‌ها از روی همین ساخته می‌شود</div></div>
      </div>
      <div class="grid g3" style="margin-top:13px">
        <div class="field"><label>شهر ${R}</label><select>${CITIES.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label>موبایل ${R}</label><input class="in num" placeholder="۰۹۱۲…" dir="ltr"></div>
        <div class="field"><label>نام مسئول هماهنگی ${R}</label><input class="in"></div>
      </div>
      <div class="grid g3" style="margin-top:13px">
        <div class="field"><label>شماره‌ی مسئول هماهنگی ${R}</label><input class="in num" dir="ltr"></div>
        <div class="field"><label>نام کاربری ${R}</label><input class="in" dir="ltr"></div>
        <div class="field"><label>رمز اولیه ${R}</label><input class="in" dir="ltr" value="Mk@140412">
          <div class="help">یک‌بار نمایش داده می‌شود — نماینده در اولین ورود مجبور به تغییر است</div></div>
      </div>

      <div class="card" style="margin:16px 0 0;box-shadow:none">
        <header><h2>اشتراک و دسترسی</h2></header>
        <div class="body">
          <div class="grid g4">
            <div class="field"><label>پلن</label><select><option>ماهیانه — ۲۵٬۰۰۰٬۰۰۰ تومان</option></select></div>
            <div class="field"><label>سقف روزانه‌ی نمایش</label><input class="in num" value="۳۰">
              <div class="help">اختصاصی همین حساب</div></div>
            <div class="field"><label>سقف ماهانه‌ی نمایش</label><input class="in num" value="۳۰۰"></div>
            <div class="field"><label>حالت ماژول</label>
              <div class="seg"><button class="on">خاموش</button><button>روشن</button></div>
              <div class="help">اجازه‌ی ساخت زیرنماینده</div></div>
          </div>
        </div>
      </div>

      <div class="btnrow" style="margin-top:16px">
        <button class="btn primary" onclick="toast('نمایندگی ساخته شد — نمونه‌ی موک‌آپ')">ساخت حساب</button>
        <button class="btn" onclick="go('adm-agents')">انصراف</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------- ۱۶ پرونده‌ی نماینده ---------------------------- */

function admAgent() {
  if (!may('agents')) return denied('پرونده‌ی نمایندگی');
  const a = AGENTS[0];
  return `
  <div class="card">
    <header><h2>${esc(a.agency)}</h2><span class="hint">${esc(a.code)} — ${esc(a.city)}</span><div class="spacer"></div>
      <span class="tag g">اشتراک فعال</span>
      <button class="btn sm" onclick="toast('نشست بسته شد')">خروج اجباری</button>
      <button class="btn sm danger" onclick="toast('حساب تعلیق شد')">تعلیق حساب</button></header>
    <div class="body">
      <div class="stats" style="margin:0">
        <div class="stat"><div class="lbl">حواله‌های ثبت‌شده</div><div class="val num">${fa(HAVALES.filter(h=>h.owner===a.id).length)}</div></div>
        <div class="stat c-copper"><div class="lbl">مشخصات باز کرده</div><div class="val num">${fa(37)}</div><div class="delta">این ماه</div></div>
        <div class="stat c-ok"><div class="lbl">زیرنماینده</div><div class="val num">${fa(SUBAGENTS.length)}</div><div class="delta">از ۵۰ ظرفیت</div></div>
        <div class="stat"><div class="lbl">اخطارها</div><div class="val num">۰ / ۰</div><div class="delta">آگهی جعلی / گزارش بی‌مورد</div></div>
      </div>
    </div>
  </div>

  <div class="cols c3">
    <div class="card">
      <header><h2>تایم‌لاین فعالیت</h2><span class="hint">با زمان و IP</span></header>
      <div class="body">
        <div class="tl">
          ${ACTIVITY.filter(e=>e.who==='a1'||true).slice(0,7).map(e=>`
            <div class="ev ${e.hot?'hot':''}">
              <div class="t">${esc(e.t)} — ${esc(e.ip)}</div>
              <b>${esc(e.act)}</b> ${e.target!=='—'?`<span style="color:var(--ink-3)">${esc(e.target)}</span>`:''}
              <div style="color:var(--ink-3);font-size:11px">${esc(agent(e.who).agency)}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div>
      <div class="card">
        <header><h2>اشتراک</h2></header>
        <div class="body" style="font-size:12.5px;line-height:2">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">پلن</span><b>ماهیانه</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">انقضا</span><b>${esc(a.ends)}</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">ظرفیت</span><b class="num">۵۰ نفر</b></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">صورتحساب ماه</span><b class="num">۷۵٬۰۰۰٬۰۰۰</b></div>
          <div class="btnrow" style="margin-top:11px">
            <button class="btn sm" ${may('subs')?'':'disabled'} onclick="toast('اشتراک تمدید شد')">تمدید</button>
            <button class="btn sm" onclick="toast('سقف تغییر کرد')">تغییر سقف</button>
          </div>
        </div>
      </div>
      <div class="card">
        <header><h2>زیرنماینده‌ها</h2></header>
        <div class="body tight"><table class="tbl"><tbody>
          ${SUBAGENTS.slice(0,5).map(s=>`<tr>
            <td class="mono">${esc(s.code)}</td><td>${esc(s.name)}</td>
            <td class="c">${s.st==='active'?'<span class="tag g">فعال</span>':'<span class="tag r">تعلیق</span>'}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>
  </div>`;
}

/* ---------------------------- ۱۷ حواله‌ها ---------------------------- */

function admHavales() {
  return `
  <div class="card">
    <header><h2>همه‌ی حواله‌ها</h2><div class="spacer"></div>
      <button class="btn sm" ${may('excel')?'':'disabled'} onclick="toast('خروجی اکسل ساخته شد')">خروجی اکسل</button></header>
    <div class="body">
      <div class="filters">
        <input class="in" placeholder="جستجو…">
        <select><option>نوع: همه</option><option>فروش</option><option>درخواست خرید</option></select>
        <select><option>وضعیت: همه</option><option>فعال</option><option>منقضی</option><option>فروخته شد</option><option>تعلیق</option></select>
        <select><option>نوع خودرو: همه</option>${CARS.map(c=>`<option>${esc(c)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="body tight"><div class="tblwrap"><table class="tbl">
      <thead><tr><th>حواله</th><th>خودرو</th><th>نمایندگی</th><th class="c">مبلغ</th><th class="c">بازدید</th><th class="c">گزارش</th><th class="c">وضعیت</th><th></th></tr></thead>
      <tbody>${HAVALES.slice(0,12).map(h=>{const o=agent(h.owner);return`
        <tr>
          <td class="mono">HV-${fa(h.id)}</td>
          <td class="strong">${esc(h.car)}<div style="color:var(--ink-3);font-size:11px">${esc(h.color||'هر رنگ')}</div></td>
          <td>${esc(o.agency)}<div style="color:var(--ink-3);font-size:11px">${esc(o.code)}</div></td>
          <td class="c mono">${money(h.price)}</td>
          <td class="c mono">${fa(h.views)}</td>
          <td class="c">${REPORTS.filter(r=>r.hv===h.id).length?`<span class="tag r">${fa(REPORTS.filter(r=>r.hv===h.id).length)}</span>`:'—'}</td>
          <td class="c">${h.status==='active'?'<span class="tag g">فعال</span>':h.status==='expired'?'<span class="tag n">منقضی</span>':'<span class="tag b">فروخته</span>'}</td>
          <td><div class="btnrow">
            <button class="btn sm danger" onclick="toast('حواله تعلیق شد')">تعلیق</button>
          </div></td>
        </tr>`}).join('')}</tbody>
    </table></div></div>
  </div>`;
}

/* ---------------------------- ۱۸ گزارش تخلف ---------------------------- */

function admReports() {
  if (!may('reports')) return denied('گزارش‌های تخلف');
  const r = REPORTS[0];
  const rep = agent(r.by), own = agent(r.on);
  return `
  <div class="card">
    <header><h2>صف گزارش‌های تخلف</h2><div class="spacer"></div>
      <span class="tag o">${fa(REPORTS.filter(x=>x.st==='pending').length)} در انتظار</span></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>#</th><th>حواله</th><th>دلیل</th><th>گزارش‌دهنده</th><th>آگهی‌دهنده</th><th>زمان</th><th class="c">وضعیت</th></tr></thead>
      <tbody>${REPORTS.map(x=>`
        <tr>
          <td class="mono">${fa(x.id)}</td>
          <td class="mono">HV-${fa(x.hv)}</td>
          <td class="strong">${esc(x.reason)}</td>
          <td>${esc(agent(x.by).agency)}</td>
          <td>${esc(agent(x.on).agency)}</td>
          <td style="color:var(--ink-3)">${esc(x.at)}</td>
          <td class="c">${reportTag(x.st)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="card">
    <header><h2>بررسی گزارش #${fa(r.id)}</h2><span class="hint">سابقه‌ی هر دو طرف کنار هم</span></header>
    <div class="body">
      <div class="banner info" style="margin-bottom:14px">
        <span class="b-ico">⚑</span>
        <div class="b-txt"><b>${esc(r.reason)} — HV-${fa(r.hv)}</b>${esc(r.desc)}</div>
      </div>

      <div class="cols c2">
        <div class="card" style="margin:0;box-shadow:none">
          <header><h2>گزارش‌دهنده</h2></header>
          <div class="body" style="font-size:12.5px;line-height:2">
            <b>${esc(rep.agency)}</b> — ${esc(rep.code)}
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">گزارش‌های ثبت‌شده</span><b class="num">۴</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">اخطار گزارش بی‌مورد</span><b class="num" style="color:var(--copper)">۱ از ۳</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">مشخصات باز کرده (این ماه)</span><b class="num">۹۱</b></div>
          </div>
        </div>
        <div class="card" style="margin:0;box-shadow:none">
          <header><h2>آگهی‌دهنده</h2></header>
          <div class="body" style="font-size:12.5px;line-height:2">
            <b>${esc(own.agency)}</b> — ${esc(own.code)}
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">حواله‌های ثبت‌شده</span><b class="num">۱۲</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">اخطار آگهی جعلی</span><b class="num" style="color:var(--danger)">۲ از ۳</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-3)">گزارش‌های علیه او</span><b class="num">۳</b></div>
          </div>
        </div>
      </div>

      <div class="banner warn" style="margin:14px 0">
        <span class="b-ico">⚠</span>
        <div class="b-txt"><b>هشدار: این آگهی‌دهنده ۲ اخطار دارد</b>
          با تأیید این تخلف، اخطار سوم ثبت و حسابش <b>خودکار تعلیق</b> می‌شود. اشتراکش باطل نمی‌شود و به او اطلاع داده می‌شود تا از راه تیکت پاسخ دهد.</div>
      </div>

      <div class="field"><label>یادداشت داخلی</label><textarea rows="2" placeholder="فقط برای ما…"></textarea></div>

      <div class="btnrow" style="margin-top:14px">
        <button class="btn danger" onclick="toast('تخلف تأیید شد — اخطار ثبت و به آگهی‌دهنده اطلاع داده شد')">تخلف تأیید شد</button>
        <button class="btn" onclick="toast('گزارش رد شد')">گزارش رد شد</button>
        <button class="btn" onclick="toast('اخطار «گزارش بی‌مورد» برای گزارش‌دهنده ثبت شد')">گزارش بی‌مورد</button>
        <button class="btn" onclick="toast('حواله موقتاً پنهان شد')">نیاز به بررسی بیشتر</button>
      </div>
    </div>
  </div>`;
}

/* ---------------------------- ۱۹ تیکت‌ها ---------------------------- */

function admTickets() {
  if (!may('tickets')) return denied('تیکت‌های پشتیبانی');
  return `
  <div class="card">
    <header><h2>صف تیکت‌ها</h2><div class="spacer"></div>
      <span class="tag o">${fa(ADMIN_TICKETS.filter(t=>t.st==='open').length)} باز</span></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>#</th><th>موضوع</th><th>نمایندگی</th><th class="c">اولویت</th><th>زمان</th><th class="c">وضعیت</th><th></th></tr></thead>
      <tbody>${ADMIN_TICKETS.map(t=>`
        <tr>
          <td class="mono">${fa(t.id)}</td>
          <td class="strong">${esc(t.subject)}</td>
          <td>${esc(agent(t.agent).agency)}</td>
          <td class="c">${t.pr==='high'?'<span class="tag r">زیاد</span>':t.pr==='normal'?'<span class="tag n">معمولی</span>':'<span class="tag n">کم</span>'}</td>
          <td style="color:var(--ink-3)">${esc(t.at)}</td>
          <td class="c">${ticketTag(t.st)}</td>
          <td><button class="btn sm" onclick="toast('تیکت باز شد')">پاسخ</button></td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="banner info"><span class="b-ico">🔒</span><div class="b-txt">
    <b>تیکت #۳۱۸ درخواست تغییر اطلاعات تماس است</b>
    اطلاعات تماس قفل است و نماینده نمی‌تواند خودش عوضش کند. با تأیید شما، شماره روی <b>همه‌ی آگهی‌های آن نماینده یکجا</b> به‌روز می‌شود.
  </div>
  <button class="btn primary" onclick="toast('شماره تأیید شد — ۱۲ آگهی به‌روز شد')">تأیید تغییر</button></div>`;
}

/* ---------------------------- ۲۰ مانیتورینگ ---------------------------- */

function admMonitor() {
  if (!may('monitor')) return denied('مانیتورینگ فعالیت');
  return `
  <div class="stats">
    <div class="stat"><div class="lbl">بازکردن مشخصات امروز</div><div class="val num">${fa(48)}</div><div class="delta">کل سامانه</div></div>
    <div class="stat c-copper"><div class="lbl">پرمصرف‌ترین نماینده</div><div class="val" style="font-size:16px">اتو کاظمی</div><div class="delta">۹۱ مورد این ماه</div></div>
    <div class="stat c-danger"><div class="lbl">رفتار مشکوک</div><div class="val num">${fa(1)}</div><div class="delta">نیازمند بررسی</div></div>
    <div class="stat"><div class="lbl">ورود ناموفق امروز</div><div class="val num">${fa(3)}</div></div>
  </div>

  <div class="banner bad"><span class="b-ico">◎</span><div class="b-txt">
    <b>اتو کاظمی (MK-1088) — الگوی جمع‌آوری دیتا</b>
    ۹۱ بار باز کردن مشخصات این ماه، در برابر ثبت تنها ۳ حواله. سقف ماهانه‌اش ۳۰۰ است ولی نسبت بازدید به ثبت غیرعادی است.
  </div>
  <button class="btn" onclick="toast('سقف این حساب به ۱۰ در روز کاهش یافت')">کاهش سقف این حساب</button></div>

  <div class="cols c3">
    <div class="card">
      <header><h2>تایم‌لاین کل سامانه</h2><span class="hint">چه کسی، چه کاری، چه ساعتی، با چه IP</span></header>
      <div class="body tight"><div class="tblwrap"><table class="tbl">
        <thead><tr><th>زمان</th><th>نمایندگی</th><th>اقدام</th><th>هدف</th><th>IP</th></tr></thead>
        <tbody>${ACTIVITY.map(e=>`
          <tr>
            <td style="color:var(--ink-3)" class="mono">${esc(e.t)}</td>
            <td><b>${esc(agent(e.who).agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(agent(e.who).code)}</div></td>
            <td>${e.hot?`<span class="tag o">${esc(e.act)}</span>`:esc(e.act)}</td>
            <td class="mono">${esc(e.target)}</td>
            <td class="mono" style="color:var(--ink-3)">${esc(e.ip)}</td>
          </tr>`).join('')}</tbody>
      </table></div></div>
    </div>

    <div class="card">
      <header><h2>چه کسی چند مشخصات دیده</h2></header>
      <div class="body tight"><table class="tbl">
        <thead><tr><th>نمایندگی</th><th class="c">امروز</th><th class="c">این ماه</th></tr></thead>
        <tbody>
          <tr><td><b>اتو کاظمی</b></td><td class="c mono">۲۲</td><td class="c mono" style="color:var(--danger);font-weight:700">۹۱</td></tr>
          <tr><td><b>نمایندگی گودرزی</b></td><td class="c mono">۴</td><td class="c mono">۳۷</td></tr>
          <tr><td><b>شریفی موتور</b></td><td class="c mono">۹</td><td class="c mono">۲۸</td></tr>
          <tr><td><b>اکبری خودرو</b></td><td class="c mono">۱۳</td><td class="c mono">۴۵</td></tr>
        </tbody></table>
        <div style="padding:11px 13px;font-size:11.5px;color:var(--ink-3);border-top:1px solid var(--line-2)">
          با کلیک روی هر ردیف، دقیقاً معلوم می‌شود کدام آگهی‌ها را باز کرده است.
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------------------- ۲۱ درخواست ظرفیت ---------------------------- */

function admSeats() {
  if (!may('seats')) return denied('درخواست‌های ظرفیت');
  return `
  <div class="card">
    <header><h2>درخواست‌های خرید ظرفیت زیرنمایندگی</h2><span class="hint">پیش‌پرداخت ماهانه</span></header>
    <div class="body tight"><table class="tbl">
      <thead><tr><th>#</th><th>نمایندگی</th><th class="c">تعداد</th><th class="c">قیمت واحد</th><th class="c">مبلغ کل</th><th>تاریخ</th><th class="c">وضعیت</th><th></th></tr></thead>
      <tbody>${SEAT_ORDERS.map(o=>`
        <tr>
          <td class="mono">${fa(o.id)}</td>
          <td><b>${esc(agent(o.agent).agency)}</b><div style="color:var(--ink-3);font-size:11px">${esc(agent(o.agent).code)}</div></td>
          <td class="c mono">${fa(o.seats)}</td>
          <td class="c mono">${money(o.unit)}</td>
          <td class="c mono strong">${money(o.total)}</td>
          <td style="color:var(--ink-3)">${esc(o.at)}</td>
          <td class="c">${o.st==='paid'?'<span class="tag g">پرداخت شد</span>':o.st==='pending'?'<span class="tag o">در انتظار</span>':'<span class="tag r">رد شد</span>'}</td>
          <td>${o.st==='pending'?`<div class="btnrow">
            <button class="btn sm primary" onclick="toast('پرداخت تأیید و ظرفیت اضافه شد')">تأیید</button>
            <button class="btn sm danger" onclick="toast('درخواست رد شد')">رد</button></div>`:''}</td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>

  <div class="banner info"><span class="b-ico">⛁</span><div class="b-txt">
    <b>قاعده‌ی پیش‌پرداخت</b>
    نماینده از قبل بابت تعداد زیرنماینده‌ی ماه پول می‌دهد. تعلیق وسط ماه نه پول برمی‌گرداند و نه ظرفیت را آزاد می‌کند.
  </div></div>`;
}

/* ---------------------------- ۲۲ تنظیمات ---------------------------- */

function admSettings() {
  if (!may('settings')) return denied('تنظیمات سامانه');
  return `
  <div class="cols c2">
    <div class="card">
      <header><h2>تنظیمات سامانه</h2><span class="hint">بدون نیاز به برنامه‌نویس</span></header>
      <div class="body">
        <div class="grid g2">
          <div class="field"><label>قیمت هر ظرفیت زیرنماینده (ماهانه)</label><input class="in num" value="۱٬۰۰۰٬۰۰۰"></div>
          <div class="field"><label>مبلغ پلن ماهیانه</label><input class="in num" value="۲۵٬۰۰۰٬۰۰۰"></div>
          <div class="field"><label>سقف روزانه‌ی پیش‌فرض</label><input class="in num" value="۳۰"></div>
          <div class="field"><label>سقف ماهانه‌ی پیش‌فرض</label><input class="in num" value="۳۰۰"></div>
          <div class="field"><label>آستانه‌ی اخطار آگهی جعلی</label><input class="in num" value="۳"></div>
          <div class="field"><label>آستانه‌ی اخطار گزارش بی‌مورد</label><input class="in num" value="۳"></div>
          <div class="field"><label>کف مدت واریز (روز)</label><input class="in num" value="۱"></div>
          <div class="field"><label>سقف مدت واریز (روز)</label><input class="in num" value="۳۰"></div>
          <div class="field"><label>عمر درخواست خرید (روز)</label><input class="in num" value="۷"></div>
          <div class="field"><label>مهلت گزارش پس از بسته شدن (روز)</label><input class="in num" value="۳۰"></div>
        </div>
        <div class="grid g2" style="margin-top:13px">
          <div class="field"><label>الزام کد دو عاملی پیامکی</label>
            <div class="seg"><button>خاموش</button><button class="on">روشن</button></div>
            <div class="help">تا وصل شدن پنل پیامک، خاموش می‌ماند</div></div>
          <div class="field"><label>پیامک هشدار بسته شدن آگهی</label>
            <div class="seg"><button>خاموش</button><button class="on">روشن</button></div>
            <div class="help">برای کنترل هزینه‌ی پیامک</div></div>
        </div>
        <button class="btn primary" style="margin-top:14px" onclick="toast('تنظیمات ذخیره شد')">ذخیره</button>
      </div>
    </div>

    <div>
      <div class="card">
        <header><h2>پایه‌ها</h2></header>
        <div class="body">
          <div class="field"><label>شرکت‌های عرضه کننده</label>
            <div class="btnrow" style="margin-top:5px">
              <span class="tag b">مدیران خودرو ✕</span>
              <button class="btn sm">＋ افزودن شرکت</button>
            </div>
          </div>
          <div class="field" style="margin-top:13px"><label>نوع خودرو (${fa(CARS.length)} مورد)</label>
            <div class="btnrow" style="margin-top:5px">
              ${CARS.slice(0,6).map(c=>`<span class="tag n">${esc(c)}</span>`).join('')}
              <button class="btn sm">＋ افزودن</button>
            </div>
          </div>
          <div class="field" style="margin-top:13px"><label>رنگ‌ها</label>
            <div class="btnrow" style="margin-top:5px">
              ${COLORS.map(c=>`<span class="tag n">${esc(c)}</span>`).join('')}
            </div>
          </div>
          <div class="field" style="margin-top:13px"><label>شهرها (${fa(CITIES.length)} مورد)</label>
            <div class="btnrow" style="margin-top:5px">
              ${CITIES.map(c=>`<span class="tag n">${esc(c)}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <header><h2>نقش‌های پنل مدیریت</h2></header>
        <div class="body tight"><table class="tbl">
          <thead><tr><th>دسترسی</th><th class="c">مدیر کل</th><th class="c">پشتیبانی</th><th class="c">مالی</th></tr></thead>
          <tbody>
            ${[['تیکت‌ها','tickets'],['گزارش تخلف','reports'],['اشتراک و پرداخت','subs'],
               ['ساخت و تعلیق حساب','agents'],['مانیتورینگ','monitor'],['خروجی اکسل','excel'],
               ['دیدن انبوه تماس','contacts'],['تنظیمات','settings']].map(([t,k])=>`
              <tr><td>${t}</td>
                <td class="c">${RIGHTS.super[k]?'<b style="color:var(--ok)">✔</b>':'<b style="color:var(--danger)">✖</b>'}</td>
                <td class="c">${RIGHTS.support[k]?'<b style="color:var(--ok)">✔</b>':'<b style="color:var(--danger)">✖</b>'}</td>
                <td class="c">${RIGHTS.finance[k]?'<b style="color:var(--ok)">✔</b>':'<b style="color:var(--danger)">✖</b>'}</td>
              </tr>`).join('')}
          </tbody></table></div>
      </div>
    </div>
  </div>`;
}
