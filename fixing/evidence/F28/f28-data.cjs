const mysql = require("E:/Task Management System/server/node_modules/mysql2/promise");
const P = (s) => console.log(s);
(async () => {
  const db = await mysql.createConnection({host:"127.0.0.1",user:"root",password:"root",database:"taskmanagement"});
  await db.query("SET time_zone='+00:00'");
  const q = async (s,a) => (await db.query(s,a))[0];

  P("================ F28 DECISION DATA (demo DB) ================");

  P("\n--- ISS-029 / ISS-028 : the workspace settings row ---");
  const [ws] = await q("SELECT * FROM workspaces LIMIT 1");
  P("  name=" + ws.name + "  tz=" + ws.timezone);
  P("  default_locale       = " + ws.default_locale);
  P("  week_starts_on       = " + ws.week_starts_on + "   (USED by client calendar)");
  P("  working_days         = " + JSON.stringify(ws.working_days));
  P("  business_hours       = " + ws.business_hours_start + " .. " + ws.business_hours_end);
  P("  fiscal_year_start_month = " + ws.fiscal_year_start_month);

  P("\n--- ISS-029 : how many SLA deadlines land off-hours / off-days? ---");
  const wd = String(ws.working_days||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  const DOW = ["sun","mon","tue","wed","thu","fri","sat"];
  const rows = await q("SELECT id, sla_due_at, created_at FROM tasks WHERE sla_due_at IS NOT NULL");
  const bhS = parseInt(String(ws.business_hours_start).slice(0,2),10);
  const bhE = parseInt(String(ws.business_hours_end).slice(0,2),10);
  // Dhaka wall clock = UTC + 6
  let offDay=0, offHour=0, ok=0;
  for (const r of rows) {
    const d = new Date(r.sla_due_at.getTime() + 6*3600*1000);
    const day = DOW[d.getUTCDay()], hr = d.getUTCHours();
    const dayOk = wd.includes(day), hrOk = hr >= bhS && hr < bhE;
    if (!dayOk) offDay++; else if (!hrOk) offHour++; else ok++;
  }
  P("  tasks with an SLA deadline : " + rows.length);
  P("    deadline on a NON-WORKING DAY   : " + offDay);
  P("    deadline OUTSIDE business hours : " + offHour);
  P("    deadline inside working hours   : " + ok);
  P("  => " + (rows.length ? Math.round(100*(offDay+offHour)/rows.length) : 0) + "% of SLA deadlines fall when nobody is at work.");

  P("\n--- ISS-082 : is there a breach queue to show? ---");
  const [br] = await q("SELECT COUNT(*) n FROM tasks WHERE sla_due_at IS NOT NULL AND sla_due_at < UTC_TIMESTAMP() AND archived_at IS NULL");
  P("  tasks currently past sla_due_at (not archived): " + br.n);

  P("\n--- ISS-070 : checklist items, and how many are assigned ---");
  const [ci] = await q("SELECT COUNT(*) total, SUM(assignee_id IS NOT NULL) assigned, SUM(is_completed=1) done FROM checklist_items");
  P("  checklist_items total = " + ci.total + " | with an assignee = " + (ci.assigned||0) + " | completed = " + (ci.done||0));
  const [cl] = await q("SELECT COUNT(*) n FROM checklists");
  P("  checklists = " + cl.n);

  P("\n--- ISS-013 : sprints, and what a delete would touch ---");
  const sp = await q("SELECT s.id, s.name, s.status, s.start_date, s.end_date, (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id=s.id) tasks FROM sprints s");
  sp.forEach(s => P("  " + s.name + "  [" + s.status + "]  " + String(s.start_date).slice(0,10) + " .. " + String(s.end_date).slice(0,10) + "  tasks=" + s.tasks));
  const fk = await q("SELECT k.TABLE_NAME, k.COLUMN_NAME, rc.DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME=rc.CONSTRAINT_NAME AND k.CONSTRAINT_SCHEMA=rc.CONSTRAINT_SCHEMA WHERE rc.CONSTRAINT_SCHEMA=DATABASE() AND rc.REFERENCED_TABLE_NAME='sprints'");
  fk.forEach(f => P("  FK -> " + f.TABLE_NAME + "." + f.COLUMN_NAME + "  ON DELETE " + f.DELETE_RULE));

  P("\n--- ISS-036 : lists, is_private usage, and the F27 collision risk ---");
  const [li] = await q("SELECT COUNT(*) n, SUM(is_private=1) priv, SUM(archived_at IS NOT NULL) arch FROM lists");
  P("  lists = " + li.n + " | is_private=1 : " + (li.priv||0) + " | archived : " + (li.arch||0));
  const dupe = await q("SELECT name, COUNT(DISTINCT space_id) spaces FROM lists GROUP BY name HAVING spaces > 1");
  P("  list names that exist in MORE THAN ONE space (a move would 409 under F27's uq_lists_space_name):");
  if (!dupe.length) P("    none");
  dupe.forEach(d => P("    \"" + d.name + "\" in " + d.spaces + " spaces"));

  P("\n--- ISS-094 : the full seeded grant matrix ---");
  const roles = await q("SELECT id, role_key, name, is_system FROM roles ORDER BY rank_order");
  for (const r of roles) {
    const perms = await q("SELECT permission_key, scope FROM role_permissions WHERE role_id=? ORDER BY permission_key", [r.id]);
    P("  [" + r.name + " / " + r.role_key + "] system=" + r.is_system + "  grants=" + perms.length);
    if (r.role_key === "guest") perms.forEach(p => P("        " + p.permission_key.padEnd(28) + " scope=" + p.scope));
  }
  P("\n  WRITE-shaped grants held by GUEST (the ISS-094 question, widened to every key):");
  const [g] = await q("SELECT id FROM roles WHERE role_key='guest'");
  const gp = await q("SELECT permission_key, scope FROM role_permissions WHERE role_id=? ORDER BY permission_key", [g.id]);
  const READ = /\.(view|list|read|export|download|search)$/;
  gp.filter(p => !READ.test(p.permission_key)).forEach(p => P("        " + p.permission_key.padEnd(28) + " scope=" + p.scope));

  P("\n--- ISS-094 : same check on MEMBER (the note said audit the others too) ---");
  const [m] = await q("SELECT id FROM roles WHERE role_key='member'");
  const mp = await q("SELECT permission_key, scope FROM role_permissions WHERE role_id=? ORDER BY permission_key", [m.id]);
  const ADMINY = /^(role\.|member\.|workspace\.|space\.delete|space\.create|task\.delete_hard|permission)/;
  P("  admin-shaped keys held by member:");
  const hits = mp.filter(p => ADMINY.test(p.permission_key));
  if (!hits.length) P("    none");
  hits.forEach(p => P("        " + p.permission_key.padEnd(28) + " scope=" + p.scope));

  await db.end();
})().catch(e => { console.error("FAIL " + e.message); process.exit(1); });
