export const dynamic = "force-dynamic";

export default function BackendHomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.5 }}>
      <h1 style={{ margin: 0 }}>TIRYAQ Backend</h1>
      <p style={{ marginTop: "0.75rem" }}>
        This service hosts the API routes used by the frontend deployment.
      </p>
      <p style={{ marginTop: "0.5rem" }}>
        Health check: <code>/api/account-eligibility</code>, <code>/api/ai-chat</code>,{" "}
        <code>/api/admin-page/session</code>.
      </p>
    </main>
  );
}
