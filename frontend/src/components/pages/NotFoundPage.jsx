import "./Page.css";

export function NotFoundPage() {
  return (
    <main className="page">
      <p className="page__eyebrow">404</p>
      <h1>Page not found</h1>
      <p>There's no page at this address. It may have moved, or the link may be mistyped.</p>
      <p>
        <a href="/">Go to the Doc Notary home page</a>
      </p>
    </main>
  );
}
