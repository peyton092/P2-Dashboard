// Billing status vocabulary used across the app. Pure data, no React or
// Firestore dependency. Moved out of src/App.jsx in Phase 18.

export const BILLING_STATUSES = ['not-invoiced', 'invoiced', 'partial-pay', 'paid']

export const BILLING_STATUS_LABEL = {
  'not-invoiced': 'Not Invoiced',
  'invoiced':     'Invoiced',
  'partial-pay':  'Partial Pay',
  'paid':         'Paid',
}

export const BILLING_STATUS_COLOR = {
  'not-invoiced': '#6b7280',
  'invoiced':     '#3b82f6',
  'partial-pay':  '#eab308',
  'paid':         '#22c55e',
}
