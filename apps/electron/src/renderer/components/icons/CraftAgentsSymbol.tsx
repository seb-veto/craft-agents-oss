interface CraftAgentsSymbolProps { className?: string }

/** Fork-specific V mark. Export name retained for source compatibility. */
export function CraftAgentsSymbol({ className }: CraftAgentsSymbolProps) {
  return <svg viewBox="0 0 32 32" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Veto Agents">
    <path d="M5 6h6l5 15 5-15h6L18.5 27h-5L5 6Z" fill="currentColor" />
  </svg>
}
