export default function HomePage() {
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>Clicky Next.js example</h1>
      <p>
        This page is wrapped in a client <code>&lt;ClickyProvider&gt;</code>. Open the floating button bottom-right and ask
        it about this page. The proxy lives at <code>/api/clicky</code> — set <code>ANTHROPIC_API_KEY</code> in your
        environment to enable real responses.
      </p>
      <ul>
        <li>
          <a href="/products">Browse products</a>
        </li>
      </ul>
    </main>
  )
}
