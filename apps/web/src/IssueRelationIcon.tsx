// Redrawn from Linear's blocked-by / blocking visual convention.
export function IssueRelationIcon({ incoming }: { incoming: boolean }) {
  const stop = "M5 1h6l4 4v6l-4 4H5l-4-4V5z M4.5 7v2h7V7z";
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {incoming ? (
        <path d={stop} fillRule="evenodd" />
      ) : (
        <>
          <path
            d="M5 14H4.5a3 3 0 0 1-3-3v-6.5a3 3 0 0 1 3-3h6.5a3 3 0 0 1 3 3V5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path d={stop} transform="translate(6.4 6.4) scale(.6)" fillRule="evenodd" />
        </>
      )}
    </svg>
  );
}
