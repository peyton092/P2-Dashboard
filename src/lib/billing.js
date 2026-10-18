// The billing statuses a person can pick for a job. The words and tones are in
// status.js (BILLING_STATUS). A job on hold is placed there and released from the
// billing queue, so hold is not in this list.

export const BILLING_STATUSES = ['not-invoiced', 'invoiced', 'partial-pay', 'paid']
