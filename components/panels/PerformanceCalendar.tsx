import React, { useState, useMemo } from "react";
import type { Theme } from "@/lib/types";

interface Signal {
  id: string;
  side: string;
  tradeType: string;
  status: string;
  pnl?: number | null;
  entry: number;
  closePrice?: number | null;
  closeReason?: string | null;
  createdAt: string;
  closedAt?: string | null;
}

interface DayStats {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
}

interface AggregateStats {
  pnl: number; trades: number; wins: number; losses: number; breakevens: number;
  winRate: number; best: DayStats | null; worst: DayStats | null;
}

interface PerformanceCalendarProps {
  signalHistory: Signal[];
  T: Theme;
}

type ViewMode = "day" | "week" | "month";

const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DAYS_ES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const TZ = "America/Santo_Domingo";
const CLOSED_STATUSES = new Set(["sl_hit","tp3_hit","closed_manual","breakeven"]);

function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(d);
}
function dateStrToUTCNoon(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00Z");
}
function addDaysToDateStr(dateStr: string, n: number): string {
  const d = dateStrToUTCNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return toLocalDateStr(d.toISOString());
}
function getWeekStartStr(dateStr: string): string {
  const dow = dateStrToUTCNoon(dateStr).getUTCDay();
  return addDaysToDateStr(dateStr, -dow);
}
function formatDayLabel(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  const m = parts[1], d = parts[2];
  return `${d} ${MONTHS_ES[m-1].slice(0,3)}`;
}
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("es-DO", { timeZone: TZ, hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(iso));
}
function formatDuration(createdAt: string, closedAt: string): string {
  const mins = Math.round((new Date(closedAt).getTime() - new Date(createdAt).getTime())/60000);
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins/60), m = mins%60;
  return m>0 ? `${h}h ${m}min` : `${h}h`;
}
function aggregate(dateStrs: string[], dailyStats: Map<string,DayStats>): AggregateStats {
  let pnl=0,trades=0,wins=0,losses=0,breakevens=0;
  let best: DayStats|null=null, worst: DayStats|null=null;
  dateStrs.forEach(ds => {
    const c = dailyStats.get(ds);
    if (!c || c.trades===0) return;
    pnl+=c.pnl; trades+=c.trades; wins+=c.wins; losses+=c.losses; breakevens+=c.breakevens;
    if(!best || c.pnl>best.pnl) best=c;
    if(!worst || c.pnl<worst.pnl) worst=c;
  });
  const winRate = (wins+losses)>0 ? Math.round(wins/(wins+losses)*100) : 0;
  return {pnl,trades,wins,losses,breakevens,winRate,best,worst};
}

