import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { INQUIRY_STATUS } from '../../types'
import Modal from '../../components/ui/Modal'

export default function Inquiries() {
  const { toast } = useApp()
  const [data, setData] = useState({ inquiries: [], stats: null })
  const [active, setActive] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [tasks, setTasks] = useState([])
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskForm, setTaskForm] = useState({ title: '', detail: '', due_at: '' })

  useEffect(() => {
    api.getInquiries().then(setData)
    api.getTasks({ kind: 'followup' }).then((t) => setTasks(Array.isArray(t) ? t : []))
  }, [])

  const list = useMemo(() => {
    if (statusFilter === 'all') return data.inquiries
    return data.inquiries.filter((i) => i.status === statusFilter)
  }, [data.inquiries, statusFilter])

  const activeTasks = useMemo(() => {
    const map = {}
    tasks.forEach((t) => {
      if (t.inquiry_id) map[t.inquiry_id] = [...(map[t.inquiry_id] || []), t]
    })
    return map
  }, [tasks])

  const changeStatus = async (id, status) => {
    await api.updateInquiryStatus(id, status)
    setData((d) => ({
      ...d,
      inquiries: d.inquiries.map((i) => (i.id === id ? { ...i, status } : i)),
    }))
    setActive((a) => (a && a.id === id ? { ...a, status } : a))
    toast(`询盘状态已更新为「${INQUIRY_STATUS[status]}」`)
  }

  /** 导出当前筛选结果为 CSV（真实下载） */
  function exportCsv() {
    if (!list.length) {
      toast('当前没有可导出的询盘', 'warn')
      return
    }
    const headers = ['询盘ID', '联系人', '邮箱', '公司', '国家/地区', '询盘产品', '来源页面', '来源渠道', '意向', '状态', '时间', '询盘内容']
    const rows = list.map((i) => [
      i.id,
      i.customer_name,
      i.email,
      i.company,
      i.country,
      i.product_name,
      i.source_page,
      i.source_channel,
      i.intent,
      INQUIRY_STATUS[i.status] || i.status,
      new Date(i.created_at).toLocaleString('zh-CN'),
      (i.message || '').replace(/\s+/g, ' '),
    ])
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `inquiries-${statusFilter}-${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast(`已导出 ${list.length} 条询盘为 CSV`)
  }

  async function createFollowUp() {
    if (!taskForm.title.trim()) {
      toast('请填写跟进事项', 'warn')
      return
    }
    const task = await api.createTask({
      kind: 'followup',
      title: taskForm.title.trim(),
      detail: taskForm.detail.trim(),
      inquiry_id: active?.id || '',
      due_at: taskForm.due_at,
      steps: [
        { label: '整理客户需求与参数', done: false },
        { label: '发送报价 / 产品资料', done: false },
        { label: '确认客户反馈并推进', done: false },
      ],
    })
    setTasks((prev) => [task, ...prev])
    setTaskOpen(false)
    setTaskForm({ title: '', detail: '', due_at: '' })
    if (active) {
      // 关联询盘时后端会把状态推进到 contacted
      setData((d) => ({
        ...d,
        inquiries: d.inquiries.map((i) => (i.id === active.id && i.status === 'new' ? { ...i, status: 'contacted' } : i)),
      }))
      setActive((a) => (a && a.status === 'new' ? { ...a, status: 'contacted' } : a))
    }
    toast('跟进任务已创建')
  }

  async function advanceTask(id) {
    const updated = await api.advanceTask(id)
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)))
    if (updated.status === 'done') toast('跟进任务已完成')
  }

  async function removeTask(id) {
    await api.deleteTask(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
    toast('已删除跟进任务')
  }

  const intentLabel = { hot: '高意向', warm: '跟进中', cold: '较低' }
  const intentClass = { hot: 'hot', warm: 'warm', cold: 'cold' }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">INQUIRY CENTER</div>
          <h1>询盘中心</h1>
          <p>只保留 B2B 询价链路，不引入购物车、支付和物流复杂度。</p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={exportCsv}>↓ 导出 CSV</button>
          <button className="primary-btn" onClick={() => setTaskOpen(true)}>＋ 创建跟进</button>
        </div>
      </div>

      <div className="metrics-grid compact">
        <article className="metric-card"><div><span>本月询盘</span><strong>{data.stats?.monthly.value ?? '—'}</strong><small className="positive">{data.stats?.monthly.delta}</small></div></article>
        <article className="metric-card"><div><span>高意向</span><strong>{data.stats?.highIntent.value ?? '—'}</strong><small>{data.stats?.highIntent.delta}</small></div></article>
        <article className="metric-card"><div><span>平均响应</span><strong>{data.stats?.avgResponse.value ?? '—'}</strong><small className="positive">{data.stats?.avgResponse.delta}</small></div></article>
        <article className="metric-card"><div><span>询盘转化率</span><strong>{data.stats?.conversion.value ?? '—'}</strong><small className="positive">{data.stats?.conversion.delta}</small></div></article>
      </div>

      <div className="toolbar">
        <div className="filters">
          {['all', 'new', 'contacted', 'following', 'done'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={statusFilter === s ? { background: 'var(--dark)', color: '#fff', borderColor: 'var(--dark)' } : undefined}
            >
              {s === 'all' ? '全部' : INQUIRY_STATUS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="data-table inquiry-table">
        <div className="table-head">
          <span>联系人</span><span>公司 / 地区</span><span>询盘产品</span><span>来源</span><span>意向</span><span>时间</span><span />
        </div>
        {list.map((i) => (
          <div className="table-row" key={i.id}>
            <div className="contact-cell">
              <div className="avatar small">{i.customer_name.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{i.customer_name}</strong>
                <small>{i.email.replace(/(.{2}).*(@.*)/, '$1•••$2')}</small>
              </div>
            </div>
            <span>{i.company} · {i.country}</span>
            <span>{i.product_name}</span>
            <span>{i.source_channel}</span>
            <span><b className={`lead ${intentClass[i.intent]}`}>{intentLabel[i.intent]}</b></span>
            <span>{new Date(i.created_at).toLocaleDateString('zh-CN')}</span>
            <button className="row-btn" onClick={() => setActive(i)}>查看</button>
          </div>
        ))}
        {!list.length && <div className="empty"><div className="big">✉️</div>暂无询盘</div>}
      </div>

      {active && (
        <div className="drawer open">
          <div className="drawer-overlay" onClick={() => setActive(null)} />
          <div className="drawer-panel" style={{ width: 'min(460px,92vw)' }}>
            <div className="drawer-head">
              <div>
                <strong>询盘详情</strong>
                <span>{active.id}</span>
              </div>
              <button onClick={() => setActive(null)}>×</button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="rule-row"><span>联系人</span><b>{active.customer_name}</b></div>
              <div className="rule-row"><span>公司</span><b>{active.company}</b></div>
              <div className="rule-row"><span>国家 / 地区</span><b>{active.country}</b></div>
              <div className="rule-row"><span>询盘产品</span><b>{active.product_name}</b></div>
              <div className="rule-row"><span>来源页面</span><b>{active.source_page}</b></div>
              <div className="rule-row"><span>来源渠道</span><b>{active.source_channel}</b></div>
              <div className="rule-row"><span>时间</span><b>{new Date(active.created_at).toLocaleString('zh-CN')}</b></div>
              <div className="rule-row"><span>状态</span><b>{INQUIRY_STATUS[active.status]}</b></div>
              <div style={{ background: '#f7f8fb', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.7 }}>{active.message}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(INQUIRY_STATUS).map(([k, v]) => (
                  <button key={k} className="ghost-btn" onClick={() => changeStatus(active.id, k)}>{v}</button>
                ))}
              </div>

              <div className="drawer-tasks">
                <div className="drawer-tasks-head">
                  <b>跟进任务</b>
                  <button
                    className="row-btn"
                    onClick={() => {
                      setTaskForm({ title: `跟进 ${active.customer_name} 的 ${active.product_name} 询盘`, detail: '', due_at: '' })
                      setTaskOpen(true)
                    }}
                  >
                    ＋ 新建
                  </button>
                </div>
                {(activeTasks[active.id] || []).length === 0 && (
                  <div className="empty small">暂无跟进任务</div>
                )}
                {(activeTasks[active.id] || []).map((t) => (
                  <div className={`task-item${t.status === 'done' ? ' done' : ''}`} key={t.id}>
                    <div className="task-item-head">
                      <b>{t.title}</b>
                      <span className={`task-status s-${t.status}`}>
                        {{ todo: '待处理', doing: '进行中', done: '已完成' }[t.status]}
                      </span>
                    </div>
                    <div className="task-progress"><span style={{ width: `${t.progress}%` }} /></div>
                    {(t.steps || []).length > 0 && (
                      <ul className="task-steps">
                        {t.steps.map((s, i) => (
                          <li key={i} className={s.done ? 'done' : ''}>{s.done ? '✓' : '○'} {s.label}</li>
                        ))}
                      </ul>
                    )}
                    <div className="task-item-actions">
                      <button className="row-btn" onClick={() => advanceTask(t.id)}>
                        {t.status === 'done' ? '重置' : '完成下一步'}
                      </button>
                      <button className="row-btn danger" onClick={() => removeTask(t.id)}>删除</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="note" style={{ fontSize: 12, color: 'var(--muted)' }}>本项目不提供订单、支付与物流，跟进完成后即为闭环。</div>
            </div>
          </div>
        </div>
      )}

      <Modal open={taskOpen} onClose={() => setTaskOpen(false)}>
        <div className="eyebrow">NEW FOLLOW-UP</div>
        <h2>创建跟进任务</h2>
        <p>跟进任务会记录在对应询盘下，完成后即为该询盘的闭环。</p>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="form-field full">
            <label>跟进事项 <em>*</em></label>
            <input
              value={taskForm.title}
              onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              placeholder="例如：发送 AF-RO-1200 报价单"
            />
          </div>
          <div className="form-field full">
            <label>补充说明</label>
            <textarea rows="2" value={taskForm.detail} onChange={(e) => setTaskForm({ ...taskForm, detail: e.target.value })} />
          </div>
          <div className="form-field full">
            <label>计划完成时间</label>
            <input type="date" value={taskForm.due_at} onChange={(e) => setTaskForm({ ...taskForm, due_at: e.target.value })} />
          </div>
        </div>
        <div className="agent-actions" style={{ marginTop: 16 }}>
          <button className="primary-btn" onClick={createFollowUp}>创建任务</button>
          <button className="ghost-btn" onClick={() => setTaskOpen(false)}>取消</button>
        </div>
      </Modal>
    </section>
  )
}
