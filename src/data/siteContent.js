// 独立站前台内容（面向采购商的编辑型内容，非后台数据）
// 结构遵循「上—中—下」：
//   上：品牌定位 + Hero + 核心卖点 + 信任背书
//   中：产品系列 + 核心产品 + 应用场景 + 技术/制造实力 + 案例
//   下：证书 / FAQ / 资料下载 / RFQ / 联系

export const siteNav = [
  { key: 'products', label: { 'en-US': 'Products', 'ru-RU': 'Продукция', 'zh-CN': '产品' } },
  { key: 'solutions', label: { 'en-US': 'Solutions', 'ru-RU': 'Решения', 'zh-CN': '解决方案' } },
  { key: 'capability', label: { 'en-US': 'Capability', 'ru-RU': 'Возможности', 'zh-CN': '制造实力' } },
  { key: 'cases', label: { 'en-US': 'Cases', 'ru-RU': 'Проекты', 'zh-CN': '项目案例' } },
  { key: 'resources', label: { 'en-US': 'Resources', 'ru-RU': 'Документы', 'zh-CN': '资料下载' } },
]

// 产品系列（大图优先，少边框）
export const siteSeries = [
  {
    id: 'ser_ro',
    name: { 'en-US': 'Reverse Osmosis Systems', 'ru-RU': 'Системы обратного осмоса', 'zh-CN': '反渗透系统' },
    lead: {
      'en-US': 'High-recovery RO for process water and reuse.',
      'ru-RU': 'Высокопроизводительный обратный осмос для технологической воды.',
      'zh-CN': '面向工艺用水与回用的高回收率反渗透系统。',
    },
    meta: { 'en-US': 'Up to 120 m³/h', 'ru-RU': 'до 120 м³/ч', 'zh-CN': '最大 120 m³/h' },
    tone: 'a',
  },
  {
    id: 'ser_uf',
    name: { 'en-US': 'Ultrafiltration', 'ru-RU': 'Ультрафильтрация', 'zh-CN': '超滤系统' },
    lead: {
      'en-US': 'Stable pretreatment with automated backwash.',
      'ru-RU': 'Стабильная предочистка с автоматической промывкой.',
      'zh-CN': '自动反洗、稳定可靠的前处理系统。',
    },
    meta: { 'en-US': 'Up to 60 m³/h', 'ru-RU': 'до 60 м³/ч', 'zh-CN': '最大 60 m³/h' },
    tone: 'b',
  },
  {
    id: 'ser_ds',
    name: { 'en-US': 'Dosing Systems', 'ru-RU': 'Системы дозирования', 'zh-CN': '加药系统' },
    lead: {
      'en-US': 'Precise, PLC-controlled chemical dosing.',
      'ru-RU': 'Точное дозирование под управлением ПЛК.',
      'zh-CN': 'PLC 控制、精准稳定的加药系统。',
    },
    meta: { 'en-US': '320 L/h', 'ru-RU': '320 л/ч', 'zh-CN': '320 L/h' },
    tone: 'c',
  },
]

// 应用场景（图片优先，文案克制）
export const siteApplications = [
  {
    id: 'app_1',
    title: { 'en-US': 'Industrial Process Water', 'ru-RU': 'Технологическая вода', 'zh-CN': '工业工艺用水' },
    desc: {
      'en-US': 'Consistent water quality for continuous production.',
      'ru-RU': 'Стабильное качество воды для непрерывного производства.',
      'zh-CN': '为连续生产提供稳定的水质保障。',
    },
  },
  {
    id: 'app_2',
    title: { 'en-US': 'Water Reuse', 'ru-RU': 'Повторное использование', 'zh-CN': '中水回用' },
    desc: {
      'en-US': 'Reduce discharge and recover valuable process water.',
      'ru-RU': 'Снижение сброса и возврат воды в производство.',
      'zh-CN': '降低排放，回收可用水资源。',
    },
  },
  {
    id: 'app_3',
    title: { 'en-US': 'Remote & Cold Climate', 'ru-RU': 'Удалённые объекты', 'zh-CN': '偏远与严寒地区' },
    desc: {
      'en-US': 'Containerized plants engineered for −40 °C operation.',
      'ru-RU': 'Контейнерные станции для работы при −40 °C.',
      'zh-CN': '集装箱式设计，可在 −40 °C 环境运行。',
    },
  },
]

