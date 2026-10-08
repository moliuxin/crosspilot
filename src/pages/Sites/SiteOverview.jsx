import { useEffect, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import MiniSitePreview from '../../components/site/MiniSitePreview'
import './sites.css'

/**
 * 站点概览（site scope 内）：
 * - 站点资料（名称 / 行业 / 产品类别 / 目标市场）；
 * - 关联产品（产品事实是账号级，站点按需挂载，不复制数据）；
 * - 本站询盘与页面入口。
 */
export default function SiteOverview() {
  const { siteId } = useParams()
  const { site, setSite } = useOutletContext()
  const { toast } = useApp()
  const [form, setForm] = useState(null)
  const [linked, setLinked] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setForm({
      name: site.name || '',
      industry: site.industry || '',
      product_category: site.product_category || '',
      target_markets: site.target_markets || ['en-US'],
    })
  }, [site])

  useEffect(() => {
    api.getSiteProducts(siteId).then(setLinked).catch(() => setLinked([]))
  }, [siteId])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  function toggleMarket(m) {
    setForm((f) => {
      const has = f.target_markets.includes(m)
      const next = has ? f.target_markets.filter((x) => x !== m) : [...f.target_markets, m]
      return { ...f, target_markets: next.length ? next : f.target_markets }
    })
  }

  async function saveInfo() {
    if (!form.name.trim()) {
      toast('站点名称不能为空', 'warn')
      return
    }
    setBusy(true)
    try {
      const updated = await api.updateSite(siteId, {
        name: form.name.trim(),
        industry: form.industry.trim(),
        product_category: form.product_category.trim(),
        target_markets: form.target_markets,
      })
      setSite(updated)
      toast('站点资料已保存')
    } catch (err) {
      toast(err?.detail || '保存失败', 'warn')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overview-grid">
      <article className="panel site-preview-panel">
        <div className="panel-head">
          <div>
            <strong>网站实时预览</strong>
            <span>{site.name} · 草稿内容</span>
          </div>
          <Link to="editor" style={{ fontSize: 12.5, color: 'var(--blue)', fontWeight: 600 }}>去编辑 →</Link>
        </div>
        <MiniSitePreview />
        <div className="site-quick-stats">
          <div><b>{site.pages ?? '—'}</b><span>页面</span></div>
          <div><b>{site.inquiries ?? '—'}</b><span>询盘</span></div>
          <div><b>{site.publish_count || 0}</b><span>发布次数</span></div>
          <div><b>{linked ? linked.length : '—'}</b><span>关联产品</span></div>
        </div>
      </article>

      <aside className="right-stack">
        <article className="panel">
          <div className="panel-head">
            <div>
              <strong>站点资料</strong>
              <span>名称 / 行业 / 产品类别 / 目标市场</span>
            </div>
          </div>
          {form && (
            <div className="site-info-form">
              <label>
                <span>站点名称</span>
                <input value={form.name} onChange={set('name')} />
              </label>
              <label>
                <span>行业</span>
                <input value={form.industry} onChange={set('industry')} placeholder="例如：工业水处理设备" />
              </label>
              <label>
                <span>主要产品类别</span>
                <input value={form.product_category} onChange={set('product_category')} placeholder="例如：工业离心泵" />
              </label>
              <div>
                <span>目标市场</span>
                <div className="market-picker">
                  {marketOrder.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`market-chip pickable${form.target_markets.includes(m) ? ' on' : ''}`}
                      onClick={() => toggleMarket(m)}
                    >
                      {marketTemplates[m].flag} {marketTemplates[m].label}
                    </button>
                  ))}
                </div>
              </div>
              <button className="primary-btn" onClick={saveInfo} disabled={busy}>
                {busy ? '保存中…' : '保存站点资料'}
              </button>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <strong>站点产品</strong>
              <span>产品按键就在本站的「产品」页签</span>
            </div>
          </div>
          <div className="site-products-entry">
            <div>
              <b>{linked ? linked.length : '—'}</b>
              <span>个已关联产品</span>
            </div>
            <Link className="primary-btn" to="products">管理本站产品 →</Link>
          </div>
        </article>
      </aside>
    </div>
  )
}
