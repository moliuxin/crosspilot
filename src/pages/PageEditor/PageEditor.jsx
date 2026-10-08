import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { api } from '../../services/api'
import Modal from '../../components/ui/Modal'

// 可添加的模块类型（与后端 SectionType 对齐）
const SECTION_PRESETS = [
  { type: 'hero', label: 'Hero 首屏' },
  { type: 'trust', label: '信任背书' },
  { type: 'products', label: '核心产品' },
  { type: 'applications', label: '应用场景' },
  { type: 'capability', label: '企业能力' },
  { type: 'cases', label: '项目案例' },
  { type: 'cta', label: '询盘 CTA' },
]

const DEVICE_LABEL = { desktop: '1440 × 960 · 80%', tablet: '768 × 1024 · 80%', mobile: '390 × 844 · 90%' }
const MARKETS = [
  { key: 'en-US', label: '英语市场' },
  { key: 'ru-RU', label: '俄语市场' },
  { key: 'zh-CN', label: '中文市场' },
]

// 样式属性选项：value 写入 section.props，画布与前台按同一份 props 渲染
const PADDING_OPTIONS = [
  { value: 'compact', label: '紧凑' },
  { value: 'comfortable', label: '舒适', hint: '默认' },
  { value: 'loose', label: '宽松' },
]
const ALIGN_OPTIONS = [
  { value: 'left', label: '左对齐', hint: '区块内文案靠左，Hero 保留配图' },
  { value: 'center', label: '居中', hint: '文案居中，Hero 转为单列居中布局' },
  { value: 'right', label: '右对齐', hint: '文案与按钮靠右' },
]
const BACKGROUND_OPTIONS = [
  { value: 'light', label: '浅色', hint: '浅色底，适合正文区块' },
  { value: 'dark', label: '深色', hint: '深色底，适合强调区块' },
  { value: 'brand', label: '品牌色', hint: '品牌蓝渐变，适合 CTA / 首屏' },
]
const PADDING_CLASS = { compact: 'block-pad-compact', comfortable: 'block-pad-comfortable', loose: 'block-pad-loose' }

/** 区块样式 → 画布 className，保证「所见即所得」 */
function styleClass(props = {}) {
  const { padding = 'comfortable', align = 'left', background = 'light' } = props
  return [
    PADDING_CLASS[padding] || '',
    `block-align-${align}`,
    `block-bg-${background}`,
  ].filter(Boolean).join(' ')
}

