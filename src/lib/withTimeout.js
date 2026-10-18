// Race a promise against a deadline. If the deadline wins, the returned promise
// rejects with an Error whose code is 'timeout', and any later settlement of the
// inner promise is ignored (the caller's handlers never run for it).
export function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      const error = new Error('timeout')
      error.code = 'timeout'
      reject(error)
    }, ms)
    Promise.resolve(promise).then(
      value => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        if (done) return
        done = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
