interface CraftAgentsLogoProps { className?: string }

/** Fork wordmark. Craft Agents remains credited in license and release documentation. */
export function CraftAgentsLogo({ className }: CraftAgentsLogoProps) {
  return <svg viewBox="0 0 408 66" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-label="Veto Agents">
    <text x="0" y="51" fontFamily="system-ui, sans-serif" fontSize="51" fontWeight="650" letterSpacing="-2">Veto Agents</text>
  </svg>
}
