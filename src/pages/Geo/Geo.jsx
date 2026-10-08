import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import { api } from '../../services/api'
import Modal from '../../components/ui/Modal'
import AiWaiting, { WAIT_STEPS } from '../../components/brand/AiWaiting'
import { resolveBrand } from '../../data/brand'
import {
  geoVisibility,
  geoIssues,
  geoTasks,
  geoCompare,
  geoMonitor,
  geoTechLayer,
  geoService,
} from '../../data/geo'

const IMPACT_TXT = { high: '高优先', mid: '中优先', low: '低优先' }
const STATE_TXT = { good: '良好', warn: '待改善', bad: '需处理', info: '建议' }

export default function Geo() {
  const navigate = useNavigate()
  const { toast, company } = useApp()
  const [tasks, setTasks] = useState(geoTasks)
  const [showService, setShowService] = useState(false)
  const [running, setRunning] = useState(false)
  const [runType, setRunType] = useState('optimizePage')
  const [geoTaskId, setGeoTaskId] = useState(null)

  const brand = resolveBrand(company, 'merchant')
  const visibility = geoVisibility

  const taskStats = useMemo(() => {
    const done = tasks.filter((t) => t.done).length
    return { done, total: tasks.length, percent: Math.round((done / tasks.length) * 100) }
  }, [tasks])

  // 把 GEO 检查清单持久化成一条 growth 任务（子步骤 = 各检查项），勾选即落库
  useEffect(() => {
    let cancelled = false
    api.getTasks({ kind: 'growth' }).then((list) => {
      if (cancelled) return
      const existing = (list || []).find((t) => t.title === 'GEO 可见性优化清单')
      if (existing) {
        setGeoTaskId(existing.id)
        const steps = existing.steps || []
        if (steps.length) {
          setTasks((prev) =>
            prev.map((t) => {
              const hit = steps.find((s) => s.label === t.title)
              return hit ? { ...t, done: !!hit.done } : t
            })
          )
        }
      } else {
        api
          .createTask({
            kind: 'growth',
            title: 'GEO 可见性优化清单',
            detail: '让企业实体、产品参数与采购 FAQ 进入 AI 知识结构',
            owner: '我',
            due_at: '持续优化',
            steps: geoTasks.map((t) => ({ label: t.title, done: !!t.done })),
          })
          .then((res) => { if (!cancelled && res?.id) setGeoTaskId(res.id) })
          .catch(() => {})
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // 勾选 → 立即写入后端（失败不影响本地交互，仅提示）
  async function toggleTask(id) {
    const next = tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    setTasks(next)
    if (!geoTaskId) return
    try {
      await api.updateTask(geoTaskId, {
        steps: next.map((t) => ({ label: t.title, done: !!t.done })),
        progress: Math.round((next.filter((t) => t.done).length / next.length) * 100),
      })
    } catch {
      toast('任务进度同步失败，请稍后重试')
    }
  }

  function startOptimize(type) {
    setRunType(type)
    setRunning(true)
  }

  async function finishOptimize() {
    setRunning(false)
    // 完成后标记 AI 可自动完成的任务为已完成，并同步到后端
    const next = tasks.map((t) => (t.id === 't1' || t.id === 't2' ? { ...t, done: true } : t))
    setTasks(next)
    if (geoTaskId) {
      try {
        await api.updateTask(geoTaskId, {
          steps: next.map((t) => ({ label: t.title, done: !!t.done })),
          progress: Math.round((next.filter((t) => t.done).length / next.length) * 100),
        })
      } catch {
        /* 忽略：本地状态已更新 */
      }
    }
    toast('GEO 优化已完成，AI 可见性将在下次监测中体现')
  }

  if (running) {
    return (
      <div className="view geo-view">
        <AiWaiting brand={brand} title="正在执行 GEO 优化" steps={WAIT_STEPS[runType]} stepMs={780} onDone={finishOptimize} />
      </div>
    )
  }

  return (
    <section className="view geo-view">
      {/* ---------- 头部 ---------- */}
      <div className="page-head">
        <div>
          <div className="eyebrow">GEO · GENERATIVE ENGINE OPTIMIZATION</div>
          <h1>让 AI 搜索「看懂并引用」你的企业</h1>
          <p>
            除了 Google，越来越多采购商直接问 AI。GEO 让你的企业、产品和专业信息
            进入 AI 的知识结构，在 AI 给出的答案里被引用。
          </p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => toast('已刷新诊断结果')}>重新诊断</button>
          <button className="primary-btn" onClick={() => setShowService(true)}>开启专业服务</button>
        </div>
      </div>

      {/* ---------- 1. AI 搜索可见性 ---------- */}
      <div className="geo-hero panel">
        <div className="geo-hero-score">
          <div className="geo-ring" style={{ '--p': `${visibility.score}%` }}>
            <b>{visibility.score}</b>
            <span>AI 可见性</span>
          </div>
          <div className="geo-hero-copy">
            <span className={`geo-level ${visibility.score >= 75 ? 'good' : visibility.score >= 55 ? 'warn' : 'bad'}`}>
              {visibility.level}
            </span>
            <h3>{visibility.summary}</h3>
            <div className="geo-mini-stats">
              {visibility.stats.map((s) => (
                <div key={s.key}>
                  <b>
                    {s.value}
                    {s.delta ? <em> {s.delta}</em> : null}
                  </b>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- 2. 商家视角：AI 是否理解我 ---------- */}
      <div className="geo-block">
        <div className="geo-block-head">
          <h2>AI 是怎么理解你的？</h2>
          <span className="geo-sub">用商家能看懂的话说明当前状态</span>
        </div>
        <div className="geo-mean-grid">
          {visibility.meanings.map((m) => (
            <div className={`geo-mean ${m.state}`} key={m.q}>
              <span className="geo-mean-state">{STATE_TXT[m.state]}</span>
              <b>{m.q}</b>
              <p>{m.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- 3. 当前诊断 → 问题项 → 推荐动作 ---------- */}
      <div className="geo-block">
        <div className="geo-block-head">
          <h2>当前诊断与推荐动作</h2>
          <span className="geo-sub">共 {geoIssues.length} 项，按影响排序</span>
        </div>
        <div className="geo-issue-list">
          {geoIssues.map((it) => (
            <div className={`geo-issue impact-${it.impact}`} key={it.id}>
              <div className="geo-issue-main">
                <div className="geo-issue-top">
                  <span className={`geo-tag t-${it.impact}`}>{IMPACT_TXT[it.impact]}</span>
                  <b>{it.title}</b>
                </div>
                <p className="geo-why">{it.why}</p>
              </div>
              <div className="geo-issue-action">
                <div className="geo-action-name">{it.action}</div>
                <div className="geo-action-effect">{it.effect}</div>
                <div className="geo-action-meta">{it.tasks} 个任务</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- 4. 优化任务 ---------- */}
      <div className="geo-block">
        <div className="geo-block-head">
          <h2>优化任务</h2>
          <span className="geo-sub">
            已完成 {taskStats.done} / {taskStats.total}（{taskStats.percent}%）
          </span>
        </div>

        <div className="geo-task-progress">
          <span style={{ width: `${taskStats.percent}%` }} />
        </div>

        <div className="geo-task-list">
          {tasks.map((t) => (
            <label className={`geo-task${t.done ? ' done' : ''}`} key={t.id}>
              <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} />
              <span className="geo-task-group">{t.group}</span>
              <span className="geo-task-title">{t.title}</span>
              <span className={`geo-tag t-${t.impact}`}>{IMPACT_TXT[t.impact]}</span>
            </label>
          ))}
        </div>

        <div className="geo-task-actions">
          <button className="primary-btn" onClick={() => startOptimize('optimizePage')}>
            ✦ AI 执行可自动完成的任务
          </button>
          <span className="muted small">复杂结构由平台专业人员完成（含在专业服务内）</span>
        </div>
      </div>

      {/* ---------- 5. 优化前后变化 ---------- */}
      <div className="geo-block">
        <div className="geo-block-head">
          <h2>优化前后发生了什么变化</h2>
          <span className="geo-sub">{geoCompare.window}</span>
        </div>
        <div className="geo-compare">
          {geoCompare.items.map((it) => (
            <div className="geo-compare-row" key={it.label}>
              <span className="gc-label">{it.label}</span>
              <span className="gc-before">{it.before}</span>
              <span className="gc-arrow">→</span>
              <span className="gc-after">{it.after}</span>
              <span className="gc-delta">{it.delta}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- 6. 持续监测 ---------- */}
      <div className="geo-block">
        <div className="geo-block-head">
          <h2>持续监测</h2>
          <span className="geo-sub">更新于 {geoMonitor.updatedAt} · {geoMonitor.frequency}</span>
        </div>
        <div className="geo-monitor">
          <GeoChart data={geoMonitor.trend} />
          <div className="geo-alerts">
            {geoMonitor.alerts.map((a, i) => (
              <div className={`geo-alert ${a.level}`} key={i}>
                <span className="geo-alert-dot" />
                {a.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- 7. 专业服务（付费） ---------- */}
      <div className="geo-service">
        <div className="geo-service-main">
          <small>PROFESSIONAL GEO SERVICE</small>
          <h2>GEO 是持续的专业服务，不是一次性工具</h2>
          <p>
            AI 搜索的规则在变、竞品在动、你的产品在上新。专业服务包含诊断、执行、监测与复盘，
            由平台团队持续维护，商家只需看结果。
          </p>
          <ul className="geo-service-includes">
            {geoService.includes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="geo-service-price">
          <span>专业服务</span>
          <strong>
            ¥ {geoService.price.toLocaleString()}
            <small> / {geoService.unit}</small>
          </strong>
          <em>{geoService.note}</em>
          <button onClick={() => setShowService(true)}>获取服务方案</button>
        </div>
      </div>

      {/* ---------- 技术层：默认隐藏 ---------- */}
      <details className="advanced-detail">
        <summary>高级技术详情（Schema / Entity / llms.txt / 内链 / 语义 / 内容覆盖，默认隐藏）</summary>
        <div className="adv-grid">
          {geoTechLayer.map((k) => (
            <div className="adv-item" key={k.key}>
              <b>{k.key}</b>
              <span>{k.desc}</span>
            </div>
          ))}
        </div>
      </details>

      <Modal open={showService} onClose={() => setShowService(false)}>
        <div className="eyebrow">PROFESSIONAL GEO SERVICE</div>
        <h2>开启 GEO 专业服务</h2>
        <p>
          GEO 由平台团队负责诊断、执行与持续监测。提交后顾问会先为你做一次免费的
          AI 可见性诊断，再确认服务范围。
        </p>
        <div className="modal-grid">
          <div className="modal-option">
            <b>诊断执行</b>
            <span>AI 可见性诊断 + 结构优化落地</span>
          </div>
          <div className="modal-option">
            <b>持续监测</b>
            <span>每周监测 + 异常提醒 + 季度复盘</span>
          </div>
        </div>
        <div className="service-price">
          <span>专业服务</span>
          <strong>
            ¥ {geoService.price.toLocaleString()} <small>/ {geoService.unit}</small>
          </strong>
        </div>
        <button
          className="modal-cta"
          onClick={() => {
            setShowService(false)
            toast('已提交 GEO 服务申请，顾问会在 1 个工作日内联系你')
          }}
        >
          提交申请 / 对接客服
        </button>
      </Modal>
    </section>
  )
}

// 轻量趋势图（无第三方依赖）
function GeoChart({ data }) {
  const w = 520
  const h = 120
  const pad = 8
  const max = Math.max(...data.map((d) => d.value)) * 1.1
  const min = Math.min(...data.map((d) => d.value)) * 0.85
  const stepX = (w - pad * 2) / (data.length - 1)
  const y = (v) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)
  const points = data.map((d, i) => `${pad + i * stepX},${y(d.value)}`).join(' ')
  const area = `${pad},${h - pad} ${points} ${pad + (data.length - 1) * stepX},${h - pad}`

  return (
    <div className="geo-chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="AI 引用趋势">
        <defs>
          <linearGradient id="geoFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#geoFill)" />
        <polyline points={points} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={d.week} cx={pad + i * stepX} cy={y(d.value)} r="3" fill="#fff" stroke="var(--blue)" strokeWidth="2" />
        ))}
      </svg>
      <div className="geo-chart-x">
        {data.map((d) => (
          <span key={d.week}>{d.week}</span>
        ))}
      </div>
    </div>
  )
}
