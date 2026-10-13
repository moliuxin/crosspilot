import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { renderLayout } from '../../components/site-blocks'
import './market-variants.css'

const MARKET_META = {
  'zh-CN': { flag: '🇨🇳', label: '中文站', note: '制造能力前置' },
  'en-US': { flag: '🇺🇸', label: 'English', note: 'Benefits 叙事' },
  'ru-RU': { flag: '🇷🇺', label: 'Русский', note: '参数与服务直给' },
}

/** 市场图片真实状态:AI / Fallback / 生成中 计数 + 失败原因(P0-IMAGE-RATE-LIMIT-RESILIENCE) */
function ImageStatusStrip({ status, onRegenerate, regenBusy }) {
  if (!status || !Array.isArray(status.markets) || status.markets.length === 0) return null
  const job = status.job || {}
  const totalFallback = status.markets.reduce((n, m) => n + (m.FALLBACK || 0), 0)
  const totalPending = status.markets.reduce((n, m) => n + (m.PENDING || 0), 0)
  const running = job.status === 'running' || totalPending > 0
  const done = job.total ? `${job.done + job.failed}/${job.total}` : null
  return (
    <div className="mv-image-status">
      <div className="mv-imgs-row">
        {running
          ? <span className="mv-img-chip gen">⏳ Images: Generating {done || `${totalPending} pending`}</span>
          : <span className="mv-img-chip ok">✓ Images ready {done ? `(${done})` : ''}</span>}
        {status.markets.map((m) => (
          <span className="mv-img-chip" key={m.market} title={(m.reasons || []).join('\n') || '全部图片就绪'}>
            {MARKET_META[m.market]?.flag || ''} {m.market}:{' '}
            <b style={{ color: '#15803d' }}>{m.AI} AI</b> /{' '}
            {m.REAL > 0 && <><b style={{ color: '#2563eb' }}>{m.REAL} real</b> / </>}
            {m.CONCEPT > 0 && <><b style={{ color: '#9333ea' }}>{m.CONCEPT} concept</b> / </>}
            {m.FALLBACK > 0
              ? <b style={{ color: '#dc2626' }}>{m.FALLBACK} fallback</b>
              : <span style={{ color: '#6b7280' }}>0 fb</span>}
            {m.PENDING > 0 && <b style={{ color: '#d97706' }}> · {m.PENDING} 中</b>}
          </span>
        ))}
        {totalFallback > 0 && (
          <button className="ghost-btn" onClick={onRegenerate} disabled={regenBusy}>
            {regenBusy ? '补图中…' : `⟳ Regenerate Missing Visuals(${totalFallback})`}
          </button>
        )}
      </div>
      {totalFallback > 0 && (
        <div className="mv-img-reason muted" style={{ fontSize: 12 }}>
          Reason: {[...new Set(status.markets.flatMap((m) => m.reasons || []))].slice(0, 3).join(' · ') || 'Provider 返回错误'}
          (Provider 恢复后点上方按钮只补失败图,已成功图不重复计费)
        </div>
      )}
    </div>
  )
}

/**
 * PHASE 6 前端:三市场变体并排(真正不同的 layout_schema / tokens / 文案 / 资产)。
 * PHASE 8:AI 画笔 — 点击区块选中 → 自然语言 → Draft/Diff → 确认发布 → 可回滚。
 * 异步图片:结构先生成(站点立即可见),图片后台补齐,轮询自动刷新到最新资产。
 */
