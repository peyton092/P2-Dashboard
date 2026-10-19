import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '../select'

// Base UI's Select.Value shows the label of the chosen item only when the root is
// handed the items, and the raw value otherwise, so a portal picker once read __ALL__.
// The shared Select hands Base UI the value and label of each SelectItem among its
// children, so a closed picker reads as the words of what is chosen.

afterEach(() => cleanup())

const picker = (props, items) => (
  <Select {...props}>
    <SelectTrigger aria-label="Projects"><SelectValue /></SelectTrigger>
    <SelectContent>{items}</SelectContent>
  </Select>
)

// The words in the trigger's value, without the chevron beside them.
const shown = () => screen.getByRole('combobox', { name: 'Projects' }).querySelector('[data-slot="select-value"]').textContent

describe('what a closed Select shows', () => {
  it('is the label of the chosen item, not its value', () => {
    render(picker({ value: '__ALL__' }, [
      <SelectItem key="all" value="__ALL__">All QBS projects</SelectItem>,
      <SelectItem key="taylor" value="Taylor Hensley">Taylor Hensley</SelectItem>,
    ]))
    expect(shown()).toBe('All QBS projects')
  })

  it('finds the items inside groups and lists, as the screens write them', () => {
    const jobs = [{ id: 'QBS-003', name: 'Larkspur Lot 12' }, { id: 'QBS-024', name: 'Larkspur Lot 14' }]
    render(picker({ value: 'QBS-024' }, (
      <SelectGroup>
        <SelectLabel>Lots</SelectLabel>
        {jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.id} {job.name}</SelectItem>)}
      </SelectGroup>
    )))
    expect(shown()).toBe('QBS-024 Larkspur Lot 14')
  })

  it('follows the value when it changes', () => {
    const items = [<SelectItem key="a" value="pending-verification">Pending verification</SelectItem>, <SelectItem key="b" value="passed">Passed</SelectItem>]
    const { rerender } = render(picker({ value: 'pending-verification' }, items))
    expect(shown()).toBe('Pending verification')
    rerender(picker({ value: 'passed' }, items))
    expect(shown()).toBe('Passed')
  })

  it('keeps the items a screen hands it, and shows the value itself when no item has it', () => {
    render(picker({ value: 'qbs', items: { qbs: 'QBS Builders' } }, <SelectItem value="qbs">qbs</SelectItem>))
    expect(shown()).toBe('QBS Builders')
    cleanup()
    render(picker({ value: 'gone' }, <SelectItem value="here">Here</SelectItem>))
    expect(shown()).toBe('gone')
  })
})
