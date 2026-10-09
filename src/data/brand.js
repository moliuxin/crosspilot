// 品牌配置：驱动「进入动效」「等待页」「独立站前台」的品牌识别。
// 关键约束：绝不写死平台自己的品牌色/Logo —— 优先用商家（客户）自己的配置。
//
// 商家配置优先级：
//   1. company.brand（商家上传的 Logo / 品牌色）—— 生成独立站、等待页默认用它
//   2. 平台兜底（CrossPilot）—— 仅当商家未提供时才使用

export const PLATFORM_BRAND = {
  name: 'CrossPilot',
  sub: 'SITEPILOT',
  logoText: 'C',
  primary: '#315efb',
  primary2: '#244bd1',
  dark: '#101828',
}

// 商家品牌：实际项目中来自 company.brand（商家后台「品牌设置」上传）
export const merchantBrand = {
  name: 'AQUAFLOW',
  sub: 'INDUSTRIAL',
  logoText: 'A',
  logoUrl: '', // 商家上传的 Logo；为空时回退到文字 Logo
  primary: '#0e7490', // 商家品牌主色（示例：工业青蓝，明显区别于平台蓝）
  primary2: '#155e75',
  dark: '#0b1f26',
}

// 根据行业推断品牌视觉方向（供独立站前台按行业自适应）
const INDUSTRY_VISUAL = {
  'industrial equipment': { ratio: '4:3', mood: '工业实景 / 设备主体突出', font: 'strong' },
  'water treatment': { ratio: '4:3', mood: '设备 + 工艺现场', font: 'strong' },
  default: { ratio: '16:10', mood: '大图留白', font: 'elegant' },
}

export function resolveIndustryVisual(industry) {
  return INDUSTRY_VISUAL[industry] || INDUSTRY_VISUAL.default
}

/**
 * 解析当前生效的品牌。
 * @param {{ brand?: object }} [company] 商家企业对象（含 brand 配置）
 * @param {'merchant'|'platform'} [fallback] 兜底策略：商家站用 merchant，平台后台用 platform
 */
export function resolveBrand(company, fallback = 'merchant') {
  const b = company?.brand
  if (b && (b.name || b.logoUrl || b.primary)) {
    return { ...PLATFORM_BRAND, ...b }
  }
  return fallback === 'merchant' ? merchantBrand : PLATFORM_BRAND
}

// 品牌首字母（无 Logo 图时用于文字 Logo）
export function brandInitial(brand) {
  return (brand?.logoText || brand?.name || 'C').trim().charAt(0).toUpperCase()
}
