/** Synthetic fixtures: no real player data is stored in this repository. */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import type {
  CharacterCardData,
  CharacterEntry,
  CharacterStatsSnapshot,
  ItemEntry,
  MasteryEntry,
  MatchData,
  PlayerCardData,
  SkillEntry,
  TacticalEntry,
  TierEntry,
  TraitEntry,
} from '../../src/types.ts'

export interface Dictionaries {
  characters: CharacterEntry[]
  tiers: TierEntry[]
  items: ItemEntry[]
  masteries: MasteryEntry[]
  skills: SkillEntry[]
  tactical: TacticalEntry[]
  traits: TraitEntry[]
}

/** A tiny opaque PNG used as a stand-in for CDN artwork. */
export function tinyPng(width = 8, height = 8, color = '#3aa'): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, width, height)
  return canvas.toBuffer('image/png')
}

export function makeDictionaries(): Dictionaries {
  return {
    characters: [
      { id: 1, key: 'Jackie', name: 'Jackie', imageUrl: 'https://cdn.example/characters/1.png' },
      {
        id: 2,
        key: 'Aya',
        name: 'Aya',
        imageUrl: 'https://cdn.example/characters/2.png',
        skins: [{ id: 11, name: 'Aya Default', imageUrl: 'https://cdn.example/character_skins/11.png' }],
      },
    ],
    tiers: [
      { id: 1, key: 'diamond1', name: 'Diamond I', iconUrl: 'https://cdn.example/tiers/1.png', imageUrl: 'https://cdn.example/tiers_full/1.png' },
    ],
    items: [1, 2, 3, 4, 5, 6].map(id => ({
      id,
      name: `Item ${id}`,
      imageUrl: `https://cdn.example/items/${id}.png`,
      grade: id % 2 === 0 ? 'Rare' : 'Common',
    })),
    masteries: [{ id: 1, key: 'Dagger', name: 'Dagger', iconUrl: 'https://cdn.example/masteries/1.png' }],
    skills: [{ id: 101, name: 'Skill 1', characterId: 1, slot: 'Q', imageUrl: 'https://cdn.example/skills/101.png' }],
    tactical: [{ id: 201, name: 'Tactical 1', imageUrl: 'https://cdn.example/tactical_skills/201.png' }],
    traits: [{ id: 301, name: 'Trait 1', imageUrl: 'https://cdn.example/trait_skills/301.png', type: 'core' }],
  }
}

/** Write a valid PNG for every asset target the dictionaries reference. */
export async function materializeAssets(dataDir: string, dictionaries: Dictionaries): Promise<void> {
  const png = tinyPng()
  const files: [string, string][] = []
  for (const character of dictionaries.characters) {
    files.push([join(dataDir, 'assets', 'characters', `${character.id}.png`), png.toString('base64')])
    for (const skin of character.skins ?? []) {
      files.push([join(dataDir, 'assets', 'character_skins', `${skin.id}.png`), png.toString('base64')])
    }
  }
  for (const tier of dictionaries.tiers) {
    files.push([join(dataDir, 'assets', 'tiers', `${tier.id}.png`), png.toString('base64')])
    files.push([join(dataDir, 'assets', 'tiers_full', `${tier.id}.png`), png.toString('base64')])
  }
  for (const item of dictionaries.items) {
    files.push([join(dataDir, 'assets', 'items', `${item.id}.png`), png.toString('base64')])
  }
  for (const mastery of dictionaries.masteries) {
    files.push([join(dataDir, 'assets', 'masteries', `${mastery.id}.png`), png.toString('base64')])
  }
  for (const skill of dictionaries.skills) {
    files.push([join(dataDir, 'assets', 'skills', `${skill.id}.png`), png.toString('base64')])
  }
  for (const entry of dictionaries.tactical) {
    files.push([join(dataDir, 'assets', 'tactical_skills', `${entry.id}.png`), png.toString('base64')])
  }
  for (const trait of dictionaries.traits) {
    files.push([join(dataDir, 'assets', 'trait_skills', `${trait.id}.png`), png.toString('base64')])
  }
  for (const [path, base64] of files) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, Buffer.from(base64, 'base64'))
  }
}

function match(index: number): MatchData {
  return {
    gameId: 9000 + index,
    characterId: index % 2 === 0 ? 1 : 2,
    characterName: index % 2 === 0 ? 'Jackie' : 'Aya',
    skinId: index % 2 === 0 ? 0 : 11,
    gameRank: (index % 8) + 1,
    kills: 2 + index,
    assists: 1 + (index % 5),
    deaths: index % 3,
    teamKill: 3 + index,
    damage: 8000 + index * 500,
    kda: 2.5,
    mmrGain: 20 + index,
    mmrBefore: 6500 + index,
    isRankMatch: true,
    weaponId: 1,
    tacticalSkillId: 201,
    tacticalSkillLevel: 3,
    traitCoreId: 301,
    traitSubId: 0,
    modeLabel: '排位',
    win: index % 3 === 0,
    startTime: '2026-10-01 20:00',
    serverName: 'Seoul',
    pathId: 1,
    items: [1, 2, 3, 4, 5, 6].map(id => ({ id, name: `Item ${id}`, grade: id % 2 === 0 ? 2 : 1 })),
  }
}

