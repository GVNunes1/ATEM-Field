export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', backgroundColor: '#000', color: '#fff', minHeight: '100vh' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto', border: '1px solid #333', borderRadius: '12px', padding: '2rem', backgroundColor: '#111' }}>
        <h1 style={{ color: '#0070f3', marginTop: 0 }}>▲ Vercel MCP Server (OAuth 2.0)</h1>
        <p>Servidor MCP Remoto hospedado na Vercel Serverless Functions com autenticação OAuth 2.0.</p>
        
        <h3>Endpoints:</h3>
        <ul>
          <li><code>/.well-known/oauth-protected-resource</code> - Descoberta OAuth 2.1</li>
          <li><code>/auth/login</code> - Iniciar Login OAuth</li>
          <li><code>/api/mcp</code> - Endpoint MCP JSON-RPC</li>
        </ul>

        <div style={{ marginTop: '2rem' }}>
          <a
            href="/auth/login"
            style={{
              display: 'inline-block',
              backgroundColor: '#0070f3',
              color: '#fff',
              padding: '0.8rem 1.6rem',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            🚀 Autenticar via OAuth
          </a>
        </div>
      </div>
    </main>
  );
}
