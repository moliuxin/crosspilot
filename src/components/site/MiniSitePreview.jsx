// 工作台内的“网站实时预览”缩略图（基线 index.html 的 .site-mini）
export default function MiniSitePreview() {
  return (
    <div className="browser-frame">
      <div className="browser-bar">
        <i /><i /><i />
        <div>aquaflow-global.com</div>
        <span>⌘</span>
      </div>
      <div className="site-mini">
        <div className="mini-nav">
          <b>AQUAFLOW</b>
          <span>Products &nbsp;&nbsp; Solutions &nbsp;&nbsp; Cases &nbsp;&nbsp; About</span>
          <button>GET A QUOTE</button>
        </div>
        <div className="mini-hero">
          <div className="mini-copy">
            <small>INDUSTRIAL WATER SOLUTIONS</small>
            <h2>Smarter Flow.<br />Stronger Operations.</h2>
            <p>Reliable treatment systems engineered for global industrial projects.</p>
            <div>
              <button>Explore Products</button>
              <button className="outline">Talk to an Engineer</button>
            </div>
          </div>
          <div className="mini-visual">
            <div className="orb" />
            <div className="machine"><span /><b /><i /></div>
            <div className="float-tag"><strong>28+</strong><span>Countries Served</span></div>
          </div>
        </div>
        <div className="trust-strip">
          <span>ISO 9001</span><span>CE CERTIFIED</span><span>OEM / ODM</span><span>24H RESPONSE</span>
        </div>
        <div className="mini-products">
          <div><b>Core Products</b><span>Engineered for demanding industrial applications.</span></div>
          <div className="prod-pic p1" />
          <div className="prod-pic p2" />
          <div className="prod-pic p3" />
        </div>
      </div>
    </div>
  )
}
