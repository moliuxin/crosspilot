import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../services/api'
import { useApp } from '../../app/store/AppContext'
import { useEntitlement } from '../../app/store/useEntitlement'
import Modal from '../../components/ui/Modal'

// 高级能力二级页：网站诊断 / AI 文案 / AI 图片 / 竞品分析
// 保持「商家看得懂」的表达；底层能力统一为专业服务入口
const FEATURES = {
  audit: {
    title: '网站诊断',
    eyebrow: 'SITE AUDIT',
    desc: '从「访客能不能找到你、能不能看懂你、愿不愿意联系你」三个角度看网站。',
    items: [
      { name: '可被找到', score: 71, hint: '搜索与 AI 可见性仍有提升空间' },
      { name: '页面体验', score: 92, hint: '加载与移动端表现良好' },
      { name: '内容说服力', score: 76, hint: '缺少部分采购决策所需信息' },
      { name: '转化路径', score: 84, hint: '询盘入口清晰，可进一步简化' },
    ],
    action: '开始完整体检',
    delivers: '站点可发现性 / 页面体验 / 内容说服力 / 转化路径 四维完整报告 + 修复清单',
    steps: ['抓取站点结构与页面样本', '检测索引、Canonical 与 Sitemap', '评估内容说服力与询盘路径', '输出体检报告与修复建议'],
    eta: '1 个工作日',
  },
  copy: {
    title: 'AI 文案',
    eyebrow: 'AI COPYWRITING',
    desc: '面向采购商的文案：先说清你能解决什么问题，再说清你怎么做到。',
    items: [
      { name: '首屏主张', score: 88, hint: '已按市场模板生成' },
      { name: '产品描述', score: 64, hint: '6 个产品描述偏短，缺少应用场景' },
      { name: 'FAQ 口径', score: 52, hint: '缺少交付、认证、定制类问答' },
      { name: '多语言一致性', score: 70, hint: '俄语站部分文案待重写' },
    ],
    action: '批量生成 / 改写文案',
    delivers: '首屏主张 + 产品描述 + FAQ + 多语言一致性 全套文案交付',
    steps: ['抽取现有文案与产品资料', '按目标市场重写首屏与产品描述', '补齐 FAQ（交付/认证/定制）', '三语言一致性校对并回填站点'],
    eta: '2 个工作日',
  },
  image: {
    title: 'AI 图片',
    eyebrow: 'AI VISUAL',
    desc: '按行业气质生成或优化产品与应用场景图，统一视觉风格与比例。',
    items: [
      { name: '产品主图', score: 82, hint: '比例统一，背景可更干净' },
      { name: '应用场景图', score: 58, hint: '缺少真实工况场景' },
      { name: '细节特写', score: 66, hint: '可补充工艺与接口特写' },
      { name: '风格一致性', score: 74, hint: '冷暖调性略有差异' },
    ],
    action: '生成 / 优化图片',
    delivers: '产品主图 + 应用场景图 + 细节特写，统一比例与调性',
    steps: ['梳理产品图清单与缺口', '生成应用场景与细节特写', '统一比例、背景与色调', '导出并替换站点图片'],
    eta: '2-3 个工作日',
  },
  competitor: {
    title: '竞品分析',
    eyebrow: 'COMPETITOR',
    desc: '看同行业头部在搜索与 AI 搜索中被如何描述，找到你的差异化位置。',
    items: [
      { name: '关键词覆盖', score: 62, hint: '低于行业头部 3 个核心词' },
      { name: 'AI 引用份额', score: 41, hint: '头部占据多数 AI 回答' },
      { name: '内容深度', score: 70, hint: '技术内容接近，案例偏少' },
      { name: '信任要素', score: 78, hint: '认证齐全，可补充交付案例' },
    ],
    action: '查看竞品对比报告',
    delivers: '3-5 家头部竞品的搜索/AI 可见性对比与差异化定位建议',
    steps: ['锁定 3-5 家对标竞品', '采集搜索排名与 AI 引用份额', '对比内容深度与信任要素', '输出差异化定位与关键词机会'],
    eta: '3 个工作日',
  },
  conversion: {
    title: 'Buyer Conversion',
    eyebrow: 'AI BUYER SIMULATOR',
    desc: '让 AI 扮演真实采购商浏览你的站点，指出「哪一步他会流失、哪句话没说服他」。',
    items: [
      { name: '首屏说服力', score: 74, hint: '主张清楚，但缺少量化交付能力' },
      { name: '规格完整度', score: 61, hint: '采购商最关心的参数缺失 3 项' },
      { name: '信任闭环', score: 69, hint: '认证与案例可再前置' },
      { name: '询盘转化路径', score: 83, hint: '入口清晰，表单字段可精简' },
    ],
    action: '运行 AI 买家模拟',
    delivers: '3 类典型买家人设 × 全站走查报告 + 流失点定位 + 优化优先序',
    steps: ['构建目标市场买家人设', '按人设走查关键转化页面', '标注流失点与阻塞问题', '输出按影响度排序的优化清单'],
    eta: '2 个工作日',
  },
}

