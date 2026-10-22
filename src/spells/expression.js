// Arithmetic used by TF's skill modifiers. Never evaluate server text as JavaScript.
export function arithmetic(source, resolve = () => 0) {
  if (typeof source === 'number') return Number.isFinite(source) ? source : 0;
  const text = String(source ?? 0).replace(/["']/g, '')
    .replace(/<([^>]+)>|%([a-z_][a-z0-9_.]*)%/gi, (_, a, b) => String(Number(resolve(a ?? b)) || 0));
  const tokens = text.match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z_]+|[()+*/%,^-]/gi) ?? [];
  if (tokens.join('').toLowerCase() !== text.replace(/\s/g, '').toLowerCase()) return 0;
  let pos = 0;
  function atom() {
    const token = tokens[pos++];
    if (token === '(') { const value = sum(); if (tokens[pos++] !== ')') throw Error(); return value; }
    if (/^[\d.]/.test(token ?? '')) return Number(token);
    const fn = { min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, round: Math.round }[token?.toLowerCase()];
    if (!fn || tokens[pos++] !== '(') throw Error();
    const args = [sum()];
    while (tokens[pos] === ',') { pos++; args.push(sum()); }
    if (tokens[pos++] !== ')') throw Error();
    return fn(...args);
  }
  function power() {
    let value = atom();
    if (tokens[pos] === '^') { pos++; value **= unary(); }
    return value;
  }
  function unary() {
    if (tokens[pos] === '-') { pos++; return -unary(); }
    if (tokens[pos] === '+') { pos++; return unary(); }
    return power();
  }
  function product() {
    let value = unary();
    while (['*', '/', '%'].includes(tokens[pos])) {
      const op = tokens[pos++], right = unary();
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (['+', '-'].includes(tokens[pos])) { const op = tokens[pos++], right = product(); value += op === '+' ? right : -right; }
    return value;
  }
  try { const value = sum(); return pos === tokens.length && Number.isFinite(value) ? value : 0; } catch { return 0; }
}

export function mechanic(text) {
  const match = String(text).match(/^\s*([^\s{]+)(?:\{([\s\S]*)\})?\s*$/);
  const args = {};
  for (const part of (match?.[2] ?? '').split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const index = part.indexOf('=');
    if (index >= 0) args[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim().replace(/^"|"$/g, '');
  }
  return { op: match?.[1]?.toLowerCase() ?? '', args };
}
