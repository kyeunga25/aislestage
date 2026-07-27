import { ArrowRight, Check, FileCheck2, Image as ImageIcon, Layers3, LockKeyhole, Menu, ShieldCheck, Sparkles, Upload, UserCheck, X } from 'lucide-react'
import { useState } from 'react'
import campaignScene from '../assets/campaign-speaker-scene.png'
import demoSpeaker from '../assets/demo-speaker.png'
import { BrandMark } from './BrandMark'

type Locale = 'zh-Hant' | 'en'

const copy = {
  'zh-Hant': {
    navProduct: '產品', navFlow: '流程', navSecurity: '私隱與安全', login: '登入工作區',
    eyebrow: '由商品原圖到整套推廣素材', title: <>一張商品圖，<br />完成整套 <span>Campaign Pack</span></>,
    intro: 'AisleStage 先整理已核准的商品資料，讓 Agent 規劃三個常用比例；你確認後，系統才會建立可直接使用的素材與雙語文案。',
    how: '看看運作方式', trust: ['受邀測試', '私人素材', '可重複輸出'],
    source: '商品原圖', approved: '計劃已批准', create: '建立素材',
    proof: [
      ['原圖作為來源', '不重新繪製已上傳商品'],
      ['準確商業文字', '價格、優惠與 CTA 確定性排版'],
      ['先批准後建立', 'Agent 不會跳過人工確認'],
      ['三個常用比例', '1:1、4:5、9:16 一次到位']
    ],
    flowEyebrow: '清楚、可控的工作流程', flowTitle: '三步，從已核准資料到 Campaign Pack',
    steps: [
      ['01', '提交已核准資料', '輸入品牌、商品、價格、優惠與雙語文案，再上傳有權使用的商品原圖。'],
      ['02', 'Agent 規劃', '系統檢查資料完整度，安排 1:1、4:5、9:16 輸出及文案，不自行新增宣稱。'],
      ['03', '批准並建立', '你先核對計劃；只有批准後，系統才建立同一套 Campaign Pack。']
    ],
    featureEyebrow: '為實際電商渠道而設', featureTitle: <>一次批准，<br />整套素材同步完成</>,
    featureBody: '同一張商品原圖與同一份商業資料，整理成比例一致、內容準確的素材包。每個輸出仍可獨立預覽、下載與管理。',
    featurePoints: ['同一商品來源與已核准資料', '繁中／英文文案一起整理', '三個比例保持一致', '冪等建立，避免重複扣減'],
    securityEyebrow: '私隱與安全，設計在每一步', securityBody: '公開主頁與私人工作區分開。登入由 Cloudflare Access 驗證，Worker 再核對簽章與 D1 成員關係；圖片與輸出只經授權路徑讀取。',
    securityItems: [
      ['Cloudflare Access', '先在邊緣驗證身份'],
      ['已驗證身份', 'Worker 再驗 JWT 簽章'],
      ['工作區授權', 'D1 成員關係限制範圍'],
      ['私人素材', 'R2 物件不公開直連'],
      ['可靠計量', 'Queue 與用量操作保持冪等']
    ],
    ctaTitle: '準備好整理下一個 Campaign？', ctaBody: '登入受邀工作區，從已核准的商品原圖與資料開始。',
    footerLine: 'AisleStage · AI 電商素材工作台', footerSecurity: '私隱與安全', footerFlow: '運作方式'
  },
  en: {
    navProduct: 'Product', navFlow: 'How it works', navSecurity: 'Privacy & security', login: 'Sign in to workspace',
    eyebrow: 'From one approved product image to a complete campaign set', title: <>One product image.<br />One coordinated <span>Campaign Pack.</span></>,
    intro: 'AisleStage organises approved product facts, lets the Agent plan three practical ratios, and creates bilingual assets only after you approve the plan.',
    how: 'See how it works', trust: ['Invite-only beta', 'Private assets', 'Repeatable output'],
    source: 'Source image', approved: 'Plan approved', create: 'Create assets',
    proof: [
      ['Source-image fidelity', 'Your uploaded product remains the source'],
      ['Exact commercial text', 'Price, offer and CTA are laid out deterministically'],
      ['Approval before creation', 'The Agent cannot skip your review'],
      ['Three practical ratios', '1:1, 4:5 and 9:16 in one pack']
    ],
    flowEyebrow: 'A clear, controlled workflow', flowTitle: 'Three steps from approved facts to Campaign Pack',
    steps: [
      ['01', 'Submit approved facts', 'Add brand, product, price, offer and bilingual copy, then upload an image you are allowed to use.'],
      ['02', 'Agent plans', 'The system checks completeness and plans 1:1, 4:5 and 9:16 outputs without inventing claims.'],
      ['03', 'Approve and create', 'Review the plan first. The system creates the coordinated pack only after approval.']
    ],
    featureEyebrow: 'Built for real commerce channels', featureTitle: <>Approve once.<br />Keep every asset aligned.</>,
    featureBody: 'One source image and one approved commercial brief become a consistent set. Every output can still be previewed, downloaded and managed separately.',
    featurePoints: ['One source and one approved brief', 'Traditional Chinese and English copy', 'Three ratios kept consistent', 'Idempotent creation prevents double charging'],
    securityEyebrow: 'Privacy and security at every step', securityBody: 'The public site and private workspace are separate. Cloudflare Access verifies identity at the edge, the Worker validates the signed JWT and D1 membership, and private files are served only through authorised routes.',
    securityItems: [
      ['Cloudflare Access', 'Identity checked at the edge'],
      ['Verified identity', 'Worker validates the JWT signature'],
      ['Workspace membership', 'D1 keeps access scoped'],
      ['Private assets', 'No public R2 object links'],
      ['Reliable accounting', 'Queue and usage operations stay idempotent']
    ],
    ctaTitle: 'Ready to organise your next campaign?', ctaBody: 'Sign in to an invited workspace and begin with approved product facts and imagery.',
    footerLine: 'AisleStage · Ecommerce campaign asset workspace', footerSecurity: 'Privacy & security', footerFlow: 'How it works'
  }
} as const

