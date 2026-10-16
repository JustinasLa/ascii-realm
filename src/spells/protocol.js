// The relay carries cast intent, never arbitrary damage or executable actions.
export function readSpellCast(value, allowed) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !allowed.includes(value.id)
    || !Number.isFinite(value.heading)) return null;
  const targetId = value.targetId == null ? null : value.targetId;
  if (targetId !== null && (typeof targetId !== 'string' || !/^[0-9a-f]{1,32}$/.test(targetId))) return null;
  const aim = value.aim;
  if (aim != null && (!Number.isFinite(aim.x) || !Number.isFinite(aim.y) || Math.abs(aim.x) > 1e7 || Math.abs(aim.y) > 1e7)) return null;
  return { id: value.id, heading: Math.atan2(Math.sin(value.heading), Math.cos(value.heading)), targetId,
    aim: aim ? { x: aim.x, y: aim.y } : null };
}
