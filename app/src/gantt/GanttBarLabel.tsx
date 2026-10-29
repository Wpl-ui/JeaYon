import { useLayoutEffect, useRef, useState } from 'react'

/** Measure the full label independently of the bar's clipped progress fill. */
export function GanttBarLabel({ text, title, left, width, timelineWidth, viewportWidth, scrollLeft, milestone }: {
  text: string
  title: string
  left: number
  width: number
  timelineWidth: number
  viewportWidth: number
  scrollLeft: number
  milestone: boolean
}) {
  const textRef = useRef<HTMLSpanElement>(null)
  const [labelWidth, setLabelWidth] = useState(0)

  useLayoutEffect(() => {
    const element = textRef.current
    if (!element) return
    const measure = () => setLabelWidth(element.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const end = left + width
  const viewportKnown = viewportWidth > 0
  // Anything left of the scroll viewport is clipped by the timeline edge.
  const clipLeft = scrollLeft + 8
  const viewportRight = scrollLeft + viewportWidth
  const visibleStart = Math.max(left + 12, clipLeft)
  const inside = !milestone && visibleStart + labelWidth <= end - 10
  const after = end + 8
  let labelLeft = visibleStart
  if (!inside) labelLeft = after + labelWidth <= timelineWidth ? after : left - labelWidth - 8
  labelLeft = Math.max(0, labelLeft)

  // A label starting left of the viewport would only show a clipped tail
  // ("整理 · 100%") against the timeline edge. The same applies to a bar that
  // is mostly off-screen to the left: its after-bar label can be cut by the
  // right edge before the progress suffix. In both cases, show the whole
  // label clamped to the visible edge with a leading ‹, or hide it.
  let clampedLeft = false
  let hidden = false
  if (viewportKnown) {
    const overflowsLeft = labelLeft < clipLeft
    const barMostlyOffLeft = left < scrollLeft && end - scrollLeft < (end - left) / 2
    const overflowsRight = labelWidth > 0 && labelLeft + labelWidth > viewportRight - 8
    if (overflowsLeft || (barMostlyOffLeft && overflowsRight)) {
      const available = viewportRight - clipLeft - 8
      // A label too wide for the visible strip can never be shown unclipped.
      hidden = labelWidth > 0 && labelWidth + 16 > available
      labelLeft = clipLeft
      clampedLeft = !hidden && labelWidth > 0
    }
  }

  return (
    <span
      className={`gantt-bar-label${inside ? '' : ' is-outside'}${clampedLeft ? ' is-clamped-left' : ''}`}
      style={{ left: labelLeft, maxWidth: Math.max(0, timelineWidth - labelLeft), visibility: hidden ? 'hidden' : undefined }}
      aria-hidden={hidden || undefined}
      title={title}
    >
      {clampedLeft ? <span className="gantt-bar-label-caret" aria-hidden="true">‹</span> : null}
      <span ref={textRef}>{text}</span>
    </span>
  )
}
