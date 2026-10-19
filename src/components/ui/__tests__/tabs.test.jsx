import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { axe } from '@/test/axe'
import { Tabs, TabList, Tab, TabPanel } from '../tabs'

afterEach(cleanup)

function Sections({ initial = 'jobs', onChange = () => {}, changeCount }) {
  const [value, setValue] = useState(initial)
  return (
    <Tabs value={value} onChange={(next) => { onChange(next); setValue(next) }}>
      <TabList aria-label="Portal sections">
        <Tab value="jobs">Jobs</Tab>
        <Tab value="changes" count={changeCount}>Change orders</Tab>
        <Tab value="messages">Messages</Tab>
      </TabList>
      <TabPanel value="jobs">Jobs panel</TabPanel>
      <TabPanel value="changes">Change orders panel</TabPanel>
      <TabPanel value="messages">Messages panel</TabPanel>
    </Tabs>
  )
}

const tab = (name) => screen.getByRole('tab', { name })
const selected = () => screen.getAllByRole('tab').filter((el) => el.getAttribute('aria-selected') === 'true')
const focusTab = (name) => act(() => { tab(name).focus() })

describe('Tabs', () => {
  it('has a named tab list, one tab for each section and one panel for the selected tab', () => {
    render(<Sections />)

    expect(screen.getByRole('tablist', { name: 'Portal sections' })).toBeTruthy()
    expect(screen.getAllByRole('tab').map((el) => el.textContent)).toEqual(['Jobs', 'Change orders', 'Messages'])
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel').textContent).toBe('Jobs panel')
  })

  it('marks the selected tab with aria-selected and ties it to its panel with aria-controls', () => {
    render(<Sections initial="changes" />)

    expect(selected().map((el) => el.textContent)).toEqual(['Change orders'])
    expect(tab('Jobs').getAttribute('aria-selected')).toBe('false')
    const panel = screen.getByRole('tabpanel')
    expect(tab('Change orders').getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Change orders').id)
  })

  it('selects a tab when it is clicked', () => {
    const onChange = vi.fn()
    render(<Sections onChange={onChange} />)

    fireEvent.click(tab('Messages'))

    expect(onChange).toHaveBeenCalledWith('messages')
    expect(selected().map((el) => el.textContent)).toEqual(['Messages'])
    expect(screen.getByRole('tabpanel').textContent).toBe('Messages panel')
  })

  it('moves focus and selection to the next tab on the Right arrow', async () => {
    const onChange = vi.fn()
    render(<Sections onChange={onChange} />)
    focusTab('Jobs')

    fireEvent.keyDown(tab('Jobs'), { key: 'ArrowRight' })

    await waitFor(() => expect(document.activeElement).toBe(tab('Change orders')))
    expect(onChange).toHaveBeenCalledWith('changes')
    expect(selected().map((el) => el.textContent)).toEqual(['Change orders'])
    expect(screen.getByRole('tabpanel').textContent).toBe('Change orders panel')
  })

  it('moves focus and selection to the previous tab on the Left arrow', async () => {
    render(<Sections initial="messages" />)
    focusTab('Messages')

    fireEvent.keyDown(tab('Messages'), { key: 'ArrowLeft' })

    await waitFor(() => expect(document.activeElement).toBe(tab('Change orders')))
    expect(selected().map((el) => el.textContent)).toEqual(['Change orders'])
  })

  it('wraps from the last tab to the first on the Right arrow, and back on the Left', async () => {
    render(<Sections initial="messages" />)
    focusTab('Messages')

    fireEvent.keyDown(tab('Messages'), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Jobs')))
    expect(selected().map((el) => el.textContent)).toEqual(['Jobs'])

    fireEvent.keyDown(tab('Jobs'), { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Messages')))
    expect(selected().map((el) => el.textContent)).toEqual(['Messages'])
  })

  it('goes to the first tab on Home and the last on End', async () => {
    render(<Sections initial="changes" />)
    focusTab('Change orders')

    fireEvent.keyDown(tab('Change orders'), { key: 'End' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Messages')))
    expect(selected().map((el) => el.textContent)).toEqual(['Messages'])

    fireEvent.keyDown(tab('Messages'), { key: 'Home' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Jobs')))
    expect(selected().map((el) => el.textContent)).toEqual(['Jobs'])
  })

  it('leaves only the selected tab in the tab order', () => {
    render(<Sections />)

    expect(tab('Jobs').tabIndex).toBe(0)
    expect(tab('Change orders').tabIndex).toBe(-1)
    expect(tab('Messages').tabIndex).toBe(-1)
  })

  it('shows a count beside the name of a tab that has one', () => {
    render(<Sections changeCount={3} />)

    expect(tab('Change orders 3')).toBeTruthy()
    expect(tab('Jobs').textContent).toBe('Jobs')
  })

  it('shows no count when there is none to show', () => {
    render(<Sections changeCount={0} />)
    expect(tab('Change orders').textContent).toBe('Change orders')
  })

  it('draws the focus ring inside a tab, where the scrolling list cannot clip it', () => {
    render(<Sections />)
    // The focus rule in index.css is in the base layer, so a plain utility moves the ring,
    // and outline-none would hide it.
    for (const el of screen.getAllByRole('tab')) {
      expect(el.classList.contains('focus-visible:-outline-offset-2'), el.textContent).toBe(true)
      expect(el.classList.contains('outline-none'), el.textContent).toBe(false)
    }
  })

  it('has tabs at least 44 pixels tall under 768 pixels', () => {
    render(<Sections />)
    for (const el of screen.getAllByRole('tab')) expect(el.classList.contains('min-h-11'), el.textContent).toBe(true)
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<Sections changeCount={3} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
