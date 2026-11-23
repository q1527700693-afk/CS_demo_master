export interface RosterPlayer {
  player_id: string
  name: string
}
export const normalizeName = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
export const findPlayers = (players: RosterPlayer[], query: string) =>
  players.filter(
    (p) =>
      normalizeName(p.name).includes(normalizeName(query)) || p.player_id.includes(query.trim()),
  )
export function uniqueExactPlayer(players: RosterPlayer[], query: string): string {
  if (!query.trim()) return ''
  const matches = players.filter(
    (p) => normalizeName(p.name) === normalizeName(query) || p.player_id === query.trim(),
  )
  return matches.length === 1 ? matches[0]!.player_id : ''
}
