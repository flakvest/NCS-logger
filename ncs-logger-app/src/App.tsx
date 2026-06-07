import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  getAppVersion,
  getLoggerStorageInfo,
  loadLoggerData,
  openLoggerDataFolder,
  saveLoggerData,
  type LoggerStorageInfo,
} from './domain/loggerStorage'
import {
  emptyLoggerData,
  precedences,
  type LoggerData,
  type NetLog,
  type Precedence,
  type StationCheckIn,
  type TrafficMessage,
} from './domain/loggerTypes'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const pad = (value: number): string => value.toString().padStart(2, '0')

const zuluDateTimeInput = (date = new Date()): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`

const normalizeZuluInput = (value: string): string => {
  if (!value) return ''
  return value.endsWith('Z') ? value : `${value}:00.000Z`
}

const zuluValueForInput = (value: string): string => {
  if (!value) {
    const now = new Date()
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T00:00`
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 16)

  return zuluDateTimeInput(parsed)
}

const normalizeCallSign = (value: string): string => {
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

const uppercaseText = (value: string): string => value.toUpperCase()

const normalizeTrafficNote = (value: string): string => {
  const upper = uppercaseText(value)
  const compact = upper.trim().replace(/[\s-]+/g, '')

  if (/^(AAR|AAT)?\d[A-Z]{2}$/.test(compact) || /^T\d[A-Z]{2}$/.test(compact)) {
    return normalizeCallSign(compact)
  }

  return upper
}

const displayDateTime = (value: string): string => {
  if (!value) return 'Not set'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}Z`
}

const createLog = (): NetLog => {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    netName: 'ARMY MARS REGION 4 NET',
    frequency: '',
    mode: '',
    ncsCallSign: '',
    startTime: normalizeZuluInput(zuluDateTimeInput()),
    closeTime: '',
    stations: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

const createStation = (callSign = ''): StationCheckIn => ({
  id: crypto.randomUUID(),
  callSign: normalizeCallSign(callSign),
  checkInTime: normalizeZuluInput(zuluDateTimeInput()),
  checkOutTime: '',
  messages: [],
  remarks: '',
  isAncs: false,
})

const createMessage = (): TrafficMessage => ({
  id: crypto.randomUUID(),
  quantity: 1,
  precedence: 'Routine',
  notes: '',
})

const precedenceClass = (precedence: Precedence): string =>
  precedence.toLowerCase()

const precedenceAbbrev: Record<Precedence, string> = { Routine: 'RR', Priority: 'PP', Immediate: 'II' }

const precedenceFromAbbrev: Record<string, Precedence> = { RR: 'Routine', PP: 'Priority', II: 'Immediate' }

const formatTrafficSummary = (messages: TrafficMessage[]): string => {
  return messages.map((m) => `${m.quantity}${precedenceAbbrev[m.precedence]} ${m.notes}`).join(', ')
}

function App() {
  const [data, setData] = useState<LoggerData>(emptyLoggerData)
  const [storageInfo, setStorageInfo] = useState<LoggerStorageInfo | null>(null)
  const [appVersion, setAppVersion] = useState('0.0.1')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [editingStationId, setEditingStationId] = useState<string | null>(null)
  const [gridCallSign, setGridCallSign] = useState('')
  const [gridQty, setGridQty] = useState('1')
  const [gridPrec, setGridPrec] = useState('')
  const [gridRecipient, setGridRecipient] = useState('')
  const gridCallSignRef = useRef<HTMLInputElement>(null)
  const gridQtyRef = useRef<HTMLInputElement>(null)
  const gridPrecRef = useRef<HTMLInputElement>(null)
  const gridRecipientRef = useRef<HTMLInputElement>(null)
  const gridTableRef = useRef<HTMLDivElement>(null)
  const [amendingStationId, setAmendingStationId] = useState<string | null>(null)
  const [amendQty, setAmendQty] = useState('1')
  const [amendPrec, setAmendPrec] = useState('')
  const [amendRecipient, setAmendRecipient] = useState('')
  const amendQtyRef = useRef<HTMLInputElement>(null)
  const amendPrecRef = useRef<HTMLInputElement>(null)
  const amendRecipientRef = useRef<HTMLInputElement>(null)
  const [showStationList, setShowStationList] = useState(false)
  const [stationListText, setStationListText] = useState('')

  const [isDark, setIsDark] = useState(() => {
    const stored = (() => { try { return window.localStorage.getItem('ncs-logger-dark-mode') } catch { return null } })()
    const dark = stored === 'true'
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    return dark
  })

  useEffect(() => {
    try { window.localStorage.setItem('ncs-logger-dark-mode', isDark ? 'true' : 'false') } catch {}
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    async function boot() {
      const [loaded, info, version] = await Promise.all([
        loadLoggerData(),
        getLoggerStorageInfo(),
        getAppVersion(),
      ])

      if (loaded.logs.length === 0) {
        const firstLog = createLog()
        setData({ version: 1, activeLogId: firstLog.id, logs: [firstLog] })
      } else {
        setData(loaded)
      }

      setStorageInfo(info)
      setAppVersion(version)
    }

    void boot()
  }, [])

  const activeLog = useMemo(
    () => data.logs.find((log) => log.id === data.activeLogId) ?? data.logs[0] ?? null,
    [data],
  )

  const trafficTotals = useMemo(() => {
    const totals: Record<Precedence, number> = {
      Routine: 0,
      Priority: 0,
      Immediate: 0,
    }

    activeLog?.stations.forEach((station) => {
      station.messages.forEach((message) => {
        totals[message.precedence] += message.quantity
      })
    })

    return totals
  }, [activeLog])

  const hasUnsavedError = saveState === 'error'

  const gridPrecClass = (value: string): string => {
    const u = value.toUpperCase()
    if (u === 'RR') return 'grid-routine'
    if (u === 'PP') return 'grid-priority'
    if (u === 'II') return 'grid-immediate'
    return ''
  }

  const updateActiveLog = (updater: (log: NetLog) => NetLog) => {
    setSaveState('idle')
    setData((current) => {
      const nextLogs = current.logs.map((log) => {
        if (log.id !== current.activeLogId) return log
        return {
          ...updater(log),
          updatedAt: new Date().toISOString(),
        }
      })

      return { ...current, logs: nextLogs }
    })
  }

  const updateLogField = (field: keyof NetLog, value: string) => {
    updateActiveLog((log) => ({ ...log, [field]: uppercaseText(value) }))
  }

  const startNewLog = () => {
    const nextLog = createLog()
    setSaveState('idle')
    setData((current) => ({
      version: 1,
      activeLogId: nextLog.id,
      logs: [nextLog, ...current.logs],
    }))
  }

  const selectLog = (id: string) => {
    setSaveState('idle')
    setData((current) => ({ ...current, activeLogId: id }))
  }

  const commitGridEntry = () => {
    const callsign = normalizeCallSign(gridCallSign)
    const qty = Math.max(1, Number.parseInt(gridQty, 10) || 1)
    const precAbbrev = gridPrec.trim().toUpperCase()
    const prec = precedenceFromAbbrev[precAbbrev] ?? null
    const recipient = normalizeTrafficNote(gridRecipient)

    if (!callsign && !recipient && !precAbbrev) return

    if (callsign && !prec && !recipient) {
      const station = createStation(callsign)
      updateActiveLog((log) => ({ ...log, stations: [...log.stations, station] }))
    } else if (callsign && prec && recipient) {
      const station = createStation(callsign)
      station.messages = [{ id: crypto.randomUUID(), quantity: qty, precedence: prec, notes: recipient }]
      updateActiveLog((log) => ({ ...log, stations: [...log.stations, station] }))
    } else if (!callsign && prec && recipient && activeLog.stations.length > 0) {
      const lastStation = activeLog.stations[activeLog.stations.length - 1]
      const newMsg: TrafficMessage = { id: crypto.randomUUID(), quantity: qty, precedence: prec, notes: recipient }
      updateStation(lastStation.id, (s) => ({ ...s, messages: [...s.messages, newMsg] }))
    } else {
      return
    }

    setGridCallSign('')
    setGridQty('1')
    setGridPrec('')
    setGridRecipient('')
    window.setTimeout(() => {
      gridCallSignRef.current?.focus()
      gridTableRef.current?.scrollTo({ top: gridTableRef.current.scrollHeight, behavior: 'smooth' })
    }, 0)
  }

  const toggleAncs = (stationId: string) => {
    updateStation(stationId, (s) => ({ ...s, isAncs: !s.isAncs }))
  }

  const startAmend = (stationId: string) => {
    setAmendingStationId(stationId)
    setAmendQty('1')
    setAmendPrec('')
    setAmendRecipient('')
    window.setTimeout(() => amendQtyRef.current?.focus(), 0)
  }

  const commitAmend = () => {
    if (!amendingStationId) return
    const qty = Math.max(1, Number.parseInt(amendQty, 10) || 1)
    const precAbbrev = amendPrec.trim().toUpperCase()
    const prec = precedenceFromAbbrev[precAbbrev] ?? null
    const recipient = normalizeTrafficNote(amendRecipient)
    if (!prec || !recipient) { setAmendingStationId(null); return }
    const newMsg: TrafficMessage = { id: crypto.randomUUID(), quantity: qty, precedence: prec, notes: recipient }
    updateStation(amendingStationId, (s) => ({ ...s, messages: [...s.messages, newMsg] }))
    setAmendingStationId(null)
    setAmendQty('1')
    setAmendPrec('')
    setAmendRecipient('')
  }

  const removeStation = (stationId: string) => {
    updateActiveLog((log) => ({
      ...log,
      stations: log.stations.filter((station) => station.id !== stationId),
    }))
  }

  const clearAllStations = () => {
    if (activeLog.stations.length === 0) return
    if (window.confirm('Clear all stations from this log?')) {
      updateActiveLog((log) => ({ ...log, stations: [] }))
    }
  }

  const updateStation = (
    stationId: string,
    updater: (station: StationCheckIn) => StationCheckIn,
  ) => {
    updateActiveLog((log) => ({
      ...log,
      stations: log.stations.map((station) =>
        station.id === stationId ? updater(station) : station,
      ),
    }))
  }

  const addMessage = (stationId: string) => {
    updateStation(stationId, (station) => ({
      ...station,
      messages: [...station.messages, createMessage()],
    }))
  }

  const updateMessage = (
    stationId: string,
    messageId: string,
    updater: (message: TrafficMessage) => TrafficMessage,
  ) => {
    updateStation(stationId, (station) => ({
      ...station,
      messages: station.messages.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    }))
  }

  const removeMessage = (stationId: string, messageId: string) => {
    updateStation(stationId, (station) => ({
      ...station,
      messages: station.messages.filter((message) => message.id !== messageId),
    }))
  }

  const setNetStartTime = () => {
    updateActiveLog((log) => ({ ...log, startTime: normalizeZuluInput(zuluDateTimeInput()) }))
  }

  const closeNet = () => {
    updateActiveLog((log) => ({ ...log, closeTime: normalizeZuluInput(zuluDateTimeInput()) }))
  }

  const saveNow = async () => {
    setSaveState('saving')
    const saved = await saveLoggerData(data)
    setSaveState(saved ? 'saved' : 'error')
  }

  const openDataFolder = async () => {
    await openLoggerDataFolder()
  }

  const buildStationListText = (): string => {
    const lines: string[] = []
    lines.push('NCS LOGGER - STATION LIST')
    lines.push(`Net: ${activeLog.netName}`)
    lines.push(`Date: ${activeLog.startTime ? displayDateTime(activeLog.startTime).split(' ')[0] : ''}`)
    lines.push(`Start: ${activeLog.startTime ? displayDateTime(activeLog.startTime) : 'Not set'}`)
    if (activeLog.frequency) lines.push(`Freq: ${activeLog.frequency}`)
    if (activeLog.ncsCallSign) lines.push(`NCS: ${activeLog.ncsCallSign}`)
    lines.push('')

    lines.push('Stations:')
    if (activeLog.stations.length === 0) {
      lines.push('  (none)')
    } else {
      for (const station of activeLog.stations) {
        const suffix = station.isAncs ? ' (ANCS)' : ''
        const traffic = station.messages.length > 0 ? `  [${formatTrafficSummary(station.messages)}]` : ''
        lines.push(`  ${station.callSign}${suffix}${traffic}`)
      }
    }

    return lines.join('\r\n')
  }

  const openStationList = () => {
    setStationListText(buildStationListText())
    setShowStationList(true)
  }

  const copyStationListText = () => {
    navigator.clipboard.writeText(stationListText).catch(() => {})
  }

  if (!activeLog) {
    return (
      <main className="app-shell">
        <div className="empty-state">
          <h1>NCS Logger</h1>
          <button className="primary-button" type="button" onClick={startNewLog}>
            Start First Net Log
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Army MARS</p>
          <h1>NCS Logger</h1>
        </div>
        <div className="top-actions">
          <select
            aria-label="Open historical net log"
            value={activeLog.id}
            onChange={(event) => selectLog(event.target.value)}
          >
            {data.logs.map((log) => (
              <option key={log.id} value={log.id}>
                {log.netName || 'Unnamed net'} - {displayDateTime(log.startTime)}
              </option>
            ))}
          </select>
          <button type="button" onClick={startNewLog}>
            New Net
          </button>
          <button className="primary-button" type="button" onClick={saveNow}>
            {saveState === 'saving' ? 'Saving...' : 'Save Log'}
          </button>
          <button type="button" onClick={openStationList}>
            Station List
          </button>
          <button type="button" onClick={() => setIsDark(!isDark)}>
            {isDark ? '\u263C' : '\u263E'}
          </button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <div>
          <strong>Start:</strong> {displayDateTime(activeLog.startTime)}
        </div>
        <div>
          <strong>Close:</strong> {displayDateTime(activeLog.closeTime)}
        </div>
        <div>
          <strong>Stations:</strong> {activeLog.stations.length}
        </div>
        <div>
          <strong>Traffic:</strong> {trafficTotals.Routine + trafficTotals.Priority + trafficTotals.Immediate}
        </div>
        <div className={hasUnsavedError ? 'save-error' : 'save-note'}>
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && 'Save failed'}
          {saveState === 'idle' && 'Ready'}
        </div>
      </section>

      <section className="panel net-details" aria-labelledby="net-details-heading">
        <div className="section-heading">
          <h2 id="net-details-heading">Net Details</h2>
        </div>
        <div className="form-grid">
          <label>
            Net Name
            <input
              value={activeLog.netName}
              onChange={(event) => updateLogField('netName', event.target.value)}
            />
          </label>
          <label>
            Frequency
            <input
              value={activeLog.frequency}
              onChange={(event) => updateLogField('frequency', event.target.value)}
              placeholder="Example: 4.XXX MHz"
            />
          </label>
          <label>
            NCS Call Sign
            <input
              value={activeLog.ncsCallSign}
              onChange={(event) => updateLogField('ncsCallSign', event.target.value)}
            />
          </label>
          <label>
            Net Start Date / Time Zulu
            <span className="input-with-button">
              <input
                type="datetime-local"
                value={zuluValueForInput(activeLog.startTime)}
                onChange={(event) => updateLogField('startTime', normalizeZuluInput(event.target.value))}
              />
              <button className="small-button" type="button" onClick={setNetStartTime}>
                Now
              </button>
            </span>
          </label>
          <label>
            Net Close Date / Time Zulu
            <span className="input-with-button">
              <input
                type="datetime-local"
                value={zuluValueForInput(activeLog.closeTime)}
                onChange={(event) => updateLogField('closeTime', normalizeZuluInput(event.target.value))}
              />
              <button className="small-button" type="button" onClick={closeNet}>
                Now
              </button>
            </span>
          </label>
        </div>
      </section>

      <section className="panel grid-panel" aria-labelledby="grid-heading">
          <div className="section-heading">
            <h2 id="grid-heading">Checked-In Stations</h2>
            <button className="small-button danger-button" type="button" onClick={clearAllStations}>
              Clear All
            </button>
          </div>

          <div className="grid-table" ref={gridTableRef} role="table" aria-label="Stations and traffic">
            <div className="grid-row grid-header-row" role="row">
              <div className="grid-cell grid-cell-header grid-ancs-col" role="columnheader">ANCS</div>
              <div className="grid-cell grid-cell-header" role="columnheader">Call Sign</div>
              <div className="grid-cell grid-cell-header grid-qty-col" role="columnheader">#</div>
              <div className="grid-cell grid-cell-header grid-prec-col" role="columnheader">Prec</div>
              <div className="grid-cell grid-cell-header" role="columnheader">Recipient / Notes</div>
            </div>

            {activeLog.stations.length === 0 ? (
              <div className="grid-empty">No stations checked in yet</div>
            ) : activeLog.stations.flatMap((station) => {
              const rows: React.ReactElement[] = []
              if (station.messages.length === 0) {
                rows.push((
                  <div className="grid-row grid-data-row" key={station.id} onClick={() => setEditingStationId(station.id)}>
                    <div className="grid-cell grid-ancs-col" role="cell" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="grid-checkbox" checked={station.isAncs} onChange={() => toggleAncs(station.id)} />
                    </div>
                    <div className="grid-cell grid-callsign-cell" role="cell">
                      {station.callSign}{station.isAncs ? <span className="ancs-badge"> ANCS</span> : null}
                    </div>
                    <div className="grid-cell grid-qty-col" role="cell"><span className="grid-dash">&ndash;</span></div>
                    <div className="grid-cell grid-prec-col" role="cell"></div>
                    <div className="grid-cell" role="cell">
                      <span className="grid-checkin-text">Check in only</span>
                      <button className="grid-add-btn" onClick={(e) => { e.stopPropagation(); startAmend(station.id) }}>+</button>
                      <button className="grid-del-btn" onClick={(e) => { e.stopPropagation(); removeStation(station.id) }}>&#128465;</button>
                    </div>
                  </div>
                ))
              } else {
                station.messages.forEach((msg, idx) => {
                  const isLast = idx === station.messages.length - 1
                  rows.push((
                    <div className="grid-row grid-data-row" key={msg.id} onClick={() => setEditingStationId(station.id)}>
                      <div className="grid-cell grid-ancs-col" role="cell" onClick={(e) => e.stopPropagation()}>
                        {idx === 0 ? <input type="checkbox" className="grid-checkbox" checked={station.isAncs} onChange={() => toggleAncs(station.id)} /> : null}
                      </div>
                      <div className="grid-cell grid-callsign-cell" role="cell">
                        {idx === 0 ? station.callSign : ''}
                        {idx === 0 && station.isAncs ? <span className="ancs-badge"> ANCS</span> : null}
                        {idx === 0 && station.remarks ? <span className="grid-has-remarks" title="Has remarks">&#9998;</span> : null}
                      </div>
                      <div className="grid-cell grid-qty-col" role="cell">{msg.quantity}</div>
                      <div className={`grid-cell grid-prec-col grid-${msg.precedence.toLowerCase()}`} role="cell">
                        {precedenceAbbrev[msg.precedence]}
                      </div>
                      <div className="grid-cell" role="cell">
                        {msg.notes}
                        <button className="grid-x-btn" onClick={(e) => { e.stopPropagation(); removeMessage(station.id, msg.id) }}>&#10005;</button>
                        {isLast ? <button className="grid-add-btn" onClick={(e) => { e.stopPropagation(); startAmend(station.id) }}>+</button> : null}
                        {isLast ? <button className="grid-del-btn" onClick={(e) => { e.stopPropagation(); removeStation(station.id) }}>&#128465;</button> : null}
                      </div>
                    </div>
                  ))
                })
              }
              if (amendingStationId === station.id) {
                rows.push((
                  <div className="grid-row grid-amend-row" key={`${station.id}-amend`}>
                    <div className="grid-cell grid-ancs-col" role="cell"></div>
                    <div className="grid-cell grid-callsign-cell" role="cell"></div>
                    <div className="grid-cell grid-qty-col" role="cell">
                      <input ref={amendQtyRef} className="grid-input grid-amend-input" value={amendQty} onChange={(e) => setAmendQty(e.target.value)} onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); amendPrecRef.current?.focus() } if (e.key === 'Enter') { e.preventDefault(); commitAmend() } }} />
                    </div>
                    <div className="grid-cell grid-prec-col" role="cell">
                      <input ref={amendPrecRef} className={`grid-input grid-amend-input ${gridPrecClass(amendPrec)}`} value={amendPrec} onChange={(e) => setAmendPrec(uppercaseText(e.target.value))} onKeyDown={(e) => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); amendRecipientRef.current?.focus() } if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); amendQtyRef.current?.focus() } if (e.key === 'Enter') { e.preventDefault(); commitAmend() } }} placeholder="RR" />
                    </div>
                    <div className="grid-cell" role="cell">
                      <input ref={amendRecipientRef} className="grid-input grid-amend-input" value={amendRecipient} onChange={(e) => setAmendRecipient(uppercaseText(e.target.value))} onKeyDown={(e) => { if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); amendPrecRef.current?.focus() } if (e.key === 'Tab' && !e.shiftKey || e.key === 'Enter') { e.preventDefault(); commitAmend() } }} placeholder="RECIPIENT" />
                    </div>
                  </div>
                ))
              }
              return rows
            })}

            <div className="grid-row grid-entry-row" role="row">
              <div className="grid-cell grid-ancs-col" role="cell"></div>
              <div className="grid-cell" role="cell">
                <input
                  ref={gridCallSignRef}
                  className="grid-input"
                  value={gridCallSign}
                  onChange={(e) => setGridCallSign(uppercaseText(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); gridQtyRef.current?.focus() }
                    if (e.key === 'Enter') { e.preventDefault(); commitGridEntry() }
                  }}
                  placeholder="CALLSIGN + ENTER"
                />
              </div>
              <div className="grid-cell grid-qty-col" role="cell">
                <input
                  ref={gridQtyRef}
                  className="grid-input"
                  value={gridQty}
                  onChange={(e) => setGridQty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); gridPrecRef.current?.focus() }
                    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); gridCallSignRef.current?.focus() }
                    if (e.key === 'Enter') { e.preventDefault(); commitGridEntry() }
                  }}
                />
              </div>
              <div className="grid-cell grid-prec-col" role="cell">
                <input
                  ref={gridPrecRef}
                  className={`grid-input ${gridPrecClass(gridPrec)}`}
                  value={gridPrec}
                  onChange={(e) => setGridPrec(uppercaseText(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); gridRecipientRef.current?.focus() }
                    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); gridQtyRef.current?.focus() }
                    if (e.key === 'Enter') { e.preventDefault(); commitGridEntry() }
                  }}
                  placeholder="RR/PP/II"
                />
              </div>
              <div className="grid-cell" role="cell">
                <input
                  ref={gridRecipientRef}
                  className="grid-input"
                  value={gridRecipient}
                  onChange={(e) => setGridRecipient(uppercaseText(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); gridPrecRef.current?.focus() }
                    if (e.key === 'Tab' && !e.shiftKey || e.key === 'Enter') { e.preventDefault(); commitGridEntry() }
                  }}
                  placeholder="RECIPIENT"
                />
              </div>
            </div>
          </div>
        </section>

      <section className="bottom-grid">
        <div className="panel traffic-summary" aria-labelledby="traffic-summary-heading">
          <h2 id="traffic-summary-heading">Traffic Summary</h2>
          <div className="summary-items">
            <div>
              <span>Routine</span>
              <strong>{trafficTotals.Routine}</strong>
            </div>
            <div>
              <span>Priority</span>
              <strong>{trafficTotals.Priority}</strong>
            </div>
            <div>
              <span>Immediate</span>
              <strong>{trafficTotals.Immediate}</strong>
            </div>
          </div>
        </div>

        <div className="panel notes-panel" aria-labelledby="notes-heading">
          <h2 id="notes-heading">Net Notes</h2>
          <textarea
            value={activeLog.notes}
            onChange={(event) => updateLogField('notes', event.target.value)}
          />
        </div>

        <div className="panel storage-panel" aria-labelledby="storage-heading">
          <h2 id="storage-heading">Local Storage</h2>
          <p>{storageInfo?.dataFile ?? 'Loading storage location...'}</p>
          <p className="muted">Version {appVersion}</p>
          <button type="button" disabled={!storageInfo?.canOpenFolder} onClick={openDataFolder}>
            Open Data Folder
          </button>
        </div>
      </section>

      {editingStationId && (() => {
        const station = activeLog.stations.find((s) => s.id === editingStationId)
        if (!station) return null

        return (
          <div className="modal-overlay" onClick={() => setEditingStationId(null)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Edit Station</h2>
                <button className="modal-close" type="button" onClick={() => setEditingStationId(null)}>
                  X
                </button>
              </div>

              <div className="form-grid" style={{ marginBottom: 16 }}>
                <label>
                  Call Sign
                  <input
                    value={station.callSign}
                    onChange={(e) =>
                      updateStation(station.id, (s) => ({ ...s, callSign: uppercaseText(e.target.value) }))
                    }
                    onBlur={(e) =>
                      updateStation(station.id, (s) => ({ ...s, callSign: normalizeCallSign(e.target.value) }))
                    }
                  />
                </label>
              </div>

              <div style={{ marginBottom: 16 }}>
                <h3>Traffic</h3>
                {station.messages.length === 0 ? (
                  <p className="muted">No listed traffic</p>
                ) : (
                  station.messages.map((message) => (
                    <div className="message-row" key={message.id}>
                      <input
                        aria-label="Message quantity"
                        className="quantity-input"
                        min="1"
                        type="number"
                        value={message.quantity}
                        onChange={(e) =>
                          updateMessage(station.id, message.id, (m) => ({
                            ...m,
                            quantity: Math.max(1, Number.parseInt(e.target.value, 10) || 1),
                          }))
                        }
                      />
                      <select
                        aria-label="Message precedence"
                        className={precedenceClass(message.precedence)}
                        value={message.precedence}
                        onChange={(e) =>
                          updateMessage(station.id, message.id, (m) => ({
                            ...m,
                            precedence: e.target.value as Precedence,
                          }))
                        }
                      >
                        {precedences.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Traffic notes"
                        value={message.notes}
                        onChange={(e) =>
                          updateMessage(station.id, message.id, (m) => ({
                            ...m,
                            notes: uppercaseText(e.target.value),
                          }))
                        }
                        onBlur={(e) =>
                          updateMessage(station.id, message.id, (m) => ({
                            ...m,
                            notes: normalizeTrafficNote(e.target.value),
                          }))
                        }
                        placeholder="Recipient"
                      />
                      <button
                        className="small-button danger-button"
                        type="button"
                        onClick={() => removeMessage(station.id, message.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
                <button className="small-button" type="button" onClick={() => addMessage(station.id)}>
                  Add Traffic
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label>
                  Remarks
                  <textarea
                    value={station.remarks}
                    onChange={(e) =>
                      updateStation(station.id, (s) => ({ ...s, remarks: uppercaseText(e.target.value) }))
                    }
                  />
                </label>
              </div>

              <button
                className="danger-button"
                type="button"
                onClick={() => { removeStation(station.id); setEditingStationId(null) }}
              >
                Remove Station
              </button>
            </div>
          </div>
        )
      })()}

      {showStationList ? (
        <div className="modal-overlay" onClick={() => setShowStationList(false)}>
          <div className="modal-content station-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Station List Preview</h2>
              <div className="station-list-actions">
                <button className="primary-button" type="button" onClick={copyStationListText}>
                  Copy to Clipboard
                </button>
                <button className="modal-close" type="button" onClick={() => setShowStationList(false)}>
                  X
                </button>
              </div>
            </div>
            <pre className="station-list-pre">{stationListText}</pre>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
