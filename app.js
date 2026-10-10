/* ============================ утилиты ============================ */
const MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const MON_SHORT=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const uid=(p)=>(crypto.randomUUID?crypto.randomUUID():p+"-"+Math.random().toString(36).slice(2,11));
const money=(v)=>(Math.round((v||0)*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:0});
const moneyR=(v)=>money(v)+" ₽";
const esc=(s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const ym=(d)=>String(d||"").slice(0,7);
const parseNum=(v)=>{if(typeof v==="number")return v;const s=String(v??"").replace(/\s| /g,"").replace(",",".").replace(/[^\d.\-]/g,"");const n=parseFloat(s);return isNaN(n)?0:n;};
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600);}

/* ============================ состояние ============================ */
const S={
  refs:null, students:[], teachers:[], tariffs:[], groups:[],
  ops:{},      // "2026-09" -> [операции]
  abon:{},     // "2026-09" -> [абонементы]
  lessons:{},  // "2026-09" -> [проведённые занятия]
  months:[],   // индекс месяцев с данными
  nav:"dash", db:null, ready:false, year:new Date().getFullYear(),
  opFilter:{month:"", type:"", q:""}, repTab:"bdds", lesDate:new Date().toISOString().slice(0,10), lesTab:"journal"
};

const DEFAULT_REFS={
  sources:["Альфа-счет","Наличные"],
  formats:["Офлайн","Онлайн"],
  subjects:["Без привязки","Алгебра","Английский язык","Геометрия","Литература","Математика","Обществознание","Русский язык","Физика","Единый","Творчество"],
  groups:["Повышение успеваемости","Подготовка к школе","Чтение","Прочие индивидуальные занятия","Творческие занятия","Подготовка к ВПР, ОГЭ и ЕГЭ","Логопед","Прочие групповые занятия","Развивающие для дошкольников","Продленка","Дневной лагерь","Без привязки"],
  directions:[{name:"Без привязки",group:"Без привязки"}],
  articles:[{name:"Прочие доходы",kind:"income",nature:"var"},{name:"Прочие расходы",kind:"expense",nature:"var"}],
  usn:6, fixedFee:57390
};

/* ---- доступ к справочникам ---- */
const R=()=>S.refs||DEFAULT_REFS;
const artByName=(n)=>R().articles.find(a=>a.name===n);
const dirGroup=(n)=>{const d=R().directions.find(x=>x.name===n);return d&&d.group?d.group:"Без привязки";};
const studentName=(id)=>{const s=S.students.find(x=>x.id===id);return s?s.name:"";};
const teacherName=(id)=>{const t=S.teachers.find(x=>x.id===id);return t?t.name:"";};
const tariff=(id)=>S.tariffs.find(t=>t.id===id);

const allOps=()=>Object.values(S.ops).flat();
const allAbon=()=>Object.values(S.abon).flat();
const allLessons=()=>Object.values(S.lessons).flat();
const groupById=(id)=>S.groups.find(g=>g.id===id);
const opsOfYear=(y)=>allOps().filter(o=>o.date&&+o.date.slice(0,4)===y);
const yearsWithData=()=>{const set=new Set([new Date().getFullYear()]);allOps().forEach(o=>o.date&&set.add(+o.date.slice(0,4)));allAbon().forEach(a=>a.date&&set.add(+a.date.slice(0,4)));return [...set].sort();};

/* абонемент: остаток и стоимость занятия */
const abLeft=(a)=>Math.max(0,(a.lessons||0)-((a.visits||[]).length));
const abPrice=(a)=>a.lessons?(a.price||0)/a.lessons:(a.price||0);
const abExpired=(a,onDate)=>!!(a.until&&a.until<(onDate||today())&&abLeft(a)>0);
/* активный абонемент ученика на дату: не просрочен, есть остаток, приоритет — совпадение направления, затем самый ранний */
function pickAbon(studentId,direction,onDate){
  const list=allAbon().filter(a=>a.studentId===studentId&&abLeft(a)>0&&!abExpired(a,onDate)&&(a.date||"")<=(onDate||today()));
  if(!list.length)return null;
  const same=list.filter(a=>direction&&a.direction===direction);
  return (same.length?same:list).sort((a,b)=>(a.date||"").localeCompare(b.date||""))[0];
}

/* ============================ хранилище: Supabase ============================ */
const SB = window.supabase.createClient(SUPA_URL, SUPA_KEY);
let ME = null;                     // email вошедшего пользователя
let MEMBERS = [];                  // список допущенных адресов