export default function PerformanceCalendar({ signalHistory, T }: PerformanceCalendarProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [viewDate, setViewDate] = useState<Date>(() => dateStrToUTCNoon(toLocalDateStr(new Date().toISOString())));

  const viewDateStr = toLocalDateStr(viewDate.toISOString());
  const todayStr = toLocalDateStr(new Date().toISOString());
  const yearMonth = viewDateStr.split("-");
  const year = parseInt(yearMonth[0],10);
  const month = parseInt(yearMonth[1],10) - 1;

  const dailyStats = useMemo(() => {
    const map = new Map<string, DayStats>();
    (signalHistory ?? []).forEach((s) => {
      if (s.pnl == null) return;
      if (!CLOSED_STATUSES.has(s.status)) return;
      const ref = s.closedAt ?? s.createdAt;
      if (!ref) return;
      const dateStr = toLocalDateStr(ref);
      const existing = map.get(dateStr) ?? { date: dateStr, pnl:0, trades:0, wins:0, losses:0, breakevens:0 };
      existing.pnl += s.pnl;
      existing.trades += 1;
      if (s.pnl > 0.1) existing.wins += 1;
      else if (s.pnl < -0.1) existing.losses += 1;
      else existing.breakevens += 1;
      map.set(dateStr, existing);
    });
    return map;
  }, [signalHistory]);

  const signalsByDate = useMemo(() => {
    const map = new Map<string, Signal[]>();
    (signalHistory ?? []).forEach((s) => {
      if (s.pnl == null) return;
      if (!CLOSED_STATUSES.has(s.status)) return;
      const ref = s.closedAt ?? s.createdAt;
      if (!ref) return;
      const dateStr = toLocalDateStr(ref);
      const arr = map.get(dateStr) ?? [];
      arr.push(s);
      map.set(dateStr, arr);
    });
    map.forEach((arr) => arr.sort((a,b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime()));
    return map;
  }, [signalHistory]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month+1, 0).getDate();
    const startWeekday = firstOfMonth.getDay();
    const result: (DayStats|null)[] = [];
    for (let i=0;i<startWeekday;i++) result.push(null);
    for (let d=1; d<=daysInMonth; d++) {
      const ds = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      result.push(dailyStats.get(ds) ?? {date:ds,pnl:0,trades:0,wins:0,losses:0,breakevens:0});
    }
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [year, month, dailyStats]);

  const weekDates = useMemo(() => {
    const start = getWeekStartStr(viewDateStr);
    return Array.from({length:7}, (_,i) => addDaysToDateStr(start,i));
  }, [viewDateStr]);

  const periodStats = useMemo(() => {
    if (viewMode === "day") return aggregate([viewDateStr], dailyStats);
    if (viewMode === "week") return aggregate(weekDates, dailyStats);
    const dateStrs = cells.filter((c): c is DayStats => !!c).map(c => c.date);
    return aggregate(dateStrs, dailyStats);
  }, [viewMode, viewDateStr, weekDates, cells, dailyStats]);

  const dayTrades = signalsByDate.get(viewDateStr) ?? [];

  const isViewingCurrent = useMemo(() => {
    if (viewMode === "day") return viewDateStr === todayStr;
    if (viewMode === "week") return weekDates.includes(todayStr);
    const now = new Date();
    return year === now.getFullYear() && month === now.getMonth();
  }, [viewMode, viewDateStr, weekDates, todayStr, year, month]);

  const headerLabel = useMemo(() => {
    if (viewMode === "day") {
      const d = dateStrToUTCNoon(viewDateStr);
      const fmt = new Intl.DateTimeFormat("es-ES", { timeZone:"UTC", weekday:"long", day:"numeric", month:"long", year:"numeric" }).format(d);
      return fmt.charAt(0).toUpperCase() + fmt.slice(1);
    }
    if (viewMode === "week") {
      const startD = dateStrToUTCNoon(weekDates[0]);
      const endD = dateStrToUTCNoon(weekDates[6]);
      if (startD.getUTCMonth() === endD.getUTCMonth()) {
        return `${startD.getUTCDate()} - ${endD.getUTCDate()} ${MONTHS_ES[endD.getUTCMonth()]} ${endD.getUTCFullYear()}`;
      }
      return `${startD.getUTCDate()} ${MONTHS_ES[startD.getUTCMonth()].slice(0,3)} - ${endD.getUTCDate()} ${MONTHS_ES[endD.getUTCMonth()].slice(0,3)} ${endD.getUTCFullYear()}`;
    }
    return `${MONTHS_ES[month].toUpperCase()} ${year}`;
  }, [viewMode, viewDateStr, weekDates, month, year]);

  const goPrev = () => {
    if (viewMode === "day") setViewDate(dateStrToUTCNoon(addDaysToDateStr(viewDateStr,-1)));
    else if (viewMode === "week") setViewDate(dateStrToUTCNoon(addDaysToDateStr(viewDateStr,-7)));
    else {
      const m = month===0?12:month, y = month===0?year-1:year;
      setViewDate(dateStrToUTCNoon(`${y}-${String(m).padStart(2,"0")}-01`));
    }
  };
  const goNext = () => {
    if (viewMode === "day") setViewDate(dateStrToUTCNoon(addDaysToDateStr(viewDateStr,1)));
    else if (viewMode === "week") setViewDate(dateStrToUTCNoon(addDaysToDateStr(viewDateStr,7)));
    else {
      const m = month===11?1:month+2, y = month===11?year+1:year;
      setViewDate(dateStrToUTCNoon(`${y}-${String(m).padStart(2,"0")}-01`));
    }
  };
  const goToday = () => setViewDate(dateStrToUTCNoon(todayStr));

  const getCellColor = (c: DayStats) => {
    if (c.trades === 0) return T.card;
    if (Math.abs(c.pnl) <= 0.1) return "#2a2a38";
    const intensity = Math.min(Math.abs(c.pnl)/5, 1);
    return c.pnl > 0
      ? `rgba(0,212,132,${0.15+intensity*0.35})`
      : `rgba(239,68,68,${0.15+intensity*0.35})`;
  };

  const navBtn: React.CSSProperties = {
    background: T.card, border:`1px solid ${T.border}`,
    borderRadius:6, color:T.text, fontSize:18, width:32, height:32,
    cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center",
  };

  const pnlLabel = viewMode==="day" ? "P&L DÍA" : viewMode==="week" ? "P&L SEMANA" : "P&L MES";

  return (
    <div style={{ padding: 12 }}>
      {/* View mode switcher */}
      <div style={{ display:"flex", gap:4, marginBottom:10, background:T.card, borderRadius:8, padding:4, border:`1px solid ${T.border}` }}>
        {(["day","week","month"] as ViewMode[]).map((mode) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            style={{
              flex:1, padding:"6px 0", borderRadius:6, border:"none", cursor:"pointer",
              fontSize:11, fontWeight:700,
              background: viewMode===mode ? T.accent : "transparent",
              color: viewMode===mode ? "#0a0a0f" : T.textSec,
              transition:"background 0.15s",
            }}>
            {mode==="day" ? "Diario" : mode==="week" ? "Semanal" : "Mensual"}
          </button>
        ))}
      </div>

      {/* Header / navigation */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <button onClick={goPrev} style={navBtn} aria-label="Anterior">‹</button>
        <div style={{ textAlign:"center", flex:1 }}>
          <div style={{ fontSize: viewMode==="day"?12:14, fontWeight:700, color:T.text, letterSpacing: viewMode==="month"?1:0 }}>
            {headerLabel}
          </div>
          {!isViewingCurrent && (
            <button onClick={goToday} style={{ fontSize:10, color:T.accent, background:"none", border:"none", cursor:"pointer", marginTop:2 }}>
              Volver a hoy
            </button>
          )}
        </div>
        <button onClick={goNext} style={navBtn} aria-label="Siguiente">›</button>
      </div>

      {/* Summary */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:10, padding:10, background:T.card, borderRadius:8, border:`1px solid ${T.border}` }}>
        <SummaryItem label={pnlLabel} value={`${periodStats.pnl>=0?"+":""}${periodStats.pnl.toFixed(2)}%`} color={periodStats.trades===0?T.textSec:periodStats.pnl>=0?T.bull:T.danger} T={T} />
        <SummaryItem label="TRADES" value={`${periodStats.trades}`} T={T} />
        <SummaryItem label="WIN RATE" value={periodStats.trades===0?"—":`${periodStats.winRate}%`} color={periodStats.trades===0?T.textSec:periodStats.winRate>=50?T.bull:T.warn} T={T} />
        <SummaryItem label="W / L / BE" value={`${periodStats.wins}/${periodStats.losses}/${periodStats.breakevens}`} T={T} />
      </div>

      {/* Best/worst day */}
      {viewMode !== "day" && (periodStats.best || periodStats.worst) && (
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.textSec, marginBottom:10, padding:"0 4px" }}>
          {periodStats.best && (
            <span>Mejor día: <span style={{color:T.bull,fontWeight:700}}>+{periodStats.best.pnl.toFixed(2)}%</span> ({formatDayLabel(periodStats.best.date)})</span>
          )}
          {periodStats.worst && (
            <span>Peor día: <span style={{color:T.danger,fontWeight:700}}>{periodStats.worst.pnl.toFixed(2)}%</span> ({formatDayLabel(periodStats.worst.date)})</span>
          )}
        </div>
      )}

      {/* DAY VIEW */}
      {viewMode === "day" && (
        <div>
          {dayTrades.length === 0 ? (
            <div style={{ textAlign:"center", color:T.textSec, fontSize:11, padding:24 }}>
              Sin operaciones cerradas este día.
            </div>
          ) : (
            dayTrades.map((s) => <TradeRow key={s.id} signal={s} T={T} />)
          )}
        </div>
      )}

      {/* WEEK VIEW */}
      {viewMode === "week" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
          {weekDates.map((ds, i) => {
            const c = dailyStats.get(ds) ?? {date:ds,pnl:0,trades:0,wins:0,losses:0,breakevens:0};
            const dayNum = parseInt(ds.slice(8,10),10);
            const isToday = ds === todayStr;
            return (
              <div key={ds}
                onClick={() => { setViewDate(dateStrToUTCNoon(ds)); setViewMode("day"); }}
                style={{
                  cursor:"pointer", aspectRatio:"0.8", borderRadius:8,
                  background:getCellColor(c),
                  border: isToday ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
                  display:"flex", flexDirection:"column", justifyContent:"space-between", padding:6,
                }}>
                <div>
                  <div style={{ fontSize:9, color:T.textSec, fontWeight:600 }}>{DAYS_ES[i]}</div>
                  <div style={{ fontSize:13, color:T.text, fontWeight:isToday?700:400 }}>{dayNum}</div>
                </div>
                {c.trades > 0 ? (
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color: c.pnl>0.1?T.bull:c.pnl<-0.1?T.danger:T.textSec }}>
                      {c.pnl>=0?"+":""}{c.pnl.toFixed(1)}%
                    </div>
                    <div style={{ fontSize:8, color:T.textSec }}>{c.trades} op</div>
                  </div>
                ) : (
                  <div style={{ fontSize:8, color:T.textSec }}>—</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* MONTH VIEW */}
      {viewMode === "month" && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3, marginBottom:4 }}>
            {DAYS_ES.map((d) => (
              <div key={d} style={{ textAlign:"center", fontSize:9, color:T.textSec, fontWeight:600, padding:"2px 0" }}>{d}</div>
            ))}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:3 }}>
            {cells.map((cell, idx) => {
              if (!cell) return <div key={`empty-${idx}`} />;
              const dayNum = parseInt(cell.date.slice(8,10),10);
              const isToday = cell.date === todayStr;
              return (
                <div key={cell.date}
                  onClick={() => { setViewDate(dateStrToUTCNoon(cell.date)); setViewMode("day"); }}
                  title={cell.trades>0 ? `${cell.trades} operación${cell.trades>1?"es":""} · P&L ${cell.pnl>=0?"+":""}${cell.pnl.toFixed(2)}%` : "Sin operaciones"}
                  style={{
                    cursor:"pointer", aspectRatio:"1", borderRadius:6,
                    background:getCellColor(cell),
                    border: isToday ? `1px solid ${T.accent}` : `1px solid ${T.border}`,
                    display:"flex", flexDirection:"column", justifyContent:"space-between", padding:4, minHeight:48,
                  }}>
                  <div style={{ fontSize:10, color:T.textSec, fontWeight:isToday?700:400 }}>{dayNum}</div>
                  {cell.trades>0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:cell.pnl>0.1?T.bull:cell.pnl<-0.1?T.danger:T.textSec, lineHeight:1.2 }}>
                        {cell.pnl>=0?"+":""}{cell.pnl.toFixed(1)}%
                      </div>
                      <div style={{ fontSize:8, color:T.textSec }}>{cell.trades} op</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Legend */}
      <div style={{ display:"flex", justifyContent:"center", gap:16, marginTop:12, fontSize:9, color:T.textSec }}>
        <LegendItem color="rgba(0,212,132,0.4)" label="Ganancia" />
        <LegendItem color="rgba(239,68,68,0.4)" label="Pérdida" />
        <LegendItem color="#2a2a38" label="Breakeven / sin trades" />
      </div>

      {periodStats.trades === 0 && viewMode !== "day" && (
        <div style={{ textAlign:"center", color:T.textSec, fontSize:11, marginTop:16, padding:8 }}>
          Sin operaciones cerradas en este periodo todavía.
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value, color, T }: { label:string; value:string; color?:string; T:Theme }) {
  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:9, color:T.textSec, marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:700, color: color ?? T.text }}>{value}</div>
    </div>
  );
}