export function makePlayerCard(matchCount = 10): PlayerCardData {
  const matches = Array.from({ length: matchCount }, (_, index) => match(index))
  const wins = matches.filter(entry => entry.win).length
  return {
    seasonLabel: 'S12',
    modeLabel: '排位',
    name: 'TestPlayer',
    level: 142,
    mmr: 6556,
    hasRankedData: true,
    tierId: 1,
    tierName: '星陨 IV',
    tierGradeId: 4,
    tierMmr: 6400,
    rankGlobal: 12345,
    rankGlobalSize: 200000,
    rankGlobalPercent: 6.2,
    rankLocal: 900,
    rankLocalSize: 20000,
    rankLocalPercent: 4.5,
    immortalMmr: 8200,
    titanMmr: 9000,
    mmrChart: [
      { label: '09-01', value: 6400 },
      { label: '09-15', value: 6480 },
      { label: '10-01', value: 6556 },
    ],
    summary: {
      play: 46,
      winRate: (wins / matches.length) * 100,
      top2Rate: 30,
      top3Rate: 56.5,
      avgRank: 3.89,
      avgKill: 4.1,
      avgAssist: 3.2,
      avgTk: 5.4,
      avgDamage: 12000,
      avgMonsterKill: 12,
      avgVfCredit: 4000,
      avgViewContribution: 300,
    },
    heroes: [
      {
        characterId: 1,
        characterName: 'Jackie',
        play: 20,
        win: 4,
        winRate: 20,
        avgRank: 3.5,
        avgKill: 4,
        avgAssist: 3,
        avgDamage: 11000,
        mmrGain: 120,
      },
    ],
    matches,
    firstMatchTeammates: [
      {
        nickname: 'Teammate',
        characterId: 2,
        characterName: 'Aya',
        skinId: 11,
        gameRank: 2,
        kills: 3,
        assists: 4,
        deaths: 1,
        teamKill: 6,
        damage: 9000,
        kda: 7,
        mmrGain: 22,
        mmrBefore: 6500,
        isRankMatch: true,
        weaponId: 1,
        tacticalSkillId: 201,
        tacticalSkillLevel: 3,
        traitCoreId: 301,
        traitSubId: 0,
        pathId: 1,
        items: [1, 2, 3, 4, 5, 6].map(id => ({ id, name: `Item ${id}`, grade: 2 })),
      },
    ],
    teamMaxDamage: 15000,
    generatedAt: 1_760_000_000_000,
  }
}

export function makeCharacterStats(): CharacterStatsSnapshot {
  return {
    dt: 7,
    patch: 3,
    matchingMode: 3,
    teamMode: 3,
    tier: 'diamond_plus',
    tierCount: 100,
    tierGameCount: 5000,
    characterStats: [
      {
        key: 1,
        count: 500,
        weaponStats: [
          {
            key: 1,
            count: 300,
            win: 60,
            top3: 120,
            place: 1300,
            playerKill: 900,
            playerAssistant: 700,
            damageToPlayer: 2_000_000,
            teamKill: 1400,
            mmrGain: 3000,
            tier: 'A',
            tierScore: 72,
          },
        ],
      },
    ],
  }
}

export function makeCharacterCard(): CharacterCardData {
  return {
    name: 'Jackie',
    weaponName: 'Dagger',
    weaponId: 1,
    tierLabel: '灭钻+',
    tierBadge: 'D+',
    pickCount: 500,
    totalSamples: 5000,
    winRate: 20,
    winRank: 10,
    winRankSize: 60,
    top3Rate: 40,
    top3Rank: 12,
    top3RankSize: 60,
    avgRank: 4.3,
    avgRankRank: 15,
    avgRankRankSize: 60,
    avgKill: 3.1,
    avgKillRank: 20,
    avgKillRankSize: 60,
    rp: 220,
    rpRank: 8,
    rpRankSize: 60,
    pickRate: 6.1,
    pickRank: 5,
    pickRankSize: 60,
    avgDamage: 12000,
    avgTk: 5,
    recommendations: { skillBuilds: [], tactical: [], traitGroups: [], itemSlots: [] },
    generatedAt: 1_760_000_000_000,
  }
}
