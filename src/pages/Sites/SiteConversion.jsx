import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import './conversion.css'

const MARKETS = [
  { id: 'zh-CN', label: '中文站' },
  { id: 'en-US', label: 'English' },
  { id: 'ru-RU', label: 'Русский' },
]

const DIM_LABELS = {
  product_clarity: '产品清晰度',
  trust_evidence: '信任证据',
  procurement_information: '采购信息',
  cta_clarity: 'CTA 清晰度',
  rfq_convenience: '询盘便利性',
}

/**
 * Buyer Conversion Readiness(P0-8):站点级五维采购转化准备度。
 * 规则引擎真实评分(证据/缺失/建议)+ 改进草稿闭环(只写真实采购事实,不编造)
 * + Re-score 前后对比。Readiness Score ≠ 成交概率(如实标注)。
 */
export default function SiteConversion() {
  const { siteId } = useParams()
  const { toast, openPaywall } = useApp()
  const [markets, setMarkets] = useState([])
  const [market, setMarket] = useState('en-US')
  const [report, setReport] = useState(null)
  const [prev, setPrev] = useState(null)      // 改进前报告(对比用)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)    // 改进草稿 {draft_id, diff, applied}

  useEffect(() => {
    api.getMarketVariants(siteId).then((vs) => {
      const ms = vs.map((v) => v.market)
      setMarkets(ms)
      if (ms.length && !ms.includes(market)) setMarket(ms[0])
    }).catch(() => setMarkets([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  const loadHistory = useCallback(() => {
    api.getConversionReports(siteId, market).then((r) => {
      setHistory(r.reports || [])
      if (r.reports?.length) { setReport(r.reports[0]); setPrev(r.reports[1] || null) }
    }).catch(() => setHistory([]))
  }, [siteId, market])

  useEffect(() => { loadHistory() }, [loadHistory])

  async function analyze() {
    setBusy(true)
    try {
      const res = await api.analyzeConversion(siteId, market)
      setPrev(report && report.id !== res.report.id ? report : prev)
      setReport(res.report)
      toast(`分析完成:${res.report.overall_score} 分(${res.report.provider === 'rule_engine+glm' ? '规则+GLM 语义' : '规则引擎'})`, 'success')
      loadHistory()
    } catch (e) {
      toast(`分析失败:${e?.detail?.message || e?.detail || e?.message || '请稍后'}`, 'warn')
    } finally { setBusy(false) }
  }

  async function improve() {
    setBusy(true)
    try {
      const res = await api.conversionImprovementDraft(siteId, market)
      setDraft(res)
      toast('改进草稿已生成(只写入产品资料中的真实采购信息);确认后发布', 'success')
    } catch (e) {
      const status = e?.status
      if (status === 422) {
        toast('无可用真实采购事实(MOQ/交期/质保等未填写)—— 平台拒绝编造。请先到「产品」补充真实采购信息。', 'warn')
      } else if (status === 403) {
        openPaywall('转化改进 · Pro', '改进草稿生成属于 Pro 能力,升级后可用。', 'brush.edit')
      } else {
        toast(`改进失败:${e?.detail?.message || e?.message || '请稍后'}`, 'warn')
      }
    } finally { setBusy(false) }
  }

  async function publishDraft() {
    setBusy(true)
    try {
      await api.publishDraft(draft.draft_id, true)
      toast('改进已发布;正在重新分析(Re-score)…', 'success')
      setDraft(null)
      const res = await api.analyzeConversion(siteId, market)
      setPrev(report)
      setReport(res.report)
      loadHistory()
    } catch (e) {
      toast(`发布失败:${e?.detail?.message || e?.message}`, 'warn')
    } finally { setBusy(false) }
  }

  const delta = report && prev ? report.overall_score - prev.overall_score : null
  const procDelta = report && prev
    ? (report.dimension_scores?.procurement_information ?? 0) - (prev.dimension_scores?.procurement_information ?? 0)
    : null

  return (
    <div className="conv-wrap">
      <div className="panel-head">
        <div>
          <h3>Buyer Conversion Readiness · 采购转化准备度</h3>
          <p className="muted" style={{ fontSize: 12.5 }}>
            五维规则引擎真实评分(证据可溯);Readiness Score ≠ 成交概率。
            改进草稿只写入产品资料中的真实采购信息,缺失时明确拒绝 —— 不编造。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="conv-market" value={market} onChange={(e) => { setMarket(e.target.value); setDraft(null); setReport(null); setPrev(null) }}>
            {MARKETS.filter((m) => markets.includes(m.id)).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <button className="primary-btn" onClick={analyze} disabled={busy || !market}>
            {busy ? '分析中…' : '◎ 分析当前变体'}
          </button>
        </div>
      </div>

      {markets.length === 0 && (
        <div className="empty" style={{ padding: 20 }}>尚无市场变体 —— 先到「市场版本」生成。</div>
      )}

      {report && (
        <div className="conv-report">
          <div className="conv-score-row">
            <div className="conv-overall">
              <b>{report.overall_score}</b>
              <span>/ 100</span>
              {delta !== null && delta !== 0 && (
                <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? `+${delta}` : delta} vs 前次</em>
              )}
            </div>
            {Object.entries(report.dimension_scores || {}).map(([k, v]) => {
              const pv = prev?.dimension_scores?.[k]
              const d = pv != null ? v - pv : null
              return (
                <div className="conv-dim" key={k}>
                  <span className="conv-dim-label">{DIM_LABELS[k] || k}</span>
                  <div className="conv-bar"><i style={{ width: `${v}%` }} data-low={v < 60} /></div>
                  <b>{v}</b>
                  {d != null && d !== 0 && <em className={d > 0 ? 'up' : 'down'}>{d > 0 ? `+${d}` : d}</em>}
                </div>
              )
            })}
          </div>
          {procDelta != null && procDelta > 0 && (
            <div className="conv-rescore">✓ Re-score:采购信息维度 {procDelta > 0 ? `+${procDelta}` : procDelta}(改进发布后)</div>
          )}

          <div className="conv-cols">
            <div>
              <h4>缺失信息({(report.missing_information || []).length})</h4>
              <ul className="conv-missing">
                {(report.missing_information || []).map((m) => <li key={m}>{m}</li>)}
                {!report.missing_information?.length && <li className="ok">无缺失</li>}
              </ul>
            </div>
            <div>
              <h4>改进建议</h4>
              <ul className="conv-recs">
                {(report.recommendations || []).map((r, i) => (
                  <li key={i}><b>{r.dimension_label}</b> {r.action}</li>
                ))}
                {!report.recommendations?.length && <li className="ok">各维度均已达标</li>}
              </ul>
            </div>
          </div>

          <div className="conv-actions">
            <button className="primary-btn" onClick={improve} disabled={busy}>✦ 生成改进草稿(只写真实事实)</button>
            <span className="muted" style={{ fontSize: 12 }}>
              无真实采购信息时平台将拒绝生成 —— 绝不编造 MOQ/交期/质保。
            </span>
          </div>

          {draft && (
            <div className="conv-draft">
              <h4>改进草稿 BEFORE / AFTER(确认后才写入公开变体)</h4>
              <table className="brush-diff-table">
                <thead><tr><th>字段</th><th>BEFORE</th><th>AFTER</th></tr></thead>
                <tbody>
                  {(draft.diff || []).map((d, i) => (
                    <tr key={i}>
                      <td>{d.field}</td>
                      <td className="bd-before">{String(d.before).slice(0, 60) || '—'}</td>
                      <td className="bd-after">{String(d.after).slice(0, 60)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="primary-btn" onClick={publishDraft} disabled={busy}>✓ 确认并发布 → Re-score</button>
                <button className="ghost-btn" onClick={() => setDraft(null)}>放弃</button>
              </div>
            </div>
          )}

          {history.length > 1 && (
            <div className="conv-history">
              <h4>报告历史</h4>
              <table className="conv-hist-table">
                <thead><tr><th>时间</th><th>总分</th><th>产品</th><th>信任</th><th>采购</th><th>CTA</th><th>RFQ</th><th>来源</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{(h.created_at || '').slice(5, 16).replace('T', ' ')}</td>
                      <td><b>{h.overall_score}</b></td>
                      <td>{h.dimension_scores?.product_clarity}</td>
                      <td>{h.dimension_scores?.trust_evidence}</td>
                      <td>{h.dimension_scores?.procurement_information}</td>
                      <td>{h.dimension_scores?.cta_clarity}</td>
                      <td>{h.dimension_scores?.rfq_convenience}</td>
                      <td>{h.provider === 'rule_engine+glm' ? '规则+GLM' : '规则'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!report && markets.length > 0 && (
        <div className="empty" style={{ padding: 20 }}>
          选择市场并点击「分析当前变体」—— 五维证据、缺失清单与改进建议将基于真实区块与产品事实生成。
        </div>
      )}
    </div>
  )
}