export default function MarketVariantsPanel({ siteId }) {
  const { toast, openPaywall } = useApp()
  const [variants, setVariants] = useState([])
  const [siteSlug, setSiteSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)   // {market, sectionId, type}
  const [instruction, setInstruction] = useState('')
  const [brushResult, setBrushResult] = useState(null)
  const [brushBusy, setBrushBusy] = useState(false)
  const [versionInfo, setVersionInfo] = useState(null)
  const [imgStatus, setImgStatus] = useState(null)
  const [regenBusy, setRegenBusy] = useState(false)
  const pollRef = useRef(null)

  const load = useCallback(() => {
    if (!siteId) return
    api.getMarketVariants(siteId).then(setVariants).catch(() => setVariants([]))
  }, [siteId])

  useEffect(() => { load() }, [load])

  // 图片后台补齐进度:轮询 status,直到无 PENDING 且任务结束;期间同步刷新区块图
  const pollStatus = useCallback(() => {
    if (!siteId) return
    clearInterval(pollRef.current)
    const tick = async () => {
      try {
        const st = await api.getVisualsStatus(siteId)
        if (!st) return
        setImgStatus(st)
        const pending = (st.markets || []).reduce((n, m) => n + (m.PENDING || 0), 0)
        if (pending > 0 || st.job?.status === 'running') {
          load()  // 拉最新 sections(图片逐张就位)
        } else {
          clearInterval(pollRef.current)
          pollRef.current = null
          load()
        }
      } catch { /* 后台任务未就绪,忽略 */ }
    }
    tick()
    pollRef.current = setInterval(tick, 3000)
    return () => clearInterval(pollRef.current)
  }, [siteId, load])

  useEffect(() => {
    pollStatus()
    return () => clearInterval(pollRef.current)
  }, [pollStatus])

  useEffect(() => {
    if (!siteId) return
    api.getSiteDetail(siteId)
      .then((d) => setSiteSlug(d.site?.public_slug || ''))
      .catch(() => setSiteSlug(''))
  }, [siteId])

  async function regenerate() {
    setBusy(true)
    try {
      const res = await api.generateMarketVariants(siteId)
      setVariants(res.variants || [])
      toast('三市场变体已生成(结构级差异,非翻译);图片后台补齐中', 'success')
      pollStatus()
    } catch (e) {
      toast(`生成失败:${e?.message || e?.detail?.message || '请稍后重试'}`, 'warn')
    } finally {
      setBusy(false)
    }
  }

  /** 只补 FALLBACK 的图片(限流恢复后一键恢复,已成功图不重复计费) */
  async function regenerateMissing() {
    setRegenBusy(true)
    try {
      const res = await api.regenerateVisuals(siteId)
      const ok = res.regenerated || 0
      const still = res.still_fallback || 0
      toast(ok > 0
        ? `已补齐 ${ok} 张图片${still ? `,仍有 ${still} 张失败(Provider 未恢复)` : ''}`
        : `没有可补的图片${still ? `(${still} 张仍失败)` : ''}`, ok > 0 ? 'success' : 'warn')
      load()
      pollStatus()
    } catch (e) {
      toast(`补图失败:${e?.detail?.message || e?.message || '请重试'}`, 'warn')
    } finally {
      setRegenBusy(false)
    }
  }

  async function runBrush() {
    if (!selected || !instruction.trim()) return
    setBrushBusy(true)
    setBrushResult(null)
    try {
      const res = await api.brushGenerate(siteId, selected.market, selected.sectionId, instruction.trim())
      setBrushResult(res)
      toast(`草稿已生成(${res.ai_source === 'glm' ? 'GLM' : '模板'}),确认后才发布`, 'success')
    } catch (e) {
      const status = e?.status
      if (status === 403) {
        openPaywall('AI 画笔 · Pro', 'AI 画笔属于 Pro 能力,升级后即可圈选组件并让 AI 修改内容。', 'brush.edit')
      } else {
        toast(`生成失败:${e?.detail?.message || e?.message || '请重试'}`, 'warn')
      }
    } finally {
      setBrushBusy(false)
    }
  }

  async function confirmPublish() {
    try {
      const res = await api.publishDraft(brushResult.draft_id)
      setVersionInfo(res.version)
      setBrushResult(null)
      setInstruction('')
      load()
      toast(`已发布 · 版本 v${res.version.version_no}(可回滚)`, 'success')
    } catch (e) {
      toast(`发布失败:${e?.detail?.message || e?.message}`, 'warn')
    }
  }

  async function rollback() {
    try {
      await api.rollbackVersion(versionInfo.id, 'market_variant', versionInfo.entity_id)
      setVersionInfo(null)
      load()
      toast('已回滚到发布前状态', 'success')
    } catch (e) {
      toast(`回滚失败:${e?.detail?.message || e?.message}`, 'warn')
    }
  }

  if (!siteId) return null

  return (
    <section className="panel mv-panel">
      <div className="panel-head">
        <div>
          <h3>市场变体 · Market Variants(结构级)</h3>
          <p className="muted" style={{ fontSize: 12.5 }}>
            每市场独立布局/令牌/文案/资产;Product Facts 共享不可变。
            {siteSlug && <> 公开站:<Link to={`/site/${siteSlug}/zh-CN/`}>中文</Link> · <Link to={`/site/${siteSlug}/en-US/`}>EN</Link> · <Link to={`/site/${siteSlug}/ru-RU/`}>RU</Link></>}
          </p>
        </div>
        <button className="primary-btn" onClick={regenerate} disabled={busy}>
          {busy ? '✦ 生成中…' : '✦ 生成三市场变体'}
        </button>
      </div>

      {variants.length === 0 && (
        <div className="empty" style={{ padding: '26px 0' }}>
          尚无市场变体 —— 点击「生成三市场变体」。
        </div>
      )}

      {variants.length > 0 && (
        <ImageStatusStrip status={imgStatus} onRegenerate={regenerateMissing} regenBusy={regenBusy} />
      )}

      {/* AI 画笔操作条 */}
      <div className="brush-bar">
        <span className="brush-sel">
          🖌 AI 画笔:{selected
            ? `${MARKET_META[selected.market]?.flag || ''} ${selected.market} · ${selected.type} (${selected.sectionId})`
            : '点击下方任一区块选中'}
        </span>
        <input
          className="brush-input"
          placeholder="例:更适合俄罗斯系统集成商,突出 10kg 负载、稳定供货和技术支持"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={!selected}
        />
        <button className="primary-btn" onClick={runBrush} disabled={!selected || !instruction.trim() || brushBusy}>
          {brushBusy ? '生成中…' : '生成草稿'}
        </button>
        {versionInfo && (
          <button className="ghost-btn" onClick={rollback}>⟲ 回滚 v{versionInfo.version_no}</button>
        )}
      </div>

      {brushResult && (
        <div className="brush-diff panel">
          <div className="panel-head">
            <div>
              <h3>BEFORE / AFTER(确认后才写入公开变体)</h3>
              <p className="muted" style={{ fontSize: 12 }}>来源:{brushResult.ai_source === 'glm' ? `GLM ${brushResult.model}` : '模板(已如实标注)'}</p>
            </div>
            <div>
              <button className="primary-btn" onClick={confirmPublish}>✓ 确认并发布</button>
              <button className="ghost-btn" onClick={() => setBrushResult(null)}>放弃</button>
            </div>
          </div>
          <table className="brush-diff-table">
            <thead><tr><th>字段</th><th>BEFORE</th><th>AFTER</th></tr></thead>
            <tbody>
              {(brushResult.diff || []).map((d, i) => (
                <tr key={i}>
                  <td>{d.field}</td>
                  <td className="bd-before">{String(d.before).slice(0, 90) || '—'}</td>
                  <td className="bd-after">{String(d.after).slice(0, 90) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mv-grid">
        {variants.map((v) => {
          const meta = MARKET_META[v.market] || {}
          const sections = v.layout_schema?.sections || []
          const tokens = v.design_tokens || {}
          const hero = v.content_json?.copy?.hero || {}
          const assets = Object.values(v.asset_manifest || {})
          return (
            <article className="mv-card" key={v.market}>
              <header className="mv-head" style={{ background: tokens.primary || '#141a24', color: tokens.on_dark || '#e6ebf2' }}>
                <span className="mv-flag">{meta.flag}</span>
                <div>
                  <b>{meta.label}</b>
                  <span>{meta.note} · {sections.length} 个区块</span>
                </div>
              </header>
              <div className="mv-body">
                {hero.cta && (
                  <div className="mv-cta" style={{ background: tokens.accent || '#c2570c', color: tokens.on_accent || '#fff' }}>
                    CTA:{hero.cta}
                  </div>
                )}
                {sections.map((s) => (
                  <div
                    key={s.id}
                    className={`mv-section${selected?.market === v.market && selected?.sectionId === s.id ? ' sel' : ''}`}
                    onClick={() => setSelected({ market: v.market, sectionId: s.id, type: s.type })}
                    title="点击选中,供 AI 画笔修改"
                  >
                    {renderLayout([s], { designTokens: tokens, market: v.market, locale: v.locale })}
                  </div>
                ))}
              </div>
              <footer className="mv-foot">
                <span>资产 {assets.length}:{assets.map((a) => a.source_type).filter(Boolean).join(' / ') || '—'}</span>
                <span className="mv-src">{v.layout_schema?.layout_source === 'glm' ? 'GLM 布局' : '规则布局'}</span>
              </footer>
            </article>
          )
        })}
      </div>
    </section>
  )
}