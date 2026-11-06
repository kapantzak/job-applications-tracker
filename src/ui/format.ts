// Agent-supplied dates (e.g. mail evidence) may not parse; show them as written rather than "Invalid Date".
export const formatTime = (iso: string | null): string => {
  if (!iso) return '–';
  return Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString();
};