// 制造与工程能力
export const siteCapability = {
  title: { 'en-US': 'From Engineering to Commissioning', 'ru-RU': 'От проектирования до пусконаладки', 'zh-CN': '从工程设计到现场调试' },
  desc: {
    'en-US': 'In-house design, manufacturing and testing. Every system is documented, traceable and supported through its full lifecycle.',
    'ru-RU': 'Собственное проектирование, производство и испытания. Полная документация и поддержка на всём сроке службы.',
    'zh-CN': '自主设计、制造与测试。每套系统全程可追溯、可验厂，并提供全生命周期支持。',
  },
  stats: [
    { value: '28+', label: { 'en-US': 'Countries served', 'ru-RU': 'Стран поставки', 'zh-CN': '服务国家' } },
    { value: '420+', label: { 'en-US': 'Projects delivered', 'ru-RU': 'Реализованных проектов', 'zh-CN': '交付项目' } },
    { value: '15', label: { 'en-US': 'Years engineering', 'ru-RU': 'Лет опыта', 'zh-CN': '年工程经验' } },
    { value: '24/7', label: { 'en-US': 'Technical support', 'ru-RU': 'Техподдержка', 'zh-CN': '技术支持' } },
  ],
}

// 项目案例
export const siteCases = [
  {
    id: 'case_1',
    sector: { 'en-US': 'Mining · Chile', 'ru-RU': 'Горная отрасль · Чили', 'zh-CN': '矿业 · 智利' },
    title: { 'en-US': 'RO plant for a high-altitude mine', 'ru-RU': 'Система RO для рудника в высокогорье', 'zh-CN': '高海拔矿区反渗透系统' },
    result: { 'en-US': '120 m³/h · 99.2% uptime', 'ru-RU': '120 м³/ч · 99,2% доступности', 'zh-CN': '120 m³/h · 99.2% 可用率' },
  },
  {
    id: 'case_2',
    sector: { 'en-US': 'Food & Beverage · Russia', 'ru-RU': 'Пищевая промышленность · Россия', 'zh-CN': '食品饮料 · 俄罗斯' },
    title: { 'en-US': 'Process water reuse line', 'ru-RU': 'Линия повторного использования воды', 'zh-CN': '工艺水回用产线' },
    result: { 'en-US': '40% discharge reduction', 'ru-RU': '−40% сброса', 'zh-CN': '排放降低 40%' },
  },
  {
    id: 'case_3',
    sector: { 'en-US': 'Petrochemical · Central Asia', 'ru-RU': 'Нефтехимия · Центральная Азия', 'zh-CN': '石化 · 中亚' },
    title: { 'en-US': 'Containerized treatment plant', 'ru-RU': 'Контейнерная станция водоподготовки', 'zh-CN': '集装箱式处理站' },
    result: { 'en-US': 'Deployed in 8 weeks', 'ru-RU': 'Развёрнута за 8 недель', 'zh-CN': '8 周完成部署' },
  },
]

// 证书 / 资料 / 联系
export const siteCertificates = ['ISO 9001', 'ISO 14001', 'CE', 'EAC', 'ГОСТ']

export const siteResources = [
  { id: 'res_1', name: { 'en-US': 'Product Catalogue (PDF)', 'ru-RU': 'Каталог продукции (PDF)', 'zh-CN': '产品目录（PDF）' }, size: '12.4 MB' },
  { id: 'res_2', name: { 'en-US': 'Technical Datasheet', 'ru-RU': 'Технические характеристики', 'zh-CN': '技术参数表' }, size: '3.1 MB' },
  { id: 'res_3', name: { 'en-US': 'Case Study Collection', 'ru-RU': 'Сборник проектов', 'zh-CN': '项目案例集' }, size: '8.7 MB' },
]

