import { createContext, useContext } from 'react'

export const ToastContext = createContext(() => {})

// useToast() returns toast(opts | string).
//   opts: { title, description, tone, duration, action }
//   tone is success, error, info or brand. duration is in milliseconds: 4000 by default,
//   8000 when there is an action, and 0 to stay until dismissed.
//   action is { label, onClick }, a button on the toast that runs onClick and takes the
//   toast away. useMutation puts Undo there.
export function useToast() {
  return useContext(ToastContext)
}
