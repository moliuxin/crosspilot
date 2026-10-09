import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { skillFilters } from '../../data/skills'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import Modal from '../../components/ui/Modal'
import UsageDrawer from './UsageDrawer'

/** 把 Skill 价格文案（"1,200 Credits / 次"）解析成可扣减的数字。 */
export function parseCost(price) {
  const m = String(price || '').replace(/,/g, '').match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

/** Skill id → 后端 feature_key（权限真源里的能力键）。 */
export function skillFeature(skill) {
  return `skill.${String(skill?.id || '').replace(/-/g, '_')}`
}

export default function SkillCenter() {
  const navigate = useNavigate()
  const { toast, openPaywall } = useApp()
  const { requireFeature } = useEntitlement()
  const [skills, setSkills] = useState([])
  const [filter, setFilter] = useState('全部')
  const [detail, setDetail] = useState(null)
  const [credits, setCredits] = useState(null)
  const [logs, setLogs] = useState([])
  const [drawer, setDrawer] = useState(false)
  const [running, setRunning] = useState(null)

  const loadCredits = useCallback(() => {
    api.getCredits().then(setCredits).catch(() => setCredits({ balance: 0, totalGranted: 0, used: 0 }))
    api.getCreditLogs(50).then(setLogs).catch(() => setLogs([]))
  }, [])

  useEffect(() => {
    api.getSkills().then(setSkills)
    loadCredits()
  }, [loadCredits])

  const filtered = useMemo(() => {
    if (filter === '全部') return skills
    const map = { 建站: 'BUILD', 内容: 'CONTENT', 增长: 'GROWTH', 市场本地化: 'MARKET', 专业服务: 'AUDIT' }
    const key = map[filter]
    return skills.filter((s) => s.type.includes(key) || (key === 'AUDIT' && s.type === 'AUDIT'))
  }, [skills, filter])

  // 真实消耗额度：后端余额不足会返回 402，此处直接引导升级
  const consume = async (cost, skillName) => {
    if (!cost) return true
    try {
      const res = await api.consumeCredits({ skill: skillName, cost, note: `使用「${skillName}」` })
      setCredits(res.credits)
      setLogs((prev) => [res.log, ...prev])
      return true
    } catch (e) {
      if (e.status === 402) {
        openPaywall('Credits 余额不足', `「${skillName}」需要 ${cost} Credits，当前余额 ${credits?.balance ?? 0}。充值后即可继续使用。`, 'credits.recharge')
      } else {
        toast(`额度扣减失败：${e.message}`)
      }
      return false
    }
  }

  const useSkill = async (skill) => {
    if (skill.action === 'view-seo') return navigate('/seo')
    if (skill.action === 'view-localization') return navigate('/localization')
    // 付费 Skill：统一走付费弹窗（高级 Skill 触发付费门槛）
    if (skill.paid && !requireFeature(skillFeature(skill), `${skill.value} 当前为付费能力（${skill.billing} · ${skill.price}），升级套餐或单独开通后即可使用。`)) return

    const cost = parseCost(skill.price)
    setRunning(skill.id)
    const ok = await consume(cost, skill.name)
    setRunning(null)
    if (ok) toast(`已启动「${skill.name}」，消耗 ${cost.toLocaleString('en-US')} Credits`)
  }

  // 详情弹窗内直接「开通 / 试用」：付费的走付费流程，免费的直接扣额度
  const activate = async (skill) => {
    if (skill.paid) {
      setDetail(null)
      requireFeature(skillFeature(skill), `${skill.value} 当前为付费能力（${skill.billing} · ${skill.price}）。开通后可在此直接调用。`)
      return
    }
    const cost = parseCost(skill.price)
    const ok = await consume(cost, skill.name)
    if (ok) {
      setDetail(null)
      toast(`「${skill.name}」已开通并记录 1 次用量`)
    }
  }

  const balance = credits?.balance ?? 0
  const used = credits?.used ?? 0
  const total = credits?.totalGranted || 1

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">SKILL CENTER</div>
          <h1>AI 能力中心</h1>
          <p>内部是 Skill + Agent + MCP，对商家则包装成清晰、可购买的业务能力。</p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => { loadCredits(); setDrawer(true) }}>
            查看用量 {balance.toLocaleString('en-US')} Credits
          </button>
        </div>
      </div>

      <div className="credit-bar">
        <div className="credit-stat">
          <div className="credit-stat-label">可用额度</div>
          <div className="credit-stat-value">
            {balance.toLocaleString('en-US')}
            <span>Credits</span>
          </div>
        </div>
        <div className="credit-meter">
          <div className="credit-meter-head">
            <span>本期已用 <b>{used.toLocaleString('en-US')}</b></span>
            <span>套餐额度 {total.toLocaleString('en-US')}</span>
          </div>
          <div className="credit-meter-bar"><i style={{ width: `${Math.min(100, (used / total) * 100)}%` }} /></div>
        </div>
        <div className="credit-actions">
          <button className="ghost-btn" onClick={() => { loadCredits(); setDrawer(true) }}>用量明细</button>
          <button className="primary-btn" onClick={() => openPaywall('充值 Credits', '选择套餐或按量充值，充值后额度立即到账，可用于全部 Skill 与 AI 能力。', 'credits.recharge')}>充值</button>
        </div>
      </div>

      <div className="skill-filter">
        {skillFilters.map((f) => (
          <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      <div className="skill-grid">
        {filtered.map((s) => (
          <article className={`skill-card${s.featured ? ' featured' : ''}`} key={s.id}>
            <div className="skill-icon">{s.icon}</div>
            <div className="skill-type">{s.type}</div>
            <h3>{s.name}</h3>
            <p>{s.value}</p>
            <div className="skill-meta">
              <span>{s.billing}</span>
              <b>{s.price}</b>
            </div>
            <button className={s.paid ? 'paid' : ''} onClick={() => useSkill(s)} disabled={running === s.id}>
              {running === s.id ? '处理中…' : s.paid ? '查看价值与开通 →' : '立即使用 →'}
            </button>
          </article>
        ))}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <>
            <div className="eyebrow">{detail.type}</div>
            <h2>{detail.name}</h2>
            <p>{detail.value}</p>
            <div className="skill-detail" style={{ margin: '16px 0' }}>
              <div><b>输入</b><span>{detail.input}</span></div>
              <div><b>输出</b><span>{detail.output}</span></div>
              <div><b>计费</b><span>{detail.billing} · {detail.price}</span></div>
            </div>
            <div className="modal-grid">
              <div className="modal-option"><b>套餐包含</b><span>专业版可享部分额度</span></div>
              <div className="modal-option"><b>专业服务</b><span>由平台专业人员执行</span></div>
            </div>
            <button className="modal-cta" onClick={() => activate(detail)}>
              {detail.paid ? '对接客服 / 开通此能力' : `立即使用（消耗 ${parseCost(detail.price).toLocaleString('en-US')} Credits）`}
            </button>
          </>
        )}
      </Modal>

      <UsageDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        credits={credits}
        logs={logs}
        onRefresh={loadCredits}
        onRecharge={() => { setDrawer(false); openPaywall('充值 Credits', '选择套餐或按量充值，充值后额度立即到账。', 'credits.recharge') }}
        toast={toast}
      />
    </section>
  )
}
