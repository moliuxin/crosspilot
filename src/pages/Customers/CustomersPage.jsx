import { useEffect, useMemo, useState } from 'react'
import { api } from '../../services/api'

/**
 * 客户（/customers）。
 *
 * 从询盘记录聚合出的客户视图（同一 email/company 合并）：
 * 询盘数 / 最近询盘时间 / 意向 / 国家 / 所在公司。不新建数据模型，
 * 客户事实的唯一来源仍是询盘（RFQ）。
 */
export default function CustomersPage() {
  const [inquiries, setInquiries] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api
      .getInquiries()
      .then((res) => setInquiries(res.inquiries || []))
      .catch(() => setInquiries([]))
  }, [])

  const customers = useMemo(() => {
    const byKey = new Map()
    for (const i of inquiries || []) {
      const key = (i.email || i.customer_name || '').toLowerCase()
      if (!key) continue
      const c =
        byKey.get(key) ||
        {
          key,
          name: i.customer_name,
          email: i.email,
          company: i.company || '—',
          country: i.country || '—',
          count: 0,
          hot: 0,
          lastAt: '',
          lastMessage: '',
          statuses: new Map(),
        }
      c.count += 1
      if (i.intent === 'hot') c.hot += 1
      if (!c.lastAt || i.created_at > c.lastAt) {
        c.lastAt = i.created_at
        c.lastMessage = i.message
      }
      c.statuses.set(i.status, (c.statuses.get(i.status) || 0) + 1)
      byKey.set(key, c)
    }
    let list = Array.from(byKey.values())
    if (q) {
      const like = q.toLowerCase()
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(like) ||
          c.company.toLowerCase().includes(like) ||
          c.email.toLowerCase().includes(like) ||
          c.country.toLowerCase().includes(like)
      )
    }
    return list.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''))
  }, [inquiries, q])

  const STATUS_LABEL = { new: '新询盘', contacted: '已联系', following: '跟进中', done: '已完成' }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">CUSTOMERS</div>
          <h1>客户</h1>
          <p>来自全部网站询盘的客户视图：同一买家合并统计，按最近联系排序。</p>
        </div>
        <div className="head-actions">
          <input
            className="search-input"
            placeholder="搜索客户 / 公司 / 国家…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 9, padding: '8px 12px', fontSize: 13 }}
          />
        </div>
      </div>

      {inquiries === null && <div className="empty">加载中…</div>}
      {inquiries !== null && customers.length === 0 && (
        <div className="empty">还没有客户。询盘进来后会自动聚合到这里。</div>
      )}

      {inquiries !== null && customers.length > 0 && (
        <div className="panel">
          <table className="data-table version-table">
            <thead>
              <tr>
                <th>客户</th>
                <th>公司</th>
                <th style={{ width: 110 }}>国家</th>
                <th style={{ width: 90 }}>询盘数</th>
                <th style={{ width: 110 }}>高意向</th>
                <th style={{ width: 150 }}>状态分布</th>
                <th style={{ width: 130 }}>最近询盘</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.key}>
                  <td>
                    <b>{c.name}</b>
                    <div className="muted" style={{ fontSize: 11.5 }}>{c.email}</div>
                  </td>
                  <td>{c.company}</td>
                  <td>{c.country}</td>
                  <td>
                    <b>{c.count}</b>
                  </td>
                  <td>{c.hot > 0 ? <span className="ver-tag warn">{c.hot} 条 hot</span> : <span className="muted">—</span>}</td>
                  <td>
                    {Array.from(c.statuses.entries()).map(([s, n]) => (
                      <span key={s} className="ver-tag info" style={{ marginRight: 4 }}>
                        {STATUS_LABEL[s] || s} {n}
                      </span>
                    ))}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {c.lastAt ? new Date(c.lastAt).toLocaleDateString('zh-CN') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