function statusLabel(s) {
  return { todo: '待处理', doing: '进行中', done: '已完成' }[s] || s
}

export default function GrowthFeature() {
  const { feature } = useParams()
  const navigate = useNavigate()
  const { toast, openPaywall } = useApp()
  const f = FEATURES[feature]

  const [tasks, setTasks] = useState([])
  const [modal, setModal] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadTasks = useCallback(() => {
    api.getTasks({ kind: 'growth' }).then(setTasks).catch(() => setTasks([]))
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  const myTasks = useMemo(
    () => tasks.filter((t) => !f || t.title?.includes(f.title)),
    [tasks, f]
  )

  if (!f) {
    return (
      <section className="view">
        <div className="page-head">
          <div>
            <div className="eyebrow">AI GROWTH</div>
            <h1>该功能正在建设中</h1>
            <p>请从「AI 增长」进入需要的方向。</p>
          </div>
          <div className="head-actions">
            <button className="primary-btn" onClick={() => navigate('/growth')}>返回 AI 增长</button>
          </div>
        </div>
      </section>
    )
  }

  const avg = Math.round(f.items.reduce((a, b) => a + b.score, 0) / f.items.length)

  // 提交专业服务任务：落库到 /tasks?kind=growth，带子步骤便于后续推进
  const submit = async () => {
    setSubmitting(true)
    try {
      await api.createTask({
        kind: 'growth',
        title: `${f.title}服务任务`,
        detail: note.trim() || f.desc,
        owner: '平台专业团队',
        due_at: f.eta,
        steps: f.steps.map((s) => ({ label: s, done: false })),
      })
      setSubmitting(false)
      setModal(false)
      setNote('')
      toast(`已提交「${f.title}」任务，平台团队将在 ${f.eta} 内处理`)
      loadTasks()
    } catch (e) {
      setSubmitting(false)
      // 后端余额不足（402）→ 引导充值；其余错误直接提示
      if (e.status === 402) openPaywall('服务额度不足', '提交专业服务任务需要消耗 Credits，充值后即可继续。', 'credits.recharge')
      else toast(`提交失败：${e.message}`)
    }
  }

  const advance = async (t) => {
    const res = await api.advanceTask(t.id)
    const next = res?.task || res
    toast(next?.status === 'done' ? `「${t.title}」已完成` : `「${t.title}」进度已更新`)
    loadTasks()
  }

  return (
    <section className="view">
      <div className="page-head">
        <div>
          <div className="eyebrow">{f.eyebrow}</div>
          <h1>{f.title}</h1>
          <p>{f.desc}</p>
        </div>
        <div className="head-actions">
          <button className="ghost-btn" onClick={() => navigate('/growth')}>返回</button>
          <button className="primary-btn" onClick={() => setModal(true)}>{f.action}</button>
        </div>
      </div>

      <div className="feat-overview panel">
        <div className="big-score-ring">
          <b>{avg}</b>
          <span>当前评分</span>
        </div>
        <div className="feat-copy">
          <b>{avg >= 80 ? '整体表现良好' : avg >= 65 ? '有明确提升空间' : '建议优先处理'}</b>
          <p>下面 4 个维度是最直接影响采购决策的部分，其余技术细节由平台后台维护。</p>
        </div>
      </div>

      <div className="feat-list">
        {f.items.map((it) => (
          <div className="panel feat-row" key={it.name}>
            <div className="feat-row-top">
              <b>{it.name}</b>
              <span className={`seo-score ${it.score >= 80 ? 'high' : it.score >= 65 ? 'mid' : 'low'}`}>{it.score}</span>
            </div>
            <p>{it.hint}</p>
            <div className="feat-bar">
              <span style={{ width: `${it.score}%` }} className={it.score >= 80 ? 'high' : it.score >= 65 ? 'mid' : 'low'} />
            </div>
          </div>
        ))}
      </div>

      <div className="panel feat-tasks">
        <div className="feat-tasks-head">
          <div>
            <b>我的服务任务</b>
            <small>提交后由平台专业团队执行，进度实时同步</small>
          </div>
          <button className="ghost-btn" onClick={loadTasks}>刷新</button>
        </div>
        {!myTasks.length && <div className="usage-empty">暂无任务，点击右上角「{f.action}」提交。</div>}
        {myTasks.map((t) => (
          <div className="feat-task" key={t.id}>
            <div className="feat-task-top">
              <b>{t.title}</b>
              <span className={`task-status s-${t.status}`}>{statusLabel(t.status)}</span>
            </div>
            <div className="task-progress"><i style={{ width: `${t.progress || 0}%` }} /></div>
            <div className="feat-task-meta">
              <span>负责人：{t.owner || '平台专业团队'}</span>
              <span>预计：{t.due_at || f.eta}</span>
              <span>{t.progress || 0}%</span>
            </div>
            {!!(t.steps || []).length && (
              <ul className="task-steps">
                {t.steps.map((s, i) => (
                  <li key={i} className={s.done ? 'done' : ''}>{s.done ? '✓' : '○'} {s.label}</li>
                ))}
              </ul>
            )}
            <div className="feat-task-actions">
              <button className="row-btn" onClick={() => advance(t)}>
                {t.status === 'done' ? '重新执行' : '推进进度'}
              </button>
              <button
                className="row-btn danger"
                onClick={async () => { await api.deleteTask(t.id); toast('任务已取消'); loadTasks() }}
              >
                取消任务
              </button>
            </div>
          </div>
        ))}
      </div>

      <details className="advanced-detail">
        <summary>高级技术详情（默认隐藏）</summary>
        <div className="adv-grid">
          {['Canonical', 'Schema', 'robots', 'sitemap', 'llms.txt', 'Entity Graph'].map((k) => (
            <div className="adv-item" key={k}>
              <b>{k}</b>
              <span>由平台专业能力维护</span>
            </div>
          ))}
        </div>
      </details>

      <Modal open={modal} onClose={() => setModal(false)}>
        <div className="eyebrow">{f.eyebrow}</div>
        <h2>{f.action}</h2>
        <p>{f.desc}</p>
        <div className="skill-detail" style={{ margin: '16px 0' }}>
          <div><b>交付内容</b><span>{f.delivers}</span></div>
          <div><b>交付周期</b><span>{f.eta}</span></div>
          <div><b>执行方</b><span>平台专业团队（含至少 1 轮免费修改）</span></div>
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>补充说明（选填）</label>
          <textarea
            rows={3}
            placeholder="例如：重点优化储能系列产品，目标市场为德国与俄罗斯"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="onboard-actions">
          <button className="ghost-btn" onClick={() => setModal(false)}>取消</button>
          <button className="primary-btn" onClick={submit} disabled={submitting}>
            {submitting ? '提交中…' : '确认提交任务'}
          </button>
        </div>
      </Modal>
    </section>
  )
}
