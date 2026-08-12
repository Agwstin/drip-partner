/**
 * Mock de react-native-udp para tests de Node/jest.
 * Implementa la superficie mínima que usa partner-sync-lan.
 */

function createSocket() {
  const handlers = {}
  const socket = {
    on: (event, cb) => {
      handlers[event] = cb
      return socket
    },
    bind: (port, cb) => {
      if (cb) setTimeout(cb, 0)
      return socket
    },
    setBroadcast: () => socket,
    send: (data, offset, port, address, cb) => {
      if (cb) setTimeout(cb, 0)
      return socket
    },
    close: () => socket,
    _handlers: handlers,
    _emit: (event, ...args) => {
      if (handlers[event]) handlers[event](...args)
    },
  }
  return socket
}

export { createSocket }
