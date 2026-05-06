function paginate(db, query, params, req) {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(200, parseInt(req.query.limit) || 50);
  const offset = (page - 1) * limit;
  const rows   = db.prepare(`${query} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM (${query})`).get(...params)?.c || 0;
  return { data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
module.exports = { paginate };
