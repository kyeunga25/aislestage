import { ArrowRight, Check, FileCheck2, Image as ImageIcon, Layers3, LockKeyhole, Menu, ShieldCheck, Sparkles, Upload, UserCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import workspaceAgent from '../assets/workspace-agent.png'
import workspaceBrief from '../assets/workspace-brief.png'
import workspaceOverview from '../assets/workspace-overview.jpg'
import workspaceResults from '../assets/workspace-results.png'
import { BrandMark } from './BrandMark'

type Locale = 'zh-Hant' | 'en'

const copy = {
  'zh-Hant': {
    navProduct: '產品', navCases: '使用情境', navFlow: '流程', navCollaboration: '合作方式', navSecurity: '私隱與安全', login: '受邀成員登入',
    eyebrow: '由商品原圖到整套推廣素材', title: <>一張商品圖，<br />完成整套 <span>Campaign Pack</span></>,
    intro: '如果你要為同一件商品準備網店主圖、社交廣告與限時動態，AisleStage 會把已核實的商品資料、私人原圖和雙語文案集中在一個批准流程。價格、優惠及 CTA 不必在不同版型重複輸入。',
    primary: '了解合作方式', how: '看看運作方式', trust: ['邀請制合作', '私人素材', '可重複輸出'],
    planStatus: '等待批准',
    proof: [
      ['原圖作為來源', '不重新繪製已上傳商品'],
      ['準確商業文字', '價格、優惠與 CTA 確定性排版'],
      ['先批准後建立', 'Agent 不會跳過人工確認'],
      ['三個常用比例', '1:1、4:5、9:16 一次到位']
    ],
    workspaceEyebrow: '實際工作區',
    workspaceTitle: '三個實際畫面，看清楚 app 怎樣運作',
    workspaceBody: '以下全部取自目前本機互動 demo。從已核實的商業資料、私人商品原圖，到 Agent 提交計劃及三比例素材預覽，每一步都在同一個可追溯的批准流程內完成。',
    workspaceSteps: [
      ['01 · 輸入', '把商業資料與商品原圖放在一起', '只輸入會真正出現在素材上的商品名、價格、優惠、最多三項賣點、品牌語氣及 CTA；原圖則保留在獲授權的工作區路徑。'],
      ['02 · 批准', 'Agent 先檢查，再停下來等你批准', 'Campaign Agent 核對資料、商品圖片及文字安全區，列出 1:1、4:5、9:16 三個固定輸出。你未批准前，它不會建立素材或代為發佈。'],
      ['03 · 預覽', '同一處預覽三比例素材與雙語文案', '批准後可同時檢視商品主圖、社交廣告及限時動態，旁邊保留繁中／英文文案。每個輸出可獨立下載及管理，不會自動發佈。']
    ],
    workspaceCaption: '資料已完成檢查，Campaign Agent 正等待使用者批准三個輸出。',
    actualInterface: '實際介面',
    casesEyebrow: '貼近日常電商工作',
    casesTitle: '不是自由 prompt 工具，而是三個常見的實際任務',
    casesBody: '每個情境都由同一個原則開始：只使用已核實資料與有權使用的圖片，先讓人核對，再建立整套素材。',
    caseLabels: ['你面對的情況', '在工作區處理', '最後得到'],
    cases: [
      ['新品上架', '商品已拍好，也有經核實的名稱、賣點與價格，但商品頁、社交 feed 和 story 仍要分開排版。', '輸入一次商業資料，選擇「新品推廣」，讓 Agent 規劃三個固定比例；你核對版型及文字後才批准。', '一套協調的商品主圖、社交廣告、限時動態，以及可複製的繁中和英文文案。'],
      ['限時優惠更新', '活動價、免運或截止日期要同步到多個版型，最怕其中一張仍沿用舊資料。', '在同一份 brief 更新價格、優惠與 CTA。修改後舊計劃立即失效，必須重新規劃和批准。', '三個輸出都以目前批准的 revision 為準，價格、優惠與 CTA 由程式準確排版。'],
      ['日常／節日 Campaign', '同一商品要持續出現在不同渠道，但商品外觀、品牌語氣和已核實賣點不能走樣。', '沿用同一張私人商品圖與品牌資料，按「日常銷售」或「節日活動」建立獨立 Campaign Pack。', '每套素材可獨立預覽、下載和管理；商品原圖不需要公開，Agent 也不會代為發佈。']
    ],
    flowEyebrow: '清楚、可控的工作流程', flowTitle: '三步，從已核准資料到 Campaign Pack',
    steps: [
      ['01', '提交已核准資料', '輸入品牌、商品、價格、優惠、最多三項賣點與繁中／英文 CTA，再上傳有權使用的 PNG、JPEG 或 WebP 商品原圖。'],
      ['02', 'Agent 規劃', '系統檢查商業資料、來源圖及文字安全區，安排 1080 × 1080、1080 × 1350、1080 × 1920 三個輸出，不自行新增宣稱。'],
      ['03', '批准並建立', '你先核對目前 revision；修改任何資料都要重新規劃。只有批准後，系統才一次建立整套 Campaign Pack。']
    ],
    collaborationEyebrow: 'Contact-first · Invite-only',
    collaborationTitle: '先確認工作方式與適用範圍，再開設私人工作區',
    collaborationBody: 'AisleStage 現階段不提供公開註冊、即時生成或 checkout。合作從一份不含私人素材的簡介開始，雙方確認範圍、資料處理及交付方式後，才由受控 Access policy 邀請成員。',
    collaborationSteps: [
      ['01', '提供非敏感簡介', '透過既有直接聯絡渠道說明商品類型、需要的三比例素材、語言及圖片使用權狀態；公開網站不收集商業 brief 或商品原圖。'],
      ['02', '確認適用性與邊界', '核對 Campaign Pack 是否適合、哪些資料已獲核實，以及私隱、人工批准、輸出數量與 deterministic fallback。'],
      ['03', '建立受邀工作區', '確認後才建立 active membership。Cloudflare Access 驗證身份，Worker 再核對 D1 membership；沒有公開帳戶或自助付款捷徑。']
    ],
    collaborationNote: '已有邀請？可直接登入私人工作區。尚未獲邀者不會在公開頁面輸入產品資料、圖片或付款資料。',
    featurePoints: ['1:1 · 1080 × 1080 商品主圖', '4:5 · 1080 × 1350 社交廣告', '9:16 · 1080 × 1920 限時動態', '附可複製的繁中／英文文案'],
    securityEyebrow: '私隱與安全，設計在每一步', securityBody: '公開主頁與私人工作區分開。登入由 Cloudflare Access 驗證，Worker 再核對簽章與 D1 成員關係；圖片與輸出只經授權路徑讀取。',
    securityItems: [
      ['Cloudflare Access', '先在邊緣驗證身份'],
      ['已驗證身份', 'Worker 再驗 JWT 簽章'],
      ['工作區授權', 'D1 成員關係限制範圍'],
      ['私人素材', 'R2 物件不公開直連'],
      ['可靠計量', 'Queue 與用量操作保持冪等']
    ],
    ctaTitle: '已確認合作範圍？', ctaBody: '受邀成員可進入私人工作區，從已核准的商品原圖與資料開始。',
    footerLine: 'AisleStage · AI 電商素材工作台', footerSecurity: '私隱與安全', footerFlow: '運作方式'
  },
  en: {
    navProduct: 'Product', navCases: 'Use cases', navFlow: 'How it works', navCollaboration: 'Working together', navSecurity: 'Privacy & security', login: 'Invited member sign-in',
    eyebrow: 'From one approved product image to a complete campaign set', title: <>One product image.<br />One coordinated <span>Campaign Pack.</span></>,
    intro: 'When one product needs a storefront visual, a social ad and a story, AisleStage keeps verified facts, the private source image and bilingual copy inside one approval flow. Price, offer and CTA do not need to be re-entered for every format.',
    primary: 'How collaboration starts', how: 'See how it works', trust: ['Invite-only engagement', 'Private assets', 'Repeatable output'],
    planStatus: 'Awaiting approval',
    proof: [
      ['Source-image fidelity', 'Your uploaded product remains the source'],
      ['Exact commercial text', 'Price, offer and CTA are laid out deterministically'],
      ['Approval before creation', 'The Agent cannot skip your review'],
      ['Three practical ratios', '1:1, 4:5 and 9:16 in one pack']
    ],
    workspaceEyebrow: 'The real workspace',
    workspaceTitle: 'Three real screens show how the app works',
    workspaceBody: 'Every view below comes from the current local interactive demo. Verified commercial facts, the private product source, the Agent plan and the three-ratio preview all stay inside one traceable approval flow.',
    workspaceSteps: [
      ['01 · Input', 'Keep commercial facts and source imagery together', 'Enter only the product name, price, offer, up to three benefits, brand tone and CTAs that may appear in the assets. The source stays behind authorised workspace routes.'],
      ['02 · Approve', 'The Agent checks first, then waits for you', 'Campaign Agent checks the brief, source image and text-safe areas before proposing 1:1, 4:5 and 9:16 outputs. It cannot create assets or publish before your approval.'],
      ['03 · Preview', 'Review three ratios and bilingual copy together', 'After approval, compare the product visual, social ad and story beside Traditional Chinese and English copy. Each output can be downloaded and managed separately; nothing is auto-published.']
    ],
    workspaceCaption: 'The brief has passed its checks and the Campaign Agent is waiting for approval of all three outputs.',
    actualInterface: 'Actual interface',
    casesEyebrow: 'Built around everyday commerce work',
    casesTitle: 'Not a free-prompt tool: three practical jobs',
    casesBody: 'Every scenario starts with the same rule: use only verified facts and entitled imagery, keep a person in the review loop, then create the coordinated set.',
    caseLabels: ['The situation', 'Inside the workspace', 'What you receive'],
    cases: [
      ['New product launch', 'The product is photographed and its name, benefits and price are verified, but the storefront, feed and story still need separate layouts.', 'Enter the commercial brief once, choose “New product”, and let the Agent plan the three fixed ratios. Approve only after checking layout and text.', 'A coordinated product visual, social ad and story, with copyable Traditional Chinese and English captions.'],
      ['Limited-time offer update', 'A campaign price, delivery offer or deadline must stay aligned across formats, without one asset retaining old information.', 'Update price, offer and CTA in the same brief. The old plan is invalidated immediately and must be planned and approved again.', 'All three outputs use the currently approved revision, with price, offer and CTA laid out deterministically.'],
      ['Always-on or seasonal campaign', 'One product appears across channels over time, while product appearance, brand tone and verified benefits must remain consistent.', 'Reuse the same private source and brand facts, then create a separate pack for an always-on or seasonal campaign intent.', 'Each pack can be previewed, downloaded and managed independently. The source stays private and the Agent does not publish for you.']
    ],
    flowEyebrow: 'A clear, controlled workflow', flowTitle: 'Three steps from approved facts to Campaign Pack',
    steps: [
      ['01', 'Submit approved facts', 'Add brand, product, price, offer, up to three benefits and Traditional Chinese and English CTAs, then upload an entitled PNG, JPEG or WebP source.'],
      ['02', 'Agent plans', 'The system checks the commercial facts, source and text-safe areas, then plans 1080 × 1080, 1080 × 1350 and 1080 × 1920 outputs without inventing claims.'],
      ['03', 'Approve and create', 'Review the current revision first. Editing any fact requires a new plan; only an approved revision can create the full Campaign Pack.']
    ],
    collaborationEyebrow: 'Contact-first · Invite-only',
    collaborationTitle: 'Confirm the fit and operating boundaries before opening a private workspace',
    collaborationBody: 'AisleStage does not currently offer public registration, instant generation or checkout. An engagement begins with a non-sensitive introduction. Scope, data handling and delivery are confirmed before members are invited through a controlled Access policy.',
    collaborationSteps: [
      ['01', 'Share a non-sensitive introduction', 'Use an existing direct contact channel to outline the product category, required three-ratio assets, languages and image-rights status. The public site does not collect the commercial brief or source image.'],
      ['02', 'Confirm fit and boundaries', 'Review whether Campaign Pack fits the job, which facts are verified, and the privacy, human approval, output allowance and deterministic fallback boundaries.'],
      ['03', 'Open an invited workspace', 'Only then is an active membership created. Cloudflare Access verifies identity and the Worker checks D1 membership; there is no public account or self-service payment shortcut.']
    ],
    collaborationNote: 'Already invited? Sign in to the private workspace. Visitors without an invitation do not enter product data, imagery or payment details on the public site.',
    featurePoints: ['1:1 · 1080 × 1080 product visual', '4:5 · 1080 × 1350 social ad', '9:16 · 1080 × 1920 story', 'Copyable Traditional Chinese and English captions'],
    securityEyebrow: 'Privacy and security at every step', securityBody: 'The public site and private workspace are separate. Cloudflare Access verifies identity at the edge, the Worker validates the signed JWT and D1 membership, and private files are served only through authorised routes.',
    securityItems: [
      ['Cloudflare Access', 'Identity checked at the edge'],
      ['Verified identity', 'Worker validates the JWT signature'],
      ['Workspace membership', 'D1 keeps access scoped'],
      ['Private assets', 'No public R2 object links'],
      ['Reliable accounting', 'Queue and usage operations stay idempotent']
    ],
    ctaTitle: 'Scope confirmed?', ctaBody: 'Invited members can enter the private workspace and begin with approved product facts and imagery.',
    footerLine: 'AisleStage · Ecommerce campaign asset workspace', footerSecurity: 'Privacy & security', footerFlow: 'How it works'
  }
} as const

const proofIcons = [ImageIcon, FileCheck2, ShieldCheck, Layers3]
const stepIcons = [Upload, Sparkles, Check]
const collaborationIcons = [FileCheck2, UserCheck, LockKeyhole]
const securityIcons = [ShieldCheck, UserCheck, LockKeyhole, ImageIcon, FileCheck2]

export function LandingPage() {
  const [locale, setLocale] = useState<Locale>('zh-Hant')
  const [menuOpen, setMenuOpen] = useState(false)
  const t = copy[locale]

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

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
          <a href="#use-cases" onClick={closeMenu}>{t.navCases}</a>
          <a href="#workflow" onClick={closeMenu}>{t.navFlow}</a>
          <a href="#collaboration" onClick={closeMenu}>{t.navCollaboration}</a>
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
            <a className="landing-login" href="#collaboration">{t.primary}<ArrowRight size={17} /></a>
            <a className="landing-secondary" href="#workflow">{t.how}</a>
          </div>
          <ul className="hero-trust" aria-label="Product access summary">
            {t.trust.map((item) => <li key={item}><Check size={15} />{item}</li>)}
          </ul>
        </div>

        <figure className="hero-interface">
          <div className="hero-interface-bar"><span>{t.actualInterface}</span><strong>{t.planStatus}</strong></div>
          <picture>
            <source media="(max-width: 560px)" srcSet={workspaceBrief} />
            <img src={workspaceOverview} width="1536" height="720" alt={locale === 'zh-Hant' ? 'AisleStage 實際工作區，顯示商品資料、商品原圖與等待批准的 Campaign Agent 計劃' : 'Actual AisleStage workspace showing product facts, source image and a Campaign Agent plan awaiting approval'} />
          </picture>
          <div className="hero-interface-flow" aria-label={locale === 'zh-Hant' ? '畫面內的三個主要區域' : 'Three main areas in this view'}>
            {t.workspaceSteps.map(([label, title]) => <span key={label}><b>{label}</b>{title}</span>)}
          </div>
          <figcaption>{t.workspaceCaption}</figcaption>
        </figure>
      </section>

      <section className="proof-strip" id="product" aria-label="Product principles">
        {t.proof.map(([title, body], index) => {
          const Icon = proofIcons[index]
          return <article key={title}><Icon size={23} /><div><strong>{title}</strong><span>{body}</span></div></article>
        })}
      </section>

      <section className="workspace-showcase" aria-labelledby="workspace-showcase-title">
        <header className="workspace-showcase-copy">
          <p className="landing-eyebrow">{t.workspaceEyebrow}</p>
          <h2 id="workspace-showcase-title">{t.workspaceTitle}</h2>
          <p>{t.workspaceBody}</p>
        </header>
        <div className="workspace-tour-grid">
          <article className="workspace-tour-card brief">
            <div className="workspace-tour-copy"><span>{t.workspaceSteps[0][0]}</span><h3>{t.workspaceSteps[0][1]}</h3><p>{t.workspaceSteps[0][2]}</p></div>
            <figure><img src={workspaceBrief} width="865" height="520" loading="lazy" decoding="async" alt={locale === 'zh-Hant' ? '實際商業資料與商品原圖輸入介面' : 'Actual commercial brief and product source input interface'} /><figcaption>{t.actualInterface}</figcaption></figure>
          </article>
          <article className="workspace-tour-card agent">
            <div className="workspace-tour-copy"><span>{t.workspaceSteps[1][0]}</span><h3>{t.workspaceSteps[1][1]}</h3><p>{t.workspaceSteps[1][2]}</p></div>
            <figure><img src={workspaceAgent} width="410" height="520" loading="lazy" decoding="async" alt={locale === 'zh-Hant' ? '實際 Campaign Agent 等待批准介面' : 'Actual Campaign Agent interface awaiting approval'} /><figcaption>{t.actualInterface}</figcaption></figure>
          </article>
          <article className="workspace-tour-card results">
            <div className="workspace-tour-copy"><span>{t.workspaceSteps[2][0]}</span><h3>{t.workspaceSteps[2][1]}</h3><p>{t.workspaceSteps[2][2]}</p><ul>{t.featurePoints.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></div>
            <figure><img src={workspaceResults} width="1290" height="530" loading="lazy" decoding="async" alt={locale === 'zh-Hant' ? '實際三比例素材包及繁體中文文案預覽介面' : 'Actual three-ratio Campaign Pack and Traditional Chinese copy preview interface'} /><figcaption>{t.actualInterface}</figcaption></figure>
          </article>
        </div>
      </section>

      <section className="use-cases-section" id="use-cases" aria-labelledby="use-cases-title">
        <div className="use-cases-intro">
          <p className="landing-eyebrow">{t.casesEyebrow}</p>
          <h2 id="use-cases-title">{t.casesTitle}</h2>
          <p>{t.casesBody}</p>
        </div>
        <div className="use-case-list">
          {t.cases.map(([title, situation, action, outcome], index) => <article key={title}>
            <header><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3></header>
            <div className="use-case-stage"><strong>{t.caseLabels[0]}</strong><p>{situation}</p></div>
            <div className="use-case-stage"><strong>{t.caseLabels[1]}</strong><p>{action}</p></div>
            <div className="use-case-stage outcome"><strong>{t.caseLabels[2]}</strong><p>{outcome}</p></div>
          </article>)}
        </div>
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

      <section className="collaboration-section" id="collaboration" aria-labelledby="collaboration-title">
        <div className="collaboration-copy">
          <p className="landing-eyebrow">{t.collaborationEyebrow}</p>
          <h2 id="collaboration-title">{t.collaborationTitle}</h2>
          <p>{t.collaborationBody}</p>
        </div>
        <div className="collaboration-grid">
          {t.collaborationSteps.map(([number, title, body], index) => {
            const Icon = collaborationIcons[index]
            return <article key={number}><span>{number}</span><Icon size={25} /><h3>{title}</h3><p>{body}</p></article>
          })}
        </div>
        <aside className="collaboration-note"><p>{t.collaborationNote}</p><a className="landing-secondary" href="/app">{t.login}<ArrowRight size={16} /></a></aside>
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
