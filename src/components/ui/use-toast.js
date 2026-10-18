import { createContext, useContext } from 'react'

export const ToastContext = createContext(() => {})

// useToast() → toast(opts | string). opts: { title, description, tone, duration }
export function useToast() {
  return useContext(ToastContext)
}
