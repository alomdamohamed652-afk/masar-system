'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { sanitize, safeInt } = require('../utils/validate');

router.use(authMiddleware);

// GET tasks (my tasks or all for admin/manager)
router.get('/', requirePermission('tasks.view'), (req, res) => {
  try {
    const { status='', priority='', mine='', page=1, limit=50 } = req.query;
    const pg=Math.max(1,safeInt(page,1)), lim=Math.min(100,safeInt(limit,50));
    const canSeeAll = db.userHasPerm(req.user.id,'tasks.manage');

    let where = 'WHERE 1=1';
    const params = [];

    if (!canSeeAll || mine === '1') {
      where += ' AND t.assigned_to=?'; params.push(req.user.id);
    }
    if (status) { where += ' AND t.status=?'; params.push(status); }
    if (priority){ where += ' AND t.priority=?'; params.push(priority); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM tasks t ${where}`).get(...params)?.c || 0;
    const data  = db.prepare(`
      SELECT t.*, a.name as assigned_name, a.avatar_url as assigned_avatar,
             c.name as creator_name
      FROM tasks t
      LEFT JOIN users a ON t.assigned_to = a.id
      LEFT JOIN users c ON t.created_by = c.id
      ${where}
      ORDER BY
        CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, (pg-1)*lim);

    // Add comment counts
    const withCounts = data.map(t => ({
      ...t,
      comment_count: db.prepare("SELECT COUNT(*) as c FROM task_comments WHERE task_id=?").get(t.id)?.c || 0
    }));

    res.json({ success:true, data: withCounts, pagination:{ page:pg, limit:lim, total, pages:Math.ceil(total/lim) } });
  } catch(e) { err(res,e,'GET /tasks'); }
});

// GET single task with comments
router.get('/:id', requirePermission('tasks.view'), (req, res) => {
  try {
    const task = db.prepare(`
      SELECT t.*, a.name as assigned_name, c.name as creator_name
      FROM tasks t
      LEFT JOIN users a ON t.assigned_to=a.id
      LEFT JOIN users c ON t.created_by=c.id
      WHERE t.id=?`).get(req.params.id);
    if (!task) return fail(res,'المهمة غير موجودة',404);

    // Check access
    const canSeeAll = db.userHasPerm(req.user.id,'tasks.manage');
    if (!canSeeAll && task.assigned_to !== req.user.id)
      return fail(res,'لا يمكنك عرض هذه المهمة',403);

    const comments = db.prepare(`
      SELECT tc.*, u.name as user_name, u.avatar_url
      FROM task_comments tc JOIN users u ON tc.user_id=u.id
      WHERE tc.task_id=? ORDER BY tc.created_at ASC
    `).all(req.params.id);

    ok(res, { ...task, comments });
  } catch(e) { err(res,e,'GET /tasks/:id'); }
});

// POST create task
router.post('/', requirePermission('tasks.view'), (req, res) => {
  try {
    const { title, description='', assigned_to, priority='medium', due_date } = req.body;
    if (!title?.trim()) return fail(res,'عنوان المهمة مطلوب');
    if (!assigned_to)   return fail(res,'يجب تحديد الموظف');
    const user = db.prepare('SELECT id,name FROM users WHERE id=? AND is_active=1').get(assigned_to);
    if (!user) return fail(res,'الموظف غير موجود');

    const r = db.prepare(`
      INSERT INTO tasks (title,description,assigned_to,created_by,priority,status,due_date)
      VALUES (?,?,?,?,?,  'pending',?)
    `).run(sanitize(title), sanitize(description), safeInt(assigned_to), req.user.id, priority, due_date || null);

    // Create in-app notification for assigned user
    db.prepare(`INSERT INTO notifications (message, created_by, show_author, target_user, end_at)
      VALUES (?,?,1,?,datetime('now','+7 days'))`
    ).run(`تم تكليفك بمهمة جديدة: ${title}`, req.user.id, safeInt(assigned_to));

    logAction(req,'CREATE_TASK','tasks',r.lastInsertRowid,{title,assigned_to});
    ok(res,{id:r.lastInsertRowid},'تم إنشاء المهمة',201);
  } catch(e) { err(res,e,'POST /tasks'); }
});

// PUT update task (status / full edit)
router.put('/:id', requirePermission('tasks.view'), (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return fail(res,'المهمة غير موجودة',404);

    const canManage = db.userHasPerm(req.user.id,'tasks.manage');
    const isAssigned = task.assigned_to === req.user.id;

    if (!canManage && !isAssigned) return fail(res,'لا يمكنك تعديل هذه المهمة',403);

    const { title, description, assigned_to, priority, status, due_date } = req.body;

    // Employees can only change status
    const f=[], v=[];
    if (status) {
      const validTransitions = canManage
        ? ['pending','in_progress','completed','cancelled']
        : { pending:['in_progress'], in_progress:['completed'] }[task.status] || [];
      if (!canManage && !validTransitions.includes(status)) return fail(res,'لا يمكنك تغيير الحالة لهذه القيمة');
      f.push('status=?'); v.push(status);
    }
    if (canManage) {
      if (title)       { f.push('title=?');       v.push(sanitize(title)); }
      if (description !== undefined) { f.push('description=?'); v.push(sanitize(description)); }
      if (assigned_to) { f.push('assigned_to=?'); v.push(safeInt(assigned_to)); }
      if (priority)    { f.push('priority=?');    v.push(priority); }
      if (due_date !== undefined) { f.push('due_date=?'); v.push(due_date||null); }
    }
    if (f.length) { v.push(req.params.id); db.prepare(`UPDATE tasks SET ${f.join(',')} WHERE id=?`).run(...v); }

    // Notify admin when completed
    if (status === 'completed') {
      db.prepare(`INSERT INTO notifications (message, created_by, show_author, target_user, end_at)
        VALUES (?,?,0,?,datetime('now','+24 hours'))`
      ).run(`تم إكمال مهمة: ${task.title}`, req.user.id, task.created_by);
    }
    logAction(req,'UPDATE_TASK','tasks',parseInt(req.params.id),{status});
    ok(res,null,'تم التحديث');
  } catch(e) { err(res,e,'PUT /tasks/:id'); }
});

// POST add comment
router.post('/:id/comments', requirePermission('tasks.view'), (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment?.trim()) return fail(res,'التعليق مطلوب');
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
    if (!task) return fail(res,'المهمة غير موجودة',404);
    const canManage = db.userHasPerm(req.user.id,'tasks.manage');
    if (!canManage && task.assigned_to !== req.user.id) return fail(res,'لا يمكنك التعليق',403);
    const r = db.prepare("INSERT INTO task_comments (task_id,user_id,comment) VALUES (?,?,?)").run(safeInt(req.params.id),req.user.id,sanitize(comment));
    ok(res,{id:r.lastInsertRowid},'تم إضافة التعليق',201);
  } catch(e) { err(res,e,'POST /tasks/:id/comments'); }
});

// DELETE task (manage only)
router.delete('/:id', requirePermission('tasks.view'), (req, res) => {
  try {
    db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
    ok(res,null,'تم الحذف');
  } catch(e) { err(res,e,'DELETE /tasks/:id'); }
});

module.exports = router;
