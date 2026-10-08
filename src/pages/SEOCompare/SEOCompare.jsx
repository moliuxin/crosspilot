import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import Modal from '../../components/ui/Modal'

export default function SEOCompare() {
  const [params, setParams] = useSearchParams()
  const { isFree, toast, addDraft, openPaywall } = useApp()
  const { requireFeature } = useEntitlement()

  // 真实产品列表（来自后端 /api/products，按租户隔离）—— 不再用 mockProducts
  const [products, setProducts] = useState([])

  // 默认对象：优先 URL 指定，其次第一个真实产品
  const productId = params.get('product') || ''
  const [targetId, setTargetId] = useState(productId)
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [applying, setApplying] = useState(false)
  const [draftDone, setDraftDone] = useState(null)

  useEffect(() => {
    let alive = true
    api.getProducts().then((list) => {
      if (!alive) return
      const arr = Array.isArray(list) ? list : list?.products || []
      setProducts(arr)
      if (!productId && arr.length) {
        setTargetId(arr[0].id)
        setParams({ product: arr[0].id }, { replace: true })
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!targetId) return undefined
    let alive = true
    setLoading(true)
    setAccepted(false)
    setDraftDone(null)
    api.getSeoDiff(targetId).then((d) => {
      if (!alive) return
      setDiff(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [targetId])

  const product = useMemo(() => products.find((p) => p.id === targetId), [products, targetId])

  function changeProduct(id) {
    setTargetId(id)
    setParams({ product: id }, { replace: true })
  }

  // 生成优化草稿：落库 + 进入 Agent 待确认队列（不动线上内容）
  async function handleApply() {
    setApplying(true)
    const res = await api.optimizeProduct(targetId)
    addDraft(res.draft)
    setDraftDone(res.draft)
    setApplying(false)
    toast('优化草稿已创建，前往「AI Agent」人工确认后发布')
  }

  const lifted = diff ? diff.scoreAfter - diff.scoreBefore : 0

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">SEO / GEO OPTIMIZATION</div>
          <h1>单产品 SEO / GEO 优化</h1>
          <p>
            按采购意图重构商品页的标题、路由、属性、FAQ 与结构化数据。优化过程<b>先生成草稿</b>，人工确认后才会发布。
          </p>
        </div>
        <div className="head-actions">
          <select className="select-box" value={targetId} onChange={(e) => changeProduct(e.target.value)}>
            {products.length === 0 && <option value="">暂无产品，请先在「产品中心」添加</option>}
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}（SEO {p.seo_score}）
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading || !diff ? (
        <div className="seo-product-bar">
          <div>
            <small>正在加载优化对比…</small>
            <strong>{product?.name}</strong>
          </div>
        </div>
      ) : (
        <>
          <div className="seo-product-bar">
            <div>
              <small>优化对象</small>
              <strong>{product?.name}</strong>
              <small>
                {product?.model} · {product?.category}
              </small>
            </div>
            <div className="seo-current">
              <b>{diff.scoreBefore}</b>
              <i>→</i>
              <b className="target">{diff.scoreAfter}</b>
              <span>提升 +{lifted} 分</span>
            </div>
          </div>

          <div className="diff-grid">
            {diff.fields.map((f) => (
              <div className="diff-card" key={f.key}>
                <div className="diff-head">
                  <strong>{f.label}</strong>
                  <span className={`impact ${f.impact === 'high' ? 'high-impact' : ''}`}>
                    {f.impact === 'high' ? '高影响' : f.impact === 'mid' ? '中影响' : '低影响'}
                  </span>
                </div>
                <div className="before">
                  <small>优化前</small>
                  <code>{f.before}</code>
                </div>
                <div className="after">
                  <small>优化后</small>
                  <code>{f.after}</code>
                </div>
              </div>
            ))}
          </div>

          <div className="ai-note">
            <b>为什么要做这部分？</b>
            <p>
              外贸 B2B 的搜索流量来自「采购关键词 + 结构化信息 + 多语言落地页」的组合。这 {diff.fields.length} 个字段
              直接决定 Google / AI 搜索能否理解你的商品，并把采购商带到询盘表单。
            </p>
          </div>

          <div className="seo-bottom">
            {draftDone ? (
              <>
                <div>
                  <b>✓ 优化草稿已创建（{draftDone.id}）</b>
                  <span>
                    草稿不会直接改线上内容。请前往「AI Agent · 高级能力」查看 Diff 并人工确认发布，
                    发布后「{diff.productName}」的 SEO 分数将更新为 {draftDone.seoScoreAfter}。
                  </span>
                </div>
                <div className="agent-actions">
                  <a className="primary-btn" href="#/agent" style={{ textDecoration: 'none' }}>前往 Agent 确认发布 →</a>
                </div>
              </>
            ) : (
              <>
                <div>
                  <b>应用本次优化</b>
                  <span>
                    应用后会创建一条优化草稿（Draft），你可以在「AI Agent」中查看 Diff 并决定是否发布。
                  </span>
                  <label className="confirm-line">
                    <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                    <span>我已了解本次优化包含的内容，确认生成草稿</span>
                  </label>
                </div>
                <div className="agent-actions">
                  <button className="primary-btn" disabled={!accepted || applying} onClick={handleApply}>
                    {applying ? '正在生成草稿…' : '生成优化草稿'}
                  </button>
                  <button
                    className="ghost-btn"
                    onClick={() => requireFeature('seo.expert')}
                  >
                    让专家帮我做（付费）
                  </button>
                </div>
              </>
            )}
          </div>

          <details className="advanced-detail">
            <summary>查看专业优化范围与计费方式</summary>
            <div className="adv-grid">
              <div className="adv-item">
                <b>AI 自动优化</b>
                <span>10 个字段批量补全，快速可执行</span>
              </div>
              <div className="adv-item">
                <b>专家人工优化</b>
                <span>结合目标市场采购词与竞品校准</span>
              </div>
              <div className="adv-item">
                <b>优化前后对比</b>
                <span>输出可交付的效果对比报告</span>
              </div>
            </div>
          </details>
        </>
      )}

      <Modal open={showUpgrade} onClose={() => setShowUpgrade(false)}>
        <div className="eyebrow">GROWTH SERVICE</div>
        <h2>解锁专业 SEO / GEO 优化</h2>
        <p>
          免费套餐可体验 <b>1 次</b> 完整生成。单产品的深度 SEO / GEO 优化、多语言落地与持续迭代属于专业服务，
          由平台专家结合你的目标市场细化到单个商品完成。
        </p>
        <div className="modal-grid">
          <div className="modal-option">
            <b>AI 自动优化</b>
            <span>10 项字段批量补全 · 快速交付</span>
          </div>
          <div className="modal-option">
            <b>专家代优化</b>
            <span>采购词校准 · 对比报告 · 持续迭代</span>
          </div>
        </div>
        <div className="service-price">
          <span>专业优化服务</span>
          <strong>
            ¥ 议价 <small>/ 商品</small>
          </strong>
        </div>
        <button
          className="modal-cta"
          onClick={() => {
            setShowUpgrade(false)
            toast('已提交专家优化申请，顾问会在 1 个工作日内联系你')
          }}
        >
          提交申请 / 对接客服
        </button>
      </Modal>
    </div>
  )
}
