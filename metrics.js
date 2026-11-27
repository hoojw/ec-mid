function ratiosAt(rows, index) {
  const end = rows[index];
  if (!end) return { day: null, week: null, m30: null };
  const values = new Map(rows.map(r => [r.date, r.amt]));
  const dateAt = n => new Date(Date.parse(end.date + 'T00:00:00Z') - n*86400000).toISOString().slice(0,10);
  const sum = (offset, length) => {
    let total = 0;
    for (let i=offset; i<offset+length; i++) {
      const v = values.get(dateAt(i));
      if (v == null || !Number.isFinite(Number(v))) return null;
      total += Number(v);
    }
    return total;
  };
  const ratio = (now, before) => now == null || before == null || before === 0 ? null : (now-before)/before*100;
  return { day: ratio(sum(0,1),sum(1,1)), week: ratio(sum(0,7),sum(7,7)), m30: ratio(sum(0,30),sum(30,30)) };
}
module.exports = { ratiosAt };
