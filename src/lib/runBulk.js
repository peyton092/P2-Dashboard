// runBulk — execute an async operation against many items, report results
// to the user as a single toast. Unlike Promise.all, partial failures are
// surfaced honestly: if 10 of 12 succeed, the toast says "10 updated, 2
// failed" instead of treating the whole batch as failed.
//
// Args:
//   items   — array of records to operate on
//   op      — async (item) => Promise<unknown>, throws on failure
//   toast   — useToast() return value
//   labels  — { success, partial, failure } string templates with {n} / {ok} / {fail}
//
// Returns: { ok: number, fail: number }
export async function runBulk(items, op, toast, labels = {}) {
  const { successTitle = 'Updated', failureTitle = 'Bulk update failed', noun = 'item' } = labels
  const results = await Promise.allSettled(items.map(op))
  const ok = results.filter(r => r.status === 'fulfilled').length
  const fail = results.length - ok
  if (fail === 0) {
    toast({ tone: 'success', title: `${successTitle} ${ok} ${noun}${ok === 1 ? '' : 's'}` })
  } else if (ok === 0) {
    const firstErr = results.find(r => r.status === 'rejected')?.reason
    toast({ tone: 'error', title: failureTitle, description: firstErr?.message || 'Try again.' })
  } else {
    toast({
      tone: 'warning',
      title: `${ok} ${noun}${ok === 1 ? '' : 's'} updated, ${fail} failed`,
      description: 'Re-try the failed ones individually.',
    })
  }
  return { ok, fail }
}
