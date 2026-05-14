import * as React from "react"

export interface TypewriterProps {
  children?: React.ReactNode
  speed?: number
  trigger?: unknown
  autoPlay?: boolean
  onDone?: () => void
}

const countText = (node: React.ReactNode): number => {
  if (node == null || typeof node === "boolean") return 0
  if (typeof node === "string" || typeof node === "number") return String(node).length
  if (Array.isArray(node)) return node.reduce<number>((s, n) => s + countText(n), 0)
  if (React.isValidElement(node)) {
    return countText((node.props as { children?: React.ReactNode }).children)
  }
  return 0
}

interface RenderState {
  remaining: number
  stopped: boolean
}

const renderTruncated = (
  node: React.ReactNode,
  state: RenderState,
  keyPrefix = "tw",
): React.ReactNode => {
  if (state.stopped) return null
  if (node == null || typeof node === "boolean") return null

  if (typeof node === "string" || typeof node === "number") {
    const text = String(node)
    if (state.remaining >= text.length) {
      state.remaining -= text.length
      return text
    }
    const shown = text.slice(0, state.remaining)
    state.remaining = 0
    state.stopped = true
    return shown
  }

  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <React.Fragment key={`${keyPrefix}-${i}`}>
        {renderTruncated(child, state, `${keyPrefix}-${i}`)}
      </React.Fragment>
    ))
  }

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    const childContent = renderTruncated(props.children, state, keyPrefix)
    return React.cloneElement(node, undefined, childContent)
  }

  return null
}

/**
 * Inner component that handles the interval animation.
 * Receives `startAt` as initial count and animates to `total`.
 * Re-mounted via key changes to reset animation.
 */
function TypewriterInner({
  children,
  total,
  startAt,
  speed,
  onDone,
}: {
  children: React.ReactNode
  total: number
  startAt: number
  speed: number
  onDone?: () => void
}) {
  const [count, setCount] = React.useState(startAt)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (count >= total) return
    timerRef.current = window.setInterval(() => {
      setCount((c) => {
        const next = c + 1
        if (next >= total) {
          if (timerRef.current) window.clearInterval(timerRef.current)
        }
        return next
      })
    }, speed)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [total, speed, count])

  React.useEffect(() => {
    if (total > 0 && count >= total) onDone?.()
  }, [count, total, onDone])

  const state: RenderState = { remaining: count, stopped: false }
  return <>{renderTruncated(children, state)}</>
}

const Typewriter: React.FC<TypewriterProps> = ({
  children,
  speed = 90,
  trigger,
  autoPlay = true,
  onDone,
}) => {
  const total = React.useMemo(() => countText(children), [children])

  // Build a composite key that forces remount when animation should restart.
  // JSON.stringify handles trigger being any serializable value.
  const resetKey = `${autoPlay}-${total}-${JSON.stringify(trigger)}`
  const startAt = autoPlay ? 0 : total

  return (
    <TypewriterInner
      key={resetKey}
      total={total}
      startAt={startAt}
      speed={speed}
      onDone={onDone}
    >
      {children}
    </TypewriterInner>
  )
}
Typewriter.displayName = "Typewriter"

export { Typewriter }
