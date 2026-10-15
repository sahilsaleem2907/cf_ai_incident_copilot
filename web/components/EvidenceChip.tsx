/** Scrolls to a check card and flashes an orange ring on it (TDD §12.2). */
export function focusCheck(evidenceId: string) {
  const card = document.getElementById(`check-${evidenceId}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.focus({ preventScroll: true });
  card.classList.remove("flash-ring");
  // Restart the animation even if the same chip is clicked twice.
  void card.offsetWidth;
  card.classList.add("flash-ring");
}

export function EvidenceChip({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={() => focusCheck(id)}
      className="mx-0.5 inline-flex items-center rounded-sm border border-(--cf-border) bg-(--cf-bg-300) px-1 font-mono text-[0.8em] leading-5 text-(--cf-fg) hover:border-cf-orange focus-visible:outline-2 focus-visible:outline-cf-orange"
      aria-label={`Show check ${id}`}
    >
      {id}
    </button>
  );
}
