const ok   = (res, data, message = 'success', status = 200) =>
  res.status(status).json({ success: true, message, data: data ?? undefined });
const fail = (res, message, status = 400) =>
  res.status(status).json({ success: false, message });
const err  = (res, error, context = '') => {
  const msg = error?.message || 'حدث خطأ داخلي';
  if (process.env.NODE_ENV !== 'production') console.error(`[${context}]`, error);
  return res.status(500).json({ success: false, message: msg });
};
module.exports = { ok, fail, err };
