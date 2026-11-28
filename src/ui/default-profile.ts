// The profile the first load of `/` opens (SOW-0059, decisions 1A and 2A): the stored one while it
// exists, else the only profile. Computed, never written, so a lone profile needs no saved choice.
export function defaultProfile<P extends { id: string }>(profiles: P[], storedId: string): P | null {
  return profiles.find((p) => p.id === storedId) ?? (profiles.length === 1 ? profiles[0] : null);
}
