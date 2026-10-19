// firebase/messaging for the demo build. Push is not supported, so src/lib/push.js
// stops at getMessagingIfSupported and never asks for a token or registers the
// messaging service worker, which the demo build does not ship. The rest does nothing.

export const isSupported = async () => false

export const getMessaging = (app) => ({ app })

export const getToken = async () => null

export const onMessage = () => () => {}
