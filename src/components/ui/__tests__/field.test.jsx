import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from '@/test/axe'
import { Input } from '../input'
import { Textarea } from '../textarea'
import { Field } from '../field'

afterEach(cleanup)

describe('Field', () => {
  it('ties the label to the control by id', () => {
    render(<Field id="job-name" label="Job name"><Input /></Field>)

    const input = screen.getByLabelText('Job name')
    expect(input.id).toBe('job-name')
    expect(screen.getByText('Job name').getAttribute('for')).toBe('job-name')
  })

  it('works with a textarea or a plain input as well', () => {
    render(
      <>
        <Field id="notes" label="Notes"><Textarea /></Field>
        <Field id="plain" label="Plain"><input /></Field>
      </>,
    )
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Plain').tagName).toBe('INPUT')
  })

  it('makes up an id when it is not given one, so the label is never loose', () => {
    render(<Field label="Phone"><Input /></Field>)

    const input = screen.getByLabelText('Phone')
    expect(input.id).not.toBe('')
  })

  it('keeps the id the control already has when Field is not given one', () => {
    render(<Field label="Phone" hint="With the area code."><Input id="phone-input" /></Field>)

    // Whatever else points at the control by that id, a script or a link, still works.
    const input = screen.getByLabelText('Phone')
    expect(input.id).toBe('phone-input')
    expect(screen.getByText('Phone').getAttribute('for')).toBe('phone-input')
    const hint = screen.getByText('With the area code.')
    expect(hint.id).toBe('phone-input-hint')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
  })

  it('uses its own id before the control id, and the control id before a made up one', () => {
    render(
      <>
        <Field id="from-field" label="First"><Input id="from-control" /></Field>
        <Field label="Second"><Input id="from-control-2" /></Field>
        <Field label="Third"><Input /></Field>
      </>,
    )

    expect(screen.getByLabelText('First').id).toBe('from-field')
    expect(screen.getByLabelText('Second').id).toBe('from-control-2')
    const third = screen.getByLabelText('Third').id
    expect(third).not.toBe('')
    expect(third).not.toBe('from-field')
    expect(third).not.toBe('from-control-2')
  })

  it('points aria-describedby at the hint', () => {
    render(<Field id="po" label="PO number" hint="Printed on the invoice."><Input /></Field>)

    const input = screen.getByLabelText('PO number')
    const hint = screen.getByText('Printed on the invoice.')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
  })

  it('marks the control invalid and points aria-describedby at the error', () => {
    render(<Field id="amount" label="Amount" error="Enter an amount above zero."><Input /></Field>)

    const input = screen.getByLabelText('Amount')
    const error = screen.getByText('Enter an amount above zero.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })

  it('shows the error in the critical color and announces it', () => {
    render(<Field id="amount" label="Amount" error="Enter an amount above zero."><Input /></Field>)

    const error = screen.getByText('Enter an amount above zero.')
    expect(error.classList.contains('text-critical')).toBe(true)
    expect(error.getAttribute('role')).toBe('alert')
  })

  it('describes the control by the hint and the error together, hint first', () => {
    render(<Field id="amount" label="Amount" hint="In US dollars." error="Enter an amount."><Input /></Field>)

    const input = screen.getByLabelText('Amount')
    const hint = screen.getByText('In US dollars.')
    const error = screen.getByText('Enter an amount.')
    expect(input.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id}`)
  })

  it('keeps what the control already says it is described by', () => {
    render(<Field id="amount" label="Amount" hint="In US dollars."><Input aria-describedby="elsewhere" /></Field>)

    const input = screen.getByLabelText('Amount')
    const hint = screen.getByText('In US dollars.')
    expect(input.getAttribute('aria-describedby')).toBe(`elsewhere ${hint.id}`)
  })

  it('adds no aria-describedby when there is no hint and no error', () => {
    render(<Field id="name" label="Name"><Input /></Field>)
    expect(screen.getByLabelText('Name').hasAttribute('aria-describedby')).toBe(false)
  })

  it('tells a screen reader that a required control is required, and shows a mark that it is', () => {
    render(<Field id="name" label="Name" required><Input /></Field>)

    // The mark is for the eyes and is left out of the name. The word comes from
    // aria-required.
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true')
  })

  it('does not call a control required unless it is', () => {
    render(<Field id="name" label="Name"><Input /></Field>)

    expect(screen.getByLabelText('Name').hasAttribute('aria-required')).toBe(false)
    expect(screen.queryByText('*')).toBeNull()
  })

  it('has no accessibility violations plain, with a hint, and with an error', async () => {
    const { container } = render(
      <>
        <Field id="a" label="Plain"><Input /></Field>
        <Field id="b" label="With hint" hint="A hint."><Input /></Field>
        <Field id="c" label="With error" hint="A hint." error="An error." required><Input /></Field>
      </>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
