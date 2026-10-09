import { useState, useRef, useEffect } from 'react'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import { MCP_TOOLS, AGENT_SAFETY_RULE, callMcpTool } from '../../services/mcp'
import { api } from '../../services/api'

// ≥5 条 mock 指令（自然语言 → 调用 MCP 工具）
const QUICK_COMMANDS = [
  { label: '看看哪些产品 SEO 最差', tool: 'get_products', intent: 'list_products' },
  { label: '这个月收到了哪些询盘？', tool: 'get_inquiries', intent: 'list_inquiries' },
  { label: '优化 ultrafiltration 那个商品页', tool: 'update_draft', intent: 'optimize' },
  { label: '生成俄语市场落地页', tool: 'get_language_versions', intent: 'localize' },
  { label: '检查站点 SEO 健康度', tool: 'get_seo_metrics', intent: 'audit' },
  { label: '回滚到上一个发布版本', tool: 'rollback_version', intent: 'rollback' },
]

let msgSeq = 0
const makeId = () => `m_${Date.now()}_${++msgSeq}`
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

export default function AgentPage() {
  const { toast, drafts, addDraft, confirmDraft, discardDraft, openPaywall, site, setDrafts } = useApp()
  const { requireFeature, can } = useEntitlement()
  const [messages, setMessages] = useState([
    {
      id: makeId(),
      role: 'bot',
      title: 'CrossPilot Agent',
      text:
        '你好，我是 CrossPilot Agent。我可以通过 MCP 工具读取你的站点数据、生成优化草稿。' +
        '任何会修改内容的动作我都会先出一份 Draft + Diff，需要你明确确认后才会发布。',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTool, setActiveTool] = useState(null)
  const scrollRef = useRef(null)

  // 挂载时从数据层拉取草稿（含其他页面/其他会话产生的），保证刷新后仍能确认发布
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const remote = await api.getDrafts()
        if (alive && Array.isArray(remote)) setDrafts(remote)
      } catch {
        /* 忽略：保留本地草稿 */
      }
    })()
    return () => {
      alive = false
    }
  }, [setDrafts])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const push = (msg) => setMessages((prev) => [...prev, { id: makeId(), ...msg }])

  async function runCommand(cmd) {
    if (busy) return
    setBusy(true)
    setActiveTool(cmd.tool)
    push({ role: 'user', text: cmd.label })

    await wait(420)
    push({ role: 'bot', tool: cmd.tool, text: `正在调用 MCP 工具 ${cmd.tool} …` })

    const result = await execute(cmd)
    await wait(360)
    setActiveTool(null)

    if (result.draft) addDraft(result.draft)
    push({ role: 'bot', text: result.text, draft: result.draft, table: result.table })
    setBusy(false)
  }

  async function execute(cmd) {
    switch (cmd.intent) {
      case 'list_products': {
        const { products } = await callMcpTool('get_products')
        const sorted = [...products].sort((a, b) => a.seo_score - b.seo_score)
        return {
          text: `共 ${products.length} 个产品，按 SEO 得分升序排列。建议优先优化得分最低的「${sorted[0].name}」。`,
          table: sorted.map((p) => ({ a: p.name, b: `${p.model}`, c: `SEO ${p.seo_score}` })),
        }
      }
      case 'list_inquiries': {
        const { inquiries } = await callMcpTool('get_inquiries')
        const byStatus = inquiries.reduce((acc, i) => {
          acc[i.status] = (acc[i.status] || 0) + 1
          return acc
        }, {})
        return {
          text: `当前共 ${inquiries.length} 条询盘，按状态分布如下。可前往「询盘中心」查看详情并跟进。`,
          table: Object.entries(byStatus).map(([k, v]) => ({ a: k, b: `${v} 条`, c: '' })),
        }
      }
      case 'optimize': {
        // 真实数据驱动：找 SEO 得分最低的产品，用真实内容补丁生成草稿
        const { products } = await callMcpTool('get_products')
        const worst = [...products].sort((a, b) => a.seo_score - b.seo_score)[0]
        const seo = worst?.seo || {}
        const patch = {
          seo: {
            title: `${worst.name} Manufacturer & Supplier | AQUAFLOW ${worst.model}`,
            slug: `/${worst.name.toLowerCase().replace(/\s+/g, '-')}/`,
            meta_description: `Industrial ${worst.name.toLowerCase()} for global B2B projects. ${worst.model}. OEM/ODM, global delivery.`,
            h1: `${worst.name} (${worst.model})`,
            faq: seo.faq?.length ? seo.faq : undefined,
            schema_enabled: true,
            faq_schema_enabled: true,
          },
        }
        const res = await callMcpTool('update_draft', {
          entity_type: 'product',
          entity_id: worst.id,
          patch,
          title: `SEO/GEO 优化草稿 · ${worst.name}`,
        })
        return {
          text: `已为「${worst.name}」（当前 SEO ${worst.seo_score} 分）生成优化草稿，共 ${res.diff.length} 项变更。确认后发布将真实写入 title / slug / Meta / H1 / Schema。`,
          draft: res.draft,
        }
      }
      case 'localize': {
        const { versions } = await callMcpTool('get_language_versions')
        const res = await api.agentRun({
          entity_type: 'page',
          entity_id: 'page_home',
          market: 'ru-RU',
          patch: { market_template: 'ru-RU', density: '偏紧凑（dense）', sections: '4 个区块' },
        })
        return {
          text: '已按「俄语市场模板」生成落地页草稿（不是翻译，是结构性适配）：',
          draft: res.draft,
          table: versions.map((v) => ({ a: v.market, b: v.is_default ? '默认市场' : '已启用', c: '' })),
        }
      }
      case 'audit': {
        const { score, issues } = await callMcpTool('get_seo_metrics', { product_id: 'prod_002' })
        const high = issues.filter((i) => i.impact === 'high')
        return {
          text: `站点 SEO 健康度得分 ${score}/100，其中高影响问题 ${high.length} 项：${high.map((i) => i.field).join('、')}。建议进入「SEO / GEO 优化」处理。`,
        }
      }
      case 'rollback': {
        // 真回滚：恢复最近一次发布前的内容快照。
        // 目标实体取真实数据（SEO 得分最低的产品），不再硬编码 prod_002。
        const { products } = await callMcpTool('get_products')
        if (!products?.length) {
          return { text: '当前租户下没有产品，无法执行回滚。请先在产品中心添加产品。' }
        }
        const target = [...products].sort((a, b) => a.seo_score - b.seo_score)[0]
        const res = await callMcpTool('rollback_version', {
          entity_type: 'product',
          entity_id: target.id,
        })
        if (!res.rolled_back) {
          return {
            text: `「${target.name}」(${target.id}) 回滚未执行：${res.error || '没有可回滚的发布版本'}。可前往「版本历史」查看全部版本。`,
          }
        }
        return {
          text: `已把「${target.name}」(${target.id}) 回滚到发布前版本（v${res.version?.version_no}）。刷新产品页或查看「版本历史」可验证。`,
        }
      }
      default:
        return { text: '暂时无法识别该指令，请换一种说法。' }
    }
  }

  function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    const matched =
      QUICK_COMMANDS.find((c) => /询盘/.test(text)) ||
      QUICK_COMMANDS.find((c) => /优|SEO|seo|优化/.test(text)) ||
      QUICK_COMMANDS.find((c) => /俄|本地化|多语言|local/i.test(text)) ||
      QUICK_COMMANDS[0]
    runCommand({ ...matched, label: text })
  }

  async function handlePublish(draft) {
    // 免费计划：首次发布免费，之后发布属付费能力（演示路径首次可走通）
    if ((site.publishCount || 0) >= 1 && !can('site.publish')) {
      requireFeature('site.publish')
      return
    }
    // 人工确认 → 发布（human_confirmed = true）：草稿落库、产品 SEO/GEO 分数真实更新、站点置为已发布
    const res = await api.publishDraft(draft.id, true)
    confirmDraft(draft.id)
    if (res.published) {
      const lift = draft.seoScoreAfter != null ? `，${draft.title.replace('SEO/GEO 优化草稿 · ', '')} SEO ${draft.seoScoreBefore} → ${draft.seoScoreAfter}` : ''
      toast(`已发布上线（人工已确认）${lift}`)
    } else {
      toast('发布失败')
    }
  }

  const pending = drafts.filter((d) => !d.confirmed)

  // 聊天卡片与侧栏共用的丢弃逻辑（context + 持久层同步删除）
  function handleDiscard(id) {
    discardDraft(id)
    toast('已丢弃草稿')
  }

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">AI AGENT · MCP</div>
          <h1>AI Agent</h1>
          <p>
            用自然语言操作站点。Agent 通过 MCP 工具读取数据、生成草稿；<b>发布需要你的人工确认</b>。
          </p>
        </div>
        <div className="head-actions">
          <span className={`status-pill ${busy ? 'busy' : ''}`}>
            {busy ? 'Agent 运行中…' : 'Agent 就绪'}
          </span>
        </div>
      </div>

      <div className="agent-layout">
        <div className="agent-chat">
          <div className="agent-messages" ref={scrollRef}>
            {messages.map((m) => (
              <ChatMessage key={m.id} msg={m} onPublish={handlePublish} onDiscard={handleDiscard} />
            ))}
          </div>

          <div className="agent-input">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入指令，例如：帮我优化 ultrafiltration 商品页"
            />
            <button onClick={handleSend} disabled={busy}>
              发送
            </button>
          </div>
        </div>

        <aside className="agent-side">
          <div className="panel">
            <div className="panel-head">
              <h3>快捷指令</h3>
            </div>
            <div className="cmd-list">
              {QUICK_COMMANDS.map((c) => (
                <button key={c.label} className="cmd-btn" disabled={busy} onClick={() => runCommand(c)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>MCP 工具</h3>
              <span className="ai-badge">{MCP_TOOLS.length} tools</span>
            </div>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              {MCP_TOOLS.length} 个工具全部对接真实数据层：读工具查询站点 / 页面 / 产品 / 询盘 / SEO·GEO 指标 / 版本记录，
              写工具（create_draft / update_draft / update_page / update_product）产出 Draft + Diff，
              发布与回滚均由后端执行并落库。清单的服务端真源是 <code>GET /api/mcp/tools</code>。
            </p>
            <div className="mcp-list">
              {MCP_TOOLS.map((t) => (
                <div key={t.name} className={`mcp-item${activeTool === t.name ? ' active' : ''}`}>
                  {t.name}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>安全规则</h3>
            </div>
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              {AGENT_SAFETY_RULE}
            </p>
            <div className="flow-mini">
              <span>Draft</span>
              <i>→</i>
              <span>Diff</span>
              <i>→</i>
              <span className="hl">人工确认</span>
              <i>→</i>
              <span>Publish</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>待确认草稿</h3>
              <span className="usage-pill">{pending.length}</span>
            </div>
            {pending.length === 0 ? (
              <p className="muted" style={{ fontSize: 12.5 }}>
                暂无待确认草稿。
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pending.map((d) => (
                  <PendingDraftCard key={d.id} draft={d} onPublish={handlePublish} onDiscard={handleDiscard} />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function ChatMessage({ msg, onPublish, onDiscard }) {
  if (msg.role === 'user') {
    return <div className="agent-msg user">{msg.text}</div>
  }
  return (
    <div className="agent-msg bot">
      {msg.title && <strong>{msg.title}</strong>}
      <div>{msg.text}</div>
      {msg.table && (
        <table className="agent-table">
          <tbody>
            {msg.table.map((r, i) => (
              <tr key={i}>
                <td>{r.a}</td>
                <td>{r.b}</td>
                <td>{r.c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg.draft && <DraftCard draft={msg.draft} onPublish={onPublish} onDiscard={onDiscard} />}
    </div>
  )
}

function DraftCard({ draft: draftProp, onPublish, onDiscard }) {
  const { drafts } = useApp()
  // 以 context 中的实时状态为准（确认后按钮区切换为已发布）
  const draft = drafts.find((d) => d.id === draftProp.id) || draftProp
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const confirmed = draft.confirmed || draft.status === 'published'
  return (
    <div className="agent-draft">
      <div className="draft-head">
        草稿 {draft.id}
        {draft.market ? ` · 市场 ${draft.market}` : ''}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 }}>
        对象 {draft.entity_type}:{draft.entity_id}
        <button className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? '收起 Diff' : '查看 Diff'}
        </button>
      </div>
      {open && (
        <table className="agent-table">
          <thead>
            <tr>
              <th>字段</th>
              <th>优化后</th>
            </tr>
          </thead>
          <tbody>
            {draft.diff.map((d, i) => (
              <tr key={i}>
                <td>
                  <code>{d.field}</code>
                </td>
                <td>{String(d.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!confirmed ? (
        <div className="agent-actions">
          <button
            className="confirm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onPublish(draft)
              setBusy(false)
            }}
          >
            人工确认并发布
          </button>
          <button className="cancel" onClick={() => onDiscard(draft.id)}>
            丢弃
          </button>
        </div>
      ) : (
        <div className="draft-published">已发布 ✓</div>
      )}
    </div>
  )
}

// 侧栏「待确认草稿」卡片：刷新后仍可查看 Diff、确认发布或丢弃
function PendingDraftCard({ draft, onPublish, onDiscard }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="pending-draft">
      <button className="pending-head" onClick={() => setOpen((v) => !v)}>
        <span className="pending-title">{draft.title || draft.id}</span>
        <i className={open ? 'open' : ''}>⌄</i>
      </button>
      {open && (
        <>
          <table className="agent-table compact">
            <tbody>
              {(draft.diff || []).slice(0, 6).map((d, i) => (
                <tr key={i}>
                  <td>
                    <code>{d.field}</code>
                  </td>
                  <td>{String(d.after).slice(0, 42)}{String(d.after).length > 42 ? '…' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(draft.diff || []).length > 6 && (
            <div className="pending-more">共 {draft.diff.length} 项变更</div>
          )}
          <div className="agent-actions">
            <button
              className="confirm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onPublish(draft)
                setBusy(false)
              }}
            >
              {busy ? '发布中…' : '人工确认并发布'}
            </button>
            <button className="cancel" onClick={() => onDiscard(draft.id)}>
              丢弃
            </button>
          </div>
        </>
      )}
    </div>
  )
}