const proofIcons = [ImageIcon, FileCheck2, ShieldCheck, Layers3]
const stepIcons = [Upload, Sparkles, Check]
const securityIcons = [ShieldCheck, UserCheck, LockKeyhole, ImageIcon, FileCheck2]

export function LandingPage() {
  const [locale, setLocale] = useState<Locale>('zh-Hant')
  const [menuOpen, setMenuOpen] = useState(false)
  const t = copy[locale]

  function closeMenu() {
    setMenuOpen(false)
  }

  return <div className="landing-page">
    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="AisleStage">
        <BrandMark /><span><strong>AisleStage</strong><small>{locale === 'zh-Hant' ? 'AI 電商素材工作台' : 'Campaign asset workspace'}</small></span>
      </a>
      <button className="landing-menu-button" type="button" aria-expanded={menuOpen} aria-controls="landing-nav" onClick={() => setMenuOpen((current) => !current)}>
        {menuOpen ? <X size={22} /> : <Menu size={22} />}<span className="visually-hidden">Menu</span>
      </button>
      <div className={`landing-nav-wrap${menuOpen ? ' open' : ''}`} id="landing-nav">
        <nav className="landing-nav" aria-label="Public navigation">
          <a href="#product" onClick={closeMenu}>{t.navProduct}</a>
          <a href="#workflow" onClick={closeMenu}>{t.navFlow}</a>
          <a href="#security" onClick={closeMenu}>{t.navSecurity}</a>
        </nav>
        <button className="locale-switch" type="button" onClick={() => setLocale((current) => current === 'zh-Hant' ? 'en' : 'zh-Hant')} aria-label={locale === 'zh-Hant' ? 'Switch to English' : '切換至繁體中文'}>
          {locale === 'zh-Hant' ? '繁中 / EN' : 'EN / 繁中'}
        </button>
        <a className="landing-login compact" href="/app">{t.login}<ArrowRight size={15} /></a>
      </div>
    </header>

    <main id="top">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-copy">
          <p className="landing-eyebrow">{t.eyebrow}</p>
          <h1 id="landing-title">{t.title}</h1>
          <p className="hero-intro">{t.intro}</p>
          <div className="hero-actions">
            <a className="landing-login" href="/app">{t.login}<ArrowRight size={17} /></a>
            <a className="landing-secondary" href="#workflow">{t.how}</a>
          </div>
          <ul className="hero-trust" aria-label="Product access summary">
            {t.trust.map((item) => <li key={item}><Check size={15} />{item}</li>)}
          </ul>
        </div>

        <div className="hero-workspace" aria-label="Campaign Pack product preview">
          <div className="workspace-preview-bar">
            <span><BrandMark /><strong>AisleStage</strong></span>
            <span>{t.approved}</span>
          </div>
          <div className="workspace-preview-body">
            <div className="source-preview">
              <span>{t.source}</span>
              <img src={demoSpeaker} alt={locale === 'zh-Hant' ? '黑色便攜式揚聲器示例商品原圖' : 'Example source image of a black portable speaker'} />
              <small>AisleBeat S1 · HK$399</small>
            </div>
            <ArrowRight className="preview-flow-arrow" size={21} aria-hidden="true" />
            <div className="campaign-preview-grid">
              {(['1:1', '4:5', '9:16'] as const).map((ratio) => <article className={`campaign-mini ratio-${ratio.replace(':', '-')}`} key={ratio}>
                <span>{ratio}</span>
                <div><img src={campaignScene} alt="" /><div className="campaign-mini-copy"><strong>{locale === 'zh-Hant' ? '隨身好聲音' : 'Sound that travels'}</strong><b>HK$399</b><small>{locale === 'zh-Hant' ? '立即選購' : 'Shop now'}</small></div></div>
              </article>)}
            </div>
          </div>
          <div className="workspace-preview-footer"><span><Check size={15} />{t.approved}</span><strong>{t.create}<ArrowRight size={14} /></strong></div>
        </div>
      </section>

      <section className="proof-strip" id="product" aria-label="Product principles">
        {t.proof.map(([title, body], index) => {
          const Icon = proofIcons[index]
          return <article key={title}><Icon size={23} /><div><strong>{title}</strong><span>{body}</span></div></article>
        })}
      </section>

      <section className="workflow-section" id="workflow" aria-labelledby="workflow-title">
        <div className="section-intro">
          <p className="landing-eyebrow">{t.flowEyebrow}</p>
          <h2 id="workflow-title">{t.flowTitle}</h2>
        </div>
        <div className="workflow-grid">
          {t.steps.map(([number, title, body], index) => {
            const Icon = stepIcons[index]
            return <article key={number}><span className="step-number">{number}</span><div className="step-icon"><Icon size={28} /></div><h3>{title}</h3><p>{body}</p>{index < 2 ? <ArrowRight className="step-arrow" size={24} aria-hidden="true" /> : null}</article>
          })}
        </div>
      </section>

      <section className="feature-section" aria-labelledby="feature-title">
        <div className="feature-copy">
          <p className="landing-eyebrow">{t.featureEyebrow}</p>
          <h2 id="feature-title">{t.featureTitle}</h2>
          <p>{t.featureBody}</p>
          <ul>{t.featurePoints.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul>
        </div>
        <div className="feature-pack" aria-label="Three format Campaign Pack example">
          <div className="feature-pack-head"><span>Campaign Pack · AisleBeat S1</span><strong><Check size={14} />{t.approved}</strong></div>
          <div className="feature-pack-grid">
            {(['1:1', '4:5', '9:16'] as const).map((ratio) => <article key={ratio}><span>{ratio}</span><div className={`feature-art feature-${ratio.replace(':', '-')}`}><img src={campaignScene} alt="" /><div><small>AisleBeat S1</small><strong>{locale === 'zh-Hant' ? '隨身好聲音' : 'Sound that travels'}</strong><b>HK$399</b></div></div></article>)}
          </div>
        </div>
      </section>

      <section className="security-section" id="security" aria-labelledby="security-title">
        <div className="security-copy">
          <p className="landing-eyebrow">{t.securityEyebrow}</p>
          <h2 id="security-title">{locale === 'zh-Hant' ? '只有獲授權成員，才可接觸工作區資料。' : 'Only authorised members can reach workspace data.'}</h2>
          <p>{t.securityBody}</p>
        </div>
        <div className="security-flow">
          {t.securityItems.map(([title, body], index) => {
            const Icon = securityIcons[index]
            return <article key={title}><span><Icon size={23} /></span><strong>{title}</strong><small>{body}</small>{index < t.securityItems.length - 1 ? <ArrowRight className="security-arrow" size={18} aria-hidden="true" /> : null}</article>
          })}
        </div>
      </section>

      <section className="landing-cta" aria-labelledby="cta-title">
        <div><p className="landing-eyebrow">AisleStage</p><h2 id="cta-title">{t.ctaTitle}</h2><p>{t.ctaBody}</p></div>
        <a className="landing-login" href="/app">{t.login}<ArrowRight size={17} /></a>
      </section>
    </main>

    <footer className="landing-footer">
      <a className="landing-brand" href="#top"><BrandMark /><span><strong>AisleStage</strong><small>{t.footerLine}</small></span></a>
      <nav aria-label="Footer navigation"><a href="#workflow">{t.footerFlow}</a><a href="#security">{t.footerSecurity}</a><button type="button" onClick={() => setLocale((current) => current === 'zh-Hant' ? 'en' : 'zh-Hant')}>{locale === 'zh-Hant' ? 'English' : '繁體中文'}</button></nav>
    </footer>
  </div>
}