export const siteContact = {
  email: 'sales@aquaflow-global.com',
  phone: '+86 400 000 0000',
  // WhatsApp 商务直线（外贸客户首选沟通渠道；wa.me 链接需纯数字）
  whatsapp: '+86 138 0000 0000',
  address: {
    'en-US': 'No.88 Industrial Park, Ningbo, China',
    'ru-RU': 'Промышленный парк №88, Нинбо, Китай',
    'zh-CN': '中国宁波市工业园区 88 号',
  },
  hours: {
    'en-US': 'Mon–Sat · 08:30–18:00 (GMT+8)',
    'ru-RU': 'Пн–Сб · 08:30–18:00 (GMT+8)',
    'zh-CN': '周一至周六 · 08:30–18:00',
  },
}

// 多语言 UI 文案
export const siteUI = {
  'en-US': {
    waTip: 'Chat on WhatsApp',
    rfqTitle: 'Get a quotation',
    rfqLead: 'Send your process conditions — capacity, inlet water quality, target output — and our engineers reply within 12 hours.',
    name: 'Your name',
    company: 'Company',
    email: 'Business email',
    message: 'Your requirements',
    submit: 'Send inquiry',
    sending: 'Sending…',
    required: 'This field is required',
    emailInvalid: 'Please enter a valid business email',
    rfqDone: 'Inquiry sent successfully',
    rfqDoneLead: 'Our engineer will reply within 12 hours. You can also check your inbox for confirmation.',
    download: 'Download',
    learnMore: 'Learn more',
    viewAll: 'View all',
    scroll: 'Scroll to explore',
    applied: 'Applications',
    capability: 'Capability',
    cases: 'Selected projects',
    resources: 'Resources',
    contact: 'Contact',
    faq: 'Frequently asked',
  },
  'ru-RU': {
    waTip: 'Написать в WhatsApp',
    rfqTitle: 'Получить расчёт',
    rfqLead: 'Опишите условия: расход, качество исходной воды, требуемые параметры — инженер ответит в течение 12 часов.',
    name: 'Ваше имя',
    company: 'Компания',
    email: 'Рабочий e-mail',
    message: 'Ваша задача',
    submit: 'Отправить запрос',
    sending: 'Отправка…',
    required: 'Обязательное поле',
    emailInvalid: 'Укажите корректный рабочий e-mail',
    rfqDone: 'Запрос отправлен',
    rfqDoneLead: 'Инженер ответит в течение 12 часов. Подтверждение также придёт на e-mail.',
    download: 'Скачать',
    learnMore: 'Подробнее',
    viewAll: 'Смотреть все',
    scroll: 'Прокрутите вниз',
    applied: 'Применение',
    capability: 'Возможности',
    cases: 'Проекты',
    resources: 'Документы',
    contact: 'Контакты',
    faq: 'Частые вопросы',
  },
  'zh-CN': {
    waTip: 'WhatsApp 咨询',
    rfqTitle: '获取项目报价',
    rfqLead: '填写处理水量、原水水质与目标指标，方案工程师将在 12 小时内提供选型与报价。',
    name: '您的姓名',
    company: '公司名称',
    email: '企业邮箱',
    message: '您的需求',
    submit: '提交询价',
    sending: '提交中…',
    required: '该项为必填项',
    emailInvalid: '请填写有效的企业邮箱',
    rfqDone: '询价已提交成功',
    rfqDoneLead: '方案工程师将在 12 小时内回复您的邮箱，请留意查收。',
    download: '下载',
    learnMore: '了解更多',
    viewAll: '查看全部',
    scroll: '向下滚动',
    applied: '应用领域',
    capability: '制造实力',
    cases: '项目案例',
    resources: '资料下载',
    contact: '联系我们',
    faq: '常见问题',
  },
}