const monthStart = (m) => m + "-01";
const monthEnd = (m) => { const [y, mm] = m.split("-").map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
const sbErr = (e, what) => { console.error(what, e); toast("Не удалось сохранить: " + ((e && e.message) || "нет связи с базой")); };

/* --- преобразование строк базы в объекты приложения и обратно --- */
const rowStudent = (r) => ({ id: r.id, name: r.name, parent: r.parent || "", phone: r.phone || "", direction: r.direction || "", note: r.note || "", archived: !!r.archived });
const outStudent = (s) => ({ id: s.id, name: s.name, parent: s.parent || "", phone: s.phone || "", direction: s.direction || "", note: s.note || "", archived: !!s.archived });
const rowTeacher = (r) => ({ id: r.id, name: r.name, subject: r.subject || "", phone: r.phone || "", rate: +r.rate || 0, archived: !!r.archived });
const outTeacher = (t) => ({ id: t.id, name: t.name, subject: t.subject || "", phone: t.phone || "", rate: +t.rate || 0, archived: !!t.archived });
const rowTariff = (r) => ({ id: r.id, name: r.name, lessons: r.lessons, price: +r.price || 0, validDays: r.valid_days || 0, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", format: r.format || "", article: r.article || "", note: r.note || "", archived: !!r.archived });
const outTariff = (t) => ({ id: t.id, name: t.name, lessons: t.lessons || 1, price: +t.price || 0, valid_days: t.validDays || null, direction: t.direction || "", subject: t.subject || "", teacher_id: t.teacherId || null, format: t.format || "", article: t.article || "", note: t.note || "", archived: !!t.archived });
const rowGroup = (r) => ({ id: r.id, name: r.name, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", time: r.time || "", days: r.days || [], studentIds: r.student_ids || [] });
const outGroup = (g) => ({ id: g.id, name: g.name, direction: g.direction || "", subject: g.subject || "", teacher_id: g.teacherId || null, time: g.time || "", days: g.days || [], student_ids: g.studentIds || [] });
const rowOp = (r) => ({ id: r.id, date: r.date, type: r.type, amount: +r.amount || 0, article: r.article || "", direction: r.direction || "", subject: r.subject || "", source: r.source || "", studentId: r.student_id || "", teacherId: r.teacher_id || "", abonId: r.abon_id || "", note: r.note || "", fisc: !!r.fisc, imported: !!r.imported });
const outOp = (o) => ({ id: o.id, date: o.date, type: o.type, amount: +o.amount || 0, article: o.article || "", direction: o.direction || "", subject: o.subject || "", source: o.source || "", student_id: o.studentId || null, teacher_id: o.teacherId || null, abon_id: o.abonId || null, note: o.note || "", fisc: !!o.fisc, imported: !!o.imported });
const rowAbon = (r) => ({ id: r.id, date: r.date, studentId: r.student_id || "", tariffId: r.tariff_id || "", name: r.name, lessons: r.lessons, price: +r.price || 0, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", until: r.until || "", format: r.format || "", visits: [] });
const outAbon = (a) => ({ id: a.id, date: a.date, student_id: a.studentId || null, tariff_id: a.tariffId || null, name: a.name, lessons: a.lessons || 1, price: +a.price || 0, direction: a.direction || "", subject: a.subject || "", teacher_id: a.teacherId || null, until: a.until || null, format: a.format || "" });
const rowLesson = (r) => ({ id: r.id, date: r.date, groupId: r.group_id || "", name: r.name, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", note: r.note || "", attend: r.attend || [] });
const outLesson = (l) => ({ id: l.id, date: l.date, group_id: l.groupId || null, name: l.name, direction: l.direction || "", subject: l.subject || "", teacher_id: l.teacherId || null, note: l.note || "", attend: l.attend || [] });

/* --- вход --- */
async function connect() {
  const { data: { session } } = await SB.auth.getSession();
  if (!session) { showAuth(); return; }
  await afterLogin(session.user.email);
}
function showAuth(msg) {
  document.getElementById("auth").style.display = "flex";
  document.querySelector(".app").style.display = "none";
  if (msg) { const b = document.getElementById("auth-msg"); b.textContent = msg; b.style.display = "block"; }
}
function hideAuth() {
  document.getElementById("auth").style.display = "none";
  document.querySelector(".app").style.display = "grid";
}
async function afterLogin(email) {
  ME = email;
  const { data, error } = await SB.from("un_members").select("email,name,role");
  if (error || !data || !data.length) {
    await SB.auth.signOut();
    showAuth("Доступ для " + email + " не открыт. Попросите владельца добавить этот адрес в разделе «Справочники → Доступ».");
    return;
  }
  MEMBERS = data;
  hideAuth();
  document.getElementById("dbstate").textContent = email;
  await loadAll();
  S.ready = true; render();
}
async function doLogin(email, password) {
  const { error } = await SB.auth.signInWithPassword({ email, password });
  if (error) { showAuth(error.message === "Invalid login credentials" ? "Неверная почта или пароль." : error.message); return; }
  await afterLogin(email);
}
async function doLogout() {
  if (!confirm("Выйти из программы?")) return;
  await SB.auth.signOut(); location.reload();
}

/* --- загрузка всех данных --- */
async function loadAll() {
  const q = (t, order) => { let r = SB.from(t).select("*"); return order ? r.order(order) : r; };
  const [set, art, dir, te, st, ta, gr, ab, vi, le, op] = await Promise.all([
    SB.from("un_settings").select("*").eq("id", 1).maybeSingle(),
    q("un_articles", "sort"), q("un_directions", "sort"), q("un_teachers", "name"), q("un_students", "name"),
    q("un_tariffs", "lessons"), q("un_groups", "name"), q("un_abon", "date"), q("un_visits", "date"),
    q("un_lessons", "date"), q("un_ops", "date")
  ]);
  const bad = [set, art, dir, te, st, ta, gr, ab, vi, le, op].find(r => r.error);
  if (bad) { sbErr(bad.error, "загрузка"); return; }

  const s = set.data || {};
  S.refs = {
    sources: s.sources || ["Альфа-счет", "Наличные"],
    subjects: s.subjects || ["Без привязки"],
    groups: s.pl_groups || ["Без привязки"],
    usn: +s.usn || 6, fixedFee: +s.fixed_fee || 0,
    articles: (art.data || []).map(a => ({ name: a.name, kind: a.kind, nature: a.nature })),
    directions: (dir.data || []).map(d => ({ name: d.name, group: d.pl_group })),
    formats: ["Офлайн", "Онлайн"]
  };
  S.teachers = (te.data || []).map(rowTeacher);
  S.students = (st.data || []).map(rowStudent);
  S.tariffs = (ta.data || []).map(rowTariff);
  S.groups = (gr.data || []).map(rowGroup);

  S.ops = {}; S.abon = {}; S.lessons = {}; S.months = [];
  const abById = {};
  (ab.data || []).forEach(r => { const a = rowAbon(r); abById[a.id] = a; (S.abon[ym(a.date)] = S.abon[ym(a.date)] || []).push(a); });
  (vi.data || []).forEach(r => {
    const a = abById[r.abon_id]; if (!a) return;
    a.visits.push({ id: r.id, date: r.date, teacherId: r.teacher_id || "", lessonId: r.lesson_id || "", note: r.note || "" });
  });
  (le.data || []).forEach(r => { const l = rowLesson(r); (S.lessons[ym(l.date)] = S.lessons[ym(l.date)] || []).push(l); });
  (op.data || []).forEach(r => { const o = rowOp(r); (S.ops[ym(o.date)] = S.ops[ym(o.date)] || []).push(o); });
  S.months = [...new Set([...Object.keys(S.ops), ...Object.keys(S.abon), ...Object.keys(S.lessons)])].sort();
  S.months.forEach(ensureMonth);
}
async function reloadAll() { await loadAll(); render(); toast("Данные обновлены"); }

/* --- запись справочников --- */
async function saveRefs() {
  const r = R();
  const e1 = (await SB.from("un_settings").upsert({
    id: 1, usn: r.usn, fixed_fee: r.fixedFee, sources: r.sources, subjects: r.subjects, pl_groups: r.groups, updated_at: new Date().toISOString()
  })).error;
  await SB.from("un_articles").delete().neq("name", "\u0000");
  const e2 = (await SB.from("un_articles").insert(r.articles.map((a, i) => ({ name: a.name, kind: a.kind, nature: a.nature || "var", sort: i })))).error;
  await SB.from("un_directions").delete().neq("name", "\u0000");
  const e3 = (await SB.from("un_directions").insert(r.directions.map((d, i) => ({ name: d.name, pl_group: d.group || "Без привязки", sort: i })))).error;
  const err = e1 || e2 || e3; if (err) { sbErr(err, "справочники"); return false; }
  return true;
}
async function syncList(table, items, mapOut) {
  if (items.length) {
    const { error } = await SB.from(table).upsert(items.map(mapOut));
    if (error) { sbErr(error, table); return false; }
  }
  const ids = items.map(x => x.id);
  const del = ids.length ? SB.from(table).delete().not("id", "in", "(" + ids.join(",") + ")") : SB.from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  const { error } = await del;
  if (error) { sbErr(error, table + " (удаление)"); return false; }
  return true;
}
const saveStudents = () => syncList("un_students", S.students, outStudent);
const saveTeachers = () => syncList("un_teachers", S.teachers, outTeacher);
const saveTariffs = () => syncList("un_tariffs", S.tariffs, outTariff);
const saveGroups = () => syncList("un_groups", S.groups, outGroup);

/* --- запись данных месяца --- */
async function syncMonthTable(table, month, items, mapOut) {
  const from = monthStart(month), to = monthEnd(month);
  if (items.length) {
    const { error } = await SB.from(table).upsert(items.map(mapOut));
    if (error) { sbErr(error, table); return false; }
  }
  let del = SB.from(table).delete().gte("date", from).lte("date", to);
  if (items.length) del = del.not("id", "in", "(" + items.map(x => x.id).join(",") + ")");
  const { error } = await del;
  if (error) { sbErr(error, table + " (удаление)"); return false; }
  return true;
}
async function syncVisits(abon) {
  (abon.visits || []).forEach(v => { if (!v.id) v.id = crypto.randomUUID(); });
  const rows = (abon.visits || []).map(v => ({
    id: v.id, abon_id: abon.id, student_id: abon.studentId || null, date: v.date,
    teacher_id: v.teacherId || null, lesson_id: v.lessonId || null, price: abPrice(abon), note: v.note || ""
  }));
  if (rows.length) {
    const { error } = await SB.from("un_visits").upsert(rows);
    if (error) { sbErr(error, "занятия по абонементу"); return false; }
  }
  let del = SB.from("un_visits").delete().eq("abon_id", abon.id);
  if (rows.length) del = del.not("id", "in", "(" + rows.map(r => r.id).join(",") + ")");
  const { error } = await del;
  if (error) { sbErr(error, "занятия по абонементу (удаление)"); return false; }
  return true;
}
async function saveMonth(m) {
  ensureMonth(m);
  let ok = await syncMonthTable("un_abon", m, S.abon[m], outAbon);
  for (const a of S.abon[m]) { if (!(await syncVisits(a))) ok = false; }
  if (!(await syncMonthTable("un_lessons", m, S.lessons[m], outLesson))) ok = false;
  if (!(await syncMonthTable("un_ops", m, S.ops[m], outOp))) ok = false;
  return ok;
}

/* --- доступ пользователей --- */
async function addMember(email, name) {
  const { error } = await SB.from("un_members").insert({ email: email.trim().toLowerCase(), name: name || "" });
  if (error) { sbErr(error, "доступ"); return false; }
  MEMBERS.push({ email: email.trim().toLowerCase(), name: name || "", role: "user" });
  return true;
}
async function removeMember(email) {
  const { error } = await SB.from("un_members").delete().eq("email", email);
  if (error) { sbErr(error, "доступ"); return false; }
  MEMBERS = MEMBERS.filter(m => m.email !== email);
  return true;
}

/* --- вспомогательные структуры месяца --- */
function ensureMonth(m){ if(!S.ops[m])S.ops[m]=[]; if(!S.abon[m])S.abon[m]=[]; if(!S.lessons[m])S.lessons[m]=[]; if(!S.months.includes(m)){S.months.push(m);S.months.sort();} return m; }
function pushOp(op){ const m=ensureMonth(ym(op.date)); S.ops[m].push(op); return m; }
function pushAbon(a){ const m=ensureMonth(ym(a.date)); S.abon[m].push(a); return m; }
function pushLesson(l){ const m=ensureMonth(ym(l.date)); S.lessons[m].push(l); return m; }
function findAbon(id){ for(const m in S.abon){const a=S.abon[m].find(x=>x.id===id); if(a)return {a,m};} return null; }

/* ============================ навигация ============================ */
document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>{S.nav=b.dataset.nav;render();});
document.getElementById("btn-backup").onclick=backup;

function render(){
  document.querySelectorAll("[data-nav]").forEach(b=>b.classList.toggle("on",b.dataset.nav===S.nav));
  document.getElementById("cnt-students").textContent=S.students.filter(s=>!s.archived).length||"";
  document.getElementById("cnt-abon").textContent=allAbon().filter(a=>abLeft(a)>0).length||"";
  document.getElementById("cnt-ops").textContent=allOps().length||"";
  document.getElementById("cnt-lessons").textContent=allLessons().length||"";
  const v=document.getElementById("view");
  if(!S.ready){ v.innerHTML='<div class="panel"><div class="empty">Загружаю данные центра…</div></div>'; return; }
  ({dash:viewDash,students:viewStudents,lessons:viewLessons,abon:viewAbon,ops:viewOps,reports:viewReports,nsi:viewNsi}[S.nav])(v);
}

/* ============================ дашборд ============================ */
function viewDash(v){
  const y=S.year, ops=opsOfYear(y);
  const inc=ops.filter(o=>o.type==="income").reduce((s,o)=>s+o.amount,0);
  const exp=ops.filter(o=>o.type==="expense").reduce((s,o)=>s+o.amount,0);
  const live=allAbon().filter(a=>abLeft(a)>0);
  const lessonsLeft=live.reduce((s,a)=>s+abLeft(a),0);
  const debt=live.reduce((s,a)=>s+abLeft(a)*abPrice(a),0);
  const m=new Date().toISOString().slice(0,7);
  const visitsMonth=allAbon().reduce((s,a)=>s+(a.visits||[]).filter(x=>ym(x.date)===m).length,0);
  const byMonth=Array.from({length:12},(_,i)=>{
    const k=y+"-"+String(i+1).padStart(2,"0");
    const list=S.ops[k]||[];
    return {i,inc:list.filter(o=>o.type==="income").reduce((s,o)=>s+o.amount,0),exp:list.filter(o=>o.type==="expense").reduce((s,o)=>s+o.amount,0)};
  });
  const low=live.filter(a=>abLeft(a)<=2).sort((a,b)=>abLeft(a)-abLeft(b));

  v.innerHTML=`
  <div class="head">
    <div><h1>Финансовая картина центра</h1><p>Денежный поток, остатки абонементов и точки внимания — по данным ${y} года.</p></div>
    <div class="tools">${yearSelect()}<button class="btn primary" data-act="new-op">Новая операция</button></div>
  </div>
  <div class="stack">
    <div class="stats">
      <div class="stat"><span class="k">Поступления</span><span class="v pos num">${money(inc)}</span><span class="n">${y} год, касса</span></div>
      <div class="stat"><span class="k">Платежи</span><span class="v neg num">${money(exp)}</span><span class="n">${y} год, касса</span></div>
      <div class="stat"><span class="k">Сальдо</span><span class="v num ${inc-exp>=0?"pos":"neg"}">${money(inc-exp)}</span><span class="n">поступления минус платежи</span></div>
      <div class="stat"><span class="k">Занятий не отработано</span><span class="v num">${lessonsLeft}</span><span class="n">${live.length} действующих абонементов</span></div>
      <div class="stat"><span class="k">Обязательства</span><span class="v num">${money(debt)}</span><span class="n">оплачено, но не проведено</span></div>
      <div class="stat"><span class="k">Занятий в этом месяце</span><span class="v num">${visitsMonth}</span><span class="n">списано с абонементов</span></div>
    </div>

    <div class="panel">
      <header><h2>Поступления и платежи по месяцам</h2><span class="sub">${y}</span></header>
      <div class="pad">${barChart(byMonth)}</div>
    </div>

    <div class="grid2" style="align-items:start">
      <div class="panel">
        <header><h2>Абонементы на исходе</h2><span class="sub">осталось 2 занятия и меньше</span></header>
        ${low.length?`<div class="tw"><table><thead><tr><th>Ученик</th><th>Абонемент</th><th class="n">Остаток</th><th></th></tr></thead><tbody>
          ${low.slice(0,8).map(a=>`<tr><td>${esc(studentName(a.studentId))||"—"}</td><td>${esc(a.name)}<div class="hint">${esc(a.direction||"")}</div></td>
          <td class="n"><span class="chip ${abLeft(a)?"warn":"out"}">${abLeft(a)} из ${a.lessons}</span></td>
          <td class="n"><button class="btn mini" data-act="visit" data-id="${a.id}">Списать</button></td></tr>`).join("")}
        </tbody></table></div>`:`<div class="empty">Все абонементы с запасом занятий.</div>`}
      </div>
      <div class="panel">
        <header><h2>Последние операции</h2><span class="sub">10 записей</span></header>
        ${lastOpsTable(10)}
      </div>
    </div>
  </div>`;
  bind(v);
}
function barChart(rows){
  const max=Math.max(1,...rows.map(r=>Math.max(r.inc,r.exp)));
  const W=940,H=220,pad={l:56,r:12,t:14,b:26},bw=(W-pad.l-pad.r)/12;
  const y=(val)=>pad.t+(H-pad.t-pad.b)*(1-val/max);
  const ticks=[0,.5,1].map(f=>({v:max*f,y:y(max*f)}));
  return `<div class="tw"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:640px;height:${H}px" role="img" aria-label="Поступления и платежи по месяцам">
  ${ticks.map(t=>`<g><line x1="${pad.l}" x2="${W-pad.r}" y1="${t.y}" y2="${t.y}" stroke="var(--line-soft)"/><text x="${pad.l-8}" y="${t.y+4}" text-anchor="end" font-size="11" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">${money(t.v)}</text></g>`).join("")}
  ${rows.map(r=>{const x=pad.l+r.i*bw;const h1=Math.max(0,y(0)-y(r.inc)),h2=Math.max(0,y(0)-y(r.exp));return `
    <rect x="${x+bw*0.16}" y="${y(r.inc)}" width="${bw*0.30}" height="${h1}" fill="var(--accent)" rx="2"/>
    <rect x="${x+bw*0.52}" y="${y(r.exp)}" width="${bw*0.30}" height="${h2}" fill="var(--neg)" opacity=".75" rx="2"/>
    <text x="${x+bw/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--ink-3)">${MON_SHORT[r.i]}</text>`;}).join("")}
  <line x1="${pad.l}" x2="${W-pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
  </svg></div>
  <div class="row" style="gap:16px;margin-top:6px"><span class="hint"><span style="display:inline-block;width:9px;height:9px;background:var(--accent);border-radius:2px"></span> поступления</span><span class="hint"><span style="display:inline-block;width:9px;height:9px;background:var(--neg);opacity:.75;border-radius:2px"></span> платежи</span></div>`;
}
function lastOpsTable(n){
  const rows=allOps().slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,n);
  if(!rows.length)return `<div class="empty">Операций пока нет. Добавьте вручную или загрузите выписку.</div>`;
  return `<div class="tw"><table><thead><tr><th>Дата</th><th>Статья</th><th>Ученик / комментарий</th><th class="n">Сумма</th></tr></thead><tbody>
  ${rows.map(o=>`<tr><td class="n">${esc(o.date)}</td><td>${esc(o.article||"—")}</td>
  <td>${esc(studentName(o.studentId)||o.note||"")}</td>
  <td class="n" style="color:var(--${o.type==="income"?"pos":"neg"})">${o.type==="income"?"+":"−"}${money(o.amount)}</td></tr>`).join("")}
  </tbody></table></div>`;
}
function yearSelect(){
  const ys=yearsWithData();
  return `<label class="f" style="width:110px"><span>Год</span><select data-act="year">${ys.map(y=>`<option ${y===S.year?"selected":""}>${y}</option>`).join("")}</select></label>`;
}

/* ============================ ученики ============================ */
function viewStudents(v){
  const archN=S.students.filter(s=>s.archived).length;
  const rows=S.students.filter(s=>showArch("students")||!s.archived).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  v.innerHTML=`
  <div class="head"><div><h1>Ученики</h1><p>Продажа абонемента и списание занятия — прямо из строки ученика. В карточке видно все абонементы, посещения и оплаты.</p></div>
  <div class="tools">${archN?`<button class="btn" data-act="toggle-arch" data-id="students">${showArch("students")?"Скрыть архив":"Показать архив"} (${archN})</button>`:""}<button class="btn primary" data-act="new-student">Добавить ученика</button></div></div>
  <div class="panel">
    <header><h2>${rows.length} учеников</h2><span class="sub">остаток занятий считается по проведённым спискам</span></header>
    ${rows.length?`<div class="tw"><table><thead><tr><th>Ученик</th><th>Направление</th><th>Контакт</th><th class="n">Оплачено всего</th><th class="n">Остаток занятий</th><th class="n">Абонементы</th><th></th></tr></thead><tbody>
    ${rows.map(s=>{
      const ab=allAbon().filter(a=>a.studentId===s.id);
      const left=ab.reduce((n,a)=>n+abLeft(a),0);
      const paid=allOps().filter(o=>o.studentId===s.id&&o.type==="income").reduce((n,o)=>n+o.amount,0);
      const active=ab.filter(a=>abLeft(a)>0).length;
      return `<tr><td><b>${esc(s.name)}</b>${s.archived?' <span class="chip mut">архив</span>':""}${s.parent?`<div class="hint">${esc(s.parent)}</div>`:""}</td>
      <td>${esc(s.direction||"—")}</td><td>${esc(s.phone||"")}</td>
      <td class="n">${money(paid)}</td>
      <td class="n">${left?`<span class="chip ${left<=2?"warn":"in"}">${left}</span>`:`<span class="chip mut">0</span>`}</td>
      <td class="n">${active}</td>
      <td class="n"><button class="btn mini primary" data-act="new-abon" data-id="${s.id}">+ Абонемент</button>
      ${left?`<button class="btn mini" data-act="visit" data-id="${ab.find(a=>abLeft(a)>0).id}">Списать занятие</button>`:""}
      <button class="btn mini" data-act="student-card" data-id="${s.id}">Карточка</button>
      <button class="btn mini" data-act="edit-student" data-id="${s.id}">✎</button></td></tr>`;
    }).join("")}
    </tbody></table></div>`:`<div class="empty">Список учеников пуст — добавьте первого.</div>`}
  </div>`;
  bind(v);
}

/* ============================ занятия ============================ */
const WD=["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"];
const WD_SHORT=["вс","пн","вт","ср","чт","пт","сб"];
const wdOf=(iso)=>new Date(iso+"T00:00:00").getDay();
const lessonsOn=(date)=>(S.lessons[ym(date)]||[]).filter(l=>l.date===date);

function viewLessons(v){
  const d=S.lesDate, wd=wdOf(d), done=lessonsOn(d);
  const doneGroups=new Set(done.map(l=>l.groupId).filter(Boolean));
  const scheduled=S.groups.filter(g=>(g.days||[]).includes(wd));
  const others=S.groups.filter(g=>!(g.days||[]).includes(wd));
  const conductedVisits=done.reduce((s,l)=>s+l.attend.filter(a=>a.abonId).length,0);
  const unpaid=done.reduce((s,l)=>s+l.attend.filter(a=>!a.abonId).length,0);

  v.innerHTML=`
  <div class="head"><div><h1>Журнал занятий</h1><p>Отметьте присутствующих и проведите занятие — занятие спишется с абонемента каждого отмеченного ученика автоматически.</p></div>
  <div class="tools">
    <button class="tab ${S.lesTab==="journal"?"on":""}" data-les="journal">Журнал дня</button>
    <button class="tab ${S.lesTab==="groups"?"on":""}" data-les="groups">Группы</button>
    <button class="tab ${S.lesTab==="history"?"on":""}" data-les="history">История</button>
  </div></div>`;

  if(S.lesTab==="groups"){ v.innerHTML+=groupsBlock(); bind(v); bindLesTabs(v); return; }
  if(S.lesTab==="history"){ v.innerHTML+=historyBlock(); bind(v); bindLesTabs(v); return; }

  v.innerHTML+=`
  <div class="stack">
    <div class="panel"><div class="pad row" style="align-items:flex-end">
      <label class="f" style="width:190px"><span>Дата занятий</span><input type="date" id="les-date" value="${d}"></label>
      <div class="row" style="gap:6px;padding-bottom:6px">
        <button class="btn mini" data-shift="-1">← день</button><button class="btn mini" data-shift="0">сегодня</button><button class="btn mini" data-shift="1">день →</button>
      </div>
      <div class="row" style="gap:14px;padding-bottom:6px;margin-left:auto">
        <span class="hint">${WD[wd]}</span>
        <span class="hint">Проведено занятий: <b class="num">${done.length}</b></span>
        <span class="hint">Списано с абонементов: <b class="num">${conductedVisits}</b></span>
        ${unpaid?`<span class="chip warn">Без абонемента: ${unpaid}</span>`:""}
      </div>
      <button class="btn" data-act="single-lesson">Индивидуальное занятие</button>
    </div></div>

    ${done.length?`<div class="panel"><header><h2>Проведено ${esc(d)}</h2><span class="sub">списание уже выполнено</span></header>
      <div class="tw"><table><thead><tr><th>Занятие</th><th>Педагог</th><th>Ученики</th><th class="n">Списано</th><th class="n">Сумма</th><th></th></tr></thead><tbody>
      ${done.map(l=>`<tr><td><b>${esc(l.name)}</b><div class="hint">${esc(l.direction||"")}</div></td>
        <td>${esc(teacherName(l.teacherId))||"—"}</td>
        <td>${l.attend.map(a=>`<span class="chip ${a.abonId?"in":"warn"}">${esc(studentName(a.studentId))}${a.abonId?"":" · без абонемента"}</span>`).join(" ")}</td>
        <td class="n">${l.attend.filter(a=>a.abonId).length}</td>
        <td class="n">${money(l.attend.reduce((s,a)=>s+(a.price||0),0))}</td>
        <td class="n"><button class="btn mini danger" data-act="cancel-lesson" data-id="${l.id}">Отменить</button></td></tr>`).join("")}
      </tbody></table></div></div>`:""}

    <div class="panel"><header><h2>Занятия на ${esc(WD[wd])}</h2><span class="sub">${scheduled.length} групп по расписанию</span></header>
      ${scheduled.length?`<div class="pad stack">${scheduled.map(g=>groupCard(g,d,doneGroups.has(g.id))).join("")}</div>`
        :`<div class="empty">На ${WD[wd]} групп в расписании нет. Задайте дни занятий во вкладке «Группы» или проведите занятие из списка ниже.</div>`}
    </div>

    ${others.length?`<div class="panel"><header><h2>Остальные группы</h2><span class="sub">не по расписанию — можно провести вручную</span></header>
      <div class="pad stack">${others.map(g=>groupCard(g,d,doneGroups.has(g.id))).join("")}</div></div>`:""}
  </div>`;
  bind(v); bindLesTabs(v);
  const di=v.querySelector("#les-date");
  di.onchange=()=>{S.lesDate=di.value||today();render();};
  v.querySelectorAll("[data-shift]").forEach(b=>b.onclick=()=>{
    const s=+b.dataset.shift;
    if(s===0)S.lesDate=today();
    else{const dt=new Date(S.lesDate+"T00:00:00");dt.setDate(dt.getDate()+s);S.lesDate=dt.toISOString().slice(0,10);}
    render();
  });
  v.querySelectorAll("[data-conduct]").forEach(b=>b.onclick=()=>conductGroup(b.dataset.conduct,v));
}
function bindLesTabs(v){ v.querySelectorAll("[data-les]").forEach(b=>b.onclick=()=>{S.lesTab=b.dataset.les;render();}); }

function groupCard(g,date,already){
  const studs=(g.studentIds||[]).map(id=>S.students.find(s=>s.id===id)).filter(Boolean);
  return `<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
    <div class="row" style="align-items:center;justify-content:space-between;padding:11px 14px;background:var(--surface-2);gap:10px">
      <div><b>${esc(g.name)}</b> ${g.time?`<span class="chip mut">${esc(g.time)}</span>`:""}
        <div class="hint">${esc(g.direction||"без направления")} · ${esc(teacherName(g.teacherId)||"педагог не указан")} · ${(g.days||[]).map(x=>WD_SHORT[x]).join(", ")||"без расписания"}</div></div>
      ${already?`<span class="chip in">занятие проведено</span>`
        :`<button class="btn primary" data-conduct="${g.id}">Провести занятие</button>`}
    </div>
    ${studs.length?`<div class="pad" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">
      ${studs.map(s=>{
        const ab=pickAbon(s.id,g.direction,date);
        const exp=allAbon().some(a=>a.studentId===s.id&&abExpired(a,date));
        return `<label class="row" style="align-items:center;gap:8px;border:1px solid var(--line-soft);border-radius:8px;padding:7px 10px;${already?"opacity:.6":""}">
          <input type="checkbox" data-att="${g.id}" value="${s.id}" ${ab&&!already?"checked":""} ${already?"disabled":""} style="width:auto">
          <span style="flex:1">${esc(s.name)}</span>
          ${ab?`<span class="chip ${abLeft(ab)<=2?"warn":"mut"}">${abLeft(ab)} зан.</span>`
             :`<span class="chip out">${exp?"просрочен":"нет абонемента"}</span>`}
        </label>`;}).join("")}
    </div>`:`<div class="pad hint">В группе нет учеников — добавьте состав во вкладке «Группы».</div>`}
  </div>`;
}
async function conductGroup(gid,root){
  const g=groupById(gid); if(!g)return;
  const ids=[...root.querySelectorAll(`[data-att="${gid}"]:checked`)].map(i=>i.value);
  if(!ids.length){toast("Отметьте хотя бы одного ученика");return;}
  await conduct({date:S.lesDate,groupId:g.id,name:g.name,direction:g.direction,subject:g.subject,teacherId:g.teacherId,studentIds:ids});
}
async function conduct({date,groupId,name,direction,subject,teacherId,studentIds,note}){
  const touched=new Set(), lesson={id:uid("les"),date,groupId:groupId||"",name,direction:direction||"",subject:subject||"",teacherId:teacherId||"",note:note||"",attend:[]};
  studentIds.forEach(sid=>{
    const ab=pickAbon(sid,direction,date);
    if(ab){
      ab.visits.push({date,teacherId:teacherId||ab.teacherId||"",note:note||name,lessonId:lesson.id,groupId:groupId||""});
      lesson.attend.push({studentId:sid,abonId:ab.id,price:abPrice(ab)});
      const f=findAbon(ab.id); if(f)touched.add(f.m);
    } else lesson.attend.push({studentId:sid,abonId:"",price:0});
  });
  touched.add(pushLesson(lesson));
  for(const m of touched) await saveMonth(m);
  const off=lesson.attend.filter(a=>a.abonId).length, no=lesson.attend.length-off;
  toast(no?`Списано занятий: ${off}. Без абонемента: ${no}`:`Занятие проведено, списано занятий: ${off}`);
  render();
}
async function cancelLesson(id){
  let month=null,lesson=null;
  for(const m in S.lessons){const l=S.lessons[m].find(x=>x.id===id); if(l){lesson=l;month=m;break;}}
  if(!lesson)return;
  const touched=new Set([month]);
  for(const m in S.abon) S.abon[m].forEach(a=>{
    const before=(a.visits||[]).length;
    a.visits=(a.visits||[]).filter(v=>v.lessonId!==id);
    if(a.visits.length!==before)touched.add(m);
  });
  S.lessons[month]=S.lessons[month].filter(x=>x.id!==id);
  for(const m of touched) await saveMonth(m);
  toast("Проведение отменено, занятия возвращены на абонементы"); render();
}
function singleLesson(){
  modal("Индивидуальное занятие",`
   <div class="grid3">
     <label class="f"><span>Дата</span><input type="date" name="date" value="${S.lesDate}"></label>
     <label class="f"><span>Ученик</span><select name="studentId">${optId(S.students)}</select></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers)}</select></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Направление</span><select name="direction">${opt(R().directions.map(x=>x.name))}</select></label>
     <label class="f"><span>Предмет</span><select name="subject">${opt(R().subjects)}</select></label>
   </div>
   <label class="f"><span>Комментарий</span><input name="note" placeholder="тема занятия"></label>
  `,async(l)=>{
    const sid=val(l,"studentId"); if(!sid){toast("Выберите ученика");return false;}
    const date=val(l,"date")||S.lesDate;
    const ab=pickAbon(sid,val(l,"direction"),date);
    if(!ab&&!confirm("У ученика нет действующего абонемента на эту дату. Провести занятие без списания?"))return false;
    await conduct({date,name:"Индивидуальное занятие",direction:val(l,"direction"),subject:val(l,"subject"),
      teacherId:val(l,"teacherId"),studentIds:[sid],note:val(l,"note")});
  },"Провести");
}
/* --- группы --- */
function groupsBlock(){
  return `<div class="panel"><header><h2>Группы и расписание</h2><button class="btn mini primary" data-act="add-group">Создать группу</button></header>
   ${S.groups.length?`<div class="tw"><table><thead><tr><th>Группа</th><th>Направление / предмет</th><th>Педагог</th><th>Дни</th><th>Время</th><th class="n">Учеников</th><th></th></tr></thead><tbody>
   ${S.groups.map(g=>`<tr><td><b>${esc(g.name)}</b></td><td>${esc(g.direction||"—")}<div class="hint">${esc(g.subject||"")}</div></td>
   <td>${esc(teacherName(g.teacherId))||"—"}</td><td>${(g.days||[]).map(x=>WD_SHORT[x]).join(", ")||"—"}</td><td>${esc(g.time||"—")}</td>
   <td class="n">${(g.studentIds||[]).length}</td>
   <td class="n"><button class="btn mini" data-act="edit-group" data-id="${g.id}">Состав и расписание</button> <button class="btn mini danger" data-act="del-group" data-id="${g.id}">✕</button></td></tr>`).join("")}
   </tbody></table></div>`:`<div class="empty">Групп пока нет. Создайте группу, укажите состав и дни занятий — журнал будет подставлять её автоматически.</div>`}
  </div>`;
}
function groupForm(g={}){
  const days=g.days||[];
  return `<div class="grid3">
    <label class="f"><span>Название группы</span><input name="name" value="${esc(g.name||"")}" placeholder="Школа дошкольника, 5–6 лет"></label>
    <label class="f"><span>Направление</span><select name="direction">${opt(R().directions.map(x=>x.name),g.direction)}</select></label>
    <label class="f"><span>Предмет</span><select name="subject">${opt(R().subjects,g.subject)}</select></label>
  </div>
  <div class="grid2">
    <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,g.teacherId)}</select></label>
    <label class="f"><span>Время начала</span><input name="time" value="${esc(g.time||"")}" placeholder="17:00"></label>
  </div>
  <label class="f"><span>Дни занятий</span><div class="row">${[1,2,3,4,5,6,0].map(i=>`<label class="row" style="align-items:center;gap:5px"><input type="checkbox" name="d${i}" ${days.includes(i)?"checked":""} style="width:auto"><span>${WD_SHORT[i]}</span></label>`).join("")}</div></label>
  <label class="f"><span>Состав группы</span><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;max-height:260px;overflow:auto;border:1px solid var(--line-soft);border-radius:8px;padding:10px">
    ${S.students.filter(s=>!s.archived||(g.studentIds||[]).includes(s.id)).sort((a,b)=>a.name.localeCompare(b.name,"ru")).map(s=>`<label class="row" style="align-items:center;gap:7px"><input type="checkbox" name="s_${s.id}" ${(g.studentIds||[]).includes(s.id)?"checked":""} style="width:auto"><span>${esc(s.name)}</span></label>`).join("")}
  </div></label>`;
}
function readGroup(l,g={}){
  return Object.assign({},g,{id:g.id||uid("g"),name:val(l,"name"),direction:val(l,"direction"),subject:val(l,"subject"),
    teacherId:val(l,"teacherId"),time:val(l,"time"),
    days:[1,2,3,4,5,6,0].filter(i=>chk(l,"d"+i)),
    studentIds:S.students.filter(s=>chk(l,"s_"+s.id)).map(s=>s.id)});
}
function addGroup(){ modal("Новая группа",groupForm(),async(l)=>{
  const g=readGroup(l); if(!g.name){toast("Укажите название группы");return false;}
  S.groups.push(g); await saveGroups(); toast("Группа создана");},"Создать"); }
function editGroup(id){ const g=groupById(id); if(!g)return;
  modal("Группа · "+g.name,groupForm(g),async(l)=>{ Object.assign(g,readGroup(l,g)); await saveGroups(); toast("Сохранено"); }); }

function historyBlock(){
  const rows=allLessons().slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,200);
  return `<div class="panel"><header><h2>История проведённых занятий</h2><span class="sub">${allLessons().length} записей</span></header>
   ${rows.length?`<div class="tw"><table><thead><tr><th>Дата</th><th>Занятие</th><th>Направление</th><th>Педагог</th><th class="n">Учеников</th><th class="n">Списано</th><th class="n">Выручка</th><th></th></tr></thead><tbody>
   ${rows.map(l=>`<tr><td class="n">${esc(l.date)}</td><td>${esc(l.name)}</td><td>${esc(l.direction||"")}</td><td>${esc(teacherName(l.teacherId))}</td>
   <td class="n">${l.attend.length}</td><td class="n">${l.attend.filter(a=>a.abonId).length}</td><td class="n">${money(l.attend.reduce((s,a)=>s+(a.price||0),0))}</td>
   <td class="n"><button class="btn mini danger" data-act="cancel-lesson" data-id="${l.id}">Отменить</button></td></tr>`).join("")}
   </tbody></table></div>`:`<div class="empty">Занятия ещё не проводились.</div>`}
  </div>`;
}

/* ============================ абонементы ============================ */
function catalogHTML(){
  const tpls=tplList();
  return `<div class="panel"><header><h2>Каталог абонементов</h2><span class="sub">выберите абонемент — останется указать ученика</span><button class="btn mini" data-act="add-tariff">+ Новый шаблон</button></header>
  ${tpls.length?`<div class="cat">${tpls.map(t=>`<div class="tpl"><div class="tpl-n">${esc(t.name)}</div>
    <div class="tpl-p num">${money(t.price)} ₽</div>
    <div class="hint">${t.lessons} зан. · ${money(t.lessons?t.price/t.lessons:t.price)} ₽ за занятие</div>
    <div class="tpl-m">${tplMeta(t).map(x=>`<span class="chip mut">${esc(x)}</span>`).join("")}</div>
    <div class="tpl-b"><button class="btn primary mini" data-act="sell-tpl" data-id="${t.id}">Выставить</button> <button class="btn mini" data-act="edit-tariff" data-id="${t.id}" title="Изменить">✎</button></div></div>`).join("")}</div>`
   :`<div class="empty">Шаблонов пока нет. Создайте постоянные абонементы — и выставляйте их в один клик.</div>`}
  </div>`;
}
function viewAbon(v){
  const list=allAbon().slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const active=list.filter(a=>abLeft(a)>0);
  v.innerHTML=`
  <div class="head"><div><h1>Абонементы и списание занятий</h1><p>Продажа абонемента создаёт поступление в журнале; каждое проведённое занятие списывается отсюда и попадает в БДР по методу начисления.</p></div>
  <div class="tools"><button class="btn primary" data-act="new-abon">Продать абонемент</button></div></div>
  <div class="stack">
  ${catalogHTML()}
  <div class="stats">
    <div class="stat"><span class="k">Действующих</span><span class="v num">${active.length}</span><span class="n">с остатком занятий</span></div>
    <div class="stat"><span class="k">Не отработано занятий</span><span class="v num">${active.reduce((s,a)=>s+abLeft(a),0)}</span><span class="n">по всем ученикам</span></div>
    <div class="stat"><span class="k">Сумма обязательств</span><span class="v num">${money(active.reduce((s,a)=>s+abLeft(a)*abPrice(a),0))}</span><span class="n">аванс к отработке</span></div>
    <div class="stat"><span class="k">Продано в ${S.year}</span><span class="v num">${money(list.filter(a=>+String(a.date).slice(0,4)===S.year).reduce((s,a)=>s+(a.price||0),0))}</span><span class="n">по дате продажи</span></div>
  </div>
  <div class="panel">
    <header><h2>Все абонементы</h2><span class="sub">${list.length} записей</span></header>
    ${list.length?`<div class="tw"><table><thead><tr><th>Продан</th><th>Ученик</th><th>Абонемент</th><th>Направление / педагог</th><th class="n">Цена</th><th class="n">За занятие</th><th>Использовано</th><th></th></tr></thead><tbody>
    ${list.map(a=>{const used=(a.visits||[]).length,pct=a.lessons?Math.min(100,used/a.lessons*100):0;const left=abLeft(a);
      return `<tr><td class="n">${esc(a.date)}</td><td>${esc(studentName(a.studentId))||"—"}</td>
      <td>${esc(a.name)}</td><td>${esc(a.direction||"—")}<div class="hint">${esc([teacherName(a.teacherId)||"педагог не указан",a.format].filter(Boolean).join(" · "))}</div></td>
      <td class="n">${money(a.price)}${a.until?`<div class="hint">до ${esc(a.until)}${abExpired(a)?" · просрочен":""}</div>`:""}</td><td class="n">${money(abPrice(a))}</td>
      <td><div class="row" style="align-items:center;gap:8px"><div class="bar"><i class="${left===0?"out":left<=2?"low":""}" style="width:${pct}%"></i></div><span class="num" style="font-size:12px">${used}/${a.lessons}</span></div></td>
      <td class="n">${left?`<button class="btn mini" data-act="visit" data-id="${a.id}">Списать</button>`:`<span class="chip mut">закрыт</span>`} <button class="btn mini" data-act="abon-card" data-id="${a.id}">История</button></td></tr>`;}).join("")}
    </tbody></table></div>`:`<div class="empty">Абонементы ещё не продавались.</div>`}
  </div></div>`;
  bind(v);
}

/* ============================ операции ============================ */
function viewOps(v){
  const f=S.opFilter;
  let rows=allOps().slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  if(f.month)rows=rows.filter(o=>ym(o.date)===f.month);
  if(f.type)rows=rows.filter(o=>o.type===f.type);
  if(f.q){const q=f.q.toLowerCase();rows=rows.filter(o=>[o.article,o.note,o.direction,studentName(o.studentId),o.source].join(" ").toLowerCase().includes(q));}
  const inc=rows.filter(o=>o.type==="income").reduce((s,o)=>s+o.amount,0);
  const exp=rows.filter(o=>o.type==="expense").reduce((s,o)=>s+o.amount,0);
  const monthsOpts=S.months.slice().sort().reverse();
  v.innerHTML=`
  <div class="head"><div><h1>Журнал операций</h1><p>Единая лента поступлений и платежей: ручной ввод и загрузка банковской выписки с разнесением по статьям.</p></div>
  <div class="tools"><button class="btn" data-act="import">Загрузить выписку</button><button class="btn" data-act="export-ops">Выгрузить в Excel</button><button class="btn primary" data-act="new-op">Новая операция</button></div></div>
  <div class="stack">
    <div class="panel"><div class="pad row" style="align-items:flex-end">
      <label class="f" style="width:180px"><span>Месяц</span><select data-flt="month"><option value="">Все месяцы</option>${monthsOpts.map(m=>`<option value="${m}" ${f.month===m?"selected":""}>${MONTHS[+m.slice(5)-1]} ${m.slice(0,4)}</option>`).join("")}</select></label>
      <label class="f" style="width:170px"><span>Тип</span><select data-flt="type"><option value="">Все</option><option value="income" ${f.type==="income"?"selected":""}>Поступления</option><option value="expense" ${f.type==="expense"?"selected":""}>Платежи</option></select></label>
      <label class="f" style="flex:1;min-width:220px"><span>Поиск по статье, ученику, комментарию</span><input data-flt="q" value="${esc(f.q)}" placeholder="например, аренда"></label>
      <div class="row" style="gap:14px;padding-bottom:6px">
        <span class="hint">Поступления <b class="num" style="color:var(--pos)">${money(inc)}</b></span>
        <span class="hint">Платежи <b class="num" style="color:var(--neg)">${money(exp)}</b></span>
        <span class="hint">Итог <b class="num">${money(inc-exp)}</b></span>
      </div>
    </div></div>
    <div class="panel">
      <header><h2>${rows.length} операций</h2><span class="sub">кассовый метод — основа БДДС и налога УСН</span></header>
      ${rows.length?`<div class="tw"><table><thead><tr><th>Дата</th><th>Статья</th><th>Направление</th><th>Ученик</th><th>Источник</th><th>Комментарий</th><th class="n">Сумма</th><th></th></tr></thead><tbody>
      ${rows.map(o=>`<tr><td class="n">${esc(o.date)}</td>
        <td>${esc(o.article||"—")} ${o.type==="expense"?`<span class="chip mut">${(artByName(o.article)||{}).nature==="const"?"пост.":"перем."}</span>`:""}</td>
        <td>${esc(o.direction||"")}</td><td>${esc(studentName(o.studentId))}</td><td>${esc(o.source||"")}</td>
        <td>${esc(o.note||"")}${o.abonId?` <span class="chip mut">абонемент</span>`:""}</td>
        <td class="n" style="color:var(--${o.type==="income"?"pos":"neg"})">${o.type==="income"?"+":"−"}${money(o.amount)}</td>
        <td class="n"><button class="btn mini" data-act="edit-op" data-id="${o.id}">✎</button> <button class="btn mini danger" data-act="del-op" data-id="${o.id}">✕</button></td></tr>`).join("")}
      </tbody></table></div>`:`<div class="empty">Под фильтр ничего не попало.</div>`}
    </div>
  </div>`;
  bind(v);
  v.querySelectorAll("[data-flt]").forEach(el=>{
    const k=el.dataset.flt;
    el.oninput=el.onchange=()=>{S.opFilter[k]=el.value;const pos=el.selectionStart;render();const n=document.querySelector(`[data-flt="${k}"]`);if(n&&n.focus){n.focus();if(n.setSelectionRange&&pos!=null)try{n.setSelectionRange(pos,pos)}catch(e){}}};
  });
}

/* ============================ отчёты ============================ */
function viewReports(v){
  const tabs=[["bdds","БДДС · движение денег"],["bdr","БДР · доходы и расходы"],["abon","Абонементы"],["pl","P&L по направлениям"],["ros","Рентабельность центра"],["unit","Рентабельность по разрезам"],["tax","Налоги УСН"]];
  v.innerHTML=`
  <div class="head"><div><h1>Отчёты</h1><p>БДДС считается по кассе, БДР — по начислению: выручка признаётся в месяце проведённого занятия, а не оплаты.</p></div>
  <div class="tools">${yearSelect()}<button class="btn" data-act="export-report">Выгрузить отчёт в Excel</button></div></div>
  <div class="panel">
    <div class="tabs">${tabs.map(t=>`<button class="tab ${S.repTab===t[0]?"on":""}" data-rep="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div id="repbody">${({bdds:repBDDS,bdr:repBDR,abon:repAbon,pl:repPL,ros:repROS,unit:repUnit,tax:repTax}[S.repTab])()}</div>
  </div>`;
  bind(v);
  v.querySelectorAll("[data-rep]").forEach(b=>b.onclick=()=>{S.repTab=b.dataset.rep;render();});
}
const monthKeys=(y)=>Array.from({length:12},(_,i)=>y+"-"+String(i+1).padStart(2,"0"));

function matrixTable(head,groups,note){
  return `${note?`<div class="pad hint">${note}</div>`:""}<div class="tw"><table><thead><tr><th>${head[0]}</th>${head.slice(1).map(h=>`<th class="n">${h}</th>`).join("")}</tr></thead><tbody>
  ${groups.map(g=>`<tr class="${g.cls||""}"><td>${esc(g.name)}</td>${g.vals.map(x=>`<td class="n">${x===0?'<span style="color:var(--ink-3)">—</span>':money(x)}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>`;
}
/* --- БДДС: касса по статьям --- */
function repBDDS(){
  const y=S.year,ks=monthKeys(y),ops=opsOfYear(y);
  const sum=(f)=>ks.map(k=>ops.filter(o=>ym(o.date)===k&&f(o)).reduce((s,o)=>s+o.amount,0));
  const tot=(a)=>a.reduce((s,x)=>s+x,0);
  const incArts=[...new Set(ops.filter(o=>o.type==="income").map(o=>o.article||"Прочие доходы"))].sort();
  const expArts=[...new Set(ops.filter(o=>o.type==="expense").map(o=>o.article||"Прочие расходы"))].sort();
  const incRows=incArts.map(a=>({name:a,cls:"sub",vals:sum(o=>o.type==="income"&&(o.article||"Прочие доходы")===a)}));
  const expRows=expArts.map(a=>({name:a,cls:"sub",vals:sum(o=>o.type==="expense"&&(o.article||"Прочие расходы")===a)}));
  const incT=sum(o=>o.type==="income"),expT=sum(o=>o.type==="expense");
  const net=incT.map((x,i)=>x-expT[i]);
  let run=0;const cum=net.map(x=>run+=x);
  const rows=[{name:"Поступления",cls:"group",vals:incT},...incRows,
              {name:"Платежи",cls:"group",vals:expT},...expRows,
              {name:"Чистый денежный поток",cls:"total",vals:net},
              {name:"Накопленное сальдо",cls:"total",vals:cum}];
  rows.forEach(r=>r.vals=[...r.vals,r.name==="Накопленное сальдо"?cum[11]:tot(r.vals)]);
  return matrixTable(["Статья",...MON_SHORT.map(m=>m),"Год"],rows,"Кассовый метод: фактические поступления на счёт и в кассу и фактические платежи.");
}
/* --- БДР: начисление --- */
function accrualIncome(y){
  const ks=monthKeys(y),map=Object.fromEntries(ks.map(k=>[k,{}]));
  allAbon().forEach(a=>{(a.visits||[]).forEach(vi=>{const k=ym(vi.date);if(!map[k])return;const g=dirGroup(a.direction);map[k][g]=(map[k][g]||0)+abPrice(a);});});
  // доходы без абонемента (разовые, прочие поступления) — по дате оплаты
  opsOfYear(y).filter(o=>o.type==="income"&&!o.abonId).forEach(o=>{const k=ym(o.date);const g=dirGroup(o.direction);map[k][g]=(map[k][g]||0)+o.amount;});
  return map;
}
function repBDR(){
  const y=S.year,ks=monthKeys(y),acc=accrualIncome(y),ops=opsOfYear(y);
  const groups=[...new Set(ks.flatMap(k=>Object.keys(acc[k])))].sort((a,b)=>a.localeCompare(b,"ru"));
  const incRows=groups.map(g=>({name:g,cls:"sub",vals:ks.map(k=>acc[k][g]||0)}));
  const incT=ks.map(k=>Object.values(acc[k]).reduce((s,x)=>s+x,0));
  const expArts=[...new Set(ops.filter(o=>o.type==="expense").map(o=>o.article||"Прочие расходы"))].sort();
  const constArts=expArts.filter(a=>(artByName(a)||{}).nature==="const"),varArts=expArts.filter(a=>!constArts.includes(a));
  const eSum=(list)=>ks.map(k=>ops.filter(o=>o.type==="expense"&&ym(o.date)===k&&list.includes(o.article||"Прочие расходы")).reduce((s,o)=>s+o.amount,0));
  const cT=eSum(constArts),vT=eSum(varArts);
  const rows=[{name:"Выручка (признанная)",cls:"group",vals:incT},...incRows,
    {name:"Переменные расходы",cls:"group",vals:vT},...varArts.map(a=>({name:a,cls:"sub",vals:eSum([a])})),
    {name:"Постоянные расходы",cls:"group",vals:cT},...constArts.map(a=>({name:a,cls:"sub",vals:eSum([a])})),
    {name:"Прибыль до налога",cls:"total",vals:incT.map((x,i)=>x-vT[i]-cT[i])}];
  rows.forEach(r=>r.vals=[...r.vals,r.vals.reduce((s,x)=>s+x,0)]);
  return matrixTable(["Показатель",...MON_SHORT,"Год"],rows,"Метод начисления: выручка признаётся в месяце проведённого занятия (списание с абонемента), разовые оплаты — в месяце получения.");
}
/* --- Отчёт по абонементам --- */
function repAbon(){
  const y=S.year,ks=monthKeys(y);
  const list=allAbon();
  /* движение по месяцам */
  const sold=ks.map(k=>list.filter(a=>ym(a.date)===k).reduce((s,a)=>s+(a.price||0),0));
  const soldCnt=ks.map(k=>list.filter(a=>ym(a.date)===k).length);
  const worked=ks.map(k=>list.reduce((s,a)=>s+(a.visits||[]).filter(v=>ym(v.date)===k).length*abPrice(a),0));
  const workedCnt=ks.map(k=>list.reduce((s,a)=>s+(a.visits||[]).filter(v=>ym(v.date)===k).length,0));
  const burned=ks.map(k=>list.filter(a=>a.until&&ym(a.until)===k&&abLeft(a)>0).reduce((s,a)=>s+abLeft(a)*abPrice(a),0));
  let bal=0; const rest=ks.map((k,i)=>bal=bal+sold[i]-worked[i]-burned[i]);
  const move=[
    {name:"Продано абонементов, шт",cls:"sub",vals:soldCnt},
    {name:"Продано на сумму",cls:"group",vals:sold},
    {name:"Проведено занятий, шт",cls:"sub",vals:workedCnt},
    {name:"Отработано на сумму",cls:"group",vals:worked},
    {name:"Сгорело по сроку",vals:burned},
    {name:"Остаток обязательств на конец месяца",cls:"total",vals:rest}
  ];
  move.forEach((r,i)=>r.vals=[...r.vals,r.name.startsWith("Остаток")?rest[11]:r.vals.reduce((s,x)=>s+x,0)]);

  /* свод по ученикам */
  const studs=S.students.map(s=>{
    const ab=list.filter(a=>a.studentId===s.id);
    const paid=ab.reduce((n,a)=>n+(a.price||0),0);
    const used=ab.reduce((n,a)=>n+(a.visits||[]).length,0);
    const left=ab.reduce((n,a)=>n+abLeft(a),0);
    const debt=ab.reduce((n,a)=>n+abLeft(a)*abPrice(a),0);
    const last=ab.flatMap(a=>(a.visits||[]).map(v=>v.date)).sort().pop()||"";
    const exp=ab.some(a=>abExpired(a));
    return {s,ab,paid,used,left,debt,last,exp};
  }).filter(x=>x.ab.length).sort((a,b)=>b.debt-a.debt);

  /* по направлениям и педагогам */
  const byDir={},byTeach={};
  list.forEach(a=>(a.visits||[]).forEach(v=>{
    if(+String(v.date).slice(0,4)!==y)return;
    const d=a.direction||"Без привязки"; byDir[d]=byDir[d]||{cnt:0,sum:0}; byDir[d].cnt++; byDir[d].sum+=abPrice(a);
    const t=teacherName(v.teacherId||a.teacherId)||"Педагог не указан"; byTeach[t]=byTeach[t]||{cnt:0,sum:0}; byTeach[t].cnt++; byTeach[t].sum+=abPrice(a);
  }));
  const expiring=list.filter(a=>abLeft(a)>0).map(a=>({a,over:abExpired(a)})).filter(x=>x.over||(x.a.until&&x.a.until<=new Date(Date.now()+14*864e5).toISOString().slice(0,10)));
  const stale=list.filter(a=>abLeft(a)>0&&!(a.visits||[]).some(v=>v.date>=new Date(Date.now()-30*864e5).toISOString().slice(0,10)));

  return matrixTable(["Показатель",...MON_SHORT,"Год"],move,"Продажа — деньги полученные, отработка — занятия проведённые. Разница между ними и есть обязательства центра перед учениками.")
  +`<div class="pad stack">
    <div class="stats" style="box-shadow:none">
      <div class="stat"><span class="k">Обязательств на сегодня</span><span class="v num">${money(list.reduce((s,a)=>s+abLeft(a)*abPrice(a),0))}</span><span class="n">не отработанный аванс</span></div>
      <div class="stat"><span class="k">Не проведено занятий</span><span class="v num">${list.reduce((s,a)=>s+abLeft(a),0)}</span></div>
      <div class="stat"><span class="k">Просрочено</span><span class="v num ${expiring.filter(x=>x.over).length?"neg":""}">${expiring.filter(x=>x.over).length}</span><span class="n">абонементов со сгоревшим сроком</span></div>
      <div class="stat"><span class="k">Без занятий месяц</span><span class="v num ${stale.length?"neg":""}">${stale.length}</span><span class="n">оплачено, но ученик не ходит</span></div>
    </div>

    <div><h3 style="font-size:14px;margin-bottom:8px">Свод по ученикам</h3>
    ${studs.length?`<div class="tw"><table><thead><tr><th>Ученик</th><th class="n">Абонементов</th><th class="n">Оплачено</th><th class="n">Проведено</th><th class="n">Остаток занятий</th><th class="n">Аванс к отработке</th><th>Последнее занятие</th></tr></thead><tbody>
    ${studs.map(x=>`<tr><td>${esc(x.s.name)} ${x.exp?'<span class="chip warn">просрочен</span>':""}</td><td class="n">${x.ab.length}</td>
    <td class="n">${money(x.paid)}</td><td class="n">${x.used}</td><td class="n">${x.left}</td><td class="n">${money(x.debt)}</td>
    <td class="n">${esc(x.last)||"—"}</td></tr>`).join("")}
    <tr class="total"><td>Итого</td><td class="n">${studs.reduce((s,x)=>s+x.ab.length,0)}</td><td class="n">${money(studs.reduce((s,x)=>s+x.paid,0))}</td>
    <td class="n">${studs.reduce((s,x)=>s+x.used,0)}</td><td class="n">${studs.reduce((s,x)=>s+x.left,0)}</td><td class="n">${money(studs.reduce((s,x)=>s+x.debt,0))}</td><td></td></tr>
    </tbody></table></div>`:`<div class="empty">Абонементы ещё не продавались.</div>`}</div>

    <div class="grid2" style="align-items:start">
      <div><h3 style="font-size:14px;margin-bottom:8px">Отработано по направлениям</h3>
        ${Object.keys(byDir).length?`<div class="tw"><table><thead><tr><th>Направление</th><th class="n">Занятий</th><th class="n">Сумма</th></tr></thead><tbody>
        ${Object.entries(byDir).sort((a,b)=>b[1].sum-a[1].sum).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${v.cnt}</td><td class="n">${money(v.sum)}</td></tr>`).join("")}
        </tbody></table></div>`:`<div class="empty">Занятия ещё не проводились.</div>`}</div>
      <div><h3 style="font-size:14px;margin-bottom:8px">Отработано по педагогам</h3>
        ${Object.keys(byTeach).length?`<div class="tw"><table><thead><tr><th>Педагог</th><th class="n">Занятий</th><th class="n">Сумма</th></tr></thead><tbody>
        ${Object.entries(byTeach).sort((a,b)=>b[1].sum-a[1].sum).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="n">${v.cnt}</td><td class="n">${money(v.sum)}</td></tr>`).join("")}
        </tbody></table></div>`:`<div class="empty">Занятия ещё не проводились.</div>`}</div>
    </div>

    <div><h3 style="font-size:14px;margin-bottom:8px">Сроки и просрочка</h3>
    ${expiring.length||stale.length?`<div class="tw"><table><thead><tr><th>Ученик</th><th>Абонемент</th><th class="n">Остаток</th><th>Действует до</th><th>Состояние</th></tr></thead><tbody>
    ${[...expiring.map(x=>({a:x.a,st:x.over?"срок истёк":"истекает в ближайшие 2 недели",cls:x.over?"out":"warn"})),
       ...stale.filter(a=>!expiring.some(x=>x.a.id===a.id)).map(a=>({a,st:"нет занятий больше месяца",cls:"warn"}))]
      .map(x=>`<tr><td>${esc(studentName(x.a.studentId))}</td><td>${esc(x.a.name)}</td><td class="n">${abLeft(x.a)}</td>
      <td class="n">${esc(x.a.until)||"без срока"}</td><td><span class="chip ${x.cls}">${x.st}</span></td></tr>`).join("")}
    </tbody></table></div>`:`<div class="empty">Просроченных и зависших абонементов нет.</div>`}</div>
  </div>`;
}

/* --- P&L по направлениям --- */
function repPL(){
  const y=S.year,ks=monthKeys(y),acc=accrualIncome(y);
  const groups=R().groups.filter(g=>ks.some(k=>acc[k][g]));
  const extra=[...new Set(ks.flatMap(k=>Object.keys(acc[k])))].filter(g=>!groups.includes(g));
  const all=[...groups,...extra];
  const head=["Месяц","Итого по центру",...all];
  const rows=ks.map((k,i)=>({name:MONTHS[i],vals:[Object.values(acc[k]).reduce((s,x)=>s+x,0),...all.map(g=>acc[k][g]||0)]}));
  rows.push({name:"ВСЕГО за год",cls:"total",vals:[0,...all.map(()=>0)].map((_,c)=>rows.reduce((s,r)=>s+r.vals[c],0))});
  return matrixTable(head,rows,"Выручка по укрупнённым направлениям — группировка задаётся в справочнике «Направления».");
}
/* --- Рентабельность --- */
function repROS(){
  const y=S.year,ks=monthKeys(y),ops=opsOfYear(y),acc=accrualIncome(y);
  const inc=ks.map(k=>Object.values(acc[k]).reduce((s,x)=>s+x,0));
  const eSum=(nature)=>ks.map(k=>ops.filter(o=>o.type==="expense"&&ym(o.date)===k&&((artByName(o.article)||{}).nature==="const")===(nature==="const")).reduce((s,o)=>s+o.amount,0));
  const vr=eSum("var"),cn=eSum("const");
  const gross=inc.map((x,i)=>x-vr[i]);
  const cash=ks.map(k=>ops.filter(o=>o.type==="income"&&ym(o.date)===k).reduce((s,o)=>s+o.amount,0));
  const tax=cash.map(x=>x*R().usn/100);
  const net=gross.map((x,i)=>x-cn[i]-tax[i]);
  const rows=[{name:"Выручка",cls:"group",vals:inc},{name:"Переменные расходы",vals:vr},{name:"Валовая прибыль",cls:"total",vals:gross},
    {name:"Постоянные расходы",vals:cn},{name:`УСН ${R().usn}% с поступлений`,vals:tax},{name:"Чистая прибыль",cls:"total",vals:net}];
  rows.forEach(r=>r.vals=[...r.vals,r.vals.reduce((s,x)=>s+x,0)]);
  const incY=inc.reduce((s,x)=>s+x,0),netY=net.reduce((s,x)=>s+x,0);
  const ros=ks.map((_,i)=>inc[i]?net[i]/inc[i]*100:0);
  return matrixTable(["Показатель",...MON_SHORT,"Год"],rows,"Себестоимость = переменные расходы. ROS считается как чистая прибыль к выручке.")
   +`<div class="pad"><div class="stats" style="box-shadow:none">
      <div class="stat"><span class="k">Выручка за год</span><span class="v num">${money(incY)}</span></div>
      <div class="stat"><span class="k">Чистая прибыль</span><span class="v num ${netY>=0?"pos":"neg"}">${money(netY)}</span></div>
      <div class="stat"><span class="k">ROS за год</span><span class="v num">${incY?(netY/incY*100).toFixed(1):"0,0"}%</span><span class="n">рентабельность продаж</span></div>
      <div class="stat"><span class="k">Лучший месяц</span><span class="v num">${MONTHS[ros.indexOf(Math.max(...ros))]||"—"}</span><span class="n">${Math.max(...ros).toFixed(1)}% ROS</span></div>
    </div></div>`;
}
/* --- Рентабельность: направления, педагоги, абонементы, точка безубыточности --- */
function visitEcon(y){
  const les={}; allLessons().forEach(l=>les[l.id]=l);
  const out=[];
  allAbon().forEach(a=>(a.visits||[]).forEach(v=>{
    if(+String(v.date).slice(0,4)!==y)return;
    const tid=v.teacherId||a.teacherId||"", rate=teacherRate(tid), l=v.lessonId?les[v.lessonId]:null;
    const n=l?Math.max(1,(l.attend||[]).filter(x=>x.abonId).length):1;
    out.push({a,date:v.date,rev:abPrice(a),cost:rate/n,dir:a.direction||"Без привязки",tid,tpl:a.tariffId||""});
  }));
  return out;
}
function ecoTable(first,map,extra){
  const rows=Object.entries(map).sort((a,b)=>b[1].rev-a[1].rev);
  if(!rows.length)return `<div class="empty">Занятия ещё не проводились.</div>`;
  const tot=rows.reduce((t,[,x])=>({cnt:t.cnt+x.cnt,rev:t.rev+x.rev,cost:t.cost+x.cost}),{cnt:0,rev:0,cost:0});
  const line=(name,x,cls)=>{const m=x.rev-x.cost;return `<tr class="${cls||""}"><td>${esc(name)}</td>${extra?`<td class="n">${x.sold||""}</td>`:""}<td class="n">${x.cnt}</td><td class="n">${money(x.rev)}</td><td class="n">${money(x.cost)}</td><td class="n" style="color:var(--${m>=0?"pos":"neg"})">${money(m)}</td><td class="n">${x.rev?Math.round(m/x.rev*100)+"%":"—"}</td><td class="n">${x.cnt?money(x.rev/x.cnt):"—"}</td></tr>`;};
  return `<div class="tw"><table><thead><tr><th>${first}</th>${extra?'<th class="n">Продано, шт</th>':""}<th class="n">Занятий</th><th class="n">Выручка</th><th class="n">Оплата педагогов</th><th class="n">Маржа</th><th class="n">Маржа, %</th><th class="n">Цена занятия</th></tr></thead><tbody>
  ${rows.map(([k,x])=>line(k,x)).join("")}${line("Итого",tot,"total")}</tbody></table></div>`;
}
function repUnit(){
  const y=S.year, ve=visitEcon(y), ks=monthKeys(y), ops=opsOfYear(y);
  const grp=(keyFn)=>{const m={};ve.forEach(x=>{const k=keyFn(x);const o=m[k]=m[k]||{cnt:0,rev:0,cost:0,sold:0};o.cnt++;o.rev+=x.rev;o.cost+=x.cost;});return m;};
  const byDir=grp(x=>x.dir), byTeach=grp(x=>teacherName(x.tid)||"Педагог не указан");
  const byTpl=grp(x=>{const t=tariff(x.tpl);return t?t.name:"Без шаблона";});
  allAbon().filter(a=>+String(a.date).slice(0,4)===y).forEach(a=>{const t=tariff(a.tariffId),k=t?t.name:"Без шаблона";const o=byTpl[k]=byTpl[k]||{cnt:0,rev:0,cost:0,sold:0};o.sold++;});
  const rev=ve.reduce((s,x)=>s+x.rev,0), cost=ve.reduce((s,x)=>s+x.cost,0), margin=rev-cost, cnt=ve.length;
  const noRate=[...new Set(ve.filter(x=>!teacherRate(x.tid)).map(x=>teacherName(x.tid)||"Педагог не указан"))];
  /* занятия без списания абонемента: педагогу платить надо, выручки нет */
  const idle=allLessons().filter(l=>+String(l.date).slice(0,4)===y&&!(l.attend||[]).some(x=>x.abonId));
  const idleCost=idle.reduce((s,l)=>s+teacherRate(l.teacherId),0);
  /* точка безубыточности */
  const constByM=ks.map(k=>ops.filter(o=>o.type==="expense"&&ym(o.date)===k&&(artByName(o.article)||{}).nature==="const").reduce((s,o)=>s+o.amount,0));
  const monthsData=constByM.filter(x=>x>0).length, constAvg=monthsData?constByM.reduce((s,x)=>s+x,0)/monthsData:0;
  const visitMonths=new Set(ve.map(x=>ym(x.date))).size, perMonth=visitMonths?cnt/visitMonths:0;
  const avgMargin=cnt?margin/cnt:0, need=avgMargin>0&&constAvg?Math.ceil(constAvg/avgMargin):0;
  const constYear=constByM.reduce((s,x)=>s+x,0);
  return `<div class="pad stack">
   <div class="hint">Выручка — по методу начисления (стоимость проведённых занятий). Оплата педагогов — расчётная: ставка за занятие из справочника «Педагоги»; в групповом занятии ставка делится между учениками, у которых списан абонемент.</div>
   <div class="stats" style="box-shadow:none">
    <div class="stat"><span class="k">Выручка</span><span class="v num">${money(rev)}</span><span class="n">${cnt} проведённых занятий</span></div>
    <div class="stat"><span class="k">Оплата педагогов</span><span class="v num">${money(cost)}</span><span class="n">по ставкам</span></div>
    <div class="stat"><span class="k">Маржа</span><span class="v num ${margin>=0?"pos":"neg"}">${money(margin)}</span><span class="n">${rev?Math.round(margin/rev*100):0}% от выручки</span></div>
    <div class="stat"><span class="k">Занятия без абонемента</span><span class="v num ${idle.length?"neg":""}">${idle.length}</span><span class="n">${idle.length?"оплата педагогов "+money(idleCost)+" ₽ без выручки":"таких нет"}</span></div>
   </div>
   ${noRate.length?`<div class="hint"><span class="chip warn">внимание</span> У педагогов не задана ставка: ${esc(noRate.join(", "))}. Их занятия считаются без затрат, маржа завышена.</div>`:""}
   <div><h3 style="font-size:14px;margin-bottom:8px">По направлениям</h3>${ecoTable("Направление",byDir)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">По педагогам</h3>${ecoTable("Педагог",byTeach)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">По абонементам</h3>${ecoTable("Абонемент",byTpl,true)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">Точка безубыточности</h3>
    ${constAvg&&cnt?`<div class="stats" style="box-shadow:none">
      <div class="stat"><span class="k">Постоянные расходы</span><span class="v num">${money(constAvg)}</span><span class="n">в месяц, в среднем по журналу</span></div>
      <div class="stat"><span class="k">Маржа с занятия</span><span class="v num">${money(avgMargin)}</span><span class="n">в среднем</span></div>
      <div class="stat"><span class="k">Нужно занятий в месяц</span><span class="v num">${need||"—"}</span><span class="n">чтобы покрыть постоянные расходы</span></div>
      <div class="stat"><span class="k">Проводится в месяц</span><span class="v num ${need&&perMonth>=need?"pos":"neg"}">${Math.round(perMonth)}</span><span class="n">${need?(perMonth>=need?"центр выходит в плюс":"не хватает "+Math.max(0,Math.ceil(need-perMonth))+" занятий"):""}</span></div>
     </div>
     <div class="hint" style="margin-top:8px">Результат за год: маржа ${money(margin)} − постоянные расходы ${money(constYear)} = <b class="num">${money(margin-constYear)} ₽</b> (до налога УСН).</div>`
    :`<div class="empty">Для расчёта нужны проведённые занятия и операции с постоянными расходами в журнале.</div>`}
   </div>
  </div>`;
}
/* --- Налоги --- */
function repTax(){
  const y=S.year,ops=opsOfYear(y);
  const q=[0,1,2,3].map(i=>ops.filter(o=>o.type==="income"&&Math.floor((+o.date.slice(5,7)-1)/3)===i).reduce((s,o)=>s+o.amount,0));
  const qe=[0,1,2,3].map(i=>ops.filter(o=>o.type==="expense"&&Math.floor((+o.date.slice(5,7)-1)/3)===i).reduce((s,o)=>s+o.amount,0));
  const usn=q.map(x=>x*R().usn/100);
  const fixed=R().fixedFee;
  const base=q.reduce((s,x)=>s+x,0);
  const extra=Math.max(0,(base-300000))*0.01;
  const rows=[
    {name:"Поступления (налоговая база)",cls:"group",vals:q},
    {name:"Платежи (справочно)",cls:"sub",vals:qe},
    {name:`Налог УСН ${R().usn}%`,cls:"total",vals:usn},
    {name:"Фиксированный взнос ИП",vals:[0,0,0,fixed]},
    {name:"Взнос 1% с дохода свыше 300 000 ₽",vals:[0,0,0,extra]},
    {name:"Итого к уплате в бюджет",cls:"total",vals:usn.map((x,i)=>x+(i===3?fixed+extra:0))}
  ];
  rows.forEach(r=>r.vals=[...r.vals,r.vals.reduce((s,x)=>s+x,0)]);
  return matrixTable(["Показатель","1 квартал","2 квартал","3 квартал","4 квартал","Год"],rows,
    `Расчёт по кассовому методу. Ставка УСН и размер фиксированного взноса меняются в справочнике «Параметры». Взнос 1% начислен с базы «доходы» свыше 300 000 ₽ и не уменьшен на вычеты — уточняйте у бухгалтера.`);
}

/* ============================ справочники ============================ */
/* ============================ справочники (НСИ) ============================ */
const NSI_MENU=[
  {title:"Операции",items:[{k:"articles",name:"Статьи операций"},{k:"sources",name:"Источники"}]},
  {title:"Занятия",items:[{k:"directions",name:"Направления"},{k:"plgroups",name:"Группы для P&L"},{k:"subjects",name:"Предметы"},{k:"tariffs",name:"Абонементы (шаблоны)"},{k:"teachers",name:"Педагоги"},{k:"students",name:"Ученики"}]},
  {title:"Настройки",items:[{k:"taxes",name:"Налоги"},{k:"access",name:"Доступ"}]}
];
const NSI_NAME=Object.fromEntries(NSI_MENU.flatMap(g=>g.items.map(i=>[i.k,i.name])));
const NSI_KEEP_ART=["Прочие доходы","Прочие расходы"];
/* простые справочники-списки (хранятся строками в настройках) */
const NSI_LIST={
  sources:{arr:()=>R().sources,col:"Источник",title:"Источник",newTitle:"Новый источник",added:"Источник добавлен",del:"Удалить источник?",keep:[]},
  subjects:{arr:()=>R().subjects,col:"Предмет",title:"Предмет",newTitle:"Новый предмет",added:"Предмет добавлен",del:"Удалить предмет?",keep:["Без привязки"]},
  plgroups:{arr:()=>R().groups,col:"Группа для P&L",title:"Группа для P&L",newTitle:"Новая группа для P&L",added:"Группа добавлена",del:"Удалить группу?",keep:["Без привязки"]}
};
function nsiCount(k){
  switch(k){case"articles":return R().articles.length;case"sources":return R().sources.length;case"directions":return R().directions.length;
    case"plgroups":return R().groups.length;case"subjects":return R().subjects.length;case"tariffs":return S.tariffs.filter(t=>!t.archived).length;
    case"teachers":return S.teachers.filter(t=>!t.archived).length;case"students":return S.students.filter(s=>!s.archived).length;case"access":return MEMBERS.length;default:return "";}
}
/* сколько раз значение справочника встречается в данных */
function nsiUsage(k,name){
  const ops=allOps(),ab=allAbon(),ls=allLessons();
  switch(k){
    case"articles":return ops.filter(o=>o.article===name).length;
    case"sources":return ops.filter(o=>o.source===name).length;
    case"directions":return ops.filter(o=>o.direction===name).length+ab.filter(a=>a.direction===name).length+ls.filter(l=>l.direction===name).length
      +S.groups.filter(g=>g.direction===name).length+S.students.filter(s=>s.direction===name).length;
    case"subjects":return ops.filter(o=>o.subject===name).length+ab.filter(a=>a.subject===name).length+ls.filter(l=>l.subject===name).length+S.groups.filter(g=>g.subject===name).length;
    case"plgroups":return R().directions.filter(d=>(d.group||"Без привязки")===name).length;
  }
  return 0;
}
/* переименование: заменить значение во всех данных и сохранить затронутое */
async function renameRef(k,oldN,newN){
  const months=new Set(); let grp=false,stud=false;
  const fix=(o,f,m)=>{if(o[f]===oldN){o[f]=newN;if(m)months.add(m);return true;}return false;};
  if(k==="articles")for(const m in S.ops)S.ops[m].forEach(o=>fix(o,"article",m));
  if(k==="sources")for(const m in S.ops)S.ops[m].forEach(o=>fix(o,"source",m));
  if(k==="directions"||k==="subjects"){
    const f=k==="directions"?"direction":"subject";
    for(const m in S.ops)S.ops[m].forEach(o=>fix(o,f,m));
    for(const m in S.abon)S.abon[m].forEach(a=>fix(a,f,m));
    for(const m in S.lessons)S.lessons[m].forEach(l=>fix(l,f,m));
    S.groups.forEach(g=>{if(fix(g,f))grp=true;});
    if(k==="directions")S.students.forEach(s=>{if(fix(s,f))stud=true;});
  }
  if(k==="plgroups")R().directions.forEach(d=>{if(d.group===oldN)d.group=newN;});
  let ok=await saveRefs();
  for(const m of months){if(!(await saveMonth(m)))ok=false;}
  if(grp&&!(await saveGroups()))ok=false;
  if(stud&&!(await saveStudents()))ok=false;
  return ok;
}
const nsiDup=(arr,name,skip)=>arr.some((x,j)=>j!==skip&&String(x).toLowerCase()===name.toLowerCase());
const nsiBtns=(k,i,canEdit,canDel)=>`${canEdit?`<button class="btn mini" data-nsi-act="edit" data-k="${k}" data-i="${i}" title="Изменить">✎</button>`:""} ${canDel?`<button class="btn mini danger" data-nsi-act="del" data-k="${k}" data-i="${i}" title="Удалить">✕</button>`:""}`;

function viewNsi(v){
  if(!S.nsiTab){let t="articles";try{t=localStorage.getItem("un_nsiTab")||t;}catch(e){} S.nsiTab=NSI_NAME[t]&&t!=="students"?t:"articles";}
  v.innerHTML=`
  <div class="head"><div><h1>Справочники</h1></div></div>
  <div class="nsi">
    <nav class="panel nsi-menu">
      <div class="nsi-find"><input type="search" id="nsi-global" placeholder="Поиск по всем справочникам" value="${esc(S.nsiGlobal||"")}" autocomplete="off"></div>
      ${NSI_MENU.map(g=>`<div class="nsi-grp">${esc(g.title)}</div>${g.items.map(it=>`<button class="nsi-item" data-nsi-tab="${it.k}"><span>${esc(it.name)}</span><small>${nsiCount(it.k)}</small></button>`).join("")}`).join("")}
    </nav>
    <div id="nsi-main"></div>
  </div>`;
  v.querySelectorAll("[data-nsi-tab]").forEach(b=>b.onclick=()=>{
    const k=b.dataset.nsiTab;
    if(k==="students"){S.nav="students";render();return;}
    S.nsiTab=k;S.nsiQ="";S.nsiGlobal="";try{localStorage.setItem("un_nsiTab",k);}catch(e){}
    const g=document.getElementById("nsi-global");if(g)g.value="";
    renderNsiMain();
  });
  const gi=v.querySelector("#nsi-global");
  gi.oninput=()=>{S.nsiGlobal=gi.value.trim();renderNsiMain();};
  renderNsiMain();
}
function nsiMenuState(){
  document.querySelectorAll("[data-nsi-tab]").forEach(b=>b.classList.toggle("on",!S.nsiGlobal&&b.dataset.nsiTab===S.nsiTab));
}
function renderNsiMain(){
  const box=document.getElementById("nsi-main"); if(!box)return;
  nsiMenuState();
  if(S.nsiGlobal){box.innerHTML=nsiGlobalHTML(S.nsiGlobal);bindNsi(box);return;}
  box.innerHTML=nsiSectionHTML(S.nsiTab);
  bind(box); bindNsi(box);
  const q=box.querySelector("#nsi-q"); if(q){q.oninput=()=>{S.nsiQ=q.value;nsiFilter(box);};nsiFilter(box);}
}
/* фильтр строк текущего справочника без перерисовки — поле поиска не теряет фокус */
function nsiFilter(box){
  const q=(S.nsiQ||"").trim().toLowerCase();
  let shown=0;
  box.querySelectorAll("tbody tr[data-s]").forEach(tr=>{const ok=!q||tr.dataset.s.includes(q);tr.style.display=ok?"":"none";if(ok)shown++;});
  box.querySelectorAll("tbody tr.group[data-g]").forEach(h=>{const any=[...box.querySelectorAll(`tbody tr[data-s][data-g="${h.dataset.g}"]`)].some(tr=>tr.style.display!=="none");h.style.display=any?"":"none";});
  const e=box.querySelector("[data-nsi-empty]"); if(e)e.style.display=shown?"none":"";
}
function nsiPanel(k,{tools="",body="",add=""}){
  const search=["taxes","access"].includes(k)?"":`<input type="search" id="nsi-q" placeholder="Поиск" value="${esc(S.nsiQ||"")}" autocomplete="off">`;
  return `<div class="panel">
    <header class="nsi-head"><h2>${esc(NSI_NAME[k])} <span class="chip mut">${nsiCount(k)}</span></h2>
      <div class="tools">${tools}${search}${add}</div></header>
    ${body}
    ${search?`<div class="empty" data-nsi-empty style="display:none">Ничего не найдено</div>`:""}
  </div>`;
}
const sAttr=(...parts)=>esc(parts.join(" ").toLowerCase());

function nsiSectionHTML(k){
  const r=R();
  if(k==="articles"){
    const f=S.nsiKind||"";
    const seg=`<div class="seg">${[["","Все"],["income","Доходы"],["expense","Расходы"]].map(([v,t])=>`<button data-nsi-kind="${v}" class="${f===v?"on":""}">${t}</button>`).join("")}</div>`;
    const row=(a,i)=>{const prot=NSI_KEEP_ART.includes(a.name);return `<tr data-s="${sAttr(a.name)}" data-g="${a.kind}"><td>${esc(a.name)}</td>
      <td><span class="chip ${a.kind==="income"?"in":"out"}">${a.kind==="income"?"доход":"расход"}</span></td>
      <td>${a.kind==="expense"?`<select data-art-nature="${i}" style="width:140px"><option value="var" ${a.nature!=="const"?"selected":""}>переменный</option><option value="const" ${a.nature==="const"?"selected":""}>постоянный</option></select>`:"—"}</td>
      <td class="n">${nsiUsage("articles",a.name)||""}</td>
      <td class="n">${nsiBtns("articles",i,!prot,!prot)}</td></tr>`;};
    const idx=r.articles.map((a,i)=>[a,i]);
    const part=(kind,title)=>{const list=idx.filter(([a])=>a.kind===kind);return list.length?`${f?"":`<tr class="group" data-g="${kind}"><td colspan="5">${title} · ${list.length}</td></tr>`}${list.map(([a,i])=>row(a,i)).join("")}`:"";};
    const body=`<div class="tw"><table><thead><tr><th>Статья</th><th>Тип</th><th>Характер</th><th class="n">Операций</th><th></th></tr></thead><tbody>
      ${f!=="expense"?part("income","Доходы"):""}${f!=="income"?part("expense","Расходы"):""}</tbody></table></div>`;
    return nsiPanel(k,{tools:seg,body,add:`<button class="btn primary mini" data-nsi-act="add" data-k="articles">Добавить</button>`});
  }
  if(NSI_LIST[k]){
    const c=NSI_LIST[k];
    const head=k==="plgroups"?"Направлений":"Используется";
    const body=`<div class="tw"><table><thead><tr><th>${esc(c.col)}</th><th class="n">${head}</th><th></th></tr></thead><tbody>
      ${c.arr().map((x,i)=>{const prot=c.keep.includes(x);return `<tr data-s="${sAttr(x)}"><td>${esc(x)}</td><td class="n">${nsiUsage(k,x)||""}</td><td class="n">${nsiBtns(k,i,!prot,!prot)}</td></tr>`;}).join("")}
      </tbody></table></div>`;
    return nsiPanel(k,{body,add:`<button class="btn primary mini" data-nsi-act="add" data-k="${k}">Добавить</button>`});
  }
  if(k==="directions"){
    const body=`<div class="tw"><table><thead><tr><th>Направление</th><th>Группа для P&amp;L</th><th class="n">Используется</th><th></th></tr></thead><tbody>
      ${r.directions.map((d,i)=>{const prot=d.name==="Без привязки";return `<tr data-s="${sAttr(d.name,d.group)}"><td>${esc(d.name)}</td>
      <td><select data-dir-group="${i}" style="min-width:220px">${r.groups.map(g=>`<option ${(d.group||"Без привязки")===g?"selected":""}>${esc(g)}</option>`).join("")}</select></td>
      <td class="n">${nsiUsage("directions",d.name)||""}</td><td class="n">${nsiBtns("directions",i,!prot,!prot)}</td></tr>`;}).join("")}
      </tbody></table></div>`;
    return nsiPanel(k,{body,add:`<button class="btn primary mini" data-nsi-act="add" data-k="directions">Добавить</button>`});
  }
  if(k==="tariffs"){
    const arch=S.tariffs.filter(t=>t.archived).length;
    const tools=arch?`<button class="btn mini" data-act="toggle-arch" data-id="tariffs">${showArch("tariffs")?"Скрыть архив":"Показать архив"} (${arch})</button>`:"";
    const body=`<div class="tw"><table><thead><tr><th>Название</th><th>Направление · предмет · педагог</th><th class="n">Занятий</th><th class="n">Цена</th><th class="n">За занятие</th><th class="n">Срок, дн.</th><th class="n">Продано</th><th></th></tr></thead><tbody>
      ${tplList(showArch("tariffs")).map(t=>`<tr data-s="${sAttr(t.name,t.direction,t.subject,teacherName(t.teacherId))}"><td>${esc(t.name)}${t.archived?' <span class="chip mut">архив</span>':""}</td>
      <td>${esc([t.direction,t.subject,teacherName(t.teacherId),t.format].filter(Boolean).join(" · ")||"—")}</td>
      <td class="n">${t.lessons}</td><td class="n">${money(t.price)}</td><td class="n">${money(t.lessons?t.price/t.lessons:t.price)}</td><td class="n">${t.validDays||""}</td><td class="n">${tplSold(t.id)||""}</td>
      <td class="n"><button class="btn mini" data-act="edit-tariff" data-id="${t.id}" title="Изменить">✎</button> <button class="btn mini danger" data-act="del-tariff" data-id="${t.id}" title="Удалить">✕</button></td></tr>`).join("")}
      </tbody></table></div>`;
    return nsiPanel(k,{tools,body,add:`<button class="btn primary mini" data-act="add-tariff">Добавить</button>`});
  }
  if(k==="teachers"){
    const body=`<div class="tw"><table><thead><tr><th>Педагог</th><th>Предмет</th><th>Телефон</th><th class="n">Ставка за занятие</th><th class="n">Проведено занятий</th><th></th></tr></thead><tbody>
      ${S.teachers.filter(t=>showArch("teachers")||!t.archived).sort((a,b)=>a.name.localeCompare(b.name,"ru")).map(t=>{const cnt=allAbon().reduce((s,a)=>s+(a.visits||[]).filter(x=>(x.teacherId||a.teacherId)===t.id).length,0);
      return `<tr data-s="${sAttr(t.name,t.subject,t.phone)}"><td>${esc(t.name)}${t.archived?' <span class="chip mut">архив</span>':""}</td><td>${esc(t.subject||"")}</td><td>${esc(t.phone||"")}</td><td class="n">${t.rate?money(t.rate):"—"}</td><td class="n">${cnt||""}</td>
      <td class="n"><button class="btn mini" data-act="edit-teacher" data-id="${t.id}" title="Изменить">✎</button> <button class="btn mini danger" data-act="del-teacher" data-id="${t.id}" title="Удалить">✕</button></td></tr>`;}).join("")}
      </tbody></table></div>`;
    const archT=S.teachers.filter(t=>t.archived).length;
    return nsiPanel(k,{tools:archT?`<button class="btn mini" data-act="toggle-arch" data-id="teachers">${showArch("teachers")?"Скрыть архив":"Показать архив"} (${archT})</button>`:"",body,add:`<button class="btn primary mini" data-act="add-teacher">Добавить</button>`});
  }
  if(k==="taxes"){
    const body=`<div class="pad grid2" style="max-width:560px">
        <label class="f"><span>Ставка УСН, %</span><input type="number" step="0.1" data-par="usn" value="${r.usn}"></label>
        <label class="f"><span>Фиксированный взнос ИП за год, ₽</span><input type="number" data-par="fixedFee" value="${r.fixedFee}"></label>
      </div>
      <div class="pad" style="padding-top:0"><button class="btn primary" data-act="save-par">Сохранить</button></div>`;
    return nsiPanel(k,{body});
  }
  if(k==="access"){
    const body=`<div class="pad hint">Работать с базой центра могут только адреса из этого списка.</div>
      <div class="tw"><table><thead><tr><th>Почта</th><th>Имя</th><th>Роль</th><th></th></tr></thead><tbody>
      ${MEMBERS.map(m=>`<tr><td>${esc(m.email)}${m.email===ME?' <span class="chip mut">это вы</span>':""}</td><td>${esc(m.name||"")}</td>
      <td>${m.role==="owner"?"владелец":"пользователь"}</td>
      <td class="n">${m.email===ME?"":`<button class="btn mini danger" data-act="del-member" data-id="${esc(m.email)}">Закрыть доступ</button>`}</td></tr>`).join("")}
      </tbody></table></div>`;
    return nsiPanel(k,{body});
  }
  return "";
}

/* общий поиск по всем справочникам */
function nsiGlobalHits(q){
  q=q.toLowerCase(); const hits=[];
  const add=(k,name,extra)=>{if((String(name||"")+" "+String(extra||"")).toLowerCase().includes(q))hits.push({k,name,extra:extra||""});};
  R().articles.forEach(a=>add("articles",a.name,a.kind==="income"?"доход":"расход"));
  R().sources.forEach(s=>add("sources",s));
  R().directions.forEach(d=>add("directions",d.name,d.group));
  R().groups.forEach(g=>add("plgroups",g));
  R().subjects.forEach(s=>add("subjects",s));
  S.tariffs.forEach(t=>add("tariffs",t.name,t.lessons+" зан."));
  S.teachers.forEach(t=>add("teachers",t.name,t.subject));
  S.students.forEach(s=>add("students",s.name,s.direction&&s.direction!=="Без привязки"?s.direction:""));
  return hits;
}
function nsiGlobalHTML(q){
  const hits=nsiGlobalHits(q);
  return `<div class="panel"><header class="nsi-head"><h2>Поиск по всем справочникам <span class="chip mut">${hits.length}</span></h2></header>
    ${hits.length?`<div class="tw"><table><thead><tr><th>Значение</th><th>Справочник</th><th></th></tr></thead><tbody>
    ${hits.map(h=>`<tr class="nsi-hit" data-nsi-go="${h.k}" data-name="${esc(h.name)}"><td>${esc(h.name)}${h.extra?` <span class="chip mut">${esc(h.extra)}</span>`:""}</td><td>${esc(NSI_NAME[h.k])}</td><td class="n"><button class="btn mini">Открыть</button></td></tr>`).join("")}
    </tbody></table></div>`:`<div class="empty">Ничего не найдено</div>`}</div>`;
}

/* обработчики справочников */
function bindNsi(box){
  box.querySelectorAll("[data-nsi-go]").forEach(tr=>tr.onclick=()=>{
    const k=tr.dataset.nsiGo;
    if(k==="students"){S.nsiGlobal="";S.nav="students";render();return;}
    S.nsiTab=k;S.nsiQ=tr.dataset.name;S.nsiGlobal="";S.nsiKind="";
    try{localStorage.setItem("un_nsiTab",k);}catch(e){}
    const g=document.getElementById("nsi-global");if(g)g.value="";
    renderNsiMain();
  });
  box.querySelectorAll("[data-nsi-kind]").forEach(b=>b.onclick=()=>{S.nsiKind=b.dataset.nsiKind;renderNsiMain();});
  box.querySelectorAll("[data-art-nature]").forEach(s=>s.onchange=async()=>{R().articles[+s.dataset.artNature].nature=s.value;if(await saveRefs())toast("Статья обновлена");});
  box.querySelectorAll("[data-dir-group]").forEach(s=>s.onchange=async()=>{R().directions[+s.dataset.dirGroup].group=s.value;if(await saveRefs())toast("Группировка обновлена");});
  box.querySelectorAll("[data-nsi-act]").forEach(b=>b.onclick=async()=>{
    const k=b.dataset.k,i=b.dataset.i===undefined?null:+b.dataset.i,act=b.dataset.nsiAct;
    if(act==="add"||act==="edit"){
      if(k==="articles")articleModal(i); else if(k==="directions")directionModal(i); else listModal(k,i);
      return;
    }
    if(act==="del"){
      const conf=k==="articles"?"Удалить статью?":k==="directions"?"Удалить направление?":NSI_LIST[k].del;
      if(!confirm(conf))return;
      if(k==="articles")R().articles.splice(i,1); else if(k==="directions")R().directions.splice(i,1); else NSI_LIST[k].arr().splice(i,1);
      if(await saveRefs())toast("Удалено");
      render();
    }
  });
}
function articleModal(i){
  const a=i==null?null:R().articles[i];
  const kind=a?a.kind:(S.nsiKind||"income");
  modal(a?"Статья":"Новая статья",`<div class="grid3">
    <label class="f"><span>Наименование</span><input name="name" value="${esc(a?a.name:"")}"></label>
    <label class="f"><span>Тип</span><select name="kind"><option value="income" ${kind==="income"?"selected":""}>Доход</option><option value="expense" ${kind==="expense"?"selected":""}>Расход</option></select></label>
    <label class="f"><span>Характер расхода</span><select name="nature"><option value="var" ${!a||a.nature!=="const"?"selected":""}>Переменный</option><option value="const" ${a&&a.nature==="const"?"selected":""}>Постоянный</option></select></label>
  </div>`,async(l)=>{
    const n=val(l,"name"); if(!n){toast("Укажите наименование");return false;}
    if(nsiDup(R().articles.map(x=>x.name),n,i)){toast("Такое название уже есть");return false;}
    const kd=val(l,"kind"),nt=val(l,"nature");
    if(a){const old=a.name;Object.assign(a,{name:n,kind:kd,nature:nt});if(await (old!==n?renameRef("articles",old,n):saveRefs()))toast("Сохранено");}
    else{R().articles.push({name:n,kind:kd,nature:nt});if(await saveRefs())toast("Статья добавлена");}
  },a?"Сохранить":"Добавить");
}
function directionModal(i){
  const d=i==null?null:R().directions[i];
  modal(d?"Направление":"Новое направление",`<div class="grid2">
    <label class="f"><span>Направление</span><input name="name" value="${esc(d?d.name:"")}"></label>
    <label class="f"><span>Группа для P&amp;L</span><select name="group">${opt(R().groups,d?(d.group||"Без привязки"):"Без привязки")}</select></label></div>`,async(l)=>{
    const n=val(l,"name"); if(!n){toast("Укажите название");return false;}
    if(nsiDup(R().directions.map(x=>x.name),n,i)){toast("Такое название уже есть");return false;}
    if(d){const old=d.name;d.name=n;d.group=val(l,"group");if(await (old!==n?renameRef("directions",old,n):saveRefs()))toast("Сохранено");}
    else{R().directions.push({name:n,group:val(l,"group")});if(await saveRefs())toast("Направление добавлено");}
  },d?"Сохранить":"Добавить");
}
function listModal(k,i){
  const c=NSI_LIST[k],arr=c.arr(),cur=i==null?null:arr[i];
  modal(cur==null?c.newTitle:c.title,`<label class="f"><span>Наименование</span><input name="name" value="${esc(cur||"")}"></label>`,async(l)=>{
    const n=val(l,"name"); if(!n){toast("Укажите наименование");return false;}
    if(nsiDup(arr,n,i)){toast("Такое название уже есть");return false;}
    if(cur!=null){arr[i]=n;if(await (cur!==n?renameRef(k,cur,n):saveRefs()))toast("Сохранено");}
    else{arr.push(n);if(await saveRefs())toast(c.added);}
  },cur==null?"Добавить":"Сохранить");
}

/* ============================ модальные окна ============================ */
function modal(title,bodyHTML,onSave,saveLabel){
  const layer=document.getElementById("layer");
  layer.innerHTML=`<div class="scrim"><div class="modal" role="dialog" aria-label="${esc(title)}">
    <header><h3>${esc(title)}</h3><button class="btn mini ghost" data-close>✕</button></header>
    <div class="body">${bodyHTML}</div>
    <footer><button class="btn" data-close>${onSave?"Отмена":"Закрыть"}</button>${onSave?`<button class="btn primary" data-save>${esc(saveLabel||"Сохранить")}</button>`:""}</footer>
  </div></div>`;
  const close=()=>layer.innerHTML="";
  layer.querySelectorAll("[data-close]").forEach(b=>b.onclick=close);
  layer.querySelector(".scrim").onclick=(e)=>{if(e.target===layer.querySelector(".scrim"))close();};
  const sv=layer.querySelector("[data-save]");
  if(sv)sv.onclick=async()=>{const ok=await onSave(layer);if(ok!==false){close();render();}};
  const first=layer.querySelector("input,select,textarea");if(first)first.focus();
  return {close,layer};
}
const val=(l,n)=>{const e=l.querySelector(`[name="${n}"]`);return e?e.value.trim():"";};
const chk=(l,n)=>{const e=l.querySelector(`[name="${n}"]`);return e?e.checked:false;};
const opt=(arr,sel)=>arr.map(x=>`<option ${x===sel?"selected":""}>${esc(x)}</option>`).join("");
const optId=(arr,sel)=>`<option value="">— не выбрано —</option>`+arr.filter(x=>!x.archived||x.id===sel).map(x=>`<option value="${x.id}" ${x.id===sel?"selected":""}>${esc(x.name)}</option>`).join("");

/* --- операция --- */
function opForm(o={}){
  const r=R();
  return `<div class="grid3">
    <label class="f"><span>Дата</span><input type="date" name="date" value="${o.date||today()}"></label>
    <label class="f"><span>Тип</span><select name="type"><option value="income" ${o.type!=="expense"?"selected":""}>Поступление</option><option value="expense" ${o.type==="expense"?"selected":""}>Платёж</option></select></label>
    <label class="f"><span>Сумма, ₽</span><input type="number" step="0.01" name="amount" value="${o.amount||""}"></label>
  </div>
  <div class="grid3">
    <label class="f"><span>Статья</span><select name="article">${opt(r.articles.map(a=>a.name),o.article)}</select></label>
    <label class="f"><span>Направление</span><select name="direction">${opt(r.directions.map(d=>d.name),o.direction||"Без привязки")}</select></label>
    <label class="f"><span>Источник</span><select name="source">${opt(r.sources,o.source||r.sources[0])}</select></label>
  </div>
  <div class="grid3">
    <label class="f"><span>Ученик</span><select name="studentId">${optId(S.students,o.studentId)}</select></label>
    <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,o.teacherId)}</select></label>
    <label class="f"><span>Предмет</span><select name="subject">${opt(r.subjects,o.subject||"Без привязки")}</select></label>
  </div>
  <label class="f"><span>Комментарий</span><input name="note" value="${esc(o.note||"")}"></label>
  <label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="fisc" ${o.fisc?"checked":""} style="width:auto"><span class="hint">Чек пробит (фискализация)</span></label>`;
}
function readOp(l,base={}){
  return Object.assign({},base,{
    id:base.id||uid("op"), date:val(l,"date")||today(), type:val(l,"type"), amount:parseNum(val(l,"amount")),
    article:val(l,"article"), direction:val(l,"direction"), source:val(l,"source"),
    studentId:val(l,"studentId"), teacherId:val(l,"teacherId"), subject:val(l,"subject"),
    note:val(l,"note"), fisc:chk(l,"fisc")
  });
}
function newOp(preStudent){
  modal("Новая операция",opForm(preStudent?{studentId:preStudent}:{}),async(l)=>{
    const o=readOp(l); if(!o.amount){toast("Укажите сумму");return false;}
    const m=pushOp(o); await saveMonth(m); toast("Операция добавлена");
  },"Добавить");
}
function editOp(id){
  let found=null,mm=null;
  for(const m in S.ops){const o=S.ops[m].find(x=>x.id===id);if(o){found=o;mm=m;break;}}
  if(!found)return;
  modal("Операция от "+found.date,opForm(found),async(l)=>{
    const o=readOp(l,found); const nm=ym(o.date);
    S.ops[mm]=S.ops[mm].filter(x=>x.id!==id);
    (S.ops[nm]=S.ops[nm]||[]).push(o); if(!S.abon[nm])S.abon[nm]=[];
    await saveMonth(mm); if(nm!==mm)await saveMonth(nm);
    toast("Изменения сохранены");
  });
}
async function delOp(id){
  for(const m in S.ops){ if(S.ops[m].some(x=>x.id===id)){ S.ops[m]=S.ops[m].filter(x=>x.id!==id); await saveMonth(m); toast("Операция удалена"); render(); return; } }
}

/* --- ученик --- */
function studentForm(s={}){
  return `<div class="grid2">
   <label class="f"><span>ФИО ученика</span><input name="name" value="${esc(s.name||"")}" placeholder="Иванова Мария"></label>
   <label class="f"><span>Родитель / контактное лицо</span><input name="parent" value="${esc(s.parent||"")}"></label>
   <label class="f"><span>Телефон</span><input name="phone" value="${esc(s.phone||"")}"></label>
   <label class="f"><span>Основное направление</span><select name="direction">${opt(R().directions.map(d=>d.name),s.direction)}</select></label>
  </div><label class="f"><span>Заметки</span><textarea name="note" rows="2">${esc(s.note||"")}</textarea></label>
   ${s.id?`<label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="archived" ${s.archived?"checked":""} style="width:auto"><span class="hint">В архиве (ученик больше не занимается)</span></label>`:""}`;
}
function newStudent(){
  modal("Новый ученик",studentForm(),async(l)=>{
    const name=val(l,"name"); if(!name){toast("Укажите имя");return false;}
    S.students.push({id:uid("s"),name,parent:val(l,"parent"),phone:val(l,"phone"),direction:val(l,"direction"),note:val(l,"note")});
    await saveStudents(); toast("Ученик добавлен");
  },"Добавить");
}
function editStudent(id){
  const s=S.students.find(x=>x.id===id); if(!s)return;
  modal("Карточка · "+s.name,studentForm(s),async(l)=>{
    Object.assign(s,{name:val(l,"name"),parent:val(l,"parent"),phone:val(l,"phone"),direction:val(l,"direction"),note:val(l,"note"),archived:chk(l,"archived")});
    await saveStudents(); toast("Сохранено");
  });
}
function studentCard(id){
  const s=S.students.find(x=>x.id===id); if(!s)return;
  const ab=allAbon().filter(a=>a.studentId===id).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const pays=allOps().filter(o=>o.studentId===id).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const visits=ab.flatMap(a=>(a.visits||[]).map(v=>({...v,ab:a}))).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const openAb=ab.filter(a=>abLeft(a)>0);
  modal(s.name,`
   <div class="row" style="gap:18px">
     <span class="hint">Оплачено: <b class="num">${money(pays.filter(p=>p.type==="income").reduce((n,p)=>n+p.amount,0))} ₽</b></span>
     <span class="hint">Остаток занятий: <b class="num">${ab.reduce((n,a)=>n+abLeft(a),0)}</b></span>
     <span class="hint">Проведено: <b class="num">${visits.length}</b></span>
   </div>
   <div class="row">
     <button class="btn primary" data-act="new-abon" data-id="${s.id}">Продать абонемент</button>
     ${openAb.length?`<button class="btn" data-act="visit" data-id="${openAb[0].id}">Списать занятие</button>`:""}
     <button class="btn" data-act="new-op" data-id="${s.id}">Добавить оплату</button>
   </div>
   <h3 style="font-size:14px">Абонементы</h3>
   ${ab.length?`<div class="tw"><table><thead><tr><th>Дата</th><th>Абонемент</th><th class="n">Остаток</th><th></th></tr></thead><tbody>
   ${ab.map(a=>`<tr><td class="n">${esc(a.date)}</td><td>${esc(a.name)}<div class="hint">${esc(a.direction||"")}</div></td><td class="n">${abLeft(a)} из ${a.lessons}</td>
   <td class="n">${abLeft(a)?`<button class="btn mini" data-act="visit" data-id="${a.id}">Списать</button>`:'<span class="chip mut">закрыт</span>'}</td></tr>`).join("")}
   </tbody></table></div>`:`<div class="hint">Абонементов нет.</div>`}
   <h3 style="font-size:14px">Посещения</h3>
   ${visits.length?`<div class="tw"><table><thead><tr><th>Дата</th><th>Абонемент</th><th>Педагог</th><th>Комментарий</th></tr></thead><tbody>
   ${visits.slice(0,20).map(v=>`<tr><td class="n">${esc(v.date)}</td><td>${esc(v.ab.name)}</td><td>${esc(teacherName(v.teacherId||v.ab.teacherId))}</td><td>${esc(v.note||"")}</td></tr>`).join("")}
   </tbody></table></div>`:`<div class="hint">Занятия ещё не списывались.</div>`}
   <h3 style="font-size:14px">Оплаты</h3>
   ${pays.length?`<div class="tw"><table><tbody>${pays.map(p=>`<tr><td class="n">${esc(p.date)}</td><td>${esc(p.article||"")}</td><td class="n" style="color:var(--${p.type==="income"?"pos":"neg"})">${p.type==="income"?"+":"−"}${money(p.amount)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="hint">Оплат нет.</div>`}
  `,null);
  bind(document.getElementById("layer"));
}

/* --- педагог, тариф, статья, направление --- */
const teacherUsed=(id)=>allAbon().some(a=>a.teacherId===id||(a.visits||[]).some(v=>v.teacherId===id))||allOps().some(o=>o.teacherId===id)||allLessons().some(l=>l.teacherId===id)||S.groups.some(g=>g.teacherId===id)||S.tariffs.some(t=>t.teacherId===id);
async function delTeacher(id){
  const t=S.teachers.find(x=>x.id===id);if(!t)return;
  if(teacherUsed(id)){
    if(!confirm("У педагога есть занятия и операции, поэтому он будет перенесён в архив. Продолжить?"))return;
    t.archived=true;if(await saveTeachers())toast("Перенесён в архив");
  } else {
    if(!confirm("Удалить педагога?"))return;
    S.teachers=S.teachers.filter(x=>x.id!==id);if(await saveTeachers())toast("Удалено");
  }
  render();
}
function teacherForm(t={}){return `<div class="grid2">
  <label class="f"><span>ФИО</span><input name="name" value="${esc(t.name||"")}"></label>
  <label class="f"><span>Предмет / направление</span><input name="subject" value="${esc(t.subject||"")}"></label>
  <label class="f"><span>Телефон</span><input name="phone" value="${esc(t.phone||"")}"></label>
  <label class="f"><span>Ставка за занятие, ₽</span><input type="number" name="rate" value="${t.rate||""}"></label></div>
  ${t.id?`<label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="archived" ${t.archived?"checked":""} style="width:auto"><span class="hint">В архиве (не показывать при выборе)</span></label>`:""}`;}
function newTeacher(){modal("Новый педагог",teacherForm(),async(l)=>{const n=val(l,"name");if(!n){toast("Укажите ФИО");return false;}
  S.teachers.push({id:uid("t"),name:n,subject:val(l,"subject"),phone:val(l,"phone"),rate:parseNum(val(l,"rate"))});await saveTeachers();toast("Педагог добавлен");},"Добавить");}
function editTeacher(id){const t=S.teachers.find(x=>x.id===id);if(!t)return;modal("Педагог",teacherForm(t),async(l)=>{
  Object.assign(t,{name:val(l,"name"),subject:val(l,"subject"),phone:val(l,"phone"),rate:parseNum(val(l,"rate")),archived:chk(l,"archived")});await saveTeachers();toast("Сохранено");});}
/* --- шаблоны абонементов (постоянные абонементы) --- */
const addDays=(iso,n)=>{const d=new Date((iso||today())+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const showArch=(k)=>!!(S.arch&&S.arch[k]);
const teacherRate=(id)=>{const t=S.teachers.find(x=>x.id===id);return t?+t.rate||0:0;};
const tplSold=(id)=>allAbon().filter(a=>a.tariffId===id).length;
const tplList=(withArchived)=>S.tariffs.filter(t=>withArchived||!t.archived).slice().sort((a,b)=>(a.direction||"яя").localeCompare(b.direction||"яя","ru")||(a.lessons-b.lessons)||a.name.localeCompare(b.name,"ru"));
const optE=(arr,sel,empty)=>`<option value="">${empty||"— не выбрано —"}</option>`+opt(arr,sel);
function tplMeta(t){return [t.direction,t.subject,teacherName(t.teacherId),t.format,t.validDays?`${t.validDays} дн.`:""].filter(Boolean);}
function tariffForm(t={}){
  const r=R();
  return `<div class="grid2">
   <label class="f"><span>Название</span><input name="name" value="${esc(t.name||"")}" placeholder="Английский, 8 занятий"></label>
   <label class="f"><span>Количество занятий</span><input type="number" name="lessons" min="1" value="${t.lessons||8}"></label>
  </div>
  <div class="grid3">
   <label class="f"><span>Цена, ₽</span><input type="number" name="price" value="${t.price||""}"></label>
   <label class="f"><span>Срок действия, дней</span><input type="number" name="validDays" min="0" value="${t.validDays||""}" placeholder="без срока"></label>
   <label class="f"><span>Формат</span><select name="format">${optE(r.formats,t.format,"— любой —")}</select></label>
  </div>
  <div class="grid3">
   <label class="f"><span>Направление</span><select name="direction">${optE(r.directions.map(d=>d.name),t.direction)}</select></label>
   <label class="f"><span>Предмет</span><select name="subject">${optE(r.subjects,t.subject)}</select></label>
   <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,t.teacherId)}</select></label>
  </div>
  <label class="f"><span>Статья дохода при продаже</span><select name="article">${optE(r.articles.filter(a=>a.kind==="income").map(a=>a.name),t.article,"— по названию, иначе первая статья дохода —")}</select></label>
  <label class="f"><span>Заметка</span><input name="note" value="${esc(t.note||"")}"></label>
  ${t.id?`<label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="archived" ${t.archived?"checked":""} style="width:auto"><span class="hint">В архиве (не показывать в каталоге и при продаже)</span></label>`:""}
  <div class="hint" data-tpl-calc></div>`;
}
function bindTariffForm(l){
  const calc=()=>{
    const n=Math.max(1,parseNum(val(l,"lessons"))||1),p=parseNum(val(l,"price")),rate=teacherRate(val(l,"teacherId")),box=l.querySelector("[data-tpl-calc]");
    if(!box)return;
    const per=p/n;
    box.textContent=rate?`За занятие: ${money(per)} ₽ · ставка педагога: ${money(rate)} ₽ · маржа с занятия: ${money(per-rate)} ₽ (${per?Math.round((per-rate)/per*100):0}%) при индивидуальном занятии`
      :`За занятие: ${money(per)} ₽. Выберите педагога со ставкой, чтобы увидеть маржу.`;
  };
  l.querySelectorAll('[name="lessons"],[name="price"],[name="teacherId"]').forEach(e=>{e.oninput=e.onchange=calc;});
  calc();
}
function readTariff(l,base={}){
  return Object.assign(base,{name:val(l,"name"),lessons:Math.max(1,parseNum(val(l,"lessons"))||1),price:parseNum(val(l,"price")),
    validDays:Math.max(0,parseNum(val(l,"validDays"))),format:val(l,"format"),direction:val(l,"direction"),subject:val(l,"subject"),
    teacherId:val(l,"teacherId"),article:val(l,"article"),note:val(l,"note")});
}
function newTariff(){
  const m=modal("Новый шаблон абонемента",tariffForm(),async(l)=>{const n=val(l,"name");if(!n){toast("Укажите название");return false;}
    if(S.tariffs.some(x=>x.name.toLowerCase()===n.toLowerCase())){toast("Такое название уже есть");return false;}
    S.tariffs.push(readTariff(l,{id:uid("tr"),archived:false}));await saveTariffs();toast("Шаблон добавлен");},"Добавить");
  bindTariffForm(m.layer);
}
function editTariff(id){
  const t=tariff(id);if(!t)return;
  const m=modal("Шаблон абонемента",tariffForm(t),async(l)=>{const n=val(l,"name");if(!n){toast("Укажите название");return false;}
    if(S.tariffs.some(x=>x.id!==id&&x.name.toLowerCase()===n.toLowerCase())){toast("Такое название уже есть");return false;}
    readTariff(l,t);t.archived=chk(l,"archived");await saveTariffs();toast("Сохранено");});
  bindTariffForm(m.layer);
}
async function delTariff(id){
  const t=tariff(id);if(!t)return;
  if(tplSold(id)){
    if(!confirm("Этот абонемент уже продавался, поэтому он будет перенесён в архив. Продолжить?"))return;
    t.archived=true;if(await saveTariffs())toast("Перенесён в архив");
  } else {
    if(!confirm("Удалить шаблон абонемента?"))return;
    S.tariffs=S.tariffs.filter(x=>x.id!==id);if(await saveTariffs())toast("Удалено");
  }
  render();
}

/* --- продажа абонемента (из каталога, из карточки ученика или вручную) --- */
function newAbon(preStudent,preTariff){
  const r=R(),tpls=tplList().filter(t=>true);
  if(preTariff&&!tpls.some(t=>t.id===preTariff)&&tariff(preTariff))tpls.push(tariff(preTariff));
  const m=modal("Продажа абонемента",`
   <label class="f"><span>Шаблон абонемента</span><select name="tariffId"><option value="">— без шаблона, ввести вручную —</option>${tpls.map(t=>`<option value="${t.id}" ${t.id===preTariff?"selected":""}>${esc(t.name)} · ${t.lessons} зан. · ${money(t.price)} ₽</option>`).join("")}</select></label>
   <div class="grid2">
     <label class="f"><span>Ученик</span><select name="studentId">${optId(S.students,preStudent)}</select></label>
     <label class="f"><span>Дата продажи</span><input type="date" name="date" value="${today()}"></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Количество занятий</span><input type="number" name="lessons" min="1" value="8"></label>
     <label class="f"><span>Сумма, ₽</span><input type="number" name="price" value=""></label>
   </div>
   <div class="hint" data-sale-info></div>
   <div class="grid3">
     <label class="f"><span>Направление</span><select name="direction">${opt(r.directions.map(d=>d.name))}</select></label>
     <label class="f"><span>Предмет</span><select name="subject">${opt(r.subjects)}</select></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers)}</select></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Формат</span><select name="format">${optE(r.formats,"","— не указан —")}</select></label>
     <label class="f"><span>Действует до</span><input type="date" name="until"></label>
   </div>
   <label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="pay" checked style="width:auto"><span class="hint">Создать поступление в журнале операций</span></label>
  `,async(l)=>{
    const sid=val(l,"studentId"); if(!sid){toast("Выберите ученика");return false;}
    const tid=val(l,"tariffId"),t=tariff(tid);
    const lessons=Math.max(1,parseNum(val(l,"lessons"))||(t?t.lessons:1));
    const price=parseNum(val(l,"price"));
    const a={id:uid("ab"),date:val(l,"date")||today(),studentId:sid,tariffId:tid,name:t?t.name:`Абонемент на ${lessons} занятий`,
      lessons,price,direction:val(l,"direction"),subject:val(l,"subject"),teacherId:val(l,"teacherId"),format:val(l,"format"),until:val(l,"until"),visits:[]};
    const mo=pushAbon(a);
    if(chk(l,"pay")&&price){
      const inc=R().articles.filter(x=>x.kind==="income").map(x=>x.name);
      const art=(t&&t.article&&inc.includes(t.article)&&t.article)||inc.find(x=>x===a.name)||inc[0]||"Прочие доходы";
      pushOp({id:uid("op"),date:a.date,type:"income",amount:price,article:art,direction:a.direction,subject:a.subject,
        source:"",studentId:sid,teacherId:a.teacherId,note:a.name,abonId:a.id,fisc:false});
    }
    await saveMonth(mo); toast("Абонемент выставлен");
  },"Выставить");
  const l=m.layer,ts=l.querySelector('[name="tariffId"]'),dt=l.querySelector('[name="date"]'),un=l.querySelector('[name="until"]'),pr=l.querySelector('[name="price"]'),ls=l.querySelector('[name="lessons"]'),info=l.querySelector("[data-sale-info]");
  let untilTouched=false;
  const setSel=(n,v)=>{const e=l.querySelector(`[name="${n}"]`);if(e&&v&&[...e.options].some(o=>o.value===v))e.value=v;};
  const upd=()=>{
    const t=tariff(ts.value),p=parseNum(pr.value),n=Math.max(1,parseNum(ls.value)||1);
    let s=`За занятие: ${money(p/n)} ₽.`;
    if(t&&t.price&&p!==t.price&&t.lessons===n){const d=t.price-p;s+=d>0?` Скидка к цене шаблона: ${money(d)} ₽ (${Math.round(d/t.price*100)}%).`:` Выше цены шаблона на ${money(-d)} ₽.`;}
    info.textContent=p?s:"";
  };
  const untilFromTpl=()=>{const t=tariff(ts.value);if(!untilTouched&&t&&t.validDays)un.value=addDays(dt.value,t.validDays);};
  ts.onchange=()=>{const t=tariff(ts.value);if(!t){upd();return;}
    ls.value=t.lessons;pr.value=t.price;setSel("direction",t.direction);setSel("subject",t.subject);setSel("teacherId",t.teacherId);setSel("format",t.format);
    untilTouched=false;un.value=t.validDays?addDays(dt.value,t.validDays):"";upd();};
  dt.onchange=untilFromTpl;un.oninput=()=>{untilTouched=true;};
  pr.oninput=ls.oninput=upd;
  if(ts.value)ts.onchange();
}
/* --- списание занятия --- */
function visitAbon(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  if(abLeft(a)<=0){toast("Занятия по абонементу закончились");return;}
  modal("Списать занятие · "+(studentName(a.studentId)||a.name),`
   <div class="hint">${esc(a.name)} · остаток ${abLeft(a)} из ${a.lessons} · ${money(abPrice(a))} ₽ за занятие</div>
   <div class="grid3">
     <label class="f"><span>Дата занятия</span><input type="date" name="date" value="${today()}"></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,a.teacherId)}</select></label>
     <label class="f"><span>Занятий списать</span><input type="number" name="qty" value="1" min="1" max="${abLeft(a)}"></label>
   </div>
   <label class="f"><span>Комментарий</span><input name="note" placeholder="тема занятия, замена, опоздание"></label>
  `,async(l)=>{
    const qty=Math.min(abLeft(a),Math.max(1,parseNum(val(l,"qty"))));
    for(let i=0;i<qty;i++)a.visits.push({date:val(l,"date")||today(),teacherId:val(l,"teacherId"),note:val(l,"note")});
    await saveMonth(f.m); toast(qty>1?`Списано занятий: ${qty}`:"Занятие списано");
  },"Списать");
}
function abonCard(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  modal("История абонемента",`
   <div class="hint">${esc(studentName(a.studentId))} · ${esc(a.name)} · продан ${esc(a.date)} · ${money(a.price)} ₽</div>
   ${(a.visits||[]).length?`<div class="tw"><table><thead><tr><th>№</th><th>Дата</th><th>Педагог</th><th>Комментарий</th><th></th></tr></thead><tbody>
   ${a.visits.map((v,i)=>`<tr><td class="n">${i+1}</td><td class="n">${esc(v.date)}</td><td>${esc(teacherName(v.teacherId))}</td><td>${esc(v.note||"")}</td>
   <td class="n"><button class="btn mini danger" data-act="del-visit" data-id="${a.id}" data-i="${i}">Отменить</button></td></tr>`).join("")}
   </tbody></table></div>`:`<div class="hint">Занятия ещё не списывались.</div>`}
  `,null);
  bind(document.getElementById("layer"));
}
async function delVisit(id,i){
  const f=findAbon(id); if(!f)return; f.a.visits.splice(i,1); await saveMonth(f.m); toast("Списание отменено");
  document.getElementById("layer").innerHTML=""; render();
}

/* ============================ импорт выписки ============================ */
const RULES=[
  [/аренд/i,"Арендная плата"],[/субаренд/i,"Субаренда"],[/коммунал|электроэнерг|водоснаб/i,"Коммунальные услуги"],
  [/зарплат|заработн/i,"Зарплата"],[/преми/i,"Премия"],[/отпускн/i,"Отпускные"],
  [/налог|усн/i,"Налоги"],[/страхов|взнос/i,"Отчисления"],[/бухгалт/i,"Оплата услуг бухгалтера"],
  [/ассистент/i,"Оплата услуг ассистента"],[/реклам|директ|таргет/i,"Реклама"],[/маркетинг/i,"Маркетинг"],
  [/дизайн/i,"Дизайнер"],[/питани|обед|продукт/i,"Питание"],[/канцеляр|материал|расходн/i,"Расходные материалы"]
];
function guessArticle(text,type){
  for(const [re,name] of RULES) if(re.test(text)) return name;
  const a=R().articles.find(x=>x.kind===(type==="income"?"income":"expense"));
  return a?a.name:"";
}
function guessStudent(text){
  const t=String(text).toLowerCase();
  const s=S.students.find(st=>{const parts=st.name.toLowerCase().split(/\s+/);return parts.every(p=>p.length>2&&t.includes(p));});
  return s?s.id:"";
}
function importDialog(){
  modal("Загрузка банковской выписки",`
   <div class="hint">Выгрузите операции из интернет-банка в Excel или CSV и выберите файл. Дальше вы сопоставите колонки — приложение подставит статьи по назначению платежа, а вы проверите и подтвердите.</div>
   <label class="f"><span>Файл выписки (.xlsx, .xls, .csv)</span><input type="file" name="file" accept=".xlsx,.xls,.csv"></label>
   <div id="imp-step"></div>
  `,null);
  const l=document.getElementById("layer");
  l.querySelector('[name="file"]').onchange=(e)=>{
    const file=e.target.files[0]; if(!file)return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const wb=XLSX.read(rd.result,{type:"array",cellDates:true});
        const sh=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(sh,{header:1,raw:false,defval:""});
        mapStep(l,rows);
      }catch(err){ l.querySelector("#imp-step").innerHTML=`<div class="warnbox">Не удалось прочитать файл. Сохраните выписку в формате .xlsx или .csv и попробуйте снова.</div>`; }
    };
    rd.readAsArrayBuffer(file);
  };
}
function mapStep(l,rows){
  // ищем строку заголовка: первая строка, где 3+ непустых ячейки
  let hi=rows.findIndex(r=>r.filter(c=>String(c).trim()).length>=3); if(hi<0)hi=0;
  const head=rows[hi].map((c,i)=>String(c).trim()||("Колонка "+(i+1)));
  const body=rows.slice(hi+1).filter(r=>r.some(c=>String(c).trim()));
  const guess=(re,def)=>{const i=head.findIndex(h=>re.test(h));return i<0?def:i;};
  const g={date:guess(/дат/i,0),inc:guess(/приход|кредит|поступ|зачисл/i,-1),exp:guess(/расход|дебет|списан/i,-1),amt:guess(/сумма/i,-1),note:guess(/назначен|описан|коммент/i,-1),cp:guess(/контрагент|плательщик|получател|наименован/i,-1)};
  const sel=(name,cur)=>`<select name="${name}"><option value="-1">— нет —</option>${head.map((h,i)=>`<option value="${i}" ${i===cur?"selected":""}>${esc(h)}</option>`).join("")}</select>`;
  l.querySelector("#imp-step").innerHTML=`
   <div class="hint">Найдено строк: <b>${body.length}</b>. Укажите, где что лежит.</div>
   <div class="grid3" style="margin-top:8px">
     <label class="f"><span>Дата</span>${sel("c_date",g.date)}</label>
     <label class="f"><span>Приход</span>${sel("c_inc",g.inc)}</label>
     <label class="f"><span>Расход</span>${sel("c_exp",g.exp)}</label>
     <label class="f"><span>Сумма (одной колонкой)</span>${sel("c_amt",g.amt)}</label>
     <label class="f"><span>Назначение платежа</span>${sel("c_note",g.note)}</label>
     <label class="f"><span>Контрагент</span>${sel("c_cp",g.cp)}</label>
   </div>
   <div class="row" style="margin-top:10px"><button class="btn primary" id="imp-prev">Показать разнесение</button></div>
   <div id="imp-prev-box"></div>`;
  l.querySelector("#imp-prev").onclick=()=>previewStep(l,body);
}
function toISO(v){
  if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
  const s=String(v).trim();
  let m=s.match(/(\d{2})[.\-\/](\d{2})[.\-\/](\d{4})/); if(m)return `${m[3]}-${m[2]}-${m[1]}`;
  m=s.match(/(\d{4})-(\d{2})-(\d{2})/); if(m)return m[0];
  const n=Number(s); if(n>20000&&n<60000){const d=new Date(Date.UTC(1899,11,30+n));return d.toISOString().slice(0,10);}
  return "";
}
let IMPORT=[];
function previewStep(l,body){
  const c=(n)=>+l.querySelector(`[name="${n}"]`).value;
  const ci={date:c("c_date"),inc:c("c_inc"),exp:c("c_exp"),amt:c("c_amt"),note:c("c_note"),cp:c("c_cp")};
  IMPORT=body.map(r=>{
    const date=toISO(r[ci.date]);
    let inc=ci.inc>=0?parseNum(r[ci.inc]):0, exp=ci.exp>=0?parseNum(r[ci.exp]):0;
    if(ci.amt>=0&&!inc&&!exp){const a=parseNum(r[ci.amt]); if(a>=0)inc=a; else exp=Math.abs(a);}
    const note=[ci.cp>=0?r[ci.cp]:"",ci.note>=0?r[ci.note]:""].filter(x=>String(x).trim()).join(" · ");
    const type=inc>0?"income":"expense", amount=inc>0?inc:exp;
    return {sel:amount>0&&!!date,date,type,amount,note:String(note).slice(0,180),article:guessArticle(note,type),studentId:type==="income"?guessStudent(note):""};
  }).filter(x=>x.amount>0);
  const arts=R().articles;
  l.querySelector("#imp-prev-box").innerHTML=`
   <h3 style="font-size:14px;margin-top:14px">Проверьте разнесение — ${IMPORT.length} строк</h3>
   <div class="tw" style="max-height:340px;overflow:auto"><table><thead><tr><th></th><th>Дата</th><th class="n">Сумма</th><th>Статья</th><th>Ученик</th><th>Назначение</th></tr></thead><tbody>
   ${IMPORT.map((x,i)=>`<tr><td><input type="checkbox" data-imp-sel="${i}" ${x.sel?"checked":""} style="width:auto"></td>
    <td class="n">${esc(x.date)||'<span class="chip warn">нет даты</span>'}</td>
    <td class="n" style="color:var(--${x.type==="income"?"pos":"neg"})">${x.type==="income"?"+":"−"}${money(x.amount)}</td>
    <td><select data-imp-art="${i}" style="min-width:170px">${arts.filter(a=>a.kind===x.type).map(a=>`<option ${a.name===x.article?"selected":""}>${esc(a.name)}</option>`).join("")}</select></td>
    <td><select data-imp-st="${i}" style="min-width:150px">${optId(S.students,x.studentId)}</select></td>
    <td class="hint">${esc(x.note)}</td></tr>`).join("")}
   </tbody></table></div>
   <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn primary" id="imp-go">Загрузить отмеченные</button></div>`;
  l.querySelectorAll("[data-imp-sel]").forEach(el=>el.onchange=()=>IMPORT[+el.dataset.impSel].sel=el.checked);
  l.querySelectorAll("[data-imp-art]").forEach(el=>el.onchange=()=>IMPORT[+el.dataset.impArt].article=el.value);
  l.querySelectorAll("[data-imp-st]").forEach(el=>el.onchange=()=>IMPORT[+el.dataset.impSt].studentId=el.value);
  l.querySelector("#imp-go").onclick=async()=>{
    const rows=IMPORT.filter(x=>x.sel&&x.date);
    if(!rows.length){toast("Нечего загружать: отметьте строки с датой");return;}
    const touched=new Set();
    rows.forEach(x=>{
      const o={id:uid("op"),date:x.date,type:x.type,amount:x.amount,article:x.article,direction:"Без привязки",
        source:R().sources[0]||"",studentId:x.studentId,teacherId:"",subject:"Без привязки",note:x.note,fisc:false,imported:true};
      touched.add(pushOp(o));
    });
    for(const m of touched) await saveMonth(m);
    document.getElementById("layer").innerHTML="";
    toast(`Загружено операций: ${rows.length}`); S.nav="ops"; render();
  };
}

/* ============================ экспорт ============================ */
async function download(filename,blobData){
  try{
    const blob=new Blob([blobData],{type:"application/octet-stream"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1500);
    toast("Файл сохранён в «Загрузки»");
  }catch(e){ console.error(e); toast("Не удалось сохранить файл"); }
}
async function exportOps(){
  const rows=allOps().slice().sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(o=>({
    Дата:o.date,Тип:o.type==="income"?"Доход":"Расход",Сумма:o.amount,Статья:o.article,Направление:o.direction,
    Предмет:o.subject,Ученик:studentName(o.studentId),Педагог:teacherName(o.teacherId),Источник:o.source,Комментарий:o.note,Чек:o.fisc?"да":"нет"}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Операции");
  const out=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  await download(`Операции_Уникум_${S.year}.xlsx`,new Uint8Array(out));
}
async function exportReport(){
  const tbls=[...document.querySelectorAll("#repbody table")]; if(!tbls.length){toast("Отчёт пуст");return;}
  const wb=XLSX.utils.book_new(),used=new Set();
  tbls.forEach((tbl,i)=>{
    const h=tbl.closest("div.tw")&&tbl.closest("div.tw").parentElement.querySelector("h3");
    let n=((h&&h.textContent)||"Отчёт").replace(/[\\\/?*\[\]:]/g," ").slice(0,28).trim()||"Отчёт";
    while(used.has(n))n=n.slice(0,25)+" "+(i+1);
    used.add(n);XLSX.utils.book_append_sheet(wb,XLSX.utils.table_to_sheet(tbl),n);
  });
  const out=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  const names={bdds:"БДДС",bdr:"БДР",abon:"Абонементы",pl:"P&L",ros:"Рентабельность центра",unit:"Рентабельность детально",tax:"Налоги"};
  await download(`${names[S.repTab]}_Уникум_${S.year}.xlsx`,new Uint8Array(out));
}
async function backup(){
  const data={refs:S.refs,students:S.students,teachers:S.teachers,tariffs:S.tariffs,groups:S.groups,
    ops:S.ops,abon:S.abon,lessons:S.lessons,months:S.months,exportedAt:new Date().toISOString()};
  await download(`Резервная_копия_Уникум_${today()}.json`,new TextEncoder().encode(JSON.stringify(data,null,2)));
}

/* ============================ обработчики ============================ */
function bind(root){
  root.querySelectorAll("[data-act]").forEach(el=>{
    const a=el.dataset.act,id=el.dataset.id,i=el.dataset.i;
    if(a==="year"){ el.onchange=()=>{S.year=+el.value;render();}; return; }
    el.onclick=async()=>{
      switch(a){
        case "new-op":newOp(id);break;
        case "edit-op":editOp(id);break;
        case "del-op":if(confirm("Удалить операцию?"))delOp(id);break;
        case "import":importDialog();break;
        case "export-ops":exportOps();break;
        case "export-report":exportReport();break;
        case "new-student":newStudent();break;
        case "edit-student":editStudent(id);break;
        case "student-card":studentCard(id);break;
        case "new-abon":newAbon(id);break;
        case "visit":visitAbon(id);break;
        case "single-lesson":singleLesson();break;
        case "cancel-lesson":if(confirm("Отменить проведение занятия? Списанные занятия вернутся на абонементы."))cancelLesson(id);break;
        case "add-group":addGroup();break;
        case "edit-group":editGroup(id);break;
        case "del-group":if(confirm("Удалить группу? Проведённые занятия сохранятся.")){S.groups=S.groups.filter(x=>x.id!==id);await saveGroups();render();}break;
        case "abon-card":abonCard(id);break;
        case "del-visit":if(confirm("Отменить списание занятия?"))delVisit(id,+i);break;
        case "add-teacher":newTeacher();break;
        case "edit-teacher":editTeacher(id);break;
        case "del-teacher":delTeacher(id);break;
        case "add-tariff":newTariff();break;
        case "edit-tariff":editTariff(id);break;
        case "del-tariff":delTariff(id);break;
        case "sell-tpl":newAbon("",id);break;
        case "tpl-archive":{const t=tariff(id);if(t){t.archived=!t.archived;if(await saveTariffs())toast(t.archived?"Перенесён в архив":"Возвращён в каталог");render();}}break;
        case "toggle-arch":S.arch=S.arch||{};S.arch[id]=!S.arch[id];render();break;
        case "save-par":savePar(root);break;
        case "add-member":inviteMember();break;
        case "del-member":if(confirm("Закрыть доступ для "+id+"? Человек больше не сможет открыть базу центра.")){ if(await removeMember(id)){toast("Доступ закрыт");render();} }break;
      }
    };
  });
}
async function savePar(root){
  const g=(n)=>root.querySelector(`[data-par="${n}"]`).value;
  R().usn=parseNum(g("usn")); R().fixedFee=parseNum(g("fixedFee"));
  await saveRefs(); toast("Параметры сохранены"); render();
}

function inviteMember(){
  modal("Пригласить в программу",`
   <div class="grid2">
     <label class="f"><span>Почта</span><input name="email" type="email" placeholder="client@example.com"></label>
     <label class="f"><span>Имя</span><input name="name" placeholder="Как подписывать в списке"></label>
   </div>
   <div class="hint">После добавления человек открывает ссылку на программу, нажимает «Создать аккаунт», указывает эту почту и придумывает пароль.</div>
  `,async(l)=>{
    const email=val(l,"email"); if(!email||email.indexOf("@")<0){toast("Укажите почту");return false;}
    if(MEMBERS.some(m=>m.email===email.toLowerCase())){toast("Этот адрес уже в списке");return false;}
    if(await addMember(email,val(l,"name"))) toast("Доступ открыт для "+email.toLowerCase());
  },"Открыть доступ");
}

/* ============================ запуск ============================ */
document.getElementById("btn-reload").onclick=reloadAll;
document.getElementById("btn-logout").onclick=doLogout;
document.getElementById("auth-form").onsubmit=async(e)=>{
  e.preventDefault();
  const email=document.getElementById("auth-email").value.trim();
  const pass=document.getElementById("auth-pass").value;
  if(!email||!pass){document.getElementById("auth-msg").textContent="Введите почту и пароль.";document.getElementById("auth-msg").style.display="block";return;}
  document.getElementById("auth-msg").style.display="none";
  await doLogin(email,pass);
};

render();
connect();
