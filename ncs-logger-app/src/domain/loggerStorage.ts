import { getVersion } from '@tauri-apps/api/app'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  emptyLoggerData,
  precedences,
  type LoggerData,
  type NetLog,
  type Precedence,
  type StationCheckIn,
  type TrafficMessage,
} from './loggerTypes'

const STORAGE_KEY = 'ncs-logger-data-v1'

export type LoggerStorageMode = 'appdata' | 'browser'

export type LoggerStorageInfo = {
  mode: LoggerStorageMode
  location: string
  dataFile: string
  backupFolder: string
  canOpenFolder: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPrecedence = (value: unknown): value is Precedence =>
  typeof value === 'string' && precedences.includes(value as Precedence)

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const asUpperString = (value: unknown): string => asString(value).toUpperCase()

const normalizeStoredCallSign = (value: string): string => {
  const clean = value.trim().toUpperCase().replace(/[\s-]+/g, '')

  if (/^AAR\d[A-Z]{2}$/.test(clean) || /^AAT\d[A-Z]{2}$/.test(clean)) {
    return clean
  }

  if (/^\d[A-Z]{2}$/.test(clean)) {
    return `AAR${clean}`
  }

  if (/^T\d[A-Z]{2}$/.test(clean)) {
    return `AA${clean}`
  }

  return clean
}

const asTrafficNote = (value: unknown): string => {
  const upper = asUpperString(value)
  const compact = upper.trim().replace(/[\s-]+/g, '')

  if (/^(AAR|AAT)?\d[A-Z]{2}$/.test(compact) || /^T\d[A-Z]{2}$/.test(compact)) {
    return normalizeStoredCallSign(compact)
  }

  return upper
}

const asQuantity = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

const normalizeMessage = (value: unknown): TrafficMessage | null => {
  if (!isRecord(value)) return null

  return {
    id: asString(value.id) || crypto.randomUUID(),
    quantity: asQuantity(value.quantity),
    precedence: isPrecedence(value.precedence) ? value.precedence : 'Routine',
    notes: asTrafficNote(value.notes),
  }
}

const normalizeStation = (value: unknown): StationCheckIn | null => {
  if (!isRecord(value)) return null

  return {
    id: asString(value.id) || crypto.randomUUID(),
    callSign: asUpperString(value.callSign),
    checkInTime: asString(value.checkInTime),
    checkOutTime: asString(value.checkOutTime),
    messages: Array.isArray(value.messages)
      ? value.messages.map(normalizeMessage).filter((item): item is TrafficMessage => item !== null)
      : [],
    remarks: asUpperString(value.remarks),
    isAncs: value.isAncs === true,
  }
}

const normalizeLog = (value: unknown): NetLog | null => {
  if (!isRecord(value)) return null

  const now = new Date().toISOString()

  return {
    id: asString(value.id) || crypto.randomUUID(),
    netName: asUpperString(value.netName),
    frequency: asUpperString(value.frequency),
    mode: asUpperString(value.mode),
    ncsCallSign: asUpperString(value.ncsCallSign),
    startTime: asString(value.startTime),
    closeTime: asString(value.closeTime),
    stations: Array.isArray(value.stations)
      ? value.stations.map(normalizeStation).filter((item): item is StationCheckIn => item !== null)
      : [],
    notes: asUpperString(value.notes),
    createdAt: asString(value.createdAt) || now,
    updatedAt: asString(value.updatedAt) || now,
  }
}

export function normalizeLoggerData(value: unknown): LoggerData {
  if (!isRecord(value)) return emptyLoggerData()

  const logs = Array.isArray(value.logs)
    ? value.logs.map(normalizeLog).filter((item): item is NetLog => item !== null)
    : []

  const activeLogId = asString(value.activeLogId)

  return {
    version: 1,
    activeLogId: logs.some((log) => log.id === activeLogId) ? activeLogId : logs[0]?.id ?? null,
    logs,
  }
}

const parseStoredBrowserData = (): LoggerData => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return emptyLoggerData()

    return normalizeLoggerData(JSON.parse(stored) as unknown)
  } catch {
    return emptyLoggerData()
  }
}

const browserStorageInfo = (): LoggerStorageInfo => ({
  mode: 'browser',
  location: 'Browser localStorage',
  dataFile: 'Browser localStorage',
  backupFolder: 'Manual exports only',
  canOpenFolder: false,
})

export async function loadLoggerData(): Promise<LoggerData> {
  if (!isTauri()) return parseStoredBrowserData()

  try {
    const stored = await invoke<unknown>('load_logger_data')
    return typeof stored === 'string'
      ? normalizeLoggerData(JSON.parse(stored) as unknown)
      : normalizeLoggerData(stored)
  } catch {
    return parseStoredBrowserData()
  }
}

export async function saveLoggerData(data: LoggerData): Promise<boolean> {
  const normalized = normalizeLoggerData(data)

  if (!isTauri()) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return true
  }

  try {
    await invoke('save_logger_data', { json: JSON.stringify(normalized, null, 2) })
    return true
  } catch {
    return false
  }
}

const normalizeStoragePaths = (value: unknown) => {
  if (Array.isArray(value)) {
    return {
      dataFile: typeof value[0] === 'string' ? value[0] : 'AppData ncs-logs.json',
      dataFolder: typeof value[1] === 'string' ? value[1] : 'AppData',
      backupFolder: typeof value[2] === 'string' ? value[2] : 'AppData backups',
    }
  }

  if (isRecord(value)) {
    return {
      dataFile: typeof value.dataFile === 'string' ? value.dataFile : 'AppData ncs-logs.json',
      dataFolder: typeof value.dataFolder === 'string' ? value.dataFolder : 'AppData',
      backupFolder: typeof value.backupFolder === 'string' ? value.backupFolder : 'AppData backups',
    }
  }

  return {
    dataFile: 'AppData ncs-logs.json',
    dataFolder: 'AppData',
    backupFolder: 'AppData backups',
  }
}

export async function getLoggerStorageInfo(): Promise<LoggerStorageInfo> {
  if (!isTauri()) return browserStorageInfo()

  try {
    const paths = normalizeStoragePaths(await invoke<unknown>('get_logger_storage_paths'))

    return {
      mode: 'appdata',
      location: paths.dataFolder,
      dataFile: paths.dataFile,
      backupFolder: paths.backupFolder,
      canOpenFolder: true,
    }
  } catch {
    return {
      mode: 'appdata',
      location: 'AppData',
      dataFile: 'AppData ncs-logs.json',
      backupFolder: 'AppData backups',
      canOpenFolder: true,
    }
  }
}

export async function openLoggerDataFolder(): Promise<boolean> {
  if (!isTauri()) return false

  try {
    await invoke('open_logger_data_folder')
    return true
  } catch {
    return false
  }
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return '0.0.1'

  try {
    return await getVersion()
  } catch {
    return '0.0.1'
  }
}
