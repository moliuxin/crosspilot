import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'

/**
 * 站点产品（site scope 内的「产品」页签）。
 *
 * 产品按键挂在「我的网站 → 某网站」下面：
 * - 本站展示/管理的是**关联到该站点**的产品；
 * - 产品本体是账号级资产（产品中心维护），站点只做挂载，不复制事实。
 */
export default function SiteProducts() {
  const { siteId } = useParams()
  const { site } = useOutletContext()
  const { toast } = useApp()
  const [linked, setLinked] = useState(null)
  const [allProducts, setAllProducts] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [q, setQ] = useState('')

  async function refresh() {
    try {
      setLinked(await api.getSiteProducts(siteId))
    } catch {
      setLinked([])
    }
  }

  useEffect(() => {
    refresh()
    api.getProducts().then(setAllProducts).catch(() => setAllProducts([]))
  }, [siteId])

  const linkedIds = new Set((linked || []).map((p) => p.id))

  async function unlink(productId) {
    try {
      await api.unlinkSiteProduct(siteId, productId)
      setLinked((list) => list.filter((p) => p.id !== productId))
      toast('已解除关联（产品本体保留在产品中心）')
    } catch (err) {
      toast(err?.detail || '操作失败', 'warn')
    }
  }

  async function link(productId) {
    try {
      await api.linkSiteProduct(siteId, productId)
      const p = allProducts.find((x) => x.id === productId)
      if (p) setLinked((list) => [...list, p])
      toast('已关联到本站')
    } catch (err) {
      toast(err?.detail || '操作失败', 'warn')
    }
  }

  const candidates = allProducts
    .filter((p) => !linkedIds.has(p.id))
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.model || '').toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="panel site-products-panel">
      <div className="panel-head">
        <div>
          <strong>「{site.name}」的产品</strong>
          <span>产品为账号级资产，本站展示的是已关联到该网站的产品</span>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => setShowPicker((v) => !v)}>
            {showPicker ? '收起' : '＋ 关联产品'}
          </button>
          <Link className="primary-btn" to="/products">产品中心（全部产品）</Link>
        </div>
      </div>

      {linked === null && <div className="empty">加载中…</div>}

      {linked !== null && linked.length === 0 && (
        <div className="empty">
          本站还没有关联产品。点击「＋ 关联产品」从产品中心选择，或在
          <Link to="/products">产品中心</Link> 新建后自动关联。
        </div>
      )}

      {linked !== null && linked.length > 0 && (
        <table className="data-table version-table">
          <thead>
            <tr>
              <th>产品</th>
              <th style={{ width: 110 }}>型号</th>
              <th style={{ width: 120 }}>分类</th>
              <th style={{ width: 90 }}>SEO</th>
              <th style={{ width: 90 }}>GEO</th>
              <th style={{ width: 110 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {linked.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b></td>
                <td><code>{p.model || '—'}</code></td>
                <td>{p.category}</td>
                <td>{p.seo_score ?? '—'}</td>
                <td>{p.geo_score ?? '—'}</td>
                <td>
                  <button className="ghost-btn small" onClick={() => unlink(p.id)}>解除关联</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showPicker && (
        <div className="link-picker">
          <div className="link-picker-head">
            <strong>从产品中心选择要关联的产品</strong>
            <input
              placeholder="搜索产品名 / 型号…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="link-product-list">
            {candidates.map((p) => (
              <div className="task-row-mini" key={p.id}>
                <span className="task-title">{p.name} <code style={{ fontSize: 10.5 }}>{p.model}</code></span>
                <button className="ghost-btn small" onClick={() => link(p.id)}>关联</button>
              </div>
            ))}
            {candidates.length === 0 && (
              <div className="empty small">没有可关联的产品。去 <Link to="/products">产品中心</Link> 新建。</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