function LegendItem({ color, label }: { color:string; label:string }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <div style={{ width:10, height:10, borderRadius:2, background:color }} />
      <span>{label}</span>
    </div>
  );
}

function TradeRow({ signal, T }: { signal: Signal; T:Theme }) {
  const pnl = signal.pnl ?? 0;
  const pnlColor = pnl>0.1 ? T.bull : pnl<-0.1 ? T.danger : T.textSec;
  const sideColor = signal.side === "LONG" ? T.bull : T.danger;
  const time = signal.closedAt ? formatTime(signal.closedAt) : "";
  const duration = signal.closedAt ? formatDuration(signal.createdAt, signal.closedAt) : "";

  return (
    <div style={{
      display:"flex", justifyContent:"space-between", alignItems:"center",
      padding:"10px 12px", marginBottom:6, borderRadius:8,
      background:T.card, border:`1px solid ${T.border}`,
    }}>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ color:sideColor, fontWeight:700, fontSize:12 }}>{signal.side}</span>
          <span style={{ color:T.textSec, fontSize:10 }}>{signal.tradeType}</span>
          {time && <span style={{ color:T.textSec, fontSize:10 }}>· {time}</span>}
        </div>
        <div style={{ fontSize:10, color:T.textSec, marginTop:2 }}>
          ${Math.round(signal.entry).toLocaleString()} → {signal.closePrice ? `$${Math.round(signal.closePrice).toLocaleString()}` : "—"}
          {duration && ` · ${duration}`}
        </div>
        {signal.closeReason && (
          <div style={{ fontSize:9, color:T.textSec, marginTop:2, opacity:0.7 }}>{signal.closeReason}</div>
        )}
      </div>
      <div style={{ fontSize:15, fontWeight:700, color:pnlColor }}>
        {pnl>=0?"+":""}{pnl.toFixed(2)}%
      </div>
    </div>
  );
}
