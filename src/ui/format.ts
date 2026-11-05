export const formatTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '–');
