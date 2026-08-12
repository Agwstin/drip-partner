/**
 * Mock de react-native-tcp-socket para tests de Node/jest.
 * Superficie mínima que usa partner-sync-lan.
 */

function createServer(handler) {
  const server = {
    listen: (opts, cb) => {
      if (cb) setTimeout(cb, 0)
      return server
    },
    close: () => server,
    _handler: handler,
  }
  return server
}

function createConnection(opts, cb) {
  const socket = {
    write: (data) => {
      // echo OK para el test
      if (socket._onData) {
        setTimeout(() => socket._onData(Buffer.from('OK')), 0)
      }
      return socket
    },
    on: (event, fn) => {
      if (event === 'connect' && cb) setTimeout(cb, 0)
      socket['_on' + event] = fn
      return socket
    },
    destroy: () => socket,
  }
  return socket
}

export default { createServer, createConnection }
