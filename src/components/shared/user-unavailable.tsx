/** A failed detail read is not evidence that the requested user is absent. */
export function UserUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <section data-testid="user-unavailable" role="alert">
      <h1>User details unavailable</h1>
      <p>The user details could not be loaded. Your session has not been ended.</p>
      <a href={retryHref}>Try again</a>
    </section>
  );
}
