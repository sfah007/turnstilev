export default function Home() {
  return (
    <div style={{ padding: '50px', fontFamily: 'Arial' }}>
      <h1>Turnstile Solver API</h1>
      <p>API Endpoint: <code>/api/solve</code></p>
      
      <h2>Usage:</h2>
      <pre style={{ background: '#f4f4f4', padding: '15px', borderRadius: '5px' }}>
{`GET /api/solve?url=https://example.com&sitekey=YOUR_SITEKEY

POST /api/solve
Body: {
  "url": "https://example.com",
  "sitekey": "YOUR_SITEKEY"
}`}
      </pre>
      
      <h2>Response:</h2>
      <pre style={{ background: '#f4f4f4', padding: '15px', borderRadius: '5px' }}>
{`{
  "success": true,
  "token": "0.xxx...",
  "duration": 1234
}`}
      </pre>
    </div>
  );
}
