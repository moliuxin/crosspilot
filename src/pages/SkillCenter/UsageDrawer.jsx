import { useMemo, useState } from 'react'
import { api } from '../../services/api'

const RECHARGE_PRESETS = [
  { amount: 1000, label: '1,000 Credits', note: '按量充值 · 入门' },
  { amount: 5000, label: '5,000 Credits', note: '按量充值 · 常用', hot: true },
  { amount: 20000, label: '20,000 Credits', note: '按量充值 · 团队' },
]

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US')
}

export default function UsageDrawer({ open, onClose, credits, logs, onRefresh, onRecharge, toast }) {
  const [tab, setTab] = useState('logs')
  const [busy, setBusy] = useState(null)

  const balance = credits?.balance ?? 0
  const used = credits?.used ?? 0
  const total = credits?.totalGranted ?? 0

  // 按 Skill 聚合消耗，识别「用量大头」
  const bySkill = useMemo(() => {
    const map = new Map()
    logs.forEach((l) => {
      if (l.cost > 0) map.set(l.skill, (map.get(l.skill) || 0) + l.cost)
    })
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [logs])

  const maxSkill = bySkill.length ? bySkill[0][1] : 1

  // 真实充值：写入 credits 表 + 生成流水（后端 POST /credits/grant）
  const buy = async (preset) => {
    setBusy(preset.amount)
    try {
      const res = await api.grantCredits(preset.amount, preset.note)
      toast?.(`充值成功，+${fmt(preset.amount)} Credits`)
      onRefresh?.()
      void res
    } catch (e) {
      toast?.(`充值失败：${e.message}`)
    }
    setBusy(null)
  }

  if (!open) return null

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer usage-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">CREDITS & USAGE</div>
            <h2>额度与用量</h2>
          </div>
          <button className="modal-close inline" onClick={onClose}>×</button>
        </div>

        <div className="usage-balance">
          <div className="usage-balance-main">
            <span>可用额度</span>
            <b>{fmt(balance)}<em>Credits</em></b>
          </div>
          <div className="usage-balance-sub">
            <div><span>套餐总额度</span><b>{fmt(total)}</b></div>
            <div><span>累计已用</span><b>{fmt(used)}</b></div>
          </div>
        </div>

        <div className="seg-row usage-tabs">
          <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>消耗流水</button>
          <button className={tab === 'bySkill' ? 'active' : ''} onClick={() => setTab('bySkill')}>按能力统计</button>
          <button className={tab === 'buy' ? 'active' : ''} onClick={() => setTab('buy')}>充值</button>
        </div>

        {tab === 'logs' && (
          <div className="usage-body">
            {!logs.length && <div className="usage-empty">暂无消耗记录，使用任意 Skill 后会在此留下流水。</div>}
            {logs.map((l) => (
              <div className="usage-log" key={l.id}>
                <div className="usage-log-main">
                  <b>{l.skill || l.note || '额度变动'}</b>
                  <small>{l.note && l.note !== l.skill ? l.note : ''}{l.time ? ` · ${l.time}` : ''}</small>
                </div>
                <div className="usage-log-side">
                  <b className={l.cost < 0 ? 'in' : 'out'}>
                    {l.cost < 0 ? `+${fmt(-l.cost)}` : `-${fmt(l.cost)}`}
                  </b>
                  <small>余 {fmt(l.balance_after)}</small>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'bySkill' && (
          <div className="usage-body">
            {!bySkill.length && <div className="usage-empty">暂无消耗数据。</div>}
            {bySkill.map(([name, cost]) => (
              <div className="usage-bar-row" key={name}>
                <div className="usage-bar-head">
                  <b>{name}</b>
                  <span>{fmt(cost)} Credits</span>
                </div>
                <div className="usage-bar">
                  <i style={{ width: `${Math.max(4, (cost / maxSkill) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'buy' && (
          <div className="usage-body">
            <p className="usage-note">
              充值后额度立即到账，可用于 AI 能力中心内的全部 Skill 与 AI 生成能力；额度不过期，可开具企业发票。
            </p>
            {RECHARGE_PRESETS.map((p) => (
              <div className="recharge-item" key={p.amount}>
                {p.hot && <span className="recharge-hot">最受欢迎</span>}
                <div>
                  <b>{p.label}</b>
                  <small>{p.note}</small>
                </div>
                <button className="primary-btn" disabled={busy === p.amount} onClick={() => buy(p)}>
                  {busy === p.amount ? '处理中…' : '立即充值'}
                </button>
              </div>
            ))}
            <button className="ghost-btn usage-custom" onClick={onRecharge}>
              需要更大额度 / 企业合同？对接商务 →
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
