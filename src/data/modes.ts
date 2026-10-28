/** Matching-mode table shared by argument parsing and card labels. */

export interface ModeInfo {
  id: number
  api: string
  label: string
}

export const MODES: Record<string, ModeInfo> = {
  all: { id: 3, api: 'ALL', label: '所有模式' },
  所有: { id: 3, api: 'ALL', label: '所有模式' },
  所有模式: { id: 3, api: 'ALL', label: '所有模式' },
  rank: { id: 3, api: 'RANK', label: '排位' },
  排位: { id: 3, api: 'RANK', label: '排位' },
  normal: { id: 2, api: 'NORMAL', label: '匹配' },
  匹配: { id: 2, api: 'NORMAL', label: '匹配' },
  cobalt: { id: 6, api: 'COBALT', label: '钴协议' },
  钴协议: { id: 6, api: 'COBALT', label: '钴协议' },
  'squad-rumble': { id: 8, api: 'SQUAD_RUMBLE', label: '联盟' },
  联盟: { id: 8, api: 'SQUAD_RUMBLE', label: '联盟' },
  'lone-wolf': { id: 9, api: 'LONE_WOLF', label: '孤狼' },
  孤狼: { id: 9, api: 'LONE_WOLF', label: '孤狼' },
  'cobalt-rumble': { id: 11, api: 'SQUAD_RUMBLE_COBALT', label: '钴联盟' },
  钴联盟: { id: 11, api: 'SQUAD_RUMBLE_COBALT', label: '钴联盟' },
}

export const DEFAULT_MODE: ModeInfo = { id: 3, api: 'ALL', label: '所有模式' }

/** Distinct canonical spellings, for error messages that teach the accepted values. */
export const MODE_HINT = 'all/所有模式, rank/排位, normal/匹配, cobalt/钴协议, squad-rumble/联盟, lone-wolf/孤狼, cobalt-rumble/钴联盟'

/** Resolve one user-supplied mode name; `undefined` means "all modes". */
export function lookupMode(value: string): ModeInfo | undefined {
  const key = value.trim()
  if (key === '') return DEFAULT_MODE
  return MODES[key.toLowerCase()] ?? MODES[key]
}
