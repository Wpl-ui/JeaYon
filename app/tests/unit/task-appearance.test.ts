import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { taskColor } from '../../src/tasks/appearance'

test('task IDs keep their colors independently of input order and cover the pastel palette', () => {
  const ids = Array.from({ length: 1000 }, (_, index) => index + 1)
  const colors = new Map(ids.map(id => [id, taskColor(id)]))
  for (const id of [...ids].reverse()) assert.equal(taskColor(id), colors.get(id))
  assert.equal(new Set(colors.values()).size, 10)
  assert.equal(taskColor(Number.MAX_SAFE_INTEGER), taskColor(Number.MAX_SAFE_INTEGER))
})

const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.slice(css.indexOf(`\n${selector} {`)).split('}')[0]

test('the sibling group reveals vertically with 200ms expansion and 150ms collapse', () => {
  assert.match(rule('.task-child-collapse'), /display: grid/)
  assert.match(rule('.task-child-collapse'), /grid-template-rows: 1fr/)
  assert.match(rule('.task-child-collapse'), /transition: grid-template-rows 200ms/)
  assert.match(rule('.task-child-collapse.is-collapsed'), /grid-template-rows: 0fr/)
  assert.match(rule('.task-child-collapse.is-collapsed'), /transition-duration: 150ms/)
  assert.match(rule('.task-child-collapse-inner'), /min-height: 0/)
  assert.match(rule('.task-child-collapse-inner'), /overflow: hidden/)
  assert.match(rule('.task-child-list'), /padding: 4px/)
  assert.doesNotMatch(rule('.task-child-collapse'), /clip-path|display: none|opacity|delay/)
  assert.doesNotMatch(css, /task-expand-delay|@starting-style|allow-discrete/)
})

test('disclosure points right when collapsed and down when expanded, with matching timing', () => {
  assert.match(rule('.task-count-triangle'), /transform: rotate\(0deg\)/)
  assert.match(rule('.task-count-triangle'), /transition: transform 200ms/)
  assert.match(rule('.task-count-capsule[aria-expanded="false"] .task-count-triangle'), /rotate\(-90deg\)/)
  assert.match(rule('.task-count-capsule[aria-expanded="false"] .task-count-triangle'), /transition-duration: 150ms/)
})

test('reduced motion makes the group height and triangle instantaneous without stagger', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.task-child-collapse, \.task-count-triangle \{ transition-duration: 0s !important; transition-delay: 0s !important;/)
})