export default function PageEditor() {
  const { toast, openPaywall } = useApp()
  const { requireFeature } = useEntitlement()
  // 站点作用域：编辑器挂在 /sites/:siteId/editor 下时只加载该站点页面
  const { siteId } = useParams()
  const [pages, setPages] = useState([])
  const [pageId, setPageId] = useState('')
  const [sections, setSections] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState('内容')
  const [device, setDevice] = useState('desktop')
  const [dragged, setDragged] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [brushLoading, setBrushLoading] = useState(false)
  const [suggest, setSuggest] = useState(null) // { section_id, field, before, after }
  const [market, setMarket] = useState('en-US')

  const page = useMemo(() => pages.find((p) => p.id === pageId), [pages, pageId])
  const selected = useMemo(() => sections.find((s) => s.id === selectedId) || sections[0], [sections, selectedId])

  // 加载页面列表（site scope 内只加载该站点页面）
  useEffect(() => {
    let alive = true
    api.getPages(siteId).then((list) => {
      if (!alive || !Array.isArray(list) || !list.length) return
      setPages(list)
      setPageId(list[0].id)
      setSections(list[0].sections || [])
      setSelectedId((list[0].sections || [])[0]?.id || '')
    })
    return () => {
      alive = false
    }
  }, [siteId])

  function switchPage(id) {
    if (dirty && !window.confirm('当前页面有未保存的修改，切换后会丢失。确定切换吗？')) return
    const p = pages.find((x) => x.id === id)
    if (!p) return
    setPageId(id)
    setSections(p.sections || [])
    setSelectedId((p.sections || [])[0]?.id || '')
    setDirty(false)
    setSuggest(null)
  }

  function mutate(next) {
    setSections(next)
    setDirty(true)
  }

  const move = (from, to) => {
    if (from === to || to < 0 || to >= sections.length) return
    const next = [...sections]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    mutate(next)
  }

  function addSection(preset) {
    const sec = {
      id: `sec_${Date.now().toString(36)}`,
      type: preset.type,
      label: preset.label,
      props: {
        eyebrow: preset.label.toUpperCase(),
        title: `新的${preset.label}模块`,
        description: '',
        cta: '',
        padding: 'comfortable',
        align: 'left',
        background: 'light',
      },
    }
    mutate([...sections, sec])
    setSelectedId(sec.id)
    setAddOpen(false)
    toast(`已添加「${preset.label}」，记得保存`)
  }

  function removeSection(idx) {
    const target = sections[idx]
    mutate(sections.filter((_, i) => i !== idx))
    if (target && target.id === selectedId) setSelectedId('')
    toast('已删除模块，记得保存')
  }

  function updateProp(field, value) {
    mutate(sections.map((s) => (s.id === selected.id ? { ...s, props: { ...s.props, [field]: value } } : s)))
  }

  async function save() {
    if (!page) return
    setSaving(true)
    try {
      await api.updatePage(page.id, { sections })
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, sections, updated_at: '刚刚' } : p)))
      setDirty(false)
      toast('页面已保存')
    } catch (e) {
      toast(e.message || '保存失败', 'warn')
    } finally {
      setSaving(false)
    }
  }

  async function runAiRewrite(instruction = '') {
    if (!page || !selected) return
    setRewriting(true)
    try {
      const res = await api.rewritePageCopy(page.id, {
        section_id: selected.id,
        field: 'title',
        instruction,
        market,
      })
      setSuggest({ ...res, currentValue: selected.props?.title || '' })
      toast('AI 已生成改写建议，确认后再保存')
    } catch (e) {
      toast(e.message || 'AI 改写失败', 'warn')
    } finally {
      setRewriting(false)
    }
  }

  function applySuggest() {
    if (!suggest) return
    updateProp('title', suggest.after)
    setSuggest(null)
    toast('已应用到编辑器，记得保存')
  }

  // AI 画笔（Pro）：免费用户可见入口但必须先升级；后端 403/403 硬校验不依赖前端锁
  async function handleBrush() {
    if (!pageId) {
      toast('请先选择一个页面', 'warn')
      return
    }
    setBrushLoading(true)
    try {
      const res = await api.brushPreview(pageId, '检查当前页面可圈选的区块')
      toast(res?.note || 'AI 画笔已开通：圈选内容并自然语言修改，改动走草稿与版本')
    } catch (err) {
      if (err?.status === 403 || err?.status === 402) {
        openPaywall(
          'AI 画笔 · Pro',
          err?.detail?.message || 'AI 画笔属于 Pro 能力。通过自然语言圈选并修改页面内容，所有修改支持 Diff 和版本回滚。',
          'brush.edit'
        )
      } else {
        toast(err?.detail || 'AI 画笔暂不可用', 'warn')
      }
    } finally {
      setBrushLoading(false)
    }
  }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">PAGE EDITOR</div>
          <h1>页面编辑</h1>
          <p>拖拽排序组件、编辑右侧属性，保存后写入站点数据（后端落库）。</p>
        </div>
        <div className="head-actions">
          {dirty && <span className="dirty-pill">● 有未保存修改</span>}
          <button className="ghost-btn pro-feature" onClick={handleBrush} disabled={brushLoading} title="自然语言圈选并修改页面内容（Pro）">
            {brushLoading ? '✨ AI 画笔…' : '✨ AI 画笔 · Pro'}
          </button>
          <button className="ghost-btn" onClick={() => setDevice(device === 'mobile' ? 'desktop' : 'mobile')}>
            {device === 'mobile' ? '切换桌面预览' : '切换移动预览'}
          </button>
          <button className="primary-btn" disabled={!dirty || saving} onClick={save}>
            {saving ? '保存中…' : '保存页面'}
          </button>
        </div>
      </div>

      <div className="editor-layout">
        <aside className="editor-left">
          <div className="editor-title">页面与组件</div>
          <div className="page-tree">
            {pages.map((p) => (
              <button key={p.id} className={p.id === pageId ? 'active' : ''} onClick={() => switchPage(p.id)}>
                <span>▤</span>{p.name}{p.is_home && <b>●</b>}
              </button>
            ))}
          </div>
          <div className="editor-section-title">当前页面组件（拖拽排序）</div>
          <div className="component-list">
            {sections.map((c, i) => (
              <button
                key={c.id}
                className={c.id === selected?.id ? 'active' : ''}
                draggable
                onDragStart={() => setDragged(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { move(dragged, i); setDragged(null) }}
                onClick={() => { setSelectedId(c.id); setSuggest(null) }}
              >
                <span>⋮⋮</span> <span>{c.label}</span>
                <b onClick={(e) => { e.stopPropagation(); removeSection(i) }} title="删除">✕</b>
              </button>
            ))}
            {!sections.length && <div className="empty small">该页面暂无组件</div>}
          </div>
          <button className="add-section" onClick={() => setAddOpen(true)}>＋ 添加模块</button>
        </aside>

        <div className="editor-canvas-wrap">
          <div className="canvas-toolbar">
            <div>
              {[['desktop', '桌面端'], ['tablet', '平板'], ['mobile', '移动端']].map(([key, label]) => (
                <button key={key} className={device === key ? 'active' : ''} onClick={() => setDevice(key)}>{label}</button>
              ))}
            </div>
            <span>{DEVICE_LABEL[device]}</span>
            <div>
              <select className="market-select" value={market} onChange={(e) => setMarket(e.target.value)}>
                {MARKETS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="editor-canvas">
            <div className={`edit-site device-${device}`}>
              <div className="edit-nav">
                <b>AQUAFLOW</b>
                <span>Products &nbsp;&nbsp; Solutions &nbsp;&nbsp; Cases &nbsp;&nbsp; About</span>
                <button>GET A QUOTE</button>
              </div>

              {sections.map((s) => (
                <CanvasBlock
                  key={s.id}
                  section={s}
                  active={s.id === selected?.id}
                  onSelect={() => { setSelectedId(s.id); setSuggest(null) }}
                />
              ))}
              {!sections.length && <div className="canvas-empty">左侧添加模块后在这里预览</div>}
            </div>
          </div>
        </div>

        <aside className="editor-right">
          <div className="property-tabs">
            {['内容', '样式', 'AI'].map((t) => (
              <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>

          {!selected && <div className="empty small">请选择一个组件</div>}

          {selected && tab === '内容' && (
            <>
              <div className="property-group">
                <label>区块名称</label>
                <input value={selected.label} onChange={(e) => mutate(sections.map((s) => (s.id === selected.id ? { ...s, label: e.target.value } : s)))} />
              </div>
              <div className="property-group">
                <label>顶部标签</label>
                <input value={selected.props?.eyebrow || ''} onChange={(e) => updateProp('eyebrow', e.target.value)} />
              </div>
              <div className="property-group">
                <label>主标题</label>
                <textarea rows="2" value={selected.props?.title || ''} onChange={(e) => updateProp('title', e.target.value)} />
                <button className="ai-inline" disabled={rewriting} onClick={() => runAiRewrite()}>
                  {rewriting ? '✦ 改写中…' : '✦ AI 改写'}
                </button>
              </div>
              <div className="property-group">
                <label>描述</label>
                <textarea rows="3" value={selected.props?.description || ''} onChange={(e) => updateProp('description', e.target.value)} />
              </div>
              <div className="property-group">
                <label>按钮文案</label>
                <input value={selected.props?.cta || ''} onChange={(e) => updateProp('cta', e.target.value)} />
              </div>
              <div className="property-group">
                <label>背景视觉</label>
                <div className="media-box">
                  <div className="media-thumb" />
                  <div>
                    <strong>工业设备场景图</strong>
                    <span>AI Generated</span>
                  </div>
                  <button onClick={() => toast('图片替换为付费能力', 'warn')}>更换</button>
                </div>
              </div>
            </>
          )}

          {selected && tab === '样式' && (
            <>
              <div className="property-group">
                <label>区块间距</label>
                <select
                  className="market-select"
                  value={selected.props?.padding || 'comfortable'}
                  onChange={(e) => updateProp('padding', e.target.value)}
                >
                  {PADDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="property-group">
                <label>文字对齐</label>
                <div className="seg-row">
                  {ALIGN_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      title={o.hint}
                      className={(selected.props?.align || 'left') === o.value ? 'active' : ''}
                      onClick={() => updateProp('align', o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="property-group">
                <label>背景</label>
                <div className="seg-row">
                  {BACKGROUND_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      title={o.hint}
                      className={(selected.props?.background || 'light') === o.value ? 'active' : ''}
                      onClick={() => updateProp('background', o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="style-hint">样式改动会即时反映到中间画布，保存后写入该区块数据。</p>
            </>
          )}

          {selected && tab === 'AI' && (
            <>
              <div className="property-group">
                <label>目标市场</label>
                <select className="market-select" value={market} onChange={(e) => setMarket(e.target.value)}>
                  {MARKETS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div className="property-group">
                <label>改写要求（可选）</label>
                <textarea rows="2" id="ai-instruction" placeholder="例如：突出交付速度与售后能力" />
                <button
                  className="ai-inline"
                  disabled={rewriting}
                  onClick={() => runAiRewrite(document.getElementById('ai-instruction')?.value || '')}
                >
                  {rewriting ? '✦ 生成中…' : '✦ 生成改写建议'}
                </button>
              </div>

              {suggest && (
                <div className="ai-suggest">
                  <div className="ai-suggest-head">✦ AI 改写建议</div>
                  <div className="ai-suggest-row"><span>原文</span><del>{suggest.currentValue || suggest.before || '（空）'}</del></div>
                  <div className="ai-suggest-row"><span>建议</span><ins>{suggest.after}</ins></div>
                  <div className="ai-suggest-actions">
                    <button className="primary-btn" onClick={applySuggest}>应用到编辑器</button>
                    <button className="ghost-btn" onClick={() => setSuggest(null)}>忽略</button>
                  </div>
                </div>
              )}

              <div className="premium-lock">
                <b>✦ 专业优化</b>
                <p>AI 可根据目标市场自动调整首屏措辞、信任元素与 CTA。</p>
                <button onClick={() => requireFeature('seo.expert')}>
                  查看高级功能
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)}>
        <div className="eyebrow">ADD SECTION</div>
        <h2>添加模块</h2>
        <p>选择要插入到当前页面的模块类型，添加后可拖拽调整顺序。</p>
        <div className="preset-grid">
          {SECTION_PRESETS.map((p) => (
            <button key={p.type} className="preset-item" onClick={() => addSection(p)}>
              <b>{p.label}</b>
              <span>{p.type}</span>
            </button>
          ))}
        </div>
      </Modal>
    </section>
  )
}

/* ---- 画布区块渲染（按 type 呈现不同结构） ---- */
function CanvasBlock({ section, active, onSelect }) {
  const { props = {}, type, label } = section
  const cls = `edit-block block-${type}${active ? ' selected-block' : ''} ${styleClass(props)}`
  return (
    <div className={cls} onClick={onSelect}>
      {active && <div className="selection-label">{label} <span>✦ AI 编辑</span></div>}

      {type === 'hero' && (
        <div className="edit-hero">
          <div className="edit-copy">
            <small>{props.eyebrow}</small>
            <h2>{props.title}</h2>
            <p>{props.description}</p>
            <div>
              <button>{props.cta || 'Explore Products'}</button>
              <button className="outline">Talk to an Engineer</button>
            </div>
          </div>
          <div className="edit-machine">
            <div className="machine"><span /><b /><i /></div>
          </div>
        </div>
      )}

      {type === 'trust' && (
        <div className="edit-trust">
          {(props.items || []).map((x) => <span key={x}>{x}</span>)}
        </div>
      )}

      {type === 'products' && (
        <div className="edit-section">
          <small>{props.eyebrow}</small>
          <h3>{props.title}</h3>
          <div className="edit-card-row"><div /><div /><div /></div>
        </div>
      )}

      {type === 'applications' && (
        <div className="edit-section alt">
          <small>{props.eyebrow}</small>
          <h3>{props.title}</h3>
          <div className="edit-card-row two"><div /><div /></div>
        </div>
      )}

      {type === 'capability' && (
        <div className="edit-section">
          <small>{props.eyebrow}</small>
          <h3>{props.title}</h3>
          <div className="edit-card-row"><div /><div /><div /></div>
        </div>
      )}

      {type === 'cases' && (
        <div className="edit-section alt">
          <small>{props.eyebrow}</small>
          <h3>{props.title}</h3>
          <div className="edit-card-row two"><div /><div /></div>
        </div>
      )}

      {type === 'cta' && (
        <div className="edit-cta">
          <h3>{props.title}</h3>
          <button>{props.cta || 'Send Inquiry'}</button>
        </div>
      )}

      {type === 'custom' && (
        <div className="edit-section">
          <small>{props.eyebrow || 'CUSTOM'}</small>
          <h3>{props.title || label}</h3>
        </div>
      )}
    </div>
  )
}
