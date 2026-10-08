import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { ai } from '../../services/ai'
import { useApp } from '../../app/store/AppContext'
import Modal from '../../components/ui/Modal'
import ProductForm from '../../components/products/ProductForm'
import BulkImportModal from '../../components/products/BulkImportModal'

export default function Products() {
  const navigate = useNavigate()
  const { toast } = useApp()
  const [products, setProducts] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [seoState, setSeoState] = useState('all')
  const [modal, setModal] = useState(false)
  const [bulk, setBulk] = useState(false)
  const [editing, setEditing] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    api.getProducts().then(setProducts)
  }, [])

  const reload = () => api.getProducts().then(setProducts)

  // 搜索状态分档：与表格里 seo-score 的高/中/低配色阈值保持一致（85 / 70）
  const SEO_STATES = [
    { key: 'all', label: '搜索状态', test: () => true },
    { key: 'high', label: '已优化（≥85）', test: (p) => (p.seo_score || 0) >= 85 },
    { key: 'mid', label: '待优化（70–84）', test: (p) => (p.seo_score || 0) >= 70 && (p.seo_score || 0) < 85 },
    { key: 'low', label: '未达标（<70）', test: (p) => (p.seo_score || 0) < 70 },
  ]

  // 分类选项从真实数据汇总去重，不写死，产品增删后自动同步
  const categories = useMemo(() => {
    const set = new Set(
      products.map((p) => (p.category || '').trim()).filter(Boolean)
    )
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [products])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const stateTest = (SEO_STATES.find((s) => s.key === seoState) || SEO_STATES[0]).test
    return products.filter((p) => {
      if (category !== 'all' && (p.category || '').trim() !== category) return false
      if (!stateTest(p)) return false
      if (!q) return true
      return `${p.name} ${p.model} ${p.category}`.toLowerCase().includes(q)
    })
  }, [products, query, category, seoState])

  const hasFilter = !!query.trim() || category !== 'all' || seoState !== 'all'

  const resetFilters = () => {
    setQuery('')
    setCategory('all')
    setSeoState('all')
  }

  const scoreClass = (s) => (s >= 85 ? 'high' : s >= 70 ? 'mid' : 'low')

  // 新增/编辑 → AI 生成内容 → API 落库（localStorage 持久化，刷新不丢）
  const handleSubmit = async (draft) => {
    setGenerating(true)
    const content = await ai.generateProductContent({
      name: draft.name || 'New Product',
      model: draft.model || 'AF-NEW',
      specs: draft.specs || [],
      applications: draft.applications || [],
    })
    const seoPatch = {
      title: content.en.title,
      slug: `/${draft.name.toLowerCase().replace(/\s+/g, '-')}/`,
      meta_description: content.en.description,
      h1: draft.name,
      faq: content.en.faq,
      image_alt: content.en.imageAlt,
      schema_enabled: false,
    }
    if (editing) {
      await api.updateProduct(editing.id, { ...draft, localized_content: content, seo: { ...editing.seo, ...seoPatch } })
      toast('产品已更新，AI 已重生成三语言内容')
    } else {
      await api.createProduct({ ...draft, localized_content: content, seo: seoPatch })
      toast('产品已添加，AI 已生成三语言标题 / 卖点 / FAQ / ALT')
    }
    setGenerating(false)
    setModal(false)
    setEditing(null)
    reload()
  }

  // 删除（二次确认）
  const handleDelete = async () => {
    if (!confirmDelete) return
    await api.deleteProduct(confirmDelete.id)
    setConfirmDelete(null)
    toast('产品已删除')
    reload()
  }

  const openEdit = (p) => { setEditing(p); setModal(true) }
  const openNew = () => { setEditing(null); setModal(true) }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">PRODUCT CENTER</div>
          <h1>产品中心</h1>
          <p>管理产品资料，让 AI 自动生成多语言标题、卖点、图片和搜索内容。</p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => setBulk(true)}>批量导入</button>
          <button className="primary-btn" onClick={openNew}>＋ 添加产品</button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          ⌕ <input
            placeholder="搜索产品名称 / SKU / 关键词"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="filters">
          <select
            className="filter-select"
            value="all"
            onChange={() => {}}
            disabled
            title="产品条数由上方搜索与下方筛选共同决定"
          >
            <option value="all">全部产品（{products.length}）</option>
          </select>
          <select
            className="filter-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">全部分类</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            className="filter-select"
            value={seoState}
            onChange={(e) => setSeoState(e.target.value)}
          >
            {SEO_STATES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <span className="filter-count">
            {hasFilter ? `命中 ${filtered.length} / ${products.length}` : `共 ${products.length} 个产品`}
          </span>
          {hasFilter && (
            <button className="filter-clear" onClick={resetFilters}>清空筛选</button>
          )}
        </div>
      </div>

      <div className="data-table product-table">
        <div className="table-head">
          <span>产品</span><span>分类</span><span>SEO</span><span>GEO</span><span>询盘</span><span>更新时间</span><span />
        </div>
        {filtered.map((p, i) => (
          <div className="table-row" key={p.id}>
            <div className="prod-cell">
              <div className={`thumb t${(i % 4) + 1}`} />
              <div>
                <strong>{p.name}</strong>
                <small>{p.model}</small>
              </div>
            </div>
            <span>{p.category}</span>
            <span>
              <b className={`seo-score ${scoreClass(p.seo_score)}`}>{p.seo_score}</b>
            </span>
            <span>
              <b className="gseo-score">{p.geo_score ?? '—'}</b>
            </span>
            <span>{p.inquiries}</span>
            <span>{p.updated_at}</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="row-btn" onClick={() => openEdit(p)}>编辑</button>
              <button className="row-btn" onClick={() => navigate(`/seo?product=${p.id}`)}>SEO</button>
              <button className="row-btn danger" onClick={() => setConfirmDelete(p)}>删除</button>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div className="empty">
            <div className="big">📦</div>
            没有匹配的产品
            {hasFilter && <button className="ghost-btn" style={{ marginTop: 12 }} onClick={resetFilters}>清空筛选条件</button>}
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)}>
        <div className="eyebrow">{editing ? 'EDIT PRODUCT' : 'NEW PRODUCT'}</div>
        <h2>{editing ? '编辑产品' : '添加产品'}</h2>
        <p>输入最少资料即可，AI 会补齐面向采购商的标题、卖点、参数结构、多语言文案与搜索内容。</p>
        <ProductForm product={editing} submitting={generating} onSubmit={handleSubmit} onCancel={() => setModal(false)} />
      </Modal>

      <BulkImportModal
        open={bulk}
        onClose={() => setBulk(false)}
        onImported={reload}
        toast={toast}
      />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <div className="eyebrow">DELETE PRODUCT</div>
        <h2>确认删除产品？</h2>
        <p>
          即将删除 <b>{confirmDelete?.name}</b>（{confirmDelete?.model}）。该产品的多语言内容与 SEO 配置会一并移除，此操作不可撤销。
        </p>
        <div className="onboard-actions">
          <button className="ghost-btn" onClick={() => setConfirmDelete(null)}>取消</button>
          <button
            className="primary-btn"
            style={{ background: '#d92d20' }}
            onClick={handleDelete}
          >
            确认删除
          </button>
        </div>
      </Modal>
    </section>
  )
}
