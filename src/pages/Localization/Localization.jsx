import { useCallback, useEffect, useState } from 'react'
import { api } from '../../services/api'
import { marketTemplates, marketOrder } from '../../data/marketTemplates'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import SiteHero from '../../components/site/SiteHero'

export default function Localization() {
  const { currentMarket, setMarket, toast, openPaywall } = useApp()
  const { requireFeature } = useEntitlement()
  const [market, setLocalMarket] = useState(currentMarket)
  const [loc, setLoc] = useState(null)
  const [working, setWorking] = useState(null)

  // 市场版本与免费额度均由服务端裁定（此前写在 localStorage，可被绕过）
  const load = useCallback(() => {
    api.getLocalization()
      .then(setLoc)
      .catch(() => setLoc({ markets: ['en-US'], available: marketOrder, defaultMarket: 'en-US', freeExtraLimit: 1, freeExtraLeft: 1, requiresPayment: false }))
  }, [])

  useEffect(() => { load() }, [load])

  const pick = (m) => {
    setLocalMarket(m)
    setMarket(m)
  }
  const t = marketTemplates[market]

  const generated = loc?.markets || ['en-US']
  const isGenerated = generated.includes(market)

  // 生成市场版本：新增市场消耗免费额度，用尽后由后端返回 402 → 引导升级
  const generateMarket = async () => {
    if (isGenerated) {
      toast(`「${t.label}」市场版本已生成，可在左侧预览中查看`)
      return
    }
    setWorking(market)
    try {
      const res = await api.generateMarket(market)
      setLoc(res)
      toast(`✦ 已生成「${t.label}」市场版本草稿（${res.markets.length}/${marketOrder.length}）`)
    } catch (e) {
      if (e.status === 402) {
        requireFeature('market.localize')
      } else {
        toast(`生成失败：${e.message}`, 'warn')
      }
    }
    setWorking(null)
  }

  const freeLeft = loc?.freeExtraLeft ?? 0

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">MARKET LOCALIZATION</div>
          <h1>三个语言界面，三个市场版本</h1>
          <p>同一批商品，页面结构、图片风格、描述方式与信任证据按市场自动适配。</p>
        </div>
        <div className="head-actions">
          <button className="primary-btn" onClick={generateMarket} disabled={working === market}>
            {working === market ? '✦ 生成中…' : '✦ 生成新市场版本'}
          </button>
        </div>
      </div>

      <div className="loc-bar">
        <div className="loc-bar-item">
          <span>已生成版本</span>
          <b>{generated.length} / {marketOrder.length}</b>
        </div>
        <div className="loc-bar-meter">
          <div className="loc-bar-dots">
            {marketOrder.map((m) => (
              <span
                key={m}
                className={`loc-dot${generated.includes(m) ? ' on' : ''}`}
                title={marketTemplates[m].label}
              />
            ))}
          </div>
          <small>
            {freeLeft > 0
              ? `免费额度剩余 ${freeLeft} 个新增市场版本`
              : '免费额度已用完 · 升级解锁全部语言市场版本'}
          </small>
        </div>
        <div className="loc-bar-actions">
          <button
            className="ghost-btn"
            onClick={() => requireFeature('market.localize')}
          >
            升级解锁
          </button>
        </div>
      </div>

      <div className="market-tabs">
        {marketOrder.map((m) => (
          <button
            key={m}
            className={`${m === market ? 'active' : ''}${generated.includes(m) ? '' : ' pending'}`}
            onClick={() => pick(m)}
          >
            {marketTemplates[m].flag} · {marketTemplates[m].label}
            {!generated.includes(m) && <em className="tab-badge">未生成</em>}
          </button>
        ))}
      </div>

      <div className="market-compare">
        <div className="market-preview">
          <SiteHero template={t} />
        </div>

        <aside className="market-rules panel">
          <strong>当前市场策略</strong>
          <div className="rule-row"><span>信息密度</span><b>{t.density}</b></div>
          <div className="rule-row"><span>首屏重点</span><b>{t.focus}</b></div>
          <div className="rule-row"><span>信任元素</span><b>{t.trust}</b></div>
          <div className="rule-row"><span>主 CTA</span><b>{t.cta}</b></div>
          <div className="rule-row"><span>联系方式优先级</span><b>{t.contactPriority}</b></div>
          <div className="rule-row"><span>描述详略</span><b>{t.descDetail}</b></div>
          <div className="rule-row"><span>图片风格</span><b>{t.visual}</b></div>
          <div className="rule-row">
            <span>版本状态</span>
            <b className={isGenerated ? 'ok-text' : 'muted'}>{isGenerated ? '已生成' : '未生成'}</b>
          </div>
          <div className="ai-note">✦ <span>AI 不是翻译页面，而是调用对应的 Market Template。</span></div>
        </aside>
      </div>
    </section>
  )
}
