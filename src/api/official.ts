/** Optional Eternal Return Open API client. */

export interface OfficialUserStats {
  matchingMode?: number
  matchingTeamMode?: number
  seasonId?: number
  mmr?: number
  totalGames?: number
  totalWins?: number
  totalTeamKills?: number
  averageKills?: number
  averageAssists?: number
  averageDeaths?: number
  averagePlacement?: number
  top3?: number
}

export class OfficialApi {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://open-api.bser.io',
  ) {}

  private async request(path: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`official API HTTP ${response.status}`)
    const payload = await response.json() as { code?: number; message?: string }
    if (payload.code !== undefined && payload.code !== 200) {
      throw new Error(payload.message ?? `official API code ${payload.code}`)
    }
    return payload as Record<string, unknown>
  }

  async getUserId(nickname: string): Promise<string> {
    const payload = await this.request(`/v1/user/nickname?query=${encodeURIComponent(nickname)}`)
    const user = payload.user as { userId?: string; userNum?: number } | undefined
    const id = user?.userId ?? user?.userNum
    if (id === undefined) throw new Error('official API returned no user id')
    return String(id)
  }

  async getUserStats(userId: string, seasonId: number, matchingMode = 3): Promise<OfficialUserStats[]> {
    const payload = await this.request(`/v2/user/stats/uid/${encodeURIComponent(userId)}/${seasonId}/${matchingMode}`)
    return (payload.userStats ?? []) as OfficialUserStats[]
  }
}
