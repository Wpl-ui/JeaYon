import React from 'react'
import { createRoot } from 'react-dom/client'
import { TasksPage } from '/src/tasks/TasksPage'
import { AuthProvider } from '/src/auth/AuthProvider'
import { TeamProvider } from '/src/teams/TeamProvider'
import '/src/styles/global.css'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const frame = () => new Promise(requestAnimationFrame)
const checks = []
function check(value, name, data = {}) {
  if (!value) throw new Error(name + ': ' + JSON.stringify(data))
  checks.push({ name, ...data })
}
const row = id => document.querySelector(`[data-task-id="${id}"]`)
const style = el => getComputedStyle(el)
const snap = el => ({ height: el.getBoundingClientRect().height, rows: style(el).gridTemplateRows, clip: style(el).clipPath })
function luminance(rgb) {
  return rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
}
function contrast(fg, bg) {
  const parse = value => value.match(/[\d.]+/g).map(Number)
  const background = parse(bg), text = parse(fg), alpha = text[3] ?? 1
  const blended = text.slice(0, 3).map((v, i) => v * alpha + background[i] * (1 - alpha))
  const values = [luminance(blended), luminance(background)].sort((a, b) => a - b)
  return (values[1] + .05) / (values[0] + .05)
}
try {
  const fixture = await (await fetch('/__task-cards-session')).json()
  createRoot(document.getElementById('root')).render(<AuthProvider initialSession={fixture.session}><TeamProvider><TasksPage /></TeamProvider></AuthProvider>)
  for (let i = 0; i < 300 && (!row(fixture.parent) || document.querySelector('.task-drag-handle:disabled')); i++) await pause(10)
  await pause(750)
  const children = fixture.children.map(row)
  const capsule = row(fixture.parent).querySelector('.task-count-capsule')
  const group = row(fixture.parent).querySelector('.task-child-collapse')
  const triangle = capsule.querySelector('.task-count-triangle')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  check(children.every(Boolean), 'real page loaded with ten children')
  check(CSS.supports('grid-template-rows', '1fr'), 'browser supports vertical grid reveal')
  check(children.every(el => !el.style.getPropertyValue('--task-expand-delay')), 'no per-child stagger')
  check(children.every(el => el.closest('.task-child-collapse') === group), 'one disclosure group contains all siblings')
  const fullHeight = group.getBoundingClientRect().height
  check(fullHeight > 0 && style(group).transitionProperty === 'grid-template-rows', 'expanded group animates height')
  check(style(group).clipPath === 'none', 'group does not clip horizontally')
  const colors = children.map(el => el.dataset.taskColor)
  for (const theme of ['light', 'dark']) {
    document.documentElement.dataset.theme = theme
    for (const el of [row(fixture.parent), ...children]) {
      const card = el.querySelector('.task-card'), bg = style(card).backgroundColor
      for (const selector of ['.task-title', '.task-meta', '.task-detail', '.task-drag-handle', '.task-open .overdue-text']) {
        const text = card.querySelector(selector)
        if (!text) continue
        const ratio = contrast(style(text).color, bg)
        check(ratio >= 4.5, 'readable card text', { theme, color: el.dataset.taskColor, selector, ratio: Number(ratio.toFixed(2)) })
      }
    }
  }
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'light'
  const width = document.documentElement.clientWidth
  check(document.documentElement.scrollWidth <= width, 'page has no horizontal overflow', { width, scrollWidth: document.documentElement.scrollWidth })
  for (const el of children) {
    const card = el.querySelector('.task-card')
    for (const button of card.querySelectorAll('button')) {
      const r = button.getBoundingClientRect(), p = card.getBoundingClientRect()
      check(r.right <= p.right + 1 && r.left >= p.left - 1, 'card controls fit', { width, label: button.getAttribute('aria-label') ?? button.textContent })
    }
  }
  children[0].querySelector('.task-drag-handle').focus()
  capsule.click(); await frame(); await frame()
  check(document.activeElement === capsule, 'collapse restores focus to disclosure')
  check(group.inert && group.getAttribute('aria-hidden') === 'true', 'collapsed group inert and aria-hidden')
  check(children.every(el => el.inert && el.getAttribute('aria-hidden') === 'true'), 'collapsed cards immediately inert and aria-hidden')
  check(children.every(el => style(el).transitionDelay === '0s' || style(el).transitionDelay.split(',').every(v => parseFloat(v) === 0)), 'collapse has no stagger')
  await pause(210)
  check(group.getBoundingClientRect().height === 0, 'collapsed group occupies no space')
  check(style(group).transitionDuration === (reduced ? '0s' : '0.15s'), 'collapse timing')
  check(style(triangle).transitionDuration === (reduced ? '0s' : '0.15s'), 'triangle collapse timing')
  capsule.click(); await frame(); await frame()
  const start = snap(group)
  await pause(100)
  const middle = snap(group)
  await pause(600)
  const end = snap(group)
  if (reduced) {
    check(start.height === fullHeight, 'reduced motion expands instantly')
    check([group, triangle].every(el => style(el).transitionDuration === '0s' && style(el).transitionDelay === '0s'), 'reduced motion has zero duration and delay')
  } else {
    check(middle.height > 0 && middle.height < end.height, 'actual vertical height interpolation', { start, middle, end })
    check(style(group).transitionDuration === '0.2s' && style(triangle).transitionDuration === '0.2s', 'expansion timing')
  }
  check(end.height === fullHeight && end.clip === 'none', 'group finishes fully expanded without horizontal clipping')
  check(!group.inert && !group.hasAttribute('aria-hidden'), 'expanded group accessible')
  check(children.every((el, i) => el === row(fixture.children[i]) && el.dataset.taskColor === colors[i]), 'DOM identity and colors survive expansion')
  for (let i = 0; i < 8; i++) { capsule.click(); await pause(25) }
  await pause(750)
  check(capsule.getAttribute('aria-expanded') === 'true' && !group.inert && group.getBoundingClientRect().height === fullHeight && children.every(el => !el.inert), 'rapid reversal settles expanded')
  const result = { result: 'PASS', width, reduced, theme: document.documentElement.dataset.theme, checks }
  document.getElementById('result').textContent = JSON.stringify(result)
} catch (error) {
  document.getElementById('result').textContent = JSON.stringify({ result: 'FAIL', error: String(error), checks })
}
