export type Precedence = 'Routine' | 'Priority' | 'Immediate'

export type TrafficMessage = {
  id: string
  quantity: number
  precedence: Precedence
  notes: string
}

export type StationCheckIn = {
  id: string
  callSign: string
  checkInTime: string
  checkOutTime: string
  messages: TrafficMessage[]
  remarks: string
  isAncs: boolean
}

export type NetLog = {
  id: string
  netName: string
  frequency: string
  mode: string
  ncsCallSign: string
  startTime: string
  closeTime: string
  stations: StationCheckIn[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type LoggerData = {
  version: 1
  activeLogId: string | null
  logs: NetLog[]
}

export const precedences: Precedence[] = ['Routine', 'Priority', 'Immediate']

export function emptyLoggerData(): LoggerData {
  return {
    version: 1,
    activeLogId: null,
    logs: [],
  }
}
