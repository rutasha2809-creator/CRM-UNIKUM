/* ============================ утилиты ============================ */
const MONTHS=["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const MON_SHORT=["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
const uid=(p)=>(crypto.randomUUID?crypto.randomUUID():p+"-"+Math.random().toString(36).slice(2,11));
const money=(v)=>(Math.round((v||0)*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:0});
const moneyR=(v)=>money(v)+" ₽";
const esc=(s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
/* даты — по местному времени пользователя (после полуночи по Москве UTC-дата ещё вчерашняя) */
const localISO=(d)=>{const t=new Date(d.getTime()-d.getTimezoneOffset()*60000);return t.toISOString().slice(0,10);};
const today=()=>localISO(new Date());
const ym=(d)=>String(d||"").slice(0,7);
const parseNum=(v)=>{if(typeof v==="number")return v;const s=String(v??"").replace(/\s| /g,"").replace(",",".").replace(/[^\d.\-]/g,"");const n=parseFloat(s);return isNaN(n)?0:n;};
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2600);}

/* ============================ состояние ============================ */
const S={
  ro:false, refs:null, students:[], teachers:[], tariffs:[], groups:[],
  ops:{},      // "2026-09" -> [операции]
  abon:{},     // "2026-09" -> [абонементы]
  lessons:{},  // "2026-09" -> [проведённые занятия]
  months:[],   // индекс месяцев с данными
  nav:"dash", db:null, ready:false, year:new Date().getFullYear(),
  stQ:"", opFilter:{month:"", type:"", q:""}, repTab:"bdds", lesDate:localISO(new Date()), lesTab:"week"
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
/* пропуски: занятие не состоялось по причине, которая переносит его в стоимость следующего абонемента (carry), либо сгорает (без предупреждения) */
const ABS_REASONS=[
  {k:"center",t:"Центр или педагог",carry:true},
  {k:"early",t:"Ученик заранее",carry:true},
  {k:"valid",t:"Уважительная причина",carry:true},
  {k:"late",t:"Ученик без предупреждения",carry:false}
];
const absReason=(k)=>ABS_REASONS.find(r=>r.k===k)||ABS_REASONS[0];
const abAbsences=(a)=>a.absences||[];
const abApplied=(a)=>abAbsences(a).filter(x=>x.carry&&x.usedIn).length;               // перенесено в другие абонементы
const abPending=(a)=>abAbsences(a).filter(x=>x.carry&&!x.usedIn).length;              // ждут следующего абонемента
const abUnused=(a)=>Math.max(0,(a.lessons||0)-((a.visits||[]).length)-abApplied(a));   // не использовано занятий (в т.ч. по закрытому)
const abFree=(a)=>Math.max(0,abUnused(a)-abPending(a));                               // свободно для занятий: без ожидающих переноса
const abLeft=(a)=>a.closedAt?0:abFree(a);                                             // доступно к списанию
const abPrice=(a)=>a.lessons?((a.price||0)+(a.carryValue||0))/a.lessons:(a.price||0);  // стоимость занятия с учётом перенесённых занятий
const abExpired=(a,onDate)=>!!(!a.closedAt&&a.until&&a.until<(onDate||today())&&abFree(a)>0);
const abLive=(a,onDate)=>abLeft(a)>0&&!abExpired(a,onDate);                           // действующий: есть остаток и срок не истёк
const abDebtSum=(a)=>(abLive(a)?abLeft(a):0)*abPrice(a)+(a.closedAt?0:abPending(a))*abPrice(a); // обязательство центра перед учеником
/* перенесённые занятия ученика, которые ещё не учтены в новом абонементе */
const carryAvail=(studentId)=>allAbon().filter(a=>a.studentId===studentId&&!a.closedAt)
  .flatMap(a=>abAbsences(a).filter(x=>x.carry&&!x.usedIn).map(x=>({a,x}))).sort((p,q)=>(p.x.date||"").localeCompare(q.x.date||""));
const abPaid=(a)=>allOps().filter(o=>o.abonId===a.id&&o.type==="income").reduce((s,o)=>s+o.amount,0);
const abOwed=(a)=>Math.max(0,(a.price||0)-abPaid(a));                                 // долг ученика по оплате
/* остаток, который не будет отработан: срок истёк или абонемент закрыт — признаётся выручкой центра в этот день */
function abBreak(a){
  if(a.closedAt){const left=abUnused(a); if(!left)return null; const val=left*abPrice(a); return {date:a.closedAt,amount:Math.max(0,val-(a.refund||0)),val,kind:"closed"};}
  if(abExpired(a)){const left=abFree(a),val=left*abPrice(a); return {date:a.until,amount:val,val,kind:"expired"};}
  return null;
}
/* пропуск с переносом: занятие остаётся на абонементе и вычитается из стоимости следующего. Возвращает месяц абонемента, "dup" или null (нет абонемента) */
function addAbsence({studentId,date,reasonKey,groupId,group,direction,subject,whole,note}){
  const ab=pickAbon(studentId,direction,date,subject); if(!ab)return null;
  const gid=groupId||"";
  if(abAbsences(ab).some(x=>x.date===date&&(x.groupId||"")===gid&&(gid||x.note===(note||""))))return "dup";
  (ab.absences=ab.absences||[]).push({id:uid("abs"),date,reason:reasonKey,carry:true,groupId:gid,group:group||"",whole:!!whole,note:note||"",usedIn:""});
  const f=findAbon(ab.id); return f?f.m:null;
}
const wholeAbsences=(gid,date)=>allAbon().flatMap(a=>abAbsences(a).filter(x=>x.whole&&x.groupId===gid&&x.date===date).map(x=>({a,x})));
/* активный абонемент ученика на дату: не просрочен, есть остаток, приоритет — совпадение направления, затем самый ранний */
function pickAbon(studentId,direction,onDate,subject){
  const list=allAbon().filter(a=>a.studentId===studentId&&abLeft(a)>0&&!abExpired(a,onDate)&&(a.date||"")<=(onDate||today()));
  if(!list.length)return null;
  let same=list.filter(a=>direction&&a.direction===direction);
  /* внутри направления: сначала абонемент именно по этому предмету, затем «Единый» или без предмета, затем любой */
  if(same.length>1&&subject){
    const exact=same.filter(a=>a.subject===subject);
    const shared=same.filter(a=>!a.subject||a.subject==="Единый"||a.subject==="Без привязки");
    same=exact.length?exact:(shared.length?shared:same);
  }
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
const rowTeacher = (r) => ({ id: r.id, name: r.name, subject: r.subject || "", phone: r.phone || "", rate: +r.rate || 0, payType: r.pay_type === "percent" ? "percent" : "rate", payPercent: +r.pay_percent || 0, archived: !!r.archived });
const outTeacher = (t) => ({ id: t.id, name: t.name, subject: t.subject || "", phone: t.phone || "", rate: +t.rate || 0, pay_type: t.payType === "percent" ? "percent" : "rate", pay_percent: +t.payPercent || 0, archived: !!t.archived });
const rowTariff = (r) => ({ id: r.id, name: r.name, lessons: r.lessons, price: +r.price || 0, validDays: r.valid_days || 0, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", format: r.format || "", article: r.article || "", note: r.note || "", archived: !!r.archived });
const outTariff = (t) => ({ id: t.id, name: t.name, lessons: t.lessons || 1, price: +t.price || 0, valid_days: t.validDays || null, direction: t.direction || "", subject: t.subject || "", teacher_id: t.teacherId || null, format: t.format || "", article: t.article || "", note: t.note || "", archived: !!t.archived });
const rowGroup = (r) => ({ id: r.id, name: r.name, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", time: r.time || "", days: r.days || [], studentIds: r.student_ids || [] });
const outGroup = (g) => ({ id: g.id, name: g.name, direction: g.direction || "", subject: g.subject || "", teacher_id: g.teacherId || null, time: g.time || "", days: g.days || [], student_ids: g.studentIds || [] });
const rowOp = (r) => ({ id: r.id, date: r.date, type: r.type, amount: +r.amount || 0, article: r.article || "", direction: r.direction || "", subject: r.subject || "", source: r.source || "", studentId: r.student_id || "", teacherId: r.teacher_id || "", abonId: r.abon_id || "", note: r.note || "", fisc: !!r.fisc, imported: !!r.imported });
const outOp = (o) => ({ id: o.id, date: o.date, type: o.type, amount: +o.amount || 0, article: o.article || "", direction: o.direction || "", subject: o.subject || "", source: o.source || "", student_id: o.studentId || null, teacher_id: o.teacherId || null, abon_id: o.abonId || null, note: o.note || "", fisc: !!o.fisc, imported: !!o.imported });
const rowAbon = (r) => ({ id: r.id, date: r.date, studentId: r.student_id || "", tariffId: r.tariff_id || "", name: r.name, lessons: r.lessons, price: +r.price || 0, direction: r.direction || "", subject: r.subject || "", teacherId: r.teacher_id || "", until: r.until || "", format: r.format || "", listPrice: r.list_price == null ? null : +r.list_price, note: r.note || "", closedAt: r.closed_at || "", refund: +r.refund || 0, absences: Array.isArray(r.absences) ? r.absences : [], carryValue: +r.carry_value || 0, carryFrom: Array.isArray(r.carry_from) ? r.carry_from : [], visits: [] });
const outAbon = (a) => ({ id: a.id, date: a.date, student_id: a.studentId || null, tariff_id: a.tariffId || null, name: a.name, lessons: a.lessons || 1, price: +a.price || 0, direction: a.direction || "", subject: a.subject || "", teacher_id: a.teacherId || null, until: a.until || null, format: a.format || "", list_price: a.listPrice == null ? null : +a.listPrice, note: a.note || "", closed_at: a.closedAt || null, refund: +a.refund || 0, absences: a.absences || [], carry_value: +a.carryValue || 0, carry_from: a.carryFrom || [] });
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
  const me = data.find(m => m.email === String(email).toLowerCase());
  S.ro = !!me && me.role === "viewer";
  document.body.classList.toggle("ro", S.ro);
  hideAuth();
  document.getElementById("dbstate").textContent = email + (S.ro ? " · только просмотр" : "");
  const bar = document.querySelector(".topbar");
  const chip = bar && bar.querySelector(".rochip");
  if (S.ro && bar && !chip) {
    const c = document.createElement("span");
    c.className = "chip warn rochip"; c.textContent = "Только просмотр";
    bar.insertBefore(c, bar.querySelector(".menuwrap"));
  } else if (!S.ro && chip) chip.remove();
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
    articles: (art.data || []).map(a => ({ name: a.name, kind: a.kind, nature: a.nature, inBdr: a.in_bdr !== false, inTax: a.in_tax !== false })),
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

/* режим просмотра: наблюдатель видит всё, но ничего не меняет (запрет продублирован на сервере) */
const roStop = () => { if (S.ro) { toast("Режим просмотра: изменения не сохраняются"); return true; } return false; };

/* --- запись справочников --- */
async function saveRefs() {
  if (roStop()) return false;
  const r = R();
  const e1 = (await SB.from("un_settings").upsert({
    id: 1, usn: r.usn, fixed_fee: r.fixedFee, sources: r.sources, subjects: r.subjects, pl_groups: r.groups, updated_at: new Date().toISOString()
  })).error;
  /* сначала записываем новые значения, и только потом убираем лишние — обрыв связи не стирает справочник */
  const e2 = (await SB.from("un_articles").upsert(r.articles.map((a, i) => ({ name: a.name, kind: a.kind, nature: a.nature || "var", in_bdr: a.inBdr !== false, in_tax: a.inTax !== false, sort: i })), { onConflict: "name" })).error;
  const e3 = (await SB.from("un_directions").upsert(r.directions.map((d, i) => ({ name: d.name, pl_group: d.group || "Без привязки", sort: i })), { onConflict: "name" })).error;
  const err0 = e1 || e2 || e3; if (err0) { sbErr(err0, "справочники"); return false; }
  const e4 = (await SB.from("un_articles").delete().not("name", "in", inList(r.articles.map(a => a.name)))).error;
  const e5 = (await SB.from("un_directions").delete().not("name", "in", inList(r.directions.map(d => d.name)))).error;
  const err = e4 || e5; if (err) { sbErr(err, "справочники (удаление)"); return false; }
  return true;
}
const inList = (arr) => "(" + arr.map(x => '"' + String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + ")";
/* удаления помним явно: сохранение не стирает то, что добавили с другого устройства */
const DEL = {};
const markDel = (table, id) => { (DEL[table] = DEL[table] || []).push(id); };
async function flushDel(table) {
  const ids = DEL[table] || []; if (!ids.length) return true;
  const { error } = await SB.from(table).delete().in("id", ids);
  if (error) { sbErr(error, table + " (удаление)"); return false; }
  DEL[table] = []; return true;
}
async function syncList(table, items, mapOut) {
  if (items.length) {
    const { error } = await SB.from(table).upsert(items.map(mapOut));
    if (error) { sbErr(error, table); return false; }
  }
  return flushDel(table);
}
const saveStudents = () => roStop() ? false : syncList("un_students", S.students, outStudent);
const saveTeachers = () => roStop() ? false : syncList("un_teachers", S.teachers, outTeacher);
const saveTariffs = () => roStop() ? false : syncList("un_tariffs", S.tariffs, outTariff);
const saveGroups = () => roStop() ? false : syncList("un_groups", S.groups, outGroup);

/* --- запись данных месяца --- */
async function syncMonthTable(table, month, items, mapOut) {
  if (S.ro) return false;
  const from = monthStart(month), to = monthEnd(month);
  if (items.length) {
    const { error } = await SB.from(table).upsert(items.map(mapOut));
    if (error) { sbErr(error, table); return false; }
  }
  return flushDel(table);
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
  if (roStop()) return false;
  ensureMonth(m);
  let ok = await syncMonthTable("un_abon", m, S.abon[m], outAbon);
  for (const a of S.abon[m]) { if (!(await syncVisits(a))) ok = false; }
  if (!(await syncMonthTable("un_lessons", m, S.lessons[m], outLesson))) ok = false;
  if (!(await syncMonthTable("un_ops", m, S.ops[m], outOp))) ok = false;
  return ok;
}

/* --- доступ пользователей --- */
async function addMember(email, name, role) {
  if (roStop()) return false;
  const m = { email: email.trim().toLowerCase(), name: name || "", role: role === "viewer" ? "viewer" : "owner" };
  const { error } = await SB.from("un_members").insert(m);
  if (error) { sbErr(error, "доступ"); return false; }
  MEMBERS.push(m);
  return true;
}
async function setMemberRole(email, role) {
  if (roStop()) return false;
  const { error } = await SB.from("un_members").update({ role }).eq("email", email);
  if (error) { sbErr(error, "доступ"); return false; }
  const m = MEMBERS.find(x => x.email === email); if (m) m.role = role;
  return true;
}
async function removeMember(email) {
  if (roStop()) return false;
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
const plural=(n,a)=>{const m=Math.abs(n)%100,d=m%10;return n+" "+(m>10&&m<20?a[2]:d===1?a[0]:d>1&&d<5?a[1]:a[2]);};
const ico=(n,cls)=>`<svg class="${cls||""}"><use href="#i-${n}"/></svg>`;

/* --- меню «Создать» --- */
(function(){
  const btn=document.getElementById("btn-create"),menu=document.getElementById("create-menu");
  if(!btn)return;
  const hide=()=>{menu.style.display="none";};
  btn.onclick=(e)=>{e.stopPropagation();menu.style.display=menu.style.display==="none"?"":"none";};
  document.addEventListener("click",hide);
  menu.onclick=(e)=>e.stopPropagation();
  menu.querySelectorAll("[data-create]").forEach(b=>b.onclick=()=>{
    hide();
    ({op:()=>newOp(),abon:()=>newAbon(),student:()=>newStudent(),lesson:()=>singleLesson()})[b.dataset.create]();
  });
})();

/* --- поиск по всей базе --- */
function globalHits(q){
  q=q.trim().toLowerCase(); if(q.length<2)return [];
  const has=(...xs)=>xs.filter(Boolean).join(" ").toLowerCase().includes(q);
  const out=[];
  S.students.filter(s=>has(s.name,s.parent,s.phone)).slice(0,6).forEach(s=>{
    const ab=allAbon().filter(a=>a.studentId===s.id),left=ab.reduce((n,a)=>n+(abLive(a)?abLeft(a):0),0);
    out.push({g:"Ученики",t:s.name,m:left?left+" зан. в остатке":(s.direction||""),run:()=>studentCard(s.id)});
  });
  allAbon().filter(a=>has(a.name,studentName(a.studentId),a.direction,a.subject)).slice(0,6).forEach(a=>
    out.push({g:"Абонементы",t:studentName(a.studentId)+" · "+a.name,m:abState(a).t,run:()=>abonCard(a.id)}));
  S.teachers.filter(t=>has(t.name,t.subject,t.phone)).slice(0,4).forEach(t=>
    out.push({g:"Педагоги",t:t.name,m:t.subject||"",run:()=>{S.nav="nsi";S.nsiTab="teachers";S.nsiGlobal=null;render();}}));
  tplList(true).filter(t=>has(t.name,t.direction,t.subject)).slice(0,4).forEach(t=>
    out.push({g:"Тарифы",t:t.name,m:money(t.price)+" ₽",run:()=>newAbon("",t.id)}));
  allOps().filter(o=>has(o.article,o.note,studentName(o.studentId),o.source)).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,6).forEach(o=>
    out.push({g:"Операции",t:o.article+(o.note?" · "+o.note:""),m:o.date+" · "+(o.type==="income"?"+":"−")+money(o.amount),run:()=>editOp(o.id)}));
  return out;
}
(function(){
  const inp=document.getElementById("g-q"),box=document.getElementById("g-res");
  if(!inp)return;
  let hits=[],cur=-1;
  const close=()=>{box.style.display="none";cur=-1;};
  const paint=()=>{
    hits=globalHits(inp.value);
    if(!hits.length){box.innerHTML=inp.value.trim().length>=2?`<div class="gk">Ничего не нашлось</div>`:"";box.style.display=inp.value.trim().length>=2?"":"none";return;}
    let last="",h="";
    hits.forEach((x,i)=>{
      if(x.g!==last){h+=`<div class="gk">${x.g}</div>`;last=x.g;}
      h+=`<button data-i="${i}" class="${i===cur?"cur":""}">${esc(x.t)}<span class="gm">${esc(x.m||"")}</span></button>`;
    });
    box.innerHTML=h;box.style.display="";
    box.querySelectorAll("[data-i]").forEach(b=>b.onclick=()=>{close();inp.value="";hits[+b.dataset.i].run();});
  };
  inp.oninput=paint;
  inp.onfocus=()=>{if(inp.value.trim().length>=2)paint();};
  inp.onkeydown=(e)=>{
    if(e.key==="Escape"){close();inp.blur();return;}
    if(!hits.length)return;
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();cur=(cur+(e.key==="ArrowDown"?1:hits.length-1))%hits.length;paint();}
    else if(e.key==="Enter"&&cur>=0){e.preventDefault();const r=hits[cur].run;close();inp.value="";r();}
  };
  document.addEventListener("click",(e)=>{if(!e.target.closest(".gsearch"))close();});
  document.addEventListener("keydown",(e)=>{
    if((e.ctrlKey||e.metaKey)&&e.key==="k"){e.preventDefault();inp.focus();inp.select();}
  });
})();

/* --- сортировка таблиц по клику на заголовок --- */
const sortKey=(td)=>{
  const raw=(td.dataset.v!==undefined?td.dataset.v:td.textContent).trim();
  const n=raw.replace(/\s|\u00a0/g,"").replace("−","-").replace(",",".");
  return /^-?\d+(\.\d+)?$/.test(n)?+n:raw.toLowerCase();
};
function bindSort(root){
  root.querySelectorAll("th[data-sort]").forEach(th=>{
    th.onclick=()=>{
      const tb=th.closest("table").tBodies[0]; if(!tb)return;
      const i=[...th.parentNode.children].indexOf(th);
      const dir=th.classList.contains("asc")?-1:1;
      [...th.parentNode.children].forEach(x=>x.classList.remove("asc","desc"));
      th.classList.add(dir>0?"asc":"desc");
      [...tb.rows].map(r=>[sortKey(r.cells[i]),r])
        .sort((a,b)=>(typeof a[0]==="number"&&typeof b[0]==="number"?a[0]-b[0]:String(a[0]).localeCompare(String(b[0]),"ru"))*dir)
        .forEach(([,r])=>tb.appendChild(r));
    };
  });
}

function render(){
  document.querySelectorAll("[data-nav]").forEach(b=>b.classList.toggle("on",b.dataset.nav===S.nav));
  document.getElementById("cnt-students").textContent=S.students.filter(s=>!s.archived).length||"";
  document.getElementById("cnt-abon").textContent=allAbon().filter(a=>abLive(a)).length||"";
  document.getElementById("cnt-ops").textContent=allOps().length||"";
  document.getElementById("cnt-lessons").textContent=allLessons().length||"";
  const v=document.getElementById("view");
  if(!S.ready){ v.innerHTML='<div class="panel"><div class="empty">Загружаю данные центра…</div></div>'; return; }
  ({dash:viewDash,students:viewStudents,lessons:viewLessons,abon:viewAbon,ops:viewOps,reports:viewReports,nsi:viewNsi}[S.nav])(v);
  bindSort(v);
  if(S.ro){
    v.querySelectorAll("[data-conduct],[data-gcancel],[data-gundo],[data-save]").forEach(e=>e.remove());
    v.querySelectorAll("input[data-att],select[data-abs],[data-par]").forEach(e=>{e.disabled=true;});
  }
}

/* ============================ дашборд ============================ */
const pct=(a,b)=>b?Math.round((a-b)/Math.abs(b)*100):null;
function deltaChip(a,b,inverse){
  const d=pct(a,b); if(d===null||!isFinite(d))return `<span class="delta flat">нет данных за прошлый месяц</span>`;
  const good=inverse?d<=0:d>=0;
  const cls=d===0?"flat":(good?"up":"down");
  return `<span class="delta ${cls}">${d>0?"▲":d<0?"▼":"="} ${Math.abs(d)}% к прошлому месяцу</span>`;
}
function viewDash(v){
  const y=S.year, ops=opsOfYear(y);
  const inc=ops.filter(o=>o.type==="income").reduce((s,o)=>s+o.amount,0);
  const exp=ops.filter(o=>o.type==="expense").reduce((s,o)=>s+o.amount,0);
  const live=allAbon().filter(a=>abLive(a));
  const lessonsLeft=live.reduce((s,a)=>s+abLeft(a),0);
  const debt=allAbon().reduce((s,a)=>s+abDebtSum(a),0);
  const owedList=allAbon().filter(a=>abOwed(a)>0).sort((a,b)=>abOwed(b)-abOwed(a));
  const owed=owedList.reduce((s,a)=>s+abOwed(a),0);
  const m=today().slice(0,7), pm=ym(addDays(m+"-01",-1));
  const mOps=(k,t)=>(S.ops[k]||[]).filter(o=>o.type===t).reduce((s,o)=>s+o.amount,0);
  const visitsIn=(k)=>allAbon().reduce((s,a)=>s+(a.visits||[]).filter(x=>ym(x.date)===k).length,0);
  const byMonth=Array.from({length:12},(_,i)=>{
    const k=y+"-"+String(i+1).padStart(2,"0");
    return {i,k,inc:mOps(k,"income"),exp:mOps(k,"expense")};
  });

  /* точки внимания */
  const attn=[];
  allAbon().filter(a=>abExpired(a)).sort((a,b)=>(a.until||"").localeCompare(b.until||"")).slice(0,4).forEach(a=>
    attn.push({ic:"n",t:studentName(a.studentId)||a.name,d:`Срок истёк ${a.until}, не отработано ${abFree(a)} зан.`,b:"Продлить",act:"abon-extend",id:a.id}));
  owedList.slice(0,4).forEach(a=>
    attn.push({ic:"n",t:studentName(a.studentId)||a.name,d:`Долг по абонементу «${a.name}» — ${money(abOwed(a))} ₽`,b:"Принять оплату",act:"abon-pay",id:a.id}));
  live.filter(a=>abLeft(a)<=2).sort((a,b)=>abLeft(a)-abLeft(b)).slice(0,5).forEach(a=>
    attn.push({ic:"w",t:studentName(a.studentId)||a.name,d:`Осталось ${abLeft(a)} из ${a.lessons} зан. — пора продлевать`,b:"Продать ещё",act:"abon-renew",id:a.id}));
  allAbon().filter(a=>abPending(a)>0).slice(0,4).forEach(a=>
    attn.push({ic:"a",t:studentName(a.studentId)||a.name,d:`Перенос ${abPending(a)} зан. — учтётся в следующем абонементе`,b:"Карточка",act:"abon-card",id:a.id}));

  const d=today(), wd=wdOf(d);
  const todayGroups=S.groups.filter(g=>(g.days||[]).includes(wd));
  const doneToday=new Set(lessonsOn(d).map(l=>l.groupId).filter(Boolean));

  v.innerHTML=`
  <div class="head">
    <div><h1>Дашборд</h1><p>Деньги, абонементы и точки внимания за ${y} год.</p></div>
    <div class="tools">${yearSelect()}<button class="btn" data-nav2="reports">Все отчёты</button><button class="btn primary" data-act="new-op">Новая операция</button></div>
  </div>
  <div class="stack">
    <div class="stats" style="--cols:${statCols(8)}">
      <div class="stat"><span class="k">Поступления</span><span class="v pos num">${money(inc)}</span>${deltaChip(mOps(m,"income"),mOps(pm,"income"))}</div>
      <div class="stat"><span class="k">Платежи</span><span class="v neg num">${money(exp)}</span>${deltaChip(mOps(m,"expense"),mOps(pm,"expense"),true)}</div>
      <div class="stat"><span class="k">Сальдо за год</span><span class="v num ${inc-exp>=0?"pos":"neg"}">${money(inc-exp)}</span><span class="n">поступления минус платежи</span></div>
      <div class="stat"><span class="k">Занятий в месяце</span><span class="v num">${visitsIn(m)}</span>${deltaChip(visitsIn(m),visitsIn(pm))}</div>
      <div class="stat"><span class="k">Не отработано</span><span class="v num">${lessonsLeft} зан.</span><span class="n">${live.length} действующих абонементов</span></div>
      <div class="stat"><span class="k">Обязательства</span><span class="v num">${money(debt)}</span><span class="n">аванс к отработке</span></div>
      <div class="stat"><span class="k">Долг учеников</span><span class="v num ${owed?"neg":""}">${money(owed)}</span><span class="n">${owedN(owedList)}</span></div>
      <div class="stat"><span class="k">Занятий сегодня</span><span class="v num">${todayGroups.length}</span><span class="n">${doneToday.size} уже проведено</span></div>
    </div>

    <div class="panel">
      <header><h2>Поступления и платежи</h2><span class="sub">${y} год, по кассе</span></header>
      <div class="pad">${barChart(byMonth)}</div>
    </div>

    <div class="grid2" style="align-items:start">
      <div class="panel">
        <header><h2>Требует внимания</h2><span class="sub">${attn.length?attn.length+" записей":"всё в порядке"}</span></header>
        ${attn.length?`<div class="attn">${attn.slice(0,9).map(x=>`
          <div class="attn-row">
            <span class="ic ${x.ic}">${x.ic==="n"?"!":x.ic==="w"?"•":"↻"}</span>
            <span class="tx"><b>${esc(x.t)}</b><div>${esc(x.d)}</div></span>
            <button class="btn mini" data-act="${x.act}" data-id="${x.id}">${x.b}</button>
          </div>`).join("")}</div>`
          :`<div class="empty"><b>Ничего не горит</b>Долгов, просроченных абонементов и остатков на исходе нет.</div>`}
      </div>
      <div class="panel">
        <header><h2>Сегодня, ${esc(WD[wd])}</h2><span class="sub">${esc(d)}</span></header>
        ${todayGroups.length?`<div class="attn">${todayGroups.map(g=>`
          <div class="attn-row">
            <span class="ic a">${esc((g.time||"—").slice(0,2))}</span>
            <span class="tx"><b>${esc(g.name)}</b><div>${esc([g.time,teacherName(g.teacherId),(g.studentIds||[]).length+" уч."].filter(Boolean).join(" · "))}</div></span>
            ${doneToday.has(g.id)?`<span class="chip in">проведено</span>`:`<button class="btn mini primary" data-nav2="lessons">Открыть журнал</button>`}
          </div>`).join("")}</div>`
          :`<div class="empty"><b>На сегодня групп нет</b>Расписание задаётся во вкладке «Группы».</div>`}
      </div>
    </div>

    <div class="panel">
      <header><h2>Последние операции</h2><span class="sub">10 записей</span><button class="btn mini" data-nav2="ops" style="margin-left:auto">Все операции</button></header>
      ${lastOpsTable(10)}
    </div>
  </div>`;
  bind(v);
  v.querySelectorAll("[data-nav2]").forEach(b=>b.onclick=()=>{S.nav=b.dataset.nav2;render();});
}
const statCols=(n)=>[4,3,2].find(c=>n%c===0)||4;
const owedN=(list)=>list.length?`абонементов с долгом: ${list.length}`:"долгов нет";
function barChart(rows){
  const max=Math.max(1,...rows.map(r=>Math.max(r.inc,r.exp)));
  const W=960,H=210,pad={l:62,r:10,t:12,b:40},bw=(W-pad.l-pad.r)/12;
  const y=(val)=>pad.t+(H-pad.t-pad.b)*(1-val/max);
  const ticks=[0,.25,.5,.75,1].map(f=>({v:max*f,y:y(max*f)}));
  const cur=ym(today());
  return `<div class="tw"><svg viewBox="0 0 ${W} ${H}" style="width:100%;min-width:620px;height:${H}px" role="img" aria-label="Поступления и платежи по месяцам">
  ${ticks.map(t=>`<g><line x1="${pad.l}" x2="${W-pad.r}" y1="${t.y}" y2="${t.y}" stroke="var(--line-soft)"/><text x="${pad.l-8}" y="${t.y+4}" text-anchor="end" font-size="10.5" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">${money(t.v)}</text></g>`).join("")}
  ${rows.map(r=>{const x=pad.l+r.i*bw,h1=Math.max(0,y(0)-y(r.inc)),h2=Math.max(0,y(0)-y(r.exp));return `<g>
    ${r.k===cur?`<rect x="${x+1}" y="${pad.t}" width="${bw-2}" height="${y(0)-pad.t}" fill="var(--surface-2)" rx="4"/>`:""}
    <rect x="${x+bw*0.17}" y="${y(r.inc)}" width="${bw*0.29}" height="${h1}" fill="var(--accent)" rx="2"><title>${MON_SHORT[r.i]}: поступления ${money(r.inc)} ₽</title></rect>
    <rect x="${x+bw*0.52}" y="${y(r.exp)}" width="${bw*0.29}" height="${h2}" fill="var(--neg)" opacity=".8" rx="2"><title>${MON_SHORT[r.i]}: платежи ${money(r.exp)} ₽</title></rect>
    <text x="${x+bw/2}" y="${H-24}" text-anchor="middle" font-size="11" fill="${r.k===cur?"var(--ink)":"var(--ink-3)"}" font-weight="${r.k===cur?600:400}">${MON_SHORT[r.i]}</text>
    <text x="${x+bw/2}" y="${H-10}" text-anchor="middle" font-size="10" fill="var(--ink-3)" font-family="IBM Plex Mono,monospace">${r.inc||r.exp?money(r.inc-r.exp):""}</text></g>`;}).join("")}
  <line x1="${pad.l}" x2="${W-pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>
  </svg></div>
  <div class="row" style="gap:16px;margin-top:4px"><span class="hint"><span style="display:inline-block;width:9px;height:9px;background:var(--accent);border-radius:2px"></span> поступления</span><span class="hint"><span style="display:inline-block;width:9px;height:9px;background:var(--neg);opacity:.8;border-radius:2px"></span> платежи</span><span class="hint">под месяцем — сальдо</span></div>`;
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
const initials=(n)=>(n||"?").trim().split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase();
const avaCls=(n)=>["","g2","g3","g4"][[...(n||"?")].reduce((a,c)=>a+c.charCodeAt(0),0)%4];
const ava=(n)=>`<span class="ava ${avaCls(n)}">${esc(initials(n))}</span>`;
function viewStudents(v){
  const archN=S.students.filter(s=>s.archived).length;
  const q=(S.stQ||"").trim().toLowerCase();
  const all=S.students.filter(s=>showArch("students")||!s.archived);
  const rows=all.filter(s=>!q||[s.name,s.parent,s.phone,s.direction].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  const stat=(s)=>{
    const ab=allAbon().filter(a=>a.studentId===s.id);
    const left=ab.reduce((n,a)=>n+(abLive(a)?abLeft(a):0),0);
    const owe=ab.reduce((n,a)=>n+abOwed(a),0);
    const paid=allOps().filter(o=>o.studentId===s.id&&o.type==="income").reduce((n,o)=>n+o.amount,0);
    const lastV=ab.flatMap(a=>(a.visits||[]).map(x=>x.date)).sort().pop()||"";
    return {ab,left,owe,paid,lastV,live:ab.filter(a=>abLive(a))};
  };
  v.innerHTML=`
  <div class="head"><div><h1>Ученики</h1><p>Абонемент, списание занятия и карточка — прямо из строки.</p></div>
  <div class="tools">
    <input type="search" id="st-q" placeholder="Поиск по имени, родителю, телефону" value="${esc(S.stQ||"")}" style="width:250px" autocomplete="off">
    ${archN?`<button class="btn" data-act="toggle-arch" data-id="students">${showArch("students")?"Скрыть архив":"Показать архив"} (${archN})</button>`:""}
    <button class="btn primary" data-act="new-student">Добавить ученика</button></div></div>
  <div class="panel">
    <header><h2>${rows.length===all.length?plural(rows.length,["ученик","ученика","учеников"]):rows.length+" из "+all.length}</h2>
      <span class="sub">остаток занятий — по действующим абонементам</span></header>
    ${rows.length?`<div class="tw"><table><thead><tr>
      <th data-sort style="min-width:196px">Ученик</th><th data-sort>Направление</th><th>Контакт</th>
      <th class="n" data-sort>Оплачено</th><th class="n" data-sort>Долг</th><th class="n" data-sort>Остаток</th>
      <th data-sort>Последнее занятие</th><th></th></tr></thead><tbody>
    ${rows.map(s=>{const x=stat(s);
      return `<tr><td data-v="${esc(s.name)}"><span class="who2">${ava(s.name)}<span style="min-width:0">
        <b>${esc(s.name)}</b>${s.archived?' <span class="chip mut">архив</span>':""}
        ${s.parent?`<div class="hint">${esc(s.parent)}</div>`:""}</span></span></td>
      <td>${esc(s.direction||"—")}</td><td class="hint">${esc(s.phone||"—")}</td>
      <td class="n">${money(x.paid)}</td>
      <td class="n" data-v="${x.owe}">${x.owe?`<span class="chip out">${money(x.owe)}</span>`:`<span class="hint">—</span>`}</td>
      <td class="n" data-v="${x.left}">${x.left?`<span class="chip ${x.left<=2?"warn":"in"}">${x.left} зан.</span>`:`<span class="chip mut">нет</span>`}</td>
      <td class="n hint">${esc(x.lastV||"—")}</td>
      <td class="act">
        ${x.live.length?`<button class="btn mini" data-act="visit" data-id="${x.live[0].id}">Списать</button> `:""}
        <button class="btn mini" data-act="new-abon" data-id="${s.id}">Абонемент</button>
        <button class="btn mini" data-act="student-card" data-id="${s.id}">Карточка</button>
        <button class="btn mini" data-act="edit-student" data-id="${s.id}">Изменить</button></td></tr>`;
    }).join("")}
    </tbody></table></div>`:`<div class="empty"><b>${all.length?"Под поиск никто не попал":"Список учеников пуст"}</b>${all.length?"Измените запрос или очистите поле поиска.":"Добавьте первого ученика — дальше можно продавать абонементы и вести занятия."}${all.length?"":`<div><button class="btn primary" data-act="new-student">Добавить ученика</button></div>`}</div>`}
  </div>`;
  bind(v);
  const si=v.querySelector("#st-q");
  if(si)si.oninput=()=>{S.stQ=si.value;const pos=si.selectionStart;render();const n=document.getElementById("st-q");if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(e){}}};
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
  <div class="head"><div><h1>Расписание</h1><p>${S.lesTab==="week"?"Неделя центра: запланированные, проведённые и отменённые занятия.":"Отметьте присутствующих и проведите занятие — оно спишется с абонемента каждого отмеченного ученика."}</p></div>
  <div class="tools">
    <div class="seg">
      <button class="${S.lesTab==="week"?"on":""}" data-les="week">Неделя</button>
      <button class="${S.lesTab==="journal"?"on":""}" data-les="journal">Журнал дня</button>
      <button class="${S.lesTab==="groups"?"on":""}" data-les="groups">Группы</button>
      <button class="${S.lesTab==="history"?"on":""}" data-les="history">История</button>
    </div>
    <button class="btn" data-act="single-lesson">Индивидуальное занятие</button>
  </div></div>`;

  if(S.lesTab==="week"){ v.innerHTML+=weekBlock(); bind(v); bindLesTabs(v); bindWeek(v); return; }
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
      ${scheduled.length?`<div class="pad stack">${scheduled.map(g=>groupCard(g,d,doneGroups.has(g.id),wholeAbsences(g.id,d).length>0)).join("")}</div>`
        :`<div class="empty">На ${WD[wd]} групп в расписании нет. Задайте дни занятий во вкладке «Группы» или проведите занятие из списка ниже.</div>`}
    </div>

    ${others.length?`<div class="panel"><header><h2>Остальные группы</h2><span class="sub">не по расписанию — можно провести вручную</span></header>
      <div class="pad stack">${others.map(g=>groupCard(g,d,doneGroups.has(g.id),wholeAbsences(g.id,d).length>0)).join("")}</div></div>`:""}
  </div>`;
  bind(v); bindLesTabs(v);
  const di=v.querySelector("#les-date");
  di.onchange=()=>{S.lesDate=di.value||today();render();};
  v.querySelectorAll("[data-shift]").forEach(b=>b.onclick=()=>{
    const s=+b.dataset.shift;
    if(s===0)S.lesDate=today();
    else S.lesDate=addDays(S.lesDate,s);
    render();
  });
  v.querySelectorAll("[data-conduct]").forEach(b=>b.onclick=()=>conductGroup(b.dataset.conduct,v));
  v.querySelectorAll("[data-gcancel]").forEach(b=>b.onclick=()=>cancelGroupLesson(b.dataset.gcancel));
  v.querySelectorAll("[data-gundo]").forEach(b=>b.onclick=()=>{if(confirm("Вернуть занятие в план? Перенос у учеников будет снят."))undoGroupCancel(b.dataset.gundo);});
  /* причина пропуска показывается только у тех, кого сняли с отметки */
  v.querySelectorAll("input[data-att]").forEach(cb=>{
    const sel=v.querySelector(`select[data-abs="${cb.dataset.att}"][data-sid="${cb.value}"]`);
    if(!sel)return;
    const sync=()=>{sel.style.display=cb.checked||cb.disabled?"none":"";if(cb.checked)sel.value="";};
    cb.addEventListener("change",sync);sync();
  });
}
/* --- неделя --- */
const weekStart=(iso)=>addDays(iso,-((wdOf(iso)+6)%7));
function weekBlock(){
  const mon=weekStart(S.lesDate), days=Array.from({length:7},(_,i)=>addDays(mon,i)), now=today();
  const fmt=(iso)=>iso.slice(8,10)+"."+iso.slice(5,7);
  let plan=0,held=0,canc=0;
  const cols=days.map(d=>{
    const wd=wdOf(d), lessons=lessonsOn(d), doneG=new Set(lessons.map(l=>l.groupId).filter(Boolean));
    const evs=[];
    lessons.forEach(l=>{
      const off=l.attend.filter(a=>a.abonId).length;
      held++;
      evs.push({cls:"done",time:(groupById(l.groupId)||{}).time||"",nm:l.name,
        sub:`${teacherName(l.teacherId)||"без педагога"} · списано ${off} из ${l.attend.length}`,d});
    });
    S.groups.filter(g=>(g.days||[]).includes(wd)&&!doneG.has(g.id)).forEach(g=>{
      const cancelled=wholeAbsences(g.id,d).length>0;
      if(cancelled)canc++; else plan++;
      evs.push({cls:cancelled?"cancel":"",time:g.time||"",nm:g.name,
        sub:cancelled?"отменено, занятия перенесены":`${teacherName(g.teacherId)||"без педагога"} · ${(g.studentIds||[]).length} уч.`,d});
    });
    evs.sort((a,b)=>(a.time||"99").localeCompare(b.time||"99"));
    return {d,wd,evs};
  });
  return `<div class="stack">
  <div class="panel">
    <header>
      <div class="row" style="align-items:center;gap:8px">
        <button class="btn mini" data-wk="-7">← неделя</button>
        <button class="btn mini" data-wk="0">эта неделя</button>
        <button class="btn mini" data-wk="7">неделя →</button>
        <b style="margin-left:6px">${fmt(mon)} — ${fmt(days[6])}</b>
      </div>
      <span class="sub">запланировано ${plan} · проведено ${held}${canc?" · отменено "+canc:""}</span>
    </header>
    <div class="week">
      ${cols.map(c=>`<div class="wd ${c.d===now?"now":""} ${c.wd===0||c.wd===6?"off":""}">
        <h4><span>${WD_SHORT[c.wd]}</span><b>${fmt(c.d)}</b></h4>
        ${c.evs.length?`<div class="slots">${c.evs.map(e=>`
          <button class="ev ${e.cls}" data-day="${e.d}">
            ${e.time?`<span class="t">${esc(e.time)}</span>`:""}
            <span class="nm">${esc(e.nm)}</span>
            <span class="sub">${esc(e.sub)}</span>
          </button>`).join("")}</div>`
        :`<div class="none">—</div>`}
      </div>`).join("")}
    </div>
  </div>
  <div class="panel">
    <header><h2>Занятия этой недели</h2><span class="sub">списания с абонементов</span></header>
    ${weekTable(days)}
  </div></div>`;
}
function weekTable(days){
  const rows=days.flatMap(d=>lessonsOn(d)).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  if(!rows.length)return `<div class="empty"><b>За эту неделю занятий ещё не проводили</b>Откройте день в журнале и отметьте присутствующих.</div>`;
  return `<div class="tw"><table><thead><tr><th data-sort>Дата</th><th data-sort>Занятие</th><th data-sort>Педагог</th><th>Ученики</th><th class="n" data-sort>Списано</th><th class="n" data-sort>Сумма</th><th></th></tr></thead><tbody>
  ${rows.map(l=>`<tr><td class="n">${esc(l.date)}</td><td><b>${esc(l.name)}</b><div class="hint">${esc(l.direction||"")}</div></td>
   <td>${esc(teacherName(l.teacherId))||"—"}</td>
   <td>${l.attend.map(a=>`<span class="chip ${a.abonId?"in":"warn"}">${esc(studentName(a.studentId))}${a.abonId?"":" · без абонемента"}</span>`).join(" ")}</td>
   <td class="n">${l.attend.filter(a=>a.abonId).length}</td><td class="n">${money(l.attend.reduce((s,a)=>s+(a.price||0),0))}</td>
   <td class="act"><button class="btn mini danger" data-act="cancel-lesson" data-id="${l.id}">Отменить</button></td></tr>`).join("")}
  </tbody></table></div>`;
}
function bindWeek(v){
  v.querySelectorAll("[data-wk]").forEach(b=>b.onclick=()=>{
    const n=+b.dataset.wk;
    S.lesDate=n?addDays(S.lesDate,n):today();
    render();
  });
  v.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{S.lesDate=b.dataset.day;S.lesTab="journal";render();});
}
function bindLesTabs(v){ v.querySelectorAll("[data-les]").forEach(b=>b.onclick=()=>{S.lesTab=b.dataset.les;render();}); }

function groupCard(g,date,already,cancelled){
  const studs=(g.studentIds||[]).map(id=>S.students.find(s=>s.id===id)).filter(Boolean);
  return `<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden">
    <div class="row" style="align-items:center;justify-content:space-between;padding:11px 14px;background:var(--surface-2);gap:10px">
      <div><b>${esc(g.name)}</b> ${g.time?`<span class="chip mut">${esc(g.time)}</span>`:""}
        <div class="hint">${esc(g.direction||"без направления")} · ${esc(teacherName(g.teacherId)||"педагог не указан")} · ${(g.days||[]).map(x=>WD_SHORT[x]).join(", ")||"без расписания"}</div></div>
      ${already?`<span class="chip in">занятие проведено</span>`
        :cancelled?`<span class="chip warn">занятие отменено</span> <button class="btn" data-gundo="${g.id}">Вернуть в план</button>`
        :`<span class="row" style="gap:6px"><button class="btn" data-gcancel="${g.id}">Отменить занятие</button><button class="btn primary" data-conduct="${g.id}">Провести занятие</button></span>`}
    </div>
    ${studs.length?`<div class="pad" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px">
      ${studs.map(s=>{
        const ab=pickAbon(s.id,g.direction,date,g.subject);
        const exp=allAbon().some(a=>a.studentId===s.id&&abExpired(a,date));
        const off=already||cancelled;
        return `<label class="row" style="align-items:center;gap:8px;border:1px solid var(--line-soft);border-radius:8px;padding:7px 10px;${off?"opacity:.6":""}">
          <input type="checkbox" data-att="${g.id}" value="${s.id}" ${ab&&!off?"checked":""} ${off?"disabled":""} style="width:auto">
          <span style="flex:1">${esc(s.name)}</span>
          ${ab&&!off?`<select data-abs="${g.id}" data-sid="${s.id}" style="display:none;width:auto;max-width:160px;font-size:12px;padding:3px 6px"><option value="">не пришёл: причина</option>${ABS_REASONS.map(r=>`<option value="${r.k}">${r.t}</option>`).join("")}</select>`:""}
          ${ab?`<span class="chip ${abLeft(ab)<=2?"warn":"mut"}">${abLeft(ab)} зан.</span>`
             :`<span class="chip out">${exp?"просрочен":"нет абонемента"}</span>`}
        </label>`;}).join("")}
    </div>`:`<div class="pad hint">В группе нет учеников — добавьте состав во вкладке «Группы».</div>`}
  </div>`;
}
async function conductGroup(gid,root){
  const g=groupById(gid); if(!g)return;
  const ids=[...root.querySelectorAll(`[data-att="${gid}"]:checked`)].map(i=>i.value);
  /* не пришедшие: причина решает, переносится занятие или списывается */
  const why=[...root.querySelectorAll(`select[data-abs="${gid}"]`)].map(e=>({sid:e.dataset.sid,k:e.value})).filter(x=>x.k&&!ids.includes(x.sid));
  const lateIds=why.filter(x=>!absReason(x.k).carry).map(x=>x.sid);
  const carry=why.filter(x=>absReason(x.k).carry);
  if(!ids.length&&!lateIds.length&&!carry.length){toast("Отметьте хотя бы одного ученика");return;}
  const touched=new Set();let carried=0;
  carry.forEach(x=>{const r=addAbsence({studentId:x.sid,date:S.lesDate,reasonKey:x.k,groupId:g.id,group:g.name,direction:g.direction,subject:g.subject});if(r&&r!=="dup"){touched.add(r);carried++;}});
  if(ids.length||lateIds.length)await conduct({date:S.lesDate,groupId:g.id,name:g.name,direction:g.direction,subject:g.subject,teacherId:g.teacherId,studentIds:ids,lateIds,touched,carried});
  else{
    let ok=true;for(const m of touched)if(!(await saveMonth(m)))ok=false;
    if(ok)toast(carried?`Перенесено занятий: ${carried}`:"Пропуск уже был отмечен");
    render();
  }
}
async function conduct({date,groupId,name,direction,subject,teacherId,studentIds,lateIds,note,touched,carried}){
  touched=touched||new Set();lateIds=lateIds||[];
  const lesson={id:uid("les"),date,groupId:groupId||"",name,direction:direction||"",subject:subject||"",teacherId:teacherId||"",note:note||"",attend:[]};
  let wo=0;
  const take=(sid,vnote,onlyAbon)=>{
    const ab=pickAbon(sid,direction,date,subject);
    if(ab){
      ab.visits.push({date,teacherId:teacherId||ab.teacherId||"",note:vnote,lessonId:lesson.id,groupId:groupId||""});
      lesson.attend.push({studentId:sid,abonId:ab.id,price:abPrice(ab)});
      const f=findAbon(ab.id); if(f)touched.add(f.m);
      return true;
    }
    if(!onlyAbon)lesson.attend.push({studentId:sid,abonId:"",price:0});
    return false;
  };
  studentIds.forEach(sid=>take(sid,note||name,false));
  lateIds.forEach(sid=>{if(take(sid,"Пропуск без предупреждения",true))wo++;});
  touched.add(pushLesson(lesson));
  let ok=true;for(const m of touched) if(!(await saveMonth(m)))ok=false;
  const off=lesson.attend.filter(a=>a.abonId).length, no=lesson.attend.length-off;
  if(ok)toast((no?`Списано занятий: ${off}. Без абонемента: ${no}`:`Занятие проведено, списано занятий: ${off}`)+(wo?` (из них без предупреждения: ${wo})`:"")+(carried?`. Перенесено: ${carried}`:""));
  render();
}
/* отмена занятия группы целиком: у всех учеников занятие остаётся на абонементе и переносится */
function cancelGroupLesson(gid){
  const g=groupById(gid); if(!g)return; const date=S.lesDate;
  modal("Отменить занятие · "+g.name,`
   <div class="grid2">
     <label class="f"><span>Дата</span><input type="date" name="date" value="${esc(date)}"></label>
     <label class="f"><span>Причина</span><select name="reason">${ABS_REASONS.filter(r=>r.carry).map(r=>`<option value="${r.k}">${r.t}</option>`).join("")}</select></label>
   </div>
   <label class="f"><span>Комментарий</span><input name="note" placeholder="болезнь педагога, каникулы"></label>
  `,async(l)=>{
    const d=val(l,"date")||date, rk=val(l,"reason")||"center";
    if(lessonsOn(d).some(x=>x.groupId===g.id)){toast("На эту дату занятие группы уже проведено");return false;}
    const touched=new Set();let n=0,none=0;
    (g.studentIds||[]).forEach(sid=>{
      const r=addAbsence({studentId:sid,date:d,reasonKey:rk,groupId:g.id,group:g.name,direction:g.direction,subject:g.subject,whole:true,note:val(l,"note")});
      if(r==="dup")return; if(r){touched.add(r);n++;}else none++;
    });
    if(!n){toast(none?"У учеников группы нет действующих абонементов — переносить нечего":"Занятие уже отменено");return false;}
    let ok=true;for(const m of touched)if(!(await saveMonth(m)))ok=false;
    if(ok)toast(`Занятие отменено, перенесено у учеников: ${n}`+(none?`. Без абонемента: ${none}`:""));
  },"Отменить занятие");
}
async function undoGroupCancel(gid){
  const list=wholeAbsences(gid,S.lesDate); if(!list.length)return;
  if(list.some(({x})=>x.usedIn)){toast("Часть занятий уже учтена в новых абонементах — сначала уберите перенос там");return;}
  const months=new Set();
  list.forEach(({a,x})=>{a.absences=a.absences.filter(y=>y!==x);const f=findAbon(a.id);if(f)months.add(f.m);});
  let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
  if(ok)toast("Занятие возвращено в план");
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
  S.lessons[month]=S.lessons[month].filter(x=>x.id!==id); markDel("un_lessons",id);
  let ok=true; for(const m of touched) if(!(await saveMonth(m)))ok=false;
  if(ok)toast("Проведение отменено, занятия возвращены на абонементы"); render();
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
   <div class="grid2">
     <label class="f"><span>Итог</span><select name="outcome"><option value="">Занятие проведено</option>${ABS_REASONS.map(r=>`<option value="${r.k}">Не состоялось: ${r.t.toLowerCase()}</option>`).join("")}</select></label>
     <label class="f"><span>Комментарий</span><input name="note" placeholder="тема занятия"></label>
   </div>
  `,async(l)=>{
    const sid=val(l,"studentId"); if(!sid){toast("Выберите ученика");return false;}
    const date=val(l,"date")||S.lesDate;
    const oc=val(l,"outcome");
    if(oc&&absReason(oc).carry){
      const r=addAbsence({studentId:sid,date,reasonKey:oc,groupId:"",group:"Индивидуальное занятие",direction:val(l,"direction"),subject:val(l,"subject"),note:val(l,"note")});
      if(r==="dup"){toast("Этот пропуск уже отмечен");return false;}
      if(!r){toast("У ученика нет действующего абонемента — переносить нечего");return false;}
      if(await saveMonth(r))toast("Занятие перенесено на следующий абонемент");
      return;
    }
    const ab=pickAbon(sid,val(l,"direction"),date,val(l,"subject"));
    if(!ab&&!confirm("У ученика нет действующего абонемента на эту дату. Провести занятие без списания?"))return false;
    await conduct({date,name:"Индивидуальное занятие",direction:val(l,"direction"),subject:val(l,"subject"),
      teacherId:val(l,"teacherId"),studentIds:[sid],note:oc==="late"?"Пропуск без предупреждения"+(val(l,"note")?": "+val(l,"note"):""):val(l,"note")});
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
  const dirs=[...new Set(tpls.map(t=>t.direction||""))].filter(Boolean).sort((a,b)=>a.localeCompare(b,"ru"));
  return `<div class="panel"><header><h2>Каталог абонементов</h2><span class="sub">выберите абонемент — останется указать ученика</span>
   <span class="tools" style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
    ${tpls.length>6?`<input type="search" id="cat-q" placeholder="Поиск по каталогу" value="${esc(S.catQ||"")}" autocomplete="off" style="width:190px">`:""}
    ${dirs.length>1?`<select id="cat-dir" style="width:200px"><option value="">Все направления</option>${dirs.map(d=>`<option ${S.catDir===d?"selected":""}>${esc(d)}</option>`).join("")}</select>`:""}
    <button class="btn mini" data-act="add-tariff">+ Новый шаблон</button></span></header>
  ${tpls.length?`<div class="cat">${tpls.map(t=>`<div class="tpl" data-s="${sAttr(t.name,t.direction,t.subject,teacherName(t.teacherId),t.format)}" data-dir="${esc(t.direction||"")}"><div class="tpl-n">${esc(t.name)}</div>
    <div class="tpl-p num">${money(t.price)} ₽</div>
    <div class="hint">${t.lessons} зан. · ${money(t.lessons?t.price/t.lessons:t.price)} ₽ за занятие${tplSold(t.id)?` · продано ${tplSold(t.id)}`:""}</div>
    <div class="tpl-m">${tplMeta(t).map(x=>`<span class="chip mut">${esc(x)}</span>`).join("")}</div>
    <div class="tpl-b"><button class="btn primary mini" data-act="sell-tpl" data-id="${t.id}">Выставить</button> <button class="btn mini" data-act="edit-tariff" data-id="${t.id}" title="Изменить">✎</button> <button class="btn mini" data-act="copy-tariff" data-id="${t.id}" title="Создать копию">⧉</button></div></div>`).join("")}</div>
    <div class="empty" data-cat-empty style="display:none">В каталоге ничего не найдено</div>`
   :`<div class="empty">Шаблонов пока нет. Создайте постоянные абонементы — и выставляйте их в один клик.</div>`}
  </div>`;
}
function catFilter(root){
  const q=(S.catQ||"").trim().toLowerCase(),d=S.catDir||"";let n=0;
  root.querySelectorAll(".cat .tpl").forEach(c=>{const ok=(!q||c.dataset.s.includes(q))&&(!d||c.dataset.dir===d);c.style.display=ok?"":"none";if(ok)n++;});
  const e=root.querySelector("[data-cat-empty]");if(e)e.style.display=n?"none":"";
}
/* состояние абонемента для фильтров и меток */
function abState(a){
  if(a.closedAt)return {k:"closed",t:"закрыт",cls:"mut"};
  if(abExpired(a))return {k:"expired",t:"срок истёк",cls:"out"};
  if(abFree(a)<=0&&abPending(a)>0)return {k:"done",t:"отработан, перенос "+abPending(a),cls:"warn"};
  if(abUnused(a)<=0)return {k:"done",t:"отработан",cls:"mut"};
  return {k:"live",t:"действует",cls:"in"};
}
function viewAbon(v){
  const list=allAbon().slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const active=list.filter(a=>abLive(a));
  const f=S.abFilter||"live", fq=(S.abQ||"").trim().toLowerCase();
  const shown=list.filter(a=>{
    const st=abState(a).k;
    if(f==="live"&&st!=="live")return false;
    if(f==="debt"&&!abOwed(a))return false;
    if(f==="expired"&&st!=="expired")return false;
    if(f==="done"&&!(st==="done"||st==="closed"))return false;
    if(fq&&![studentName(a.studentId),a.name,a.direction,a.subject,teacherName(a.teacherId)].join(" ").toLowerCase().includes(fq))return false;
    return true;
  });
  const owed=list.reduce((s,a)=>s+abOwed(a),0);
  v.innerHTML=`
  <div class="head"><div><h1>Абонементы и списание занятий</h1><p>Продажа абонемента создаёт поступление в журнале; каждое проведённое занятие списывается отсюда и попадает в БДР по методу начисления.</p></div>
  <div class="tools"><button class="btn primary" data-act="new-abon">Продать абонемент</button></div></div>
  <div class="stack">
  ${catalogHTML()}
  <div class="stats" style="--cols:5">
    <div class="stat"><span class="k">Действующих</span><span class="v num">${active.length}</span><span class="n">с остатком занятий и не просрочены</span></div>
    <div class="stat"><span class="k">Не отработано занятий</span><span class="v num">${active.reduce((s,a)=>s+abLeft(a),0)}</span><span class="n">по действующим абонементам</span></div>
    <div class="stat"><span class="k">Сумма обязательств</span><span class="v num">${money(active.reduce((s,a)=>s+abDebtSum(a),0))}</span><span class="n">аванс к отработке</span></div>
    <div class="stat"><span class="k">Не оплачено</span><span class="v num ${owed?"neg":""}">${money(owed)}</span><span class="n">${owed?"абонементов с долгом: "+list.filter(a=>abOwed(a)>0).length:"долгов нет"}</span></div>
    <div class="stat"><span class="k">Продано в ${S.year}</span><span class="v num">${money(list.filter(a=>+String(a.date).slice(0,4)===S.year).reduce((s,a)=>s+(a.price||0),0))}</span><span class="n">по дате продажи</span></div>
  </div>
  <div class="panel">
    <header><h2>Абонементы учеников</h2><span class="sub">${shown.length} из ${list.length}</span>
      <span class="tools" style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
       <div class="seg">${[["live","Действуют"],["debt","С долгом"],["expired","Просрочены"],["done","Закрыты"],["all","Все"]].map(([k,t])=>`<button data-ab-f="${k}" class="${f===k?"on":""}">${t}</button>`).join("")}</div>
       <input type="search" id="ab-q" placeholder="Ученик, абонемент" value="${esc(S.abQ||"")}" autocomplete="off" style="width:190px"></span></header>
    ${shown.length?`<div class="tw"><table><thead><tr><th>Продан</th><th>Ученик</th><th>Абонемент</th><th>Направление / педагог</th><th class="n">Цена</th><th class="n">За занятие</th><th>Использовано</th><th></th></tr></thead><tbody>
    ${shown.map(a=>{const used=(a.visits||[]).length,pct=a.lessons?Math.min(100,used/a.lessons*100):0;const left=abLeft(a),st=abState(a),owe=abOwed(a);
      return `<tr><td class="n">${esc(a.date)}</td><td>${esc(studentName(a.studentId))||"—"}</td>
      <td>${esc(a.name)} ${st.k!=="live"?`<span class="chip ${st.cls}">${st.t}</span>`:""}${owe?` <span class="chip warn">долг ${money(owe)}</span>`:""}</td><td>${esc(a.direction||"—")}<div class="hint">${esc([teacherName(a.teacherId)||"педагог не указан",a.format].filter(Boolean).join(" · "))}</div></td>
      <td class="n">${money(a.price)}${a.until?`<div class="hint">до ${esc(a.until)}</div>`:""}</td><td class="n">${money(abPrice(a))}</td>
      <td><div class="row" style="align-items:center;gap:8px"><div class="bar"><i class="${left===0?"out":left<=2?"low":""}" style="width:${pct}%"></i></div><span class="num" style="font-size:12px">${used}/${a.lessons}</span></div></td>
      <td class="n">${abLive(a)?`<button class="btn mini" data-act="visit" data-id="${a.id}">Списать</button> `:""}<button class="btn mini" data-act="abon-card" data-id="${a.id}">Карточка</button></td></tr>`;}).join("")}
    </tbody></table></div>`:`<div class="empty">${list.length?"Под выбранный фильтр ничего не попало.":"Абонементы ещё не продавались."}</div>`}
  </div></div>`;
  bind(v);
  catFilter(v);
  const cq=v.querySelector("#cat-q");if(cq)cq.oninput=()=>{S.catQ=cq.value;catFilter(v);};
  const cd=v.querySelector("#cat-dir");if(cd)cd.onchange=()=>{S.catDir=cd.value;catFilter(v);};
  v.querySelectorAll("[data-ab-f]").forEach(b=>b.onclick=()=>{S.abFilter=b.dataset.abF;render();});
  const aq=v.querySelector("#ab-q");if(aq)aq.oninput=()=>{S.abQ=aq.value;const pos=aq.selectionStart;render();const n=document.getElementById("ab-q");if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(e){}}};
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
  const tabs=[["bdds","БДДС · движение денег"],["bdr","БДР · доходы и расходы"],["abon","Абонементы"],["pl","P&L по направлениям"],["ros","Рентабельность центра"],["unit","Рентабельность по разрезам"],["pay","Зарплата педагогов"],["tax","Налоги УСН"]];
  v.innerHTML=`
  <div class="head"><div><h1>Отчёты</h1><p>БДДС считается по кассе, БДР — по начислению: выручка признаётся в месяце проведённого занятия, а не оплаты.</p></div>
  <div class="tools">${yearSelect()}<button class="btn" data-act="export-report">Выгрузить отчёт в Excel</button></div></div>
  <div class="panel">
    <div class="tabs">${tabs.map(t=>`<button class="tab ${S.repTab===t[0]?"on":""}" data-rep="${t[0]}">${t[1]}</button>`).join("")}</div>
    <div id="repbody">${({bdds:repBDDS,bdr:repBDR,abon:repAbon,pl:repPL,ros:repROS,unit:repUnit,pay:repPay,tax:repTax}[S.repTab])()}</div>
  </div>`;
  bind(v);
  v.querySelectorAll("[data-rep]").forEach(b=>b.onclick=()=>{S.repTab=b.dataset.rep;render();});
}
const monthKeys=(y)=>Array.from({length:12},(_,i)=>y+"-"+String(i+1).padStart(2,"0"));

function matrixTable(head,groups,note){
  return `${note?`<div class="pad hint">${note}</div>`:""}<div class="tw"><table><thead><tr><th>${head[0]}</th>${head.slice(1).map(h=>`<th class="n">${h}</th>`).join("")}</tr></thead><tbody>
  ${groups.map(g=>`<tr class="${g.cls||""}"><td>${esc(g.name)}</td>${g.vals.map(x=>`<td class="n">${x===0?'<span style="color:var(--ink-3)">—</span>':g.pct?fmtPct(x):money(x)}</td>`).join("")}</tr>`).join("")}
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
/* --- признаки статей: что учитывать в БДР и в налоговой базе --- */
const artOf=(n)=>artByName(n)||{};
const opInBdr=(o)=>artOf(o.article).inBdr!==false;
const opNature=(o)=>artOf(o.article).nature||"var";
/* влияние операции на налоговую базу УСН «доходы»: поступления по статьям с признаком, возвраты клиентам уменьшают */
const taxEffect=(o)=>o.type==="income"?(artOf(o.article).inTax!==false?o.amount:0):(o.abonId?-o.amount:0);
const sumArr=(a)=>a.reduce((s,x)=>s+x,0);
/* строки отчёта: годовой итог; строка-процент считается как доля числителя в знаменателе */
function finishRows(rows){
  rows.forEach(r=>{
    if(r.pctOf){const {num,den}=r.pctOf;r.pct=true;r.vals=[...num.map((n,i)=>den[i]?n/den[i]*100:0),sumArr(den)?sumArr(num)/sumArr(den)*100:0];}
    else r.vals=[...r.vals,sumArr(r.vals)];
  });
  return rows;
}
const fmtPct=(x)=>(Math.round(x*10)/10).toLocaleString("ru-RU")+"%";
/* --- БДР: начисление --- */
function accrualIncome(y){
  const ks=monthKeys(y),map=Object.fromEntries(ks.map(k=>[k,{}]));
  allAbon().forEach(a=>{
    (a.visits||[]).forEach(vi=>{const k=ym(vi.date);if(!map[k])return;const g=dirGroup(a.direction);map[k][g]=(map[k][g]||0)+abPrice(a);});
    /* неотработанный остаток по истёкшему сроку или закрытию — выручка центра в день истечения/закрытия */
    const b=abBreak(a); if(b&&b.amount>0){const k=ym(b.date);if(map[k]){const g=dirGroup(a.direction);map[k][g]=(map[k][g]||0)+b.amount;}}
  });
  // доходы без абонемента (разовые, прочие поступления) — по дате оплаты, если статья входит в БДР
  opsOfYear(y).filter(o=>o.type==="income"&&!o.abonId&&opInBdr(o)).forEach(o=>{const k=ym(o.date);const g=dirGroup(o.direction);map[k][g]=(map[k][g]||0)+o.amount;});
  return map;
}
const breakIncome=(y)=>{const ks=monthKeys(y),r=ks.map(()=>0);allAbon().forEach(a=>{const b=abBreak(a);if(b&&b.amount>0){const i=ks.indexOf(ym(b.date));if(i>=0)r[i]+=b.amount;}});return r;};
const revByMonth=(y)=>{const acc=accrualIncome(y);return monthKeys(y).map(k=>sumArr(Object.values(acc[k])));};
/* расходы БДР по характеру: переменные / постоянные / налоги и взносы; статьи с признаком «не в БДР» не попадают */
function bdrExpenses(y){
  const ks=monthKeys(y),ops=opsOfYear(y).filter(o=>o.type==="expense"&&opInBdr(o));
  const arts=[...new Set(ops.map(o=>o.article||"Прочие расходы"))].sort((a,b)=>a.localeCompare(b,"ru"));
  const nat=(n)=>artOf(n).nature||"var";
  const of=(n)=>nat(n)==="const"?"const":nat(n)==="tax"?"tax":"var";
  const by=(list)=>ks.map(k=>ops.filter(o=>ym(o.date)===k&&list.includes(o.article||"Прочие расходы")).reduce((s,o)=>s+o.amount,0));
  const lists={var:arts.filter(a=>of(a)==="var"),const:arts.filter(a=>of(a)==="const"),tax:arts.filter(a=>of(a)==="tax")};
  return {ks,lists,by,tot:{var:by(lists.var),const:by(lists.const),tax:by(lists.tax)}};
}
function repBDR(){
  const y=S.year,ks=monthKeys(y),acc=accrualIncome(y),E=bdrExpenses(y);
  const groups=[...new Set(ks.flatMap(k=>Object.keys(acc[k])))].sort((a,b)=>a.localeCompare(b,"ru"));
  const incT=ks.map(k=>sumArr(Object.values(acc[k]))),brk=breakIncome(y);
  const marg=incT.map((x,i)=>x-E.tot.var[i]), before=marg.map((x,i)=>x-E.tot.const[i]);
  const rows=[{name:"Выручка (признанная)",cls:"group",vals:incT},...groups.map(g=>({name:g,cls:"sub",vals:ks.map(k=>acc[k][g]||0)})),
    ...(sumArr(brk)?[{name:"из неё: сгоревшие и удержанные остатки абонементов",cls:"sub",vals:brk}]:[]),
    {name:"Переменные расходы",cls:"group",vals:E.tot.var},...E.lists.var.map(a=>({name:a,cls:"sub",vals:E.by([a])})),
    {name:"Маржинальная прибыль",cls:"total",vals:marg},
    {name:"Постоянные расходы",cls:"group",vals:E.tot.const},...E.lists.const.map(a=>({name:a,cls:"sub",vals:E.by([a])})),
    {name:"Прибыль до налогов",cls:"total",vals:before},
    {name:"Рентабельность до налогов, %",cls:"sub",pctOf:{num:before,den:incT}}];
  if(E.lists.tax.length){
    const after=before.map((x,i)=>x-E.tot.tax[i]);
    rows.push({name:"Налоги и взносы (уплачено)",cls:"group",vals:E.tot.tax},...E.lists.tax.map(a=>({name:a,cls:"sub",vals:E.by([a])})),{name:"Прибыль после налогов",cls:"total",vals:after});
  }
  finishRows(rows);
  return matrixTable(["Показатель",...MON_SHORT,"Год"],rows,"Метод начисления: выручка признаётся в месяце проведённого занятия (списание с абонемента), в день окончания срока или закрытия абонемента (неотработанный остаток) и в месяце оплаты для разовых поступлений. Расходы — по дате платежа. Статьи, у которых в справочнике снят признак «в БДР», сюда не попадают.");
}
/* --- Отчёт по абонементам --- */
function abFlows(keys){
  const idx=Object.fromEntries(keys.map((k,i)=>[k,i])),z=()=>keys.map(()=>0);
  const F={sold:z(),soldCnt:z(),disc:z(),worked:z(),workedCnt:z(),burned:z(),closed:z(),refunded:z()};
  allAbon().forEach(a=>{
    const i=idx[ym(a.date)]; if(i!=null){F.sold[i]+=a.price||0;F.soldCnt[i]++;if(a.listPrice!=null&&a.listPrice>a.price)F.disc[i]+=a.listPrice-a.price;}
    (a.visits||[]).forEach(v=>{const j=idx[ym(v.date)];if(j!=null){F.worked[j]+=abPrice(a);F.workedCnt[j]++;}});
    const b=abBreak(a); if(b){const j=idx[ym(b.date)];if(j!=null){if(b.kind==="expired")F.burned[j]+=b.val;else{F.closed[j]+=b.val;F.refunded[j]+=a.refund||0;}}}
  });
  return F;
}
function repAbon(){
  const y=S.year,ks=monthKeys(y);
  const list=allAbon();
  /* движение по месяцам; остаток обязательств считается с первого месяца, где были абонементы */
  const y0=Math.min(y,...list.map(a=>+String(a.date).slice(0,4)).filter(Boolean),...list.flatMap(a=>(a.visits||[]).map(v=>+String(v.date).slice(0,4))).filter(Boolean));
  const allKeys=[];for(let yy=y0;yy<=y;yy++)allKeys.push(...monthKeys(yy));
  const F=abFlows(allKeys);
  let bal=0;const restAll=allKeys.map((k,i)=>bal=bal+F.sold[i]-F.worked[i]-F.burned[i]-F.closed[i]);
  const last=(a)=>a.slice(-12);
  const rest=last(restAll);
  const move=[
    {name:"Продано абонементов, шт",cls:"sub",vals:last(F.soldCnt)},
    {name:"Продано на сумму",cls:"group",vals:last(F.sold)},
    {name:"из них скидки к цене шаблона",cls:"sub",vals:last(F.disc)},
    {name:"Проведено занятий, шт",cls:"sub",vals:last(F.workedCnt)},
    {name:"Отработано на сумму",cls:"group",vals:last(F.worked)},
    {name:"Сгорело по сроку",vals:last(F.burned)},
    {name:"Закрыто досрочно (стоимость остатка)",vals:last(F.closed)},
    {name:"из них возвращено клиентам",cls:"sub",vals:last(F.refunded)},
    {name:"Остаток обязательств на конец месяца",cls:"total",vals:rest}
  ];
  move.forEach(r=>r.vals=[...r.vals,r.name.startsWith("Остаток")?rest[11]:sumArr(r.vals)]);

  /* свод по ученикам */
  const studs=S.students.map(s=>{
    const ab=list.filter(a=>a.studentId===s.id);
    const paid=ab.reduce((n,a)=>n+abPaid(a),0);
    const used=ab.reduce((n,a)=>n+(a.visits||[]).length,0);
    const left=ab.reduce((n,a)=>n+(abLive(a)?abLeft(a):0),0);
    const debt=ab.reduce((n,a)=>n+abDebtSum(a),0);
    const owe=ab.reduce((n,a)=>n+abOwed(a),0);
    const lastV=ab.flatMap(a=>(a.visits||[]).map(v=>v.date)).sort().pop()||"";
    const exp=ab.some(a=>abExpired(a));
    return {s,ab,paid,used,left,debt,owe,last:lastV,exp};
  }).filter(x=>x.ab.length).sort((a,b)=>b.debt-a.debt);

  /* по направлениям и педагогам */
  const byDir={},byTeach={};
  list.forEach(a=>(a.visits||[]).forEach(v=>{
    if(+String(v.date).slice(0,4)!==y)return;
    const d=a.direction||"Без привязки"; byDir[d]=byDir[d]||{cnt:0,sum:0}; byDir[d].cnt++; byDir[d].sum+=abPrice(a);
    const t=teacherName(v.teacherId||a.teacherId)||"Педагог не указан"; byTeach[t]=byTeach[t]||{cnt:0,sum:0}; byTeach[t].cnt++; byTeach[t].sum+=abPrice(a);
  }));
  const in14=addDays(today(),14),ago30=addDays(today(),-30);
  const expiring=list.filter(a=>abLeft(a)>0).map(a=>({a,over:abExpired(a)})).filter(x=>x.over||(x.a.until&&x.a.until<=in14));
  const stale=list.filter(a=>abLive(a)&&!(a.visits||[]).some(v=>v.date>=ago30)&&a.date<ago30);
  const owedAll=list.reduce((s,a)=>s+abOwed(a),0);

  return matrixTable(["Показатель",...MON_SHORT,"Год"],move,"Продажа — деньги полученные, отработка — занятия проведённые. Разница между ними и есть обязательства центра перед учениками.")
  +`<div class="pad stack">
    <div class="stats" style="--cols:5;box-shadow:none">
      <div class="stat"><span class="k">Обязательств на сегодня</span><span class="v num">${money(list.reduce((s,a)=>s+abDebtSum(a),0))}</span><span class="n">не отработанный аванс</span></div>
      <div class="stat"><span class="k">Не проведено занятий</span><span class="v num">${list.reduce((s,a)=>s+(abLive(a)?abLeft(a):0),0)}</span></div>
      <div class="stat"><span class="k">Просрочено</span><span class="v num ${expiring.filter(x=>x.over).length?"neg":""}">${expiring.filter(x=>x.over).length}</span><span class="n">абонементов со сгоревшим сроком</span></div>
      <div class="stat"><span class="k">Без занятий месяц</span><span class="v num ${stale.length?"neg":""}">${stale.length}</span><span class="n">оплачено, но ученик не ходит</span></div>
      <div class="stat"><span class="k">Не оплачено учениками</span><span class="v num ${owedAll?"neg":""}">${money(owedAll)}</span><span class="n">${owedAll?"абонементов с долгом: "+list.filter(a=>abOwed(a)>0).length:"долгов нет"}</span></div>
    </div>

    <div><h3 style="font-size:14px;margin-bottom:8px">Свод по ученикам</h3>
    ${studs.length?`<div class="tw"><table><thead><tr><th>Ученик</th><th class="n">Абонементов</th><th class="n">Оплачено</th><th class="n">Долг по оплате</th><th class="n">Проведено</th><th class="n">Остаток занятий</th><th class="n">Аванс к отработке</th><th>Последнее занятие</th></tr></thead><tbody>
    ${studs.map(x=>`<tr><td>${esc(x.s.name)} ${x.exp?'<span class="chip warn">просрочен</span>':""}</td><td class="n">${x.ab.length}</td>
    <td class="n">${money(x.paid)}</td><td class="n">${x.owe?`<span style="color:var(--neg)">${money(x.owe)}</span>`:""}</td><td class="n">${x.used}</td><td class="n">${x.left}</td><td class="n">${money(x.debt)}</td>
    <td class="n">${esc(x.last)||"—"}</td></tr>`).join("")}
    <tr class="total"><td>Итого</td><td class="n">${studs.reduce((s,x)=>s+x.ab.length,0)}</td><td class="n">${money(studs.reduce((s,x)=>s+x.paid,0))}</td><td class="n">${money(studs.reduce((s,x)=>s+x.owe,0))}</td>
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
  const rows=ks.map((k,i)=>({name:MONTHS[i],vals:[sumArr(Object.values(acc[k])),...all.map(g=>acc[k][g]||0)]}));
  rows.push({name:"ВСЕГО за год",cls:"total",vals:[0,...all.map(()=>0)].map((_,c)=>rows.reduce((s,r)=>s+r.vals[c],0))});
  return matrixTable(head,rows,"Выручка по укрупнённым направлениям — группировка задаётся в справочнике «Направления».");
}
/* --- Налоги: расчётное начисление по месяцам (для ROS) --- */
function taxProv(y,inc){
  const ks=monthKeys(y),ops=opsOfYear(y);
  const cash=ks.map(k=>ops.filter(o=>ym(o.date)===k).reduce((s,o)=>s+taxEffect(o),0));
  const usn=cash.map(x=>x*R().usn/100);
  let cum=0;const extra=cash.map(x=>{const before=Math.max(0,cum-300000);cum+=x;return (Math.max(0,cum-300000)-before)*0.01;});
  const active=ks.map((k,i)=>inc[i]>0||(S.ops[k]||[]).length>0||(S.abon[k]||[]).length>0||(S.lessons[k]||[]).length>0);
  const fixed=active.map(a=>a?R().fixedFee/12:0);
  return {cash,usn,extra,fixed};
}
/* --- Рентабельность центра --- */
function repROS(){
  const y=S.year,ks=monthKeys(y),inc=revByMonth(y),E=bdrExpenses(y);
  const vr=E.tot.var,cn=E.tot.const,T=taxProv(y,inc);
  const gross=inc.map((x,i)=>x-vr[i]);
  const oper=gross.map((x,i)=>x-cn[i]);
  const dues=T.extra.map((x,i)=>x+T.fixed[i]);
  const net=oper.map((x,i)=>x-T.usn[i]-dues[i]);
  const rows=[{name:"Выручка",cls:"group",vals:inc},{name:"Переменные расходы",vals:vr},{name:"Маржинальная прибыль",cls:"total",vals:gross},
    {name:"Маржинальность, %",cls:"sub",pctOf:{num:gross,den:inc}},
    {name:"Постоянные расходы",vals:cn},{name:"Операционная прибыль",cls:"total",vals:oper},
    {name:`УСН ${R().usn}% с поступлений (расчёт)`,vals:T.usn},{name:"Взносы ИП: фиксированные (1/12) и 1% свыше 300 000 ₽",vals:dues},
    {name:"Чистая прибыль",cls:"total",vals:net},{name:"Рентабельность продаж (ROS), %",cls:"sub",pctOf:{num:net,den:inc}}];
  finishRows(rows);
  const incY=sumArr(inc),netY=sumArr(net);
  const ros=ks.map((_,i)=>inc[i]?net[i]/inc[i]*100:null);
  const best=ros.reduce((b,x,i)=>x!=null&&(b<0||x>ros[b])?i:b,-1);
  return matrixTable(["Показатель",...MON_SHORT,"Год"],rows,"Себестоимость = переменные расходы. Налоги и взносы здесь начисляются расчётом; фактические платежи по статьям с характером «налоги и взносы» показаны в БДР и сюда не входят.")
   +`<div class="pad"><div class="stats" style="box-shadow:none">
      <div class="stat"><span class="k">Выручка за год</span><span class="v num">${money(incY)}</span></div>
      <div class="stat"><span class="k">Чистая прибыль</span><span class="v num ${netY>=0?"pos":"neg"}">${money(netY)}</span></div>
      <div class="stat"><span class="k">ROS за год</span><span class="v num">${incY?(netY/incY*100).toFixed(1).replace(".",","):"0,0"}%</span><span class="n">рентабельность продаж</span></div>
      <div class="stat"><span class="k">Лучший месяц</span><span class="v num">${best>=0?MONTHS[best]:"—"}</span><span class="n">${best>=0?fmtPct(ros[best])+" ROS":"нет выручки"}</span></div>
    </div></div>`;
}
/* --- Оплата педагогов: модель «ставка за занятие» или «процент от стоимости занятия» --- */
const tObj=(id)=>S.teachers.find(t=>t.id===id);
const tHasPay=(t)=>!!t&&(t.payType==="percent"?t.payPercent>0:t.rate>0);
const tPayLabel=(t)=>!t?"":t.payType==="percent"?(t.payPercent?t.payPercent+"% от занятия":"—"):(t.rate?money(t.rate)+" ₽ за занятие":"—");
/* сколько получает педагог за занятие: rev — стоимость списанных занятий, n — число учеников со списанием (ставка делится между ними) */
const lessonPay=(t,rev,n)=>!t?0:t.payType==="percent"?rev*(t.payPercent||0)/100:(t.rate||0)/Math.max(1,n||1);
/* все начисления педагогам за год: проведённые занятия (одно начисление за занятие) и разовые списания без занятия */
function payEvents(y){
  const ev=[],revOf={};
  allAbon().forEach(a=>(a.visits||[]).forEach(v=>{if(v.lessonId)revOf[v.lessonId]=(revOf[v.lessonId]||0)+abPrice(a);}));
  allLessons().filter(l=>+String(l.date).slice(0,4)===y).forEach(l=>{
    const t=tObj(l.teacherId),rev=revOf[l.id]||0,n=(l.attend||[]).filter(x=>x.abonId).length;
    ev.push({kind:"lesson",tid:l.teacherId||"",date:l.date,rev,paid:n,all:(l.attend||[]).length,cost:lessonPay(t,rev,1),
      dir:l.direction||"Без привязки",grp:l.groupId||""});
  });
  allAbon().forEach(a=>(a.visits||[]).forEach(v=>{
    if(v.lessonId||+String(v.date).slice(0,4)!==y)return;
    const tid=v.teacherId||a.teacherId||"",t=tObj(tid);
    ev.push({kind:"manual",tid,date:v.date,rev:abPrice(a),paid:1,all:1,cost:lessonPay(t,abPrice(a),1),dir:a.direction||"Без привязки",grp:""});
  }));
  return ev;
}
function repPay(){
  const y=S.year,ks=monthKeys(y),ev=payEvents(y),ops=opsOfYear(y).filter(o=>o.type==="expense"&&o.teacherId&&!o.abonId);
  const ids=[...new Set([...ev.map(e=>e.tid),...ops.map(o=>o.teacherId)])];
  const rows=ids.map(id=>{
    const t=tObj(id),mine=ev.filter(e=>e.tid===id);
    const acc=sumArr(mine.map(e=>e.cost)),paid=ops.filter(o=>o.teacherId===id).reduce((s,o)=>s+o.amount,0);
    return {id,name:t?t.name:"Педагог не указан",t,cnt:mine.length,rev:sumArr(mine.map(e=>e.rev)),acc,paid,bal:acc-paid,byM:ks.map(k=>sumArr(mine.filter(e=>ym(e.date)===k).map(e=>e.cost)))};
  }).sort((a,b)=>b.acc-a.acc);
  if(!rows.length)return `<div class="pad"><div class="empty">Занятий и платежей педагогам в ${y} году ещё нет.</div></div>`;
  const tot=(f)=>sumArr(rows.map(f));
  const noPay=rows.filter(r=>!tHasPay(r.t)&&r.cnt);
  return `<div class="pad stack">
   <div class="hint">Начислено — по модели оплаты педагога из справочника: ставка за каждое проведённое занятие или процент от стоимости занятия. Выплачено — платежи, где указан педагог. Остаток считается в пределах года.</div>
   ${noPay.length?`<div class="hint"><span class="chip warn">внимание</span> У педагогов не задана оплата: ${esc(noPay.map(r=>r.name).join(", "))}. Их занятия считаются без затрат.</div>`:""}
   <div class="tw"><table><thead><tr><th>Педагог</th><th>Оплата</th><th class="n">Занятий</th><th class="n">Стоимость занятий</th><th class="n">Начислено</th><th class="n">Выплачено</th><th class="n">К выплате</th></tr></thead><tbody>
   ${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(tPayLabel(r.t)||"—")}</td><td class="n">${r.cnt}</td><td class="n">${money(r.rev)}</td><td class="n">${money(r.acc)}</td><td class="n">${money(r.paid)}</td>
     <td class="n" style="color:var(--${r.bal>0?"neg":"pos"})">${money(r.bal)}</td></tr>`).join("")}
   <tr class="total"><td>Итого</td><td></td><td class="n">${tot(r=>r.cnt)}</td><td class="n">${money(tot(r=>r.rev))}</td><td class="n">${money(tot(r=>r.acc))}</td><td class="n">${money(tot(r=>r.paid))}</td><td class="n">${money(tot(r=>r.bal))}</td></tr>
   </tbody></table></div>
   <div><h3 style="font-size:14px;margin-bottom:8px">Начислено по месяцам</h3>
   ${matrixTable(["Педагог",...MON_SHORT,"Год"],finishRows(rows.map(r=>({name:r.name,vals:r.byM}))))}</div>
  </div>`;
}
/* --- Рентабельность: направления, педагоги, абонементы, группы, точка безубыточности --- */
function visitEcon(y){
  const les={}; allLessons().forEach(l=>les[l.id]=l);
  const out=[];
  allAbon().forEach(a=>(a.visits||[]).forEach(v=>{
    if(+String(v.date).slice(0,4)!==y)return;
    const tid=v.teacherId||a.teacherId||"", l=v.lessonId?les[v.lessonId]:null;
    const n=l?Math.max(1,(l.attend||[]).filter(x=>x.abonId).length):1;
    out.push({a,date:v.date,rev:abPrice(a),cost:lessonPay(tObj(tid),abPrice(a),n),dir:a.direction||"Без привязки",tid,tpl:a.tariffId||""});
  }));
  return out;
}
function ecoTable(first,map,extra){
  const rows=Object.entries(map).sort((a,b)=>b[1].rev-a[1].rev||b[1].cost-a[1].cost);
  if(!rows.length)return `<div class="empty">Занятия ещё не проводились.</div>`;
  const tot=rows.reduce((t,[,x])=>({cnt:t.cnt+x.cnt,rev:t.rev+x.rev,cost:t.cost+x.cost,sold:t.sold+(x.sold||0)}),{cnt:0,rev:0,cost:0,sold:0});
  const line=(name,x,cls)=>{const m=x.rev-x.cost;return `<tr class="${cls||""}"><td>${esc(name)}</td>${extra?`<td class="n">${x.sold||""}</td>`:""}<td class="n">${x.cnt}</td><td class="n">${money(x.rev)}</td><td class="n">${money(x.cost)}</td><td class="n" style="color:var(--${m>=0?"pos":"neg"})">${money(m)}</td><td class="n">${x.rev?Math.round(m/x.rev*100)+"%":"—"}</td><td class="n">${x.cnt?money(x.rev/x.cnt):"—"}</td></tr>`;};
  return `<div class="tw"><table><thead><tr><th>${first}</th>${extra?'<th class="n">Продано, шт</th>':""}<th class="n">Занятий</th><th class="n">Выручка</th><th class="n">Оплата педагогов</th><th class="n">Маржа</th><th class="n">Маржа, %</th><th class="n">Цена занятия</th></tr></thead><tbody>
  ${rows.map(([k,x])=>line(k,x)).join("")}${line("Итого",tot,"total")}</tbody></table></div>`;
}
function repUnit(){
  const y=S.year, ve=visitEcon(y), ks=monthKeys(y), ev=payEvents(y);
  const IDLE="Занятия без абонемента";
  const grp=(keyFn,idleKey)=>{const m={};
    ve.forEach(x=>{const k=keyFn(x);const o=m[k]=m[k]||{cnt:0,rev:0,cost:0,sold:0};o.cnt++;o.rev+=x.rev;o.cost+=x.cost;});
    /* занятие без списаний: педагогу платить надо, выручки нет */
    idle.forEach(e=>{const k=idleKey(e);const o=m[k]=m[k]||{cnt:0,rev:0,cost:0,sold:0};o.cost+=e.cost;});
    return m;};
  const idle=ev.filter(e=>e.kind==="lesson"&&!e.paid);
  const byDir=grp(x=>x.dir,e=>e.dir), byTeach=grp(x=>teacherName(x.tid)||"Педагог не указан",e=>teacherName(e.tid)||"Педагог не указан");
  const byTpl=grp(x=>{const t=tariff(x.tpl);return t?t.name:"Без шаблона";},()=>IDLE);
  allAbon().filter(a=>+String(a.date).slice(0,4)===y).forEach(a=>{const t=tariff(a.tariffId),k=t?t.name:"Без шаблона";const o=byTpl[k]=byTpl[k]||{cnt:0,rev:0,cost:0,sold:0};o.sold++;});
  const rev=sumArr(ve.map(x=>x.rev)), vcost=sumArr(ve.map(x=>x.cost)), cnt=ve.length;
  const idleCost=sumArr(idle.map(e=>e.cost)), cost=vcost+idleCost, margin=rev-cost;
  const noRate=[...new Set(ev.filter(e=>!tHasPay(tObj(e.tid))).map(e=>teacherName(e.tid)||"Педагог не указан"))];
  /* по группам: выручка, оплата педагога, сколько платящих нужно, чтобы занятие окупило педагога */
  const gm={};
  ev.filter(e=>e.kind==="lesson").forEach(e=>{
    const g=e.grp?groupById(e.grp):null, key=e.grp?(g?g.name:"Группа удалена"):"Индивидуальные занятия";
    const o=gm[key]=gm[key]||{les:0,all:0,paid:0,rev:0,cost:0,size:g?(g.studentIds||[]).length:0};
    o.les++;o.all+=e.all;o.paid+=e.paid;o.rev+=e.rev;o.cost+=e.cost;
  });
  const gRows=Object.entries(gm).sort((a,b)=>b[1].rev-a[1].rev);
  /* точка безубыточности */
  const constByM=bdrExpenses(y).tot.const;
  const monthsData=constByM.filter(x=>x>0).length, constAvg=monthsData?sumArr(constByM)/monthsData:0;
  const visitMonths=new Set(ve.map(x=>ym(x.date))).size, perMonth=visitMonths?cnt/visitMonths:0;
  const avgMargin=cnt?margin/cnt:0, need=avgMargin>0&&constAvg?Math.ceil(constAvg/avgMargin):0;
  const constYear=sumArr(constByM);
  return `<div class="pad stack">
   <div class="hint">Выручка — по методу начисления (стоимость проведённых занятий). Оплата педагогов — расчётная, по модели из справочника «Педагоги»: ставка за занятие (в групповом занятии делится между учениками со списанием) или процент от стоимости занятия.</div>
   <div class="stats" style="box-shadow:none">
    <div class="stat"><span class="k">Выручка</span><span class="v num">${money(rev)}</span><span class="n">${cnt} проведённых занятий</span></div>
    <div class="stat"><span class="k">Оплата педагогов</span><span class="v num">${money(cost)}</span><span class="n">${idle.length?"в т.ч. без выручки "+money(idleCost)+" ₽":"по моделям оплаты"}</span></div>
    <div class="stat"><span class="k">Маржа</span><span class="v num ${margin>=0?"pos":"neg"}">${money(margin)}</span><span class="n">${rev?Math.round(margin/rev*100):0}% от выручки</span></div>
    <div class="stat"><span class="k">Занятия без абонемента</span><span class="v num ${idle.length?"neg":""}">${idle.length}</span><span class="n">${idle.length?"оплата педагогов "+money(idleCost)+" ₽ без выручки":"таких нет"}</span></div>
   </div>
   ${noRate.length?`<div class="hint"><span class="chip warn">внимание</span> У педагогов не задана оплата: ${esc(noRate.join(", "))}. Их занятия считаются без затрат, маржа завышена.</div>`:""}
   <div><h3 style="font-size:14px;margin-bottom:8px">По направлениям</h3>${ecoTable("Направление",byDir)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">По педагогам</h3>${ecoTable("Педагог",byTeach)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">По абонементам</h3>${ecoTable("Абонемент",byTpl,true)}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">По группам</h3>
    ${gRows.length?`<div class="tw"><table><thead><tr><th>Группа</th><th class="n">Занятий</th><th class="n">В группе</th><th class="n">Приходит в среднем</th><th class="n">Из них со списанием</th><th class="n">Выручка</th><th class="n">Оплата педагога</th><th class="n">Маржа</th><th class="n">Маржа, %</th><th class="n">Окупается при</th></tr></thead><tbody>
    ${gRows.map(([k,o])=>{const m=o.rev-o.cost,perPaid=o.paid?o.rev/o.paid:0,need=perPaid&&o.cost?Math.ceil(o.cost/o.les/perPaid):0;
      return `<tr><td>${esc(k)}</td><td class="n">${o.les}</td><td class="n">${o.size||"—"}</td><td class="n">${(o.all/o.les).toFixed(1).replace(".",",")}</td><td class="n">${(o.paid/o.les).toFixed(1).replace(".",",")}</td>
      <td class="n">${money(o.rev)}</td><td class="n">${money(o.cost)}</td><td class="n" style="color:var(--${m>=0?"pos":"neg"})">${money(m)}</td><td class="n">${o.rev?Math.round(m/o.rev*100)+"%":"—"}</td>
      <td class="n">${need?need+" платящ.":"—"}</td></tr>`;}).join("")}
    </tbody></table></div>
    <div class="hint" style="margin-top:6px">«Окупается при» — сколько учеников со списанием должно прийти на одно занятие, чтобы выручка с них покрыла оплату педагога по средней цене занятия группы.</div>`
    :`<div class="empty">Занятия ещё не проводились.</div>`}</div>
   <div><h3 style="font-size:14px;margin-bottom:8px">Точка безубыточности</h3>
    ${constAvg&&cnt?`<div class="stats" style="box-shadow:none">
      <div class="stat"><span class="k">Постоянные расходы</span><span class="v num">${money(constAvg)}</span><span class="n">в месяц, в среднем по журналу</span></div>
      <div class="stat"><span class="k">Маржа с занятия</span><span class="v num">${money(avgMargin)}</span><span class="n">в среднем</span></div>
      <div class="stat"><span class="k">Нужно занятий в месяц</span><span class="v num">${need||"—"}</span><span class="n">чтобы покрыть постоянные расходы</span></div>
      <div class="stat"><span class="k">Проводится в месяц</span><span class="v num ${need&&perMonth>=need?"pos":"neg"}">${Math.round(perMonth)}</span><span class="n">${need?(perMonth>=need?"центр выходит в плюс":"не хватает "+Math.max(0,Math.ceil(need-perMonth))+" занятий"):""}</span></div>
     </div>
     <div class="hint" style="margin-top:8px">Результат за год: маржа ${money(margin)} − постоянные расходы ${money(constYear)} = <b class="num">${money(margin-constYear)} ₽</b> (до налогов).</div>`
    :`<div class="empty">Для расчёта нужны проведённые занятия и операции с постоянными расходами в журнале.</div>`}
   </div>
  </div>`;
}
/* --- Налоги --- */
function repTax(){
  const y=S.year,ops=opsOfYear(y);
  const qOf=(o)=>Math.floor((+o.date.slice(5,7)-1)/3);
  const qs=(f)=>[0,1,2,3].map(i=>ops.filter(o=>qOf(o)===i).reduce((s,o)=>s+f(o),0));
  const taxable=qs(o=>o.type==="income"&&artOf(o.article).inTax!==false?o.amount:0);
  const refunds=qs(o=>o.type==="expense"&&o.abonId?o.amount:0);
  const base=taxable.map((x,i)=>x-refunds[i]);
  const notTaxed=qs(o=>o.type==="income"&&artOf(o.article).inTax===false?o.amount:0);
  const qe=qs(o=>o.type==="expense"&&!o.abonId?o.amount:0);
  const usn=base.map(x=>x*R().usn/100);
  const fixed=R().fixedFee, baseY=sumArr(base);
  const extra=Math.max(0,baseY-300000)*0.01;
  const rows=[
    {name:"Поступления в налоговой базе",cls:"group",vals:taxable},
    {name:"Возвраты клиентам (уменьшают базу)",cls:"sub",vals:refunds},
    {name:"Налоговая база",cls:"group",vals:base},
    {name:"Поступления вне налоговой базы (справочно)",cls:"sub",vals:notTaxed},
    {name:"Платежи (справочно)",cls:"sub",vals:qe},
    {name:`Налог УСН ${R().usn}%`,cls:"total",vals:usn},
    {name:"Фиксированный взнос ИП",vals:[0,0,0,fixed]},
    {name:"Взнос 1% с дохода свыше 300 000 ₽",vals:[0,0,0,extra]},
    {name:"Итого к уплате в бюджет",cls:"total",vals:usn.map((x,i)=>x+(i===3?fixed+extra:0))}
  ];
  rows.forEach(r=>r.vals=[...r.vals,sumArr(r.vals)]);
  return matrixTable(["Показатель","1 квартал","2 квартал","3 квартал","4 квартал","Год"],rows,
    `Расчёт по кассовому методу. В базу входят поступления по статьям с признаком «налоговая база» (справочник «Статьи операций»); возврат по абонементу уменьшает базу. Ставка УСН и фиксированный взнос задаются в справочнике «Налоги». Взнос 1% начислен с базы свыше 300 000 ₽ и не уменьшен на вычеты — уточняйте у бухгалтера.`);
}

/* ============================ справочники ============================ */
/* ============================ справочники (НСИ) ============================ */
const NSI_MENU=[
  {title:"Операции",items:[{k:"articles",name:"Статьи операций"},{k:"sources",name:"Источники"}]},
  {title:"Занятия",items:[{k:"directions",name:"Направления"},{k:"plgroups",name:"Группы для P&L"},{k:"subjects",name:"Предметы"},{k:"tariffs",name:"Абонементы (шаблоны)"},{k:"teachers",name:"Педагоги"},{k:"students",name:"Ученики"}]},
  {title:"Настройки",items:[{k:"taxes",name:"Налоги"},{k:"access",name:"Доступ"}]},
  {title:"Контроль",items:[{k:"audit",name:"Проверка данных"}]}
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
    case"teachers":return S.teachers.filter(t=>!t.archived).length;case"students":return S.students.filter(s=>!s.archived).length;case"access":return MEMBERS.length;
    case"audit":return nsiAudit().length||"";default:return "";}
}
/* сколько раз значение справочника встречается в данных */
function nsiUsage(k,name){
  const ops=allOps(),ab=allAbon(),ls=allLessons();
  switch(k){
    case"articles":return ops.filter(o=>o.article===name).length+S.tariffs.filter(t=>t.article===name).length;
    case"sources":return ops.filter(o=>o.source===name).length;
    case"directions":return ops.filter(o=>o.direction===name).length+ab.filter(a=>a.direction===name).length+ls.filter(l=>l.direction===name).length
      +S.groups.filter(g=>g.direction===name).length+S.students.filter(s=>s.direction===name).length+S.tariffs.filter(t=>t.direction===name).length;
    case"subjects":return ops.filter(o=>o.subject===name).length+ab.filter(a=>a.subject===name).length+ls.filter(l=>l.subject===name).length+S.groups.filter(g=>g.subject===name).length+S.tariffs.filter(t=>t.subject===name).length+S.teachers.filter(t=>t.subject===name).length;
    case"plgroups":return R().directions.filter(d=>(d.group||"Без привязки")===name).length;
  }
  return 0;
}
/* переименование: заменить значение во всех данных и сохранить затронутое */
async function renameRef(k,oldN,newN){
  const months=new Set(); let grp=false,stud=false,tar=false,tea=false;
  const fix=(o,f,m)=>{if(o[f]===oldN){o[f]=newN;if(m)months.add(m);return true;}return false;};
  if(k==="articles"){for(const m in S.ops)S.ops[m].forEach(o=>fix(o,"article",m));S.tariffs.forEach(t=>{if(fix(t,"article"))tar=true;});}
  if(k==="sources")for(const m in S.ops)S.ops[m].forEach(o=>fix(o,"source",m));
  if(k==="directions"||k==="subjects"){
    const f=k==="directions"?"direction":"subject";
    for(const m in S.ops)S.ops[m].forEach(o=>fix(o,f,m));
    for(const m in S.abon)S.abon[m].forEach(a=>fix(a,f,m));
    for(const m in S.lessons)S.lessons[m].forEach(l=>fix(l,f,m));
    S.groups.forEach(g=>{if(fix(g,f))grp=true;});
    S.tariffs.forEach(t=>{if(fix(t,f))tar=true;});
    if(k==="subjects")S.teachers.forEach(t=>{if(fix(t,"subject"))tea=true;});
    if(k==="directions")S.students.forEach(s=>{if(fix(s,f))stud=true;});
  }
  if(k==="plgroups")R().directions.forEach(d=>{if(d.group===oldN)d.group=newN;});
  let ok=await saveRefs();
  for(const m of months){if(!(await saveMonth(m)))ok=false;}
  if(grp&&!(await saveGroups()))ok=false;
  if(stud&&!(await saveStudents()))ok=false;
  if(tar&&!(await saveTariffs()))ok=false;
  if(tea&&!(await saveTeachers()))ok=false;
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
  const search=["taxes","access","audit"].includes(k)?"":`<input type="search" id="nsi-q" placeholder="Поиск" value="${esc(S.nsiQ||"")}" autocomplete="off">`;
  const exp=["taxes","access","audit"].includes(k)?"":`<button class="btn mini" data-nsi-export="${k}" title="Выгрузить справочник в Excel">В Excel</button>`;
  return `<div class="panel">
    <header class="nsi-head"><h2>${esc(NSI_NAME[k])} <span class="chip mut">${nsiCount(k)}</span></h2>
      <div class="tools">${tools}${search}${exp}${add}</div></header>
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
      <td>${a.kind==="expense"?`<select data-art-nature="${i}" style="width:160px"><option value="var" ${a.nature==="var"||!a.nature?"selected":""}>переменный</option><option value="const" ${a.nature==="const"?"selected":""}>постоянный</option><option value="tax" ${a.nature==="tax"?"selected":""}>налоги и взносы</option></select>`:"—"}</td>
      <td class="c"><input type="checkbox" data-art-bdr="${i}" ${a.inBdr!==false?"checked":""} title="Учитывать в БДР и рентабельности"></td>
      <td class="c">${a.kind==="income"?`<input type="checkbox" data-art-tax="${i}" ${a.inTax!==false?"checked":""} title="Входит в налоговую базу УСН">`:"—"}</td>
      <td class="n">${nsiUsage("articles",a.name)||""}</td>
      <td class="n">${nsiBtns("articles",i,!prot,!prot)}</td></tr>`;};
    const idx=r.articles.map((a,i)=>[a,i]);
    const part=(kind,title)=>{const list=idx.filter(([a])=>a.kind===kind);return list.length?`${f?"":`<tr class="group" data-g="${kind}"><td colspan="7">${title} · ${list.length}</td></tr>`}${list.map(([a,i])=>row(a,i)).join("")}`:"";};
    const body=`<div class="tw"><table><thead><tr><th>Статья</th><th>Тип</th><th>Характер расхода</th><th class="c">В БДР</th><th class="c">Налоговая база</th><th class="n">Операций</th><th></th></tr></thead><tbody>
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
    const body=`<div class="tw"><table><thead><tr><th>Педагог</th><th>Предмет</th><th>Телефон</th><th>Оплата</th><th class="n">Проведено занятий</th><th></th></tr></thead><tbody>
      ${S.teachers.filter(t=>showArch("teachers")||!t.archived).sort((a,b)=>a.name.localeCompare(b.name,"ru")).map(t=>{const cnt=allAbon().reduce((s,a)=>s+(a.visits||[]).filter(x=>(x.teacherId||a.teacherId)===t.id).length,0);
      return `<tr data-s="${sAttr(t.name,t.subject,t.phone)}"><td>${esc(t.name)}${t.archived?' <span class="chip mut">архив</span>':""}</td><td>${esc(t.subject||"")}</td><td>${esc(t.phone||"")}</td><td>${esc(tPayLabel(t)||"—")}</td><td class="n">${cnt||""}</td>
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
      <td>${m.role==="viewer"?'<span class="chip mut">только просмотр</span>':'<span class="chip acc">полный доступ</span>'}</td>
      <td class="act">${m.email===ME?"":`<button class="btn mini" data-act="role-member" data-id="${esc(m.email)}">${m.role==="viewer"?"Дать полный доступ":"Сделать наблюдателем"}</button>
      <button class="btn mini danger" data-act="del-member" data-id="${esc(m.email)}">Закрыть доступ</button>`}</td></tr>`).join("")}
      </tbody></table></div>`;
    return nsiPanel(k,{body});
  }
  if(k==="audit"){
    const list=nsiAudit();
    const body=list.length?`<div class="pad hint">Здесь собраны места, где данные расходятся со справочниками или не хватает признаков для отчётов. Нажмите «Открыть», чтобы перейти к нужному справочнику.</div>
      <div class="tw"><table><thead><tr><th></th><th>Что найдено</th><th></th></tr></thead><tbody>
      ${list.map(x=>`<tr><td><span class="chip ${x.sev==="warn"?"warn":"mut"}">${x.sev==="warn"?"исправить":"проверить"}</span></td><td>${esc(x.text)}</td><td class="n">${x.k?`<button class="btn mini" data-nsi-go="${x.k}" data-name="${esc(x.q||"")}">Открыть</button>`:""}</td></tr>`).join("")}
      </tbody></table></div>`
      :`<div class="empty">Замечаний нет: все значения в данных есть в справочниках, у педагогов задана оплата, у шаблонов заполнены цены.</div>`;
    return nsiPanel(k,{body});
  }
  return "";
}
/* проверка согласованности справочников и данных */
function nsiAudit(){
  const out=[],r=R(),ops=allOps(),ab=allAbon(),ls=allLessons();
  const has={articles:new Set(r.articles.map(a=>a.name)),sources:new Set(r.sources),directions:new Set(r.directions.map(d=>d.name)),subjects:new Set(r.subjects),plgroups:new Set(r.groups)};
  const cnt=(arr,f)=>arr.reduce((m,x)=>{const v=f(x);if(v)m[v]=(m[v]||0)+1;return m;},{});
  const missing=(k,label,pairs)=>{ /* pairs: [[имя, число записей]] */
    pairs.forEach(([n,c])=>{ if(!has[k].has(n)) out.push({sev:"warn",k,q:"",text:`${label} «${n}» используется в записях (${c}), но его нет в справочнике. Добавьте значение или замените его в данных.`}); });
  };
  missing("articles","Статья",Object.entries(cnt(ops,o=>o.article)));
  missing("sources","Источник",Object.entries(cnt(ops,o=>o.source)));
  const dirCnt={};[...ops,...ab,...ls,...S.groups,...S.students,...S.tariffs].forEach(x=>{if(x.direction)dirCnt[x.direction]=(dirCnt[x.direction]||0)+1;});
  missing("directions","Направление",Object.entries(dirCnt));
  const subCnt={};[...ops,...ab,...ls,...S.groups,...S.tariffs].forEach(x=>{if(x.subject)subCnt[x.subject]=(subCnt[x.subject]||0)+1;});
  missing("subjects","Предмет",Object.entries(subCnt));
  r.directions.forEach(d=>{if(d.group&&!has.plgroups.has(d.group))out.push({sev:"warn",k:"directions",q:d.name,text:`У направления «${d.name}» указана группа для P&L «${d.group}», которой нет в справочнике.`});});
  const noGroup=r.directions.filter(d=>(d.group||"Без привязки")==="Без привязки"&&d.name!=="Без привязки");
  if(noGroup.length)out.push({sev:"info",k:"directions",q:"",text:`Направлений без группы для P&L: ${noGroup.length} (${noGroup.slice(0,4).map(d=>d.name).join(", ")}${noGroup.length>4?"…":""}). Их выручка в P&L попадёт в «Без привязки».`});
  S.teachers.filter(t=>!t.archived&&!tHasPay(t)).forEach(t=>out.push({sev:"info",k:"teachers",q:t.name,text:`У педагога «${t.name}» не задана оплата — в рентабельности его занятия считаются без затрат.`}));
  S.tariffs.filter(t=>!t.archived).forEach(t=>{
    if(!t.price)out.push({sev:"info",k:"tariffs",q:t.name,text:`У шаблона «${t.name}» не указана цена.`});
    else if(!t.direction)out.push({sev:"info",k:"tariffs",q:t.name,text:`У шаблона «${t.name}» не указано направление — выручка по нему пойдёт в «Без привязки».`});
    if(t.article&&!has.articles.has(t.article))out.push({sev:"warn",k:"tariffs",q:t.name,text:`У шаблона «${t.name}» указана статья «${t.article}», которой нет в справочнике.`});
  });
  const dups={};S.students.forEach(s=>{const k=s.name.trim().toLowerCase().replace(/\s+/g," ");(dups[k]=dups[k]||[]).push(s);});
  Object.values(dups).filter(a=>a.length>1).forEach(a=>out.push({sev:"warn",k:"students",q:"",text:`Ученик «${a[0].name}» заведён ${a.length} раза — возможно, дубль.`}));
  const noArt=ops.filter(o=>!o.article).length; if(noArt)out.push({sev:"warn",k:"",q:"",text:`Операций без статьи: ${noArt}.`});
  const owed=ab.filter(a=>abOwed(a)>0);
  if(owed.length)out.push({sev:"info",k:"",q:"",text:`Абонементов с долгом по оплате: ${owed.length} на ${money(owed.reduce((s,a)=>s+abOwed(a),0))} ₽ (раздел «Абонементы», фильтр «С долгом»).`});
  const exp=ab.filter(a=>abExpired(a));
  if(exp.length)out.push({sev:"info",k:"",q:"",text:`Абонементов с истёкшим сроком и неиспользованным остатком: ${exp.length}. Остаток признан выручкой; если ученик ещё придёт, продлите срок.`});
  const orphanPay=ops.filter(o=>o.abonId&&!ab.some(a=>a.id===o.abonId)).length; if(orphanPay)out.push({sev:"warn",k:"",q:"",text:`Операций, привязанных к несуществующему абонементу: ${orphanPay}.`});
  return out;
}
/* удаление используемого значения: сначала замена в данных */
function replaceModal(k,i){
  const r=R();
  const cur=k==="articles"?r.articles[i]:k==="directions"?r.directions[i]:null;
  const name=cur?cur.name:NSI_LIST[k].arr()[i];
  let cands=k==="articles"?r.articles.filter((a,j)=>j!==i&&a.kind===cur.kind).map(a=>a.name):k==="directions"?r.directions.filter((d,j)=>j!==i).map(d=>d.name):NSI_LIST[k].arr().filter((x,j)=>j!==i);
  if(!cands.length){toast("Нет другого значения, на которое можно заменить");return;}
  const used=nsiUsage(k,name);
  modal("Значение используется",`<div class="hint">«${esc(name)}» встречается в записях: ${used}. Чтобы удалить его, выберите, чем заменить его в этих записях.</div>
    <label class="f"><span>Заменить на</span><select name="to">${opt(cands)}</select></label>`,async(l)=>{
    const to=val(l,"to"); if(!to)return false;
    const arr=k==="articles"?r.articles:k==="directions"?r.directions:NSI_LIST[k].arr();
    let ok=await renameRef(k,name,to);
    const idx=k==="articles"?arr.findIndex(a=>a.name===name):k==="directions"?arr.findIndex(d=>d.name===name):arr.indexOf(name);
    if(idx>=0)arr.splice(idx,1);
    if(ok&&await saveRefs())toast(`Заменено на «${to}» и удалено`);
  },"Заменить и удалить");
}
/* выгрузка справочника в Excel */
async function exportNsi(k){
  let rows=[];
  const yn=(b)=>b?"да":"нет";
  if(k==="articles")rows=R().articles.map(a=>({Статья:a.name,Тип:a.kind==="income"?"доход":"расход",Характер:a.kind==="expense"?({const:"постоянный",tax:"налоги и взносы"}[a.nature]||"переменный"):"","В БДР":yn(a.inBdr!==false),"Налоговая база":a.kind==="income"?yn(a.inTax!==false):"",Операций:nsiUsage("articles",a.name)}));
  else if(k==="directions")rows=R().directions.map(d=>({Направление:d.name,"Группа для P&L":d.group,Используется:nsiUsage("directions",d.name)}));
  else if(NSI_LIST[k])rows=NSI_LIST[k].arr().map(x=>({[NSI_LIST[k].col]:x,Используется:nsiUsage(k,x)}));
  else if(k==="tariffs")rows=S.tariffs.map(t=>({Название:t.name,Занятий:t.lessons,Цена:t.price,"За занятие":t.lessons?Math.round(t.price/t.lessons):t.price,"Срок, дн.":t.validDays||"",Направление:t.direction,Предмет:t.subject,Педагог:teacherName(t.teacherId),Формат:t.format,Статья:t.article,Архив:yn(t.archived)}));
  else if(k==="teachers")rows=S.teachers.map(t=>({ФИО:t.name,Предмет:t.subject,Телефон:t.phone,Оплата:tPayLabel(t),Архив:yn(t.archived)}));
  if(!rows.length){toast("Справочник пуст");return;}
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),String(NSI_NAME[k]).slice(0,28));
  await download(`${NSI_NAME[k]}_Уникум.xlsx`,new Uint8Array(XLSX.write(wb,{bookType:"xlsx",type:"array"})));
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
  S.tariffs.forEach(t=>add("tariffs",t.name,[t.lessons+" зан.",t.direction,t.subject,teacherName(t.teacherId)].filter(Boolean).join(" · ")));
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
  box.querySelectorAll("[data-art-bdr]").forEach(c=>c.onchange=async()=>{R().articles[+c.dataset.artBdr].inBdr=c.checked;if(await saveRefs())toast(c.checked?"Статья учитывается в БДР":"Статья исключена из БДР");});
  box.querySelectorAll("[data-art-tax]").forEach(c=>c.onchange=async()=>{R().articles[+c.dataset.artTax].inTax=c.checked;if(await saveRefs())toast(c.checked?"Входит в налоговую базу":"Исключена из налоговой базы");});
  box.querySelectorAll("[data-nsi-export]").forEach(b=>b.onclick=()=>exportNsi(b.dataset.nsiExport));
  box.querySelectorAll("[data-dir-group]").forEach(s=>s.onchange=async()=>{R().directions[+s.dataset.dirGroup].group=s.value;if(await saveRefs())toast("Группировка обновлена");});
  box.querySelectorAll("[data-nsi-act]").forEach(b=>b.onclick=async()=>{
    const k=b.dataset.k,i=b.dataset.i===undefined?null:+b.dataset.i,act=b.dataset.nsiAct;
    if(act==="add"||act==="edit"){
      if(k==="articles")articleModal(i); else if(k==="directions")directionModal(i); else listModal(k,i);
      return;
    }
    if(act==="del"){
      const nm0=k==="articles"?R().articles[i].name:k==="directions"?R().directions[i].name:NSI_LIST[k].arr()[i];
      if(nsiUsage(k,nm0)>0){replaceModal(k,i);return;}
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
  const m=modal(a?"Статья":"Новая статья",`<div class="grid3">
    <label class="f"><span>Наименование</span><input name="name" value="${esc(a?a.name:"")}"></label>
    <label class="f"><span>Тип</span><select name="kind"><option value="income" ${kind==="income"?"selected":""}>Доход</option><option value="expense" ${kind==="expense"?"selected":""}>Расход</option></select></label>
    <label class="f" data-for="expense"><span>Характер расхода</span><select name="nature"><option value="var" ${!a||a.nature==="var"||!a.nature?"selected":""}>Переменный</option><option value="const" ${a&&a.nature==="const"?"selected":""}>Постоянный</option><option value="tax" ${a&&a.nature==="tax"?"selected":""}>Налоги и взносы</option></select></label>
  </div>
  <label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="inBdr" ${!a||a.inBdr!==false?"checked":""} style="width:auto"><span>Учитывать в БДР и рентабельности</span></label>
  <label class="row" style="align-items:center;gap:8px" data-for="income"><input type="checkbox" name="inTax" ${!a||a.inTax!==false?"checked":""} style="width:auto"><span>Входит в налоговую базу УСН</span></label>`,async(l)=>{
    const n=val(l,"name"); if(!n){toast("Укажите наименование");return false;}
    if(nsiDup(R().articles.map(x=>x.name),n,i)){toast("Такое название уже есть");return false;}
    const kd=val(l,"kind"),nt=kd==="expense"?val(l,"nature"):"var",flags={inBdr:chk(l,"inBdr"),inTax:kd==="income"?chk(l,"inTax"):(a?a.inTax!==false:true)};
    if(a){const old=a.name;Object.assign(a,{name:n,kind:kd,nature:nt},flags);if(await (old!==n?renameRef("articles",old,n):saveRefs()))toast("Сохранено");}
    else{R().articles.push(Object.assign({name:n,kind:kd,nature:nt},flags));if(await saveRefs())toast("Статья добавлена");}
  },a?"Сохранить":"Добавить");
  const sync=()=>{const kd=m.layer.querySelector('[name="kind"]').value;m.layer.querySelectorAll("[data-for]").forEach(e=>{e.style.display=e.dataset.for===kd?"":"none";});};
  m.layer.querySelector('[name="kind"]').onchange=sync;sync();
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
  <label class="f"><span>Относится к абонементу</span><select name="abonId">${opAbonOptions(o.studentId,o.abonId)}</select></label>
  <label class="f"><span>Комментарий</span><input name="note" value="${esc(o.note||"")}"></label>
  <label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="fisc" ${o.fisc?"checked":""} style="width:auto"><span class="hint">Чек пробит (фискализация)</span></label>`;
}
/* абонементы выбранного ученика — чтобы привязать к ним поступление или возврат (привязанная оплата не считается выручкой повторно) */
function opAbonOptions(studentId,sel){
  const list=allAbon().filter(a=>studentId?a.studentId===studentId:a.id===sel).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  return `<option value="">${studentId?"— не относится к абонементу —":"— сначала выберите ученика —"}</option>`+list.map(a=>`<option value="${a.id}" ${a.id===sel?"selected":""}>${esc(a.name)} · ${esc(a.date)} · ${money(a.price)} ₽</option>`).join("");
}
function bindOpForm(l){
  const st=l.querySelector('[name="studentId"]'),ab=l.querySelector('[name="abonId"]');
  if(st&&ab)st.onchange=()=>{ab.innerHTML=opAbonOptions(st.value,"");};
}
function readOp(l,base={}){
  return Object.assign({},base,{
    id:base.id||uid("op"), date:val(l,"date")||today(), type:val(l,"type"), amount:parseNum(val(l,"amount")),
    article:val(l,"article"), direction:val(l,"direction"), source:val(l,"source"),
    studentId:val(l,"studentId"), teacherId:val(l,"teacherId"), subject:val(l,"subject"),
    note:val(l,"note"), fisc:chk(l,"fisc"), abonId:l.querySelector('[name="abonId"]')?val(l,"abonId"):(base.abonId||"")
  });
}
function newOp(preStudent){
  const m=modal("Новая операция",opForm(preStudent?{studentId:preStudent}:{}),async(l)=>{
    const o=readOp(l); if(!o.amount){toast("Укажите сумму");return false;}
    const mm=pushOp(o); if(await saveMonth(mm))toast("Операция добавлена");
  },"Добавить");
  bindOpForm(m.layer);
}
function editOp(id){
  let found=null,mm=null;
  for(const m in S.ops){const o=S.ops[m].find(x=>x.id===id);if(o){found=o;mm=m;break;}}
  if(!found)return;
  const m=modal("Операция от "+found.date,opForm(found),async(l)=>{
    const o=readOp(l,found); const nm=ym(o.date);
    if(!o.amount){toast("Укажите сумму");return false;}
    S.ops[mm]=S.ops[mm].filter(x=>x.id!==id);
    ensureMonth(nm); S.ops[nm].push(o);
    let ok=await saveMonth(mm); if(nm!==mm&&!(await saveMonth(nm)))ok=false;
    if(ok)toast("Изменения сохранены");
  });
  bindOpForm(m.layer);
}
async function delOp(id){
  for(const m in S.ops){ if(S.ops[m].some(x=>x.id===id)){ S.ops[m]=S.ops[m].filter(x=>x.id!==id); markDel("un_ops",id); if(await saveMonth(m))toast("Операция удалена"); render(); return; } }
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
  const openAb=ab.filter(a=>abLive(a)), owedAll=ab.reduce((n,a)=>n+abOwed(a),0);
  modal(s.name,`
   <div class="row" style="gap:18px">
     <span class="hint">Оплачено: <b class="num">${money(pays.filter(p=>p.type==="income").reduce((n,p)=>n+p.amount,0))} ₽</b></span>
     <span class="hint">Остаток занятий: <b class="num">${ab.reduce((n,a)=>n+(abLive(a)?abLeft(a):0),0)}</b></span>
     ${owedAll?`<span class="hint">Долг по оплате: <b class="num" style="color:var(--neg)">${money(owedAll)} ₽</b></span>`:""}
     <span class="hint">Проведено: <b class="num">${visits.length}</b></span>
   </div>
   <div class="row">
     <button class="btn primary" data-act="new-abon" data-id="${s.id}">Продать абонемент</button>
     ${openAb.length?`<button class="btn" data-act="visit" data-id="${openAb[0].id}">Списать занятие</button>`:""}
     <button class="btn" data-act="new-op" data-id="${s.id}">Добавить оплату</button>
   </div>
   <h3 style="font-size:14px">Абонементы</h3>
   ${ab.length?`<div class="tw"><table><thead><tr><th>Дата</th><th>Абонемент</th><th class="n">Остаток</th><th></th></tr></thead><tbody>
   ${ab.map(a=>{const st=abState(a),owe=abOwed(a);return `<tr><td class="n">${esc(a.date)}</td><td>${esc(a.name)} ${st.k!=="live"?`<span class="chip ${st.cls}">${st.t}</span>`:""}${owe?` <span class="chip warn">долг ${money(owe)}</span>`:""}<div class="hint">${esc(a.direction||"")}</div></td><td class="n">${a.closedAt?"—":abLeft(a)+" из "+a.lessons}</td>
   <td class="n">${abLive(a)?`<button class="btn mini" data-act="visit" data-id="${a.id}">Списать</button> `:""}<button class="btn mini" data-act="abon-card" data-id="${a.id}">Карточка</button></td></tr>`;}).join("")}
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
    S.teachers=S.teachers.filter(x=>x.id!==id);markDel("un_teachers",id);if(await saveTeachers())toast("Удалено");
  }
  render();
}
function teacherForm(t={}){return `<div class="grid2">
  <label class="f"><span>ФИО</span><input name="name" value="${esc(t.name||"")}"></label>
  <label class="f"><span>Предмет / направление</span><input name="subject" value="${esc(t.subject||"")}" list="dl-subj"><datalist id="dl-subj">${[...R().subjects,...R().directions.map(d=>d.name)].map(x=>`<option value="${esc(x)}">`).join("")}</datalist></label>
  <label class="f"><span>Телефон</span><input name="phone" value="${esc(t.phone||"")}"></label>
  <label class="f"><span>Как платим педагогу</span><select name="payType"><option value="rate" ${t.payType!=="percent"?"selected":""}>Ставка за занятие</option><option value="percent" ${t.payType==="percent"?"selected":""}>Процент от стоимости занятия</option></select></label>
  <label class="f" data-pay="rate"><span>Ставка за занятие, ₽</span><input type="number" min="0" name="rate" value="${t.rate||""}"></label>
  <label class="f" data-pay="percent"><span>Процент, %</span><input type="number" min="0" max="100" step="any" name="payPercent" value="${t.payPercent||""}"></label></div>
  ${t.id?`<label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="archived" ${t.archived?"checked":""} style="width:auto"><span class="hint">В архиве (не показывать при выборе)</span></label>`:""}`;}
function bindTeacherForm(l){
  const sel=l.querySelector('[name="payType"]'),sync=()=>l.querySelectorAll("[data-pay]").forEach(e=>{e.style.display=e.dataset.pay===sel.value?"":"none";});
  sel.onchange=sync;sync();
}
const readTeacher=(l)=>({name:val(l,"name"),subject:val(l,"subject"),phone:val(l,"phone"),payType:val(l,"payType")==="percent"?"percent":"rate",
  rate:Math.max(0,parseNum(val(l,"rate"))),payPercent:Math.min(100,Math.max(0,parseNum(val(l,"payPercent"))))});
function newTeacher(){const m=modal("Новый педагог",teacherForm(),async(l)=>{const n=val(l,"name");if(!n){toast("Укажите ФИО");return false;}
  if(S.teachers.some(x=>x.name.toLowerCase()===n.toLowerCase())){toast("Такой педагог уже есть");return false;}
  S.teachers.push(Object.assign({id:uid("t"),archived:false},readTeacher(l)));if(await saveTeachers())toast("Педагог добавлен");},"Добавить");bindTeacherForm(m.layer);}
function editTeacher(id){const t=S.teachers.find(x=>x.id===id);if(!t)return;const m=modal("Педагог",teacherForm(t),async(l)=>{
  const n=val(l,"name");if(!n){toast("Укажите ФИО");return false;}
  if(S.teachers.some(x=>x.id!==id&&x.name.toLowerCase()===n.toLowerCase())){toast("Такой педагог уже есть");return false;}
  Object.assign(t,readTeacher(l),{archived:chk(l,"archived")});if(await saveTeachers())toast("Сохранено");});bindTeacherForm(m.layer);}
/* --- шаблоны абонементов (постоянные абонементы) --- */
const addDays=(iso,n)=>{const d=new Date((iso||today())+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const showArch=(k)=>!!(S.arch&&S.arch[k]);
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
    const n=Math.max(1,parseNum(val(l,"lessons"))||1),p=parseNum(val(l,"price")),t=tObj(val(l,"teacherId")),box=l.querySelector("[data-tpl-calc]");
    if(!box)return;
    const per=p/n,pay=t?lessonPay(t,per,1):0;
    box.textContent=tHasPay(t)?`За занятие: ${money(per)} ₽ · оплата педагога: ${t.payType==="percent"?t.payPercent+"% = ":""}${money(pay)} ₽ · маржа с занятия: ${money(per-pay)} ₽ (${per?Math.round((per-pay)/per*100):0}%)${t.payType==="percent"?"":" при индивидуальном занятии"}`
      :`За занятие: ${money(per)} ₽. Выберите педагога с заданной оплатой, чтобы увидеть маржу.`;
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
    S.tariffs=S.tariffs.filter(x=>x.id!==id);markDel("un_tariffs",id);if(await saveTariffs())toast("Удалено");
  }
  render();
}

/* --- продажа абонемента (из каталога, из карточки ученика или вручную) --- */
const REFUND_ART="Возврат оплаты по абонементу";
const lessonsWord=(n)=>{const a=n%100,b=n%10;return a>10&&a<15?"занятий":b===1?"занятие":b>=2&&b<=4?"занятия":"занятий";};
/* статья дохода для оплаты абонемента: из шаблона → «Абонемент на N занятий» → по названию → «Прочие доходы» */
function abonArticle(a,t){
  const inc=R().articles.filter(x=>x.kind==="income").map(x=>x.name);
  const tt=t||tariff(a.tariffId);
  return (tt&&tt.article&&inc.includes(tt.article)&&tt.article)||inc.find(x=>x===`Абонемент на ${a.lessons} ${lessonsWord(a.lessons)}`)||inc.find(x=>x===a.name)||(inc.includes("Прочие доходы")?"Прочие доходы":inc[0])||"Прочие доходы";
}
function payOp(a,amount,date,note){
  return {id:uid("op"),date:date||today(),type:"income",amount,article:abonArticle(a),direction:a.direction,subject:a.subject,
    source:"",studentId:a.studentId,teacherId:a.teacherId,note:note||a.name,abonId:a.id,fisc:false};
}
function newAbon(preStudent,preTariff,preset){
  const r=R(),tpls=tplList();
  if(preTariff&&!tpls.some(t=>t.id===preTariff)&&tariff(preTariff))tpls.push(tariff(preTariff));
  const pr0=preset||{};
  const m=modal("Продажа абонемента",`
   <label class="f"><span>Шаблон абонемента</span><select name="tariffId"><option value="">— без шаблона, ввести вручную —</option>${tpls.map(t=>`<option value="${t.id}" ${t.id===preTariff?"selected":""}>${esc(t.name)} · ${t.lessons} зан. · ${money(t.price)} ₽</option>`).join("")}</select></label>
   <div class="grid2">
     <label class="f"><span>Ученик</span><select name="studentId">${optId(S.students,preStudent)}</select></label>
     <label class="f"><span>Дата продажи</span><input type="date" name="date" value="${today()}"></label>
   </div>
   <div class="grid3">
     <label class="f"><span>Количество занятий</span><input type="number" name="lessons" min="1" value="${pr0.lessons||8}"></label>
     <label class="f"><span>Скидка, %</span><input type="number" name="discount" min="0" max="100" step="any" value=""></label>
     <label class="f"><span>Сумма к оплате, ₽</span><input type="number" name="price" min="0" value="${pr0.price||""}"></label>
   </div>
   <div class="grid2" data-carry-wrap style="display:none">
     <label class="f"><span>Перенос с прошлых абонементов, занятий</span><input type="number" name="carry" min="0" value="0"></label>
     <div class="hint" data-carry-info style="align-self:end"></div>
   </div>
   <div class="hint" data-sale-info></div>
   <div class="grid3">
     <label class="f"><span>Направление</span><select name="direction">${opt(r.directions.map(d=>d.name),pr0.direction)}</select></label>
     <label class="f"><span>Предмет</span><select name="subject">${opt(r.subjects,pr0.subject)}</select></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,pr0.teacherId)}</select></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Формат</span><select name="format">${optE(r.formats,pr0.format,"— не указан —")}</select></label>
     <label class="f"><span>Действует до</span><input type="date" name="until"></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Оплачено сейчас, ₽</span><input type="number" name="paid" min="0" value=""></label>
     <label class="f"><span>Заметка</span><input name="note"></label>
   </div>
  `,async(l)=>{
    const sid=val(l,"studentId"); if(!sid){toast("Выберите ученика");return false;}
    const tid=val(l,"tariffId"),t=tariff(tid);
    const lessons=Math.max(1,Math.round(parseNum(val(l,"lessons")))||(t?t.lessons:1));
    const gross=Math.max(0,parseNum(val(l,"price")));
    const avail=carryAvail(sid);
    const k=Math.min(Math.max(0,Math.round(parseNum(val(l,"carry")))),avail.length,lessons);
    const price=k?Math.round(gross*(lessons-k)/lessons):gross;
    const paid=Math.max(0,parseNum(val(l,"paid")));
    if(paid>price){toast("Оплата не может быть больше суммы абонемента");return false;}
    const list0=t&&t.lessons?Math.round(t.price/t.lessons*lessons):gross;
    const list=k?Math.round(list0*(lessons-k)/lessons):list0;
    const a={id:uid("ab"),date:val(l,"date")||today(),studentId:sid,tariffId:tid,name:t?t.name:(pr0.name||`Абонемент на ${lessons} ${lessonsWord(lessons)}`),
      lessons,price,listPrice:list,direction:val(l,"direction"),subject:val(l,"subject"),teacherId:val(l,"teacherId"),format:val(l,"format"),until:val(l,"until"),note:val(l,"note"),closedAt:"",refund:0,visits:[],
      absences:[],carryValue:0,carryFrom:[]};
    /* перенесённые занятия: старейшие первыми; их стоимость остаётся выручкой по цене прошлого абонемента */
    const months=new Set();
    avail.slice(0,k).forEach(({a:old,x})=>{
      a.carryValue+=abPrice(old); a.carryFrom.push({abonId:old.id,absId:x.id}); x.usedIn=a.id;
      const fo=findAbon(old.id); if(fo)months.add(fo.m);
    });
    months.add(pushAbon(a));
    if(paid>0)pushOp(payOp(a,paid,a.date));
    let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
    if(ok)toast((k?`Перенесено занятий: ${k}. `:"")+(paid<price?`Абонемент выставлен, долг ${money(price-paid)} ₽`:"Абонемент выставлен"));
  },"Выставить");
  const l=m.layer,F=(n)=>l.querySelector(`[name="${n}"]`),ts=F("tariffId"),dt=F("date"),un=F("until"),pr=F("price"),ls=F("lessons"),ds=F("discount"),pd=F("paid"),info=l.querySelector("[data-sale-info]");
  const sd=F("studentId"),cy=F("carry"),cwrap=l.querySelector("[data-carry-wrap]"),cinfo=l.querySelector("[data-carry-info]");
  const carryN=()=>{const av=carryAvail(sd.value).length,n=Math.max(1,parseNum(ls.value)||1);return Math.min(Math.max(0,Math.round(parseNum(cy.value))||0),av,n);};
  const netP=()=>{const g=parseNum(pr.value),n=Math.max(1,parseNum(ls.value)||1),k=carryN();return k?Math.round(g*(n-k)/n):g;};
  let untilTouched=false,paidTouched=false;
  const baseP=()=>{const t=tariff(ts.value),n=Math.max(1,parseNum(ls.value)||1);return t&&t.lessons?Math.round(t.price/t.lessons*n):0;};
  const setSel=(n,v)=>{const e=F(n);if(e&&v&&[...e.options].some(o=>o.value===v))e.value=v;};
  const followPaid=()=>{if(!paidTouched)pd.value=netP();};
  const refreshCarry=(reset)=>{
    const av=carryAvail(sd.value).length;
    cwrap.style.display=av?"":"none";
    if(reset)cy.value=av?Math.min(av,Math.max(1,parseNum(ls.value)||1)):0;
    cy.max=av;
  };
  const upd=()=>{
    const p=parseNum(pr.value),n=Math.max(1,parseNum(ls.value)||1),b=baseP(),paid=parseNum(pd.value),k=carryN();
    if(k){cinfo.textContent=`Вычитается ${money(p-netP())} ₽. К оплате: ${money(netP())} ₽.`;}else cinfo.textContent="";
    let s=p?`За занятие: ${money(p/n)} ₽.`:"";
    if(b&&p<b)s+=` Скидка к цене шаблона: ${money(b-p)} ₽ (${Math.round((b-p)/b*1000)/10}%).`;
    else if(b&&p>b)s+=` Выше цены шаблона на ${money(p-b)} ₽.`;
    const net=netP();
    if(net&&paid<net)s+=` Останется долг: ${money(net-paid)} ₽.`;
    info.textContent=s;
  };
  const untilFromTpl=()=>{const t=tariff(ts.value);if(!untilTouched&&t&&t.validDays)un.value=addDays(dt.value,t.validDays);};
  ts.onchange=()=>{const t=tariff(ts.value);if(!t){upd();return;}
    ls.value=t.lessons;pr.value=t.price;ds.value="";setSel("direction",t.direction);setSel("subject",t.subject);setSel("teacherId",t.teacherId);setSel("format",t.format);
    untilTouched=false;un.value=t.validDays?addDays(dt.value,t.validDays):"";refreshCarry(true);followPaid();upd();};
  dt.onchange=untilFromTpl;un.oninput=()=>{untilTouched=true;};
  ds.oninput=()=>{const b=baseP();if(b){const d=Math.min(100,Math.max(0,parseNum(ds.value)));pr.value=Math.round(b*(1-d/100));followPaid();}upd();};
  pr.oninput=()=>{const b=baseP(),p=parseNum(pr.value);ds.value=b&&p<b?Math.round((b-p)/b*1000)/10:"";followPaid();upd();};
  ls.oninput=()=>{refreshCarry(false);followPaid();upd();};
  cy.oninput=()=>{followPaid();upd();};
  sd.onchange=()=>{refreshCarry(true);followPaid();upd();};
  pd.oninput=()=>{paidTouched=true;upd();};
  refreshCarry(true);
  if(ts.value)ts.onchange();
  else if(pr0.price){followPaid();upd();}
  else upd();
}
/* --- списание занятия --- */
function visitAbon(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  if(a.closedAt){toast("Абонемент закрыт");return;}
  if(abLeft(a)<=0){toast("Занятия по абонементу закончились");return;}
  modal("Списать занятие · "+(studentName(a.studentId)||a.name),`
   <div class="hint">${esc(a.name)} · остаток ${abLeft(a)} из ${a.lessons} · ${money(abPrice(a))} ₽ за занятие${a.until?" · действует до "+esc(a.until):""}</div>
   <div class="grid3">
     <label class="f"><span>Дата занятия</span><input type="date" name="date" value="${today()}"></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,a.teacherId)}</select></label>
     <label class="f"><span>Занятий списать</span><input type="number" name="qty" value="1" min="1" max="${abLeft(a)}"></label>
   </div>
   <label class="f"><span>Комментарий</span><input name="note" placeholder="тема занятия, замена, опоздание"></label>
  `,async(l)=>{
    const d=val(l,"date")||today();
    if(a.until&&d>a.until){toast("Срок абонемента истёк "+a.until+" — сначала продлите срок в карточке абонемента");return false;}
    const qty=Math.min(abLeft(a),Math.max(1,parseNum(val(l,"qty"))));
    for(let i=0;i<qty;i++)a.visits.push({date:d,teacherId:val(l,"teacherId"),note:val(l,"note")});
    if(await saveMonth(f.m))toast(qty>1?`Списано занятий: ${qty}`:"Занятие списано");
  },"Списать");
}
/* --- карточка абонемента: все действия над проданным абонементом --- */
function abonCard(id){
  const f=findAbon(id); if(!f)return; const a=f.a, st=abState(a), owe=abOwed(a), paid=abPaid(a);
  const pays=allOps().filter(o=>o.abonId===a.id).sort((x,y)=>(x.date||"").localeCompare(y.date||""));
  const disc=a.listPrice!=null&&a.listPrice>a.price?a.listPrice-a.price:0;
  const unused=abUnused(a), br=abBreak(a);
  modal("Абонемент · "+(studentName(a.studentId)||a.name),`
   <div class="stats" style="box-shadow:none">
    <div class="stat"><span class="k">Состояние</span><span class="v" style="font-size:16px"><span class="chip ${st.cls}">${st.t}</span></span><span class="n">${esc(a.name)}</span></div>
    <div class="stat"><span class="k">Занятий</span><span class="v num">${(a.visits||[]).length}/${a.lessons}</span><span class="n">${a.closedAt?"остаток закрыт":"остаток "+abLeft(a)+(abPending(a)?", перенос "+abPending(a):"")}</span></div>
    <div class="stat"><span class="k">Цена</span><span class="v num">${money(a.price)}</span><span class="n">${disc?"скидка "+money(disc)+" ₽":money(abPrice(a))+" ₽ за занятие"}${a.carryFrom&&a.carryFrom.length?`<br>перенесено занятий: ${a.carryFrom.length} на ${money(a.carryValue)} ₽`:""}</span></div>
    <div class="stat"><span class="k">Оплачено</span><span class="v num ${owe?"neg":"pos"}">${money(paid)}</span><span class="n">${owe?"долг "+money(owe)+" ₽":"полностью"}</span></div>
   </div>
   <div class="hint">Продан ${esc(a.date)}${a.until?" · действует до "+esc(a.until):" · без срока"} · ${esc([a.direction,a.subject,teacherName(a.teacherId),a.format].filter(Boolean).join(" · ")||"без привязки")}${a.note?"<br>"+esc(a.note).replace(/\n/g,"<br>"):""}</div>
   ${a.closedAt?`<div class="hint"><span class="chip mut">закрыт ${esc(a.closedAt)}</span> возвращено клиенту ${money(a.refund)} ₽${br&&br.amount?`, удержано как выручка ${money(br.amount)} ₽`:""}</div>`:""}
   ${st.k==="expired"&&br?`<div class="hint"><span class="chip out">срок истёк ${esc(a.until)}</span> неотработанные ${unused} зан. (${money(br.val)} ₽) признаны выручкой на эту дату. Продлите срок, если ученик ещё будет заниматься.</div>`:""}
   <div class="row" style="flex-wrap:wrap">
     ${abLive(a)?`<button class="btn primary" data-act="visit" data-id="${a.id}">Списать занятие</button>`:""}
     ${owe?`<button class="btn" data-act="abon-pay" data-id="${a.id}">Принять оплату</button>`:""}
     ${!a.closedAt&&abFree(a)>0?`<button class="btn" data-act="abs-add" data-id="${a.id}">Отметить пропуск</button>`:""}
     ${!a.closedAt&&unused>0?`<button class="btn" data-act="abon-extend" data-id="${a.id}">Продлить срок</button>`:""}
     <button class="btn" data-act="abon-edit" data-id="${a.id}">Изменить</button>
     <button class="btn" data-act="abon-renew" data-id="${a.id}">Продать ещё такой же</button>
     ${!a.closedAt&&unused>0?`<button class="btn" data-act="abon-close" data-id="${a.id}">Закрыть с возвратом</button>`:""}
     ${a.closedAt?`<button class="btn" data-act="abon-reopen" data-id="${a.id}">Открыть снова</button>`:""}
     <button class="btn danger" data-act="abon-del" data-id="${a.id}">Удалить</button>
   </div>
   <h3 style="font-size:14px">Занятия</h3>
   ${(a.visits||[]).length?`<div class="tw"><table><thead><tr><th>№</th><th>Дата</th><th>Педагог</th><th>Комментарий</th><th></th></tr></thead><tbody>
   ${a.visits.map((v,i)=>`<tr><td class="n">${i+1}</td><td class="n">${esc(v.date)}</td><td>${esc(teacherName(v.teacherId))}</td><td>${esc(v.note||"")}</td>
   <td class="n"><button class="btn mini danger" data-act="del-visit" data-id="${a.id}" data-i="${i}">Отменить</button></td></tr>`).join("")}
   </tbody></table></div>`:`<div class="hint">Занятия ещё не списывались.</div>`}
   ${abAbsences(a).length?`<h3 style="font-size:14px">Пропуски и перенос</h3>
   <div class="tw"><table><thead><tr><th>Дата</th><th>Причина</th><th>Занятие</th><th>Что с занятием</th><th></th></tr></thead><tbody>
   ${abAbsences(a).slice().sort((p,q)=>(p.date||"").localeCompare(q.date||"")).map(x=>{
     const nx=x.usedIn?findAbon(x.usedIn):null;
     const st=!x.carry?`<span class="chip out">списано</span>`:x.usedIn?`<span class="chip in">учтено в абонементе${nx?" от "+esc(nx.a.date):""}</span>`:`<span class="chip warn">ждёт следующего абонемента</span>`;
     return `<tr><td class="n">${esc(x.date)}</td><td>${esc(absReason(x.reason).t)}</td><td>${esc(x.group||"")}${x.note?`<div class="hint">${esc(x.note)}</div>`:""}</td><td>${st}</td>
     <td class="n">${x.usedIn?"":`<button class="btn mini danger" data-act="abs-del" data-id="${a.id}" data-i="${esc(x.id)}">Убрать</button>`}</td></tr>`;}).join("")}
   </tbody></table></div>`:""}
   ${a.carryFrom&&a.carryFrom.length?`<div class="hint">При продаже учтено перенесённых занятий: ${a.carryFrom.length}. Их стоимость (${money(a.carryValue)} ₽) вычтена из суммы к оплате и признаётся выручкой по мере занятий.</div>`:""}
   <h3 style="font-size:14px">Оплаты по абонементу</h3>
   ${pays.length?`<div class="tw"><table><tbody>${pays.map(p=>`<tr><td class="n">${esc(p.date)}</td><td>${esc(p.article||"")}</td><td class="n" style="color:var(--${p.type==="income"?"pos":"neg"})">${p.type==="income"?"+":"−"}${money(p.amount)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="hint">Оплат нет.</div>`}
  `,null);
  bind(document.getElementById("layer"));
}
function absAdd(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  modal("Пропуск · "+(studentName(a.studentId)||a.name),`
   <div class="grid2">
     <label class="f"><span>Дата занятия</span><input type="date" name="date" value="${today()}"></label>
     <label class="f"><span>Причина</span><select name="reason">${ABS_REASONS.map(r=>`<option value="${r.k}">${r.t}</option>`).join("")}</select></label>
   </div>
   <label class="f"><span>Комментарий</span><input name="note" placeholder="что за занятие, подробности"></label>
  `,async(l)=>{
    const d=val(l,"date")||today(), rk=val(l,"reason")||"center", note=val(l,"note");
    if(abFree(a)<=0){toast("Свободных занятий нет");return false;}
    if(!absReason(rk).carry){
      a.visits.push({date:d,teacherId:a.teacherId||"",note:"Пропуск без предупреждения"+(note?": "+note:"")});
      if(await saveMonth(f.m))toast("Занятие списано как пропуск без предупреждения");
      return;
    }
    if(abAbsences(a).some(x=>x.date===d&&!x.groupId&&x.note===note)){toast("Этот пропуск уже отмечен");return false;}
    (a.absences=a.absences||[]).push({id:uid("abs"),date:d,reason:rk,carry:true,groupId:"",group:"",whole:false,note,usedIn:""});
    if(await saveMonth(f.m))toast("Занятие перенесено на следующий абонемент");
  },"Отметить");
}
async function absDel(id,absId){
  const f=findAbon(id); if(!f)return; const x=abAbsences(f.a).find(y=>y.id===absId); if(!x)return;
  if(x.usedIn){toast("Это занятие уже учтено в другом абонементе");return;}
  f.a.absences=f.a.absences.filter(y=>y!==x);
  if(await saveMonth(f.m))toast("Пропуск убран, занятие снова доступно");
  document.getElementById("layer").innerHTML="";render();
}
async function delVisit(id,i){
  const f=findAbon(id); if(!f)return; const [v]=f.a.visits.splice(i,1);
  /* строка в журнале занятий, из которой пришло списание, не должна ссылаться на удалённое */
  const months=new Set([f.m]);
  if(v&&v.lessonId)for(const m of Object.keys(S.lessons))S.lessons[m].forEach(ls=>{if(ls.id===v.lessonId)(ls.attend||[]).forEach(at=>{if(at.abonId===f.a.id&&at.studentId===f.a.studentId){at.abonId="";at.price=0;months.add(m);}});});
  let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
  if(ok)toast("Списание отменено");
  document.getElementById("layer").innerHTML=""; render();
}
function abonEdit(id){
  const f=findAbon(id); if(!f)return; const a=f.a,r=R();
  modal("Изменить абонемент",`
   <label class="f"><span>Название</span><input name="name" value="${esc(a.name)}"></label>
   <div class="grid3">
     <label class="f"><span>Ученик</span><select name="studentId">${optId(S.students,a.studentId)}</select></label>
     <label class="f"><span>Дата продажи</span><input type="date" name="date" value="${esc(a.date)}"></label>
     <label class="f"><span>Действует до</span><input type="date" name="until" value="${esc(a.until||"")}"></label>
   </div>
   <div class="grid3">
     <label class="f"><span>Количество занятий</span><input type="number" name="lessons" min="${Math.max(1,(a.visits||[]).length+abApplied(a)+abPending(a))}" value="${a.lessons}"></label>
     <label class="f"><span>Сумма, ₽</span><input type="number" name="price" min="0" value="${a.price}"></label>
     <label class="f"><span>Цена без скидки, ₽</span><input type="number" name="listPrice" min="0" value="${a.listPrice==null?a.price:a.listPrice}"></label>
   </div>
   <div class="grid3">
     <label class="f"><span>Направление</span><select name="direction">${opt(r.directions.map(d=>d.name),a.direction)}</select></label>
     <label class="f"><span>Предмет</span><select name="subject">${opt(r.subjects,a.subject)}</select></label>
     <label class="f"><span>Педагог</span><select name="teacherId">${optId(S.teachers,a.teacherId)}</select></label>
   </div>
   <div class="grid2">
     <label class="f"><span>Формат</span><select name="format">${optE(r.formats,a.format,"— не указан —")}</select></label>
     <label class="f"><span>Заметка</span><input name="note" value="${esc(a.note||"")}"></label>
   </div>
   <div class="hint">Если изменить сумму или количество занятий, стоимость уже проведённых занятий в отчётах пересчитается.</div>
  `,async(l)=>{
    const name=val(l,"name"); if(!name){toast("Укажите название");return false;}
    if(!val(l,"studentId")){toast("Выберите ученика");return false;}
    const lessons=Math.round(parseNum(val(l,"lessons")));
    if(lessons<Math.max(1,(a.visits||[]).length)){toast("Занятий не может быть меньше уже проведённых ("+(a.visits||[]).length+")");return false;}
    const oldM=f.m;
    Object.assign(a,{name,studentId:val(l,"studentId"),date:val(l,"date")||a.date,until:val(l,"until"),lessons,price:Math.max(0,parseNum(val(l,"price"))),
      listPrice:Math.max(0,parseNum(val(l,"listPrice"))),direction:val(l,"direction"),subject:val(l,"subject"),teacherId:val(l,"teacherId"),format:val(l,"format"),note:val(l,"note")});
    /* оплаты привязаны к ученику — переносим вместе с абонементом */
    allOps().filter(o=>o.abonId===a.id).forEach(o=>{o.studentId=a.studentId;});
    const nm=ym(a.date);
    if(nm!==oldM){S.abon[oldM]=S.abon[oldM].filter(x=>x.id!==a.id);ensureMonth(nm);S.abon[nm].push(a);}
    let ok=await saveMonth(oldM); if(nm!==oldM&&!(await saveMonth(nm)))ok=false;
    for(const m of Object.keys(S.ops)) if(S.ops[m].some(o=>o.abonId===a.id)&&m!==oldM&&m!==nm) if(!(await saveMonth(m)))ok=false;
    if(ok)toast("Сохранено");
  });
}
function abonPay(id){
  const f=findAbon(id); if(!f)return; const a=f.a, owe=abOwed(a);
  modal("Принять оплату",`
   <div class="hint">${esc(studentName(a.studentId))} · ${esc(a.name)} · сумма ${money(a.price)} ₽ · не оплачено ${money(owe)} ₽</div>
   <div class="grid2">
     <label class="f"><span>Сумма, ₽</span><input type="number" name="amount" min="0" value="${owe}"></label>
     <label class="f"><span>Дата оплаты</span><input type="date" name="date" value="${today()}"></label>
   </div>
  `,async(l)=>{
    const amount=parseNum(val(l,"amount")); if(!(amount>0)){toast("Укажите сумму");return false;}
    if(amount>owe){toast("Оплата больше долга ("+money(owe)+" ₽)");return false;}
    const m=pushOp(payOp(a,amount,val(l,"date")||today(),a.name));
    if(await saveMonth(m))toast("Оплата принята: "+money(amount)+" ₽");
  },"Принять");
}
function abonExtend(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  const base=a.until&&a.until>today()?a.until:today();
  const m=modal("Продлить срок абонемента",`
   <div class="hint">${esc(studentName(a.studentId))} · ${esc(a.name)} · сейчас ${a.until?"действует до "+esc(a.until):"без срока"} · остаток ${abUnused(a)} зан.</div>
   <div class="row" style="gap:6px">${[7,14,30,60].map(n=>`<button class="btn mini" type="button" data-plus="${n}">+${n} дн.</button>`).join("")}</div>
   <label class="f"><span>Новая дата окончания</span><input type="date" name="until" value="${addDays(base,14)}"></label>
   <label class="f"><span>Причина (в заметку)</span><input name="why" placeholder="болезнь, каникулы"></label>
  `,async(l)=>{
    const u=val(l,"until"); if(!u){toast("Укажите дату");return false;}
    const was=a.until;
    a.until=u;
    a.note=[a.note,`${today()}: срок ${was?"с "+was+" ":""}продлён до ${u}${val(l,"why")?" ("+val(l,"why")+")":""}`].filter(Boolean).join("\n");
    if(await saveMonth(f.m))toast("Срок продлён до "+u);
  },"Продлить");
  m.layer.querySelectorAll("[data-plus]").forEach(b=>b.onclick=()=>{m.layer.querySelector('[name="until"]').value=addDays(base,+b.dataset.plus);});
}
function abonClose(id){
  const f=findAbon(id); if(!f)return; const a=f.a, un=abUnused(a), val0=Math.round(un*abPrice(a)), paid=abPaid(a);
  const exp=R().articles.filter(x=>x.kind==="expense").map(x=>x.name);
  const def=REFUND_ART;
  modal("Закрыть абонемент с возвратом",`
   <div class="hint">${esc(studentName(a.studentId))} · ${esc(a.name)}. Не использовано ${un} зан. на ${money(val0)} ₽. Оплачено ${money(paid)} ₽.<br>
   Возвращённая сумма не считается выручкой; невозвращённый остаток центр признаёт выручкой в день закрытия.</div>
   <div class="grid3">
     <label class="f"><span>Вернуть клиенту, ₽</span><input type="number" name="refund" min="0" value="${Math.min(val0,paid)}"></label>
     <label class="f"><span>Дата</span><input type="date" name="date" value="${today()}"></label>
     <label class="f"><span>Статья платежа</span><select name="article">${opt(exp.includes(REFUND_ART)?exp:[REFUND_ART,...exp],def)}</select></label>
   </div>
  `,async(l)=>{
    const refund=Math.max(0,parseNum(val(l,"refund")));
    if(refund>val0){toast("Возврат больше стоимости остатка ("+money(val0)+" ₽)");return false;}
    if(refund>paid){toast("Возврат больше фактически оплаченной суммы ("+money(paid)+" ₽)");return false;}
    const date=val(l,"date")||today(), art=val(l,"article")||REFUND_ART;
    if(!R().articles.some(x=>x.name===art)){R().articles.push({name:art,kind:"expense",nature:"var",inBdr:false,inTax:true});if(!(await saveRefs()))return false;}
    a.closedAt=date;a.refund=refund;
    const months=new Set([f.m]);
    if(refund>0)months.add(pushOp({id:uid("op"),date,type:"expense",amount:refund,article:art,direction:a.direction,subject:a.subject,source:"",studentId:a.studentId,teacherId:"",note:"Возврат: "+a.name,abonId:a.id,fisc:false}));
    let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
    if(ok)toast(refund?"Абонемент закрыт, возврат "+money(refund)+" ₽":"Абонемент закрыт без возврата");
  },"Закрыть абонемент");
}
async function abonReopen(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  if(!confirm("Открыть абонемент снова? Операция возврата по нему будет удалена из журнала."))return;
  const months=new Set([f.m]);
  for(const m of Object.keys(S.ops)){const gone=S.ops[m].filter(o=>o.abonId===a.id&&o.type==="expense");
    if(gone.length){gone.forEach(o=>markDel("un_ops",o.id));S.ops[m]=S.ops[m].filter(o=>!gone.includes(o));months.add(m);}}
  a.closedAt="";a.refund=0;
  let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
  if(ok)toast("Абонемент открыт снова");
  document.getElementById("layer").innerHTML="";render();
}
function abonDelete(id){
  const f=findAbon(id); if(!f)return; const a=f.a;
  if(abApplied(a)>0){toast("Часть занятий перенесена в другой абонемент — сначала удалите тот абонемент");return;}
  const ops=allOps().filter(o=>o.abonId===a.id), sum=ops.filter(o=>o.type==="income").reduce((s,o)=>s+o.amount,0);
  modal("Удалить абонемент",`
   <div class="hint">${esc(studentName(a.studentId))} · ${esc(a.name)} · ${money(a.price)} ₽. Проведённых занятий: ${(a.visits||[]).length}.</div>
   ${(a.visits||[]).length?`<div class="warnbox">Вместе с абонементом исчезнут списания занятий — выручка по ним пропадёт из БДР. Если ученик просто перестал ходить, лучше «Закрыть с возвратом».</div>`:""}
   ${ops.length?`<label class="row" style="align-items:center;gap:8px"><input type="checkbox" name="withOps" checked style="width:auto"><span>Удалить и связанные операции в журнале (${ops.length} шт., поступлений на ${money(sum)} ₽)</span></label>`:""}
   <div class="hint">Действие нельзя отменить.</div>
  `,async(l)=>{
    const months=new Set([f.m]);
    const withOps=ops.length&&chk(l,"withOps");
    for(const m of Object.keys(S.ops)){
      const mine=S.ops[m].filter(o=>o.abonId===a.id);
      if(!mine.length)continue;
      if(withOps){mine.forEach(o=>markDel("un_ops",o.id));S.ops[m]=S.ops[m].filter(o=>o.abonId!==a.id);}
      else mine.forEach(o=>{o.abonId="";});
      months.add(m);
    }
    /* занятия из журнала групп становятся «без абонемента» */
    for(const m of Object.keys(S.lessons))S.lessons[m].forEach(ls=>(ls.attend||[]).forEach(at=>{if(at.abonId===a.id){at.abonId="";at.price=0;months.add(m);}}));
    /* перенесённые в него занятия снова ждут следующего абонемента */
    (a.carryFrom||[]).forEach(cf=>{const fo=findAbon(cf.abonId);if(fo){const x=abAbsences(fo.a).find(y=>y.id===cf.absId);if(x&&x.usedIn===a.id){x.usedIn="";months.add(fo.m);}}});
    S.abon[f.m]=S.abon[f.m].filter(x=>x.id!==a.id); markDel("un_abon",a.id);
    let ok=true;for(const m of months)if(!(await saveMonth(m)))ok=false;
    if(ok)toast("Абонемент удалён");
  },"Удалить");
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
  const kind=type==="income"?"income":"expense", arts=R().articles;
  /* подсказка применяется, только если такая статья нужного типа есть в справочнике */
  for(const [re,name] of RULES) if(re.test(text)&&arts.some(a=>a.name===name&&a.kind===kind)) return name;
  const other=arts.find(x=>x.kind===kind&&NSI_KEEP_ART.includes(x.name))||arts.find(x=>x.kind===kind);
  return other?other.name:"";
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
        let wb;
        if(/\.csv$/i.test(file.name)){
          /* CSV: кодировка UTF-8 или Windows-1251, разделитель «;», «,» или табуляция; даты и числа оставляем текстом, как в файле */
          const bytes=new Uint8Array(rd.result);let text;
          try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}catch(e){text=new TextDecoder("windows-1251").decode(bytes);}
          const head=text.split(/\r?\n/).find(x=>x.trim())||"";
          const fs=[";","\t",","].map(c=>[c,head.split(c).length-1]).sort((a,b)=>b[1]-a[1])[0][0];
          wb=XLSX.read(text,{type:"string",raw:true,FS:fs});
        } else wb=XLSX.read(rd.result,{type:"array",cellDates:true});
        const sh=wb.Sheets[wb.SheetNames[0]];
        /* raw: даты приходят датами, суммы — числами; формат ячейки не искажает значения */
        const rows=XLSX.utils.sheet_to_json(sh,{header:1,raw:true,defval:""});
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
  const names={bdds:"БДДС",bdr:"БДР",abon:"Абонементы",pl:"P&L",ros:"Рентабельность центра",unit:"Рентабельность детально",pay:"Зарплата педагогов",tax:"Налоги"};
  await download(`${names[S.repTab]}_Уникум_${S.year}.xlsx`,new Uint8Array(out));
}
async function backup(){
  const data={refs:S.refs,students:S.students,teachers:S.teachers,tariffs:S.tariffs,groups:S.groups,
    ops:S.ops,abon:S.abon,lessons:S.lessons,months:S.months,exportedAt:new Date().toISOString()};
  await download(`Резервная_копия_Уникум_${today()}.json`,new TextEncoder().encode(JSON.stringify(data,null,2)));
}

/* ============================ обработчики ============================ */
const VIEW_ACTS=new Set(["year","abon-card","student-card","toggle-arch","export-ops","export-report"]);
function bind(root){
  root.querySelectorAll("[data-act]").forEach(el=>{
    const a=el.dataset.act,id=el.dataset.id,i=el.dataset.i;
    if(S.ro&&!VIEW_ACTS.has(a)){el.remove();return;}
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
        case "del-group":if(confirm("Удалить группу? Проведённые занятия сохранятся.")){S.groups=S.groups.filter(x=>x.id!==id);markDel("un_groups",id);if(await saveGroups())toast("Группа удалена");render();}break;
        case "abon-card":abonCard(id);break;
        case "abon-pay":abonPay(id);break;
        case "abon-extend":abonExtend(id);break;
        case "abon-edit":abonEdit(id);break;
        case "abon-close":abonClose(id);break;
        case "abon-reopen":abonReopen(id);break;
        case "abon-del":abonDelete(id);break;
        case "abs-add":absAdd(id);break;
        case "abs-del":if(confirm("Убрать пропуск? Занятие снова будет доступно на этом абонементе."))absDel(id,i);break;
        case "abon-renew":{const f=findAbon(id);if(f){const a=f.a,t=tariff(a.tariffId);newAbon(a.studentId,t&&!t.archived?t.id:"",t&&!t.archived?null:{name:a.name,lessons:a.lessons,price:a.price,direction:a.direction,subject:a.subject,teacherId:a.teacherId,format:a.format});}}break;
        case "copy-tariff":{const t=tariff(id);if(t){const c=Object.assign({},t,{id:uid("tr"),name:t.name+" (копия)",archived:false});S.tariffs.push(c);if(await saveTariffs()){toast("Копия создана — измените название и цену");render();editTariff(c.id);}}}break;
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
        case "role-member":{
          const m=MEMBERS.find(x=>x.email===id); if(!m)break;
          const to=m.role==="viewer"?"owner":"viewer";
          if(!confirm(to==="viewer"?"Перевести "+id+" в режим просмотра? Человек сможет смотреть, но не сможет менять данные.":"Дать "+id+" полный доступ? Человек сможет вносить и удалять данные."))break;
          if(await setMemberRole(id,to)){toast(to==="viewer"?"Теперь только просмотр":"Открыт полный доступ");render();}
        }break;
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
  modal("Открыть доступ",`
   <div class="grid3">
     <label class="f"><span>Почта</span><input name="email" type="email" placeholder="client@example.com"></label>
     <label class="f"><span>Имя</span><input name="name" placeholder="Как подписывать в списке"></label>
     <label class="f"><span>Права</span><select name="role"><option value="viewer">Только просмотр</option><option value="owner">Полный доступ</option></select></label>
   </div>
   <div class="hint">Наблюдатель видит все экраны и отчёты, но ничего не может изменить или удалить.<br>
   Чтобы человек смог войти, у него должна быть учётная запись с этой почтой: создайте её в панели Supabase — Authentication → Users → Add user, с галочкой Auto Confirm User, и передайте почту с паролем лично.</div>
  `,async(l)=>{
    const email=val(l,"email"); if(!email||email.indexOf("@")<0){toast("Укажите почту");return false;}
    if(MEMBERS.some(m=>m.email===email.toLowerCase())){toast("Этот адрес уже в списке");return false;}
    if(await addMember(email,val(l,"name"),val(l,"role"))) toast("Доступ открыт для "+email.toLowerCase());
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
