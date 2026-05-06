const isPositive= v => !isNaN(v) && Number(v) >= 0;
const notEmpty  = v => v !== undefined && v !== null && String(v).trim() !== '';
const safeInt   = (v, def = 0) => { const n = parseInt(v); return isNaN(n) ? def : Math.max(0, n); };
const safeFloat = (v, def = 0) => { const n = parseFloat(v); return isNaN(n) ? def : n; };
const sanitize  = v => String(v || '').trim().slice(0, 500);
module.exports = { isPositive, notEmpty, safeInt, safeFloat, sanitize };
