const test = require('brittle')
const { swarm, createDHT, endAndCloseSocket } = require('./helpers')
const { encode } = require('spacecore-id-encoding')
const { once } = require('events')
const DHT = require('../')

test('createServer + connect - once defaults', async function (t) {
  t.plan(2)

  const [a, b] = await swarm(t)
  const lc = t.test('socket lifecycle')

  lc.plan(4)

  const server = a.createServer(function (socket) {
    lc.pass('server side opened')

    socket.once('end', function () {
      lc.pass('server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = b.connect(server.publicKey)

  socket.once('open', function () {
    lc.pass('client side opened')
  })

  socket.once('end', function () {
    lc.pass('client side ended')
  })

  socket.end()

  await lc

  server.on('close', function () {
    t.pass('server closed')
  })

  await server.close()
})

test('createServer + connect - emits connect', async function (t) {
  t.plan(2)

  const [a, b] = await swarm(t)
  const lc = t.test('socket lifecycle')

  lc.plan(4)

  const server = a.createServer(function (socket) {
    lc.pass('server side opened')

    socket.once('end', function () {
      lc.pass('server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = b.connect(server.publicKey)

  socket.once('connect', function () {
    lc.pass('client side emitted connect')
  })

  socket.once('end', function () {
    lc.pass('client side ended')
  })

  socket.end()

  await lc

  server.on('close', function () {
    t.pass('server closed')
  })

  await server.close()
})

test('createServer + connect - exchange data', { timeout: 60000 }, async function (t) {
  const [a, b] = await swarm(t)
  const lc = t.test('socket lifecycle')

  lc.plan(5)

  const server = a.createServer(function (socket) {
    lc.pass('server side opened')

    socket.on('data', function (data) {
      socket.write(data)
    })

    socket.once('end', function () {
      lc.pass('server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = b.connect(server.publicKey)
  const blk = Buffer.alloc(4096)
  const expected = 20 * 1024 * blk.byteLength

  let sent = 0
  let recv = 0

  for (let i = 0; i < 10; i++) send()

  function send () {
    sent += blk.byteLength
    socket.write(blk)
  }

  socket.on('data', function (data) {
    recv += data.byteLength
    if (recv === expected) {
      lc.is(sent, expected, 'client sent all data')
      lc.is(recv, expected, 'client received all data')
      socket.end()
    } else if (sent < expected) {
      send()
    }
  })

  socket.once('end', function () {
    lc.pass('client side ended')
  })

  await lc
  await server.close()
})

test('createServer + connect - force holepunch', async function (t) {
  const [boot] = await swarm(t)

  const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
  const a = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })
  const b = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })

  await a.fullyBootstrapped()
  await b.fullyBootstrapped()

  const lc = t.test('socket lifecycle')
  lc.plan(4)

  const server = a.createServer({ shareLocalAddress: false }, function (socket) {
    lc.pass('udx server side opened')

    socket.once('end', function () {
      lc.pass('udx server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = b.connect(server.publicKey, { localConnection: false })

  socket.once('open', function () {
    lc.pass('udx client side opened')
  })

  socket.once('end', function () {
    lc.pass('udx client side ended')
  })

  socket.end()

  await lc

  await server.close()
  await a.destroy()
  await b.destroy()
})

test('server choosing to abort holepunch', async function (t) {
  const [boot] = await swarm(t)

  const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
  const a = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })
  const b = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })

  await a.fullyBootstrapped()
  await b.fullyBootstrapped()

  const lc = t.test('socket lifecycle')
  lc.plan(2)

  const server = a.createServer({
    shareLocalAddress: false,
    holepunch () {
      lc.pass('server should trigger holepuncher hook')
      return false
    }
  }, function (socket) {
    lc.fail('server should not make a connection')
  })

  await server.listen()

  const socket = b.connect(server.publicKey, {
    fastOpen: false,
    localConnection: false
  })

  socket.once('open', function () {
    lc.fail('client should not make a connection')
  })

  socket.once('error', function (err) {
    lc.ok(!!err, 'client socket should error')
  })

  await lc

  await server.close()
  await a.destroy()
  await b.destroy()
})

test('client choosing to abort holepunch', async function (t) {
  const [boot] = await swarm(t)

  const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
  const a = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })
  const b = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })

  await a.fullyBootstrapped()
  await b.fullyBootstrapped()

  const lc = t.test('socket lifecycle')
  lc.plan(2)

  const server = a.createServer({ shareLocalAddress: false }, function (socket) {
    lc.fail('server should not make a connection')
  })

  await server.listen()

  const socket = b.connect(server.publicKey, {
    fastOpen: false,
    localConnection: false,
    holepunch () {
      lc.pass('client is aborting')
      return false
    }
  })

  socket.once('open', function () {
    lc.fail('client should not make a connection')
  })

  socket.once('error', function (err) {
    lc.ok(!!err, 'client socket should error')
  })

  await lc

  await server.close()
  await a.destroy()
  await b.destroy()
})

test('udp noise, client ends, no crash', async function (t) {
  const [, node] = await swarm(t, 2)

  const socket = node.udx.createSocket()
  await socket.send(Buffer.from('hi'), node.address().port)
  await socket.close()

  t.pass('did not crash')
})

test('half open', async function (t) {
  t.plan(2)

  const [a, b] = await swarm(t)

  const server = a.createServer()
  await server.listen()

  const socket = b.connect(server.address().publicKey)

  server.on('connection', (socket) => {
    socket.on('data', (data) => {
      t.alike(data.toString(), 'ping')
      setTimeout(() => socket.end('pong'))
    })
  })

  socket
    .on('data', (data) => {
      t.alike(data.toString(), 'pong')
    })
    .end('ping')
})

test('server responds and immediately ends, multiple connects', async function (t) {
  const [a, b] = await swarm(t)

  const lc = t.test('socket lifecycle')
  lc.plan(1)

  const server = a.createServer((socket) => {
    socket.end('hi')
  })

  await server.listen()

  // TODO: the test fails due to congestion when this is too high
  let n = 10

  for (let i = n; i > 0; i--) {
    const socket = b.connect(server.publicKey)

    socket
      .on('close', () => {
        if (--n === 0) lc.pass()
      })
      .resume()
      .end()
  }

  await lc

  await server.close()
})

test('dht node can host server', async function (t) {
  t.plan(2)

  const [, b, c] = await swarm(t, 3)

  const lc = t.test('socket lifecycle')

  lc.plan(4)

  const server = b.createServer(function (socket) {
    lc.pass('server side opened')

    socket.once('end', function () {
      lc.pass('server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = c.connect(server.publicKey)

  socket.once('open', function () {
    lc.pass('client side opened')
  })

  socket.once('end', function () {
    lc.pass('client side ended')
  })

  socket.end()

  await lc

  server.on('close', function () {
    t.pass('server closed')
  })

  await server.close()
})

test('server and client on same node', async function (t) {
  t.plan(2)

  const [, a] = await swarm(t)

  const server = a.createServer()
  await server.listen()

  const socket = a.connect(server.address().publicKey)

  server.on('connection', (socket) => {
    t.pass('server connected')
    socket.end()
  })

  socket.on('open', () => {
    t.pass('client connected')
    socket.end()
  })
})

test('relayed connection', async function (t) {
  t.plan(2)

  const nodes = await swarm(t)

  const a = nodes.createNode()
  const b = nodes.createNode()

  const server = a.createServer()
  await server.listen()

  const socket = b.connect(server.address().publicKey)

  server.on('connection', (socket) => {
    socket.on('error', () => {})
    t.pass('server connected')
    socket.end()
  })

  socket
    .on('error', () => {})
    .on('open', () => {
      t.pass('client connected')
      socket.end()
    })
})

test('relayed connection on same node', async function (t) {
  t.plan(4)

  const nodes = await swarm(t)

  const a = nodes.createNode()

  const server = a.createServer()
  await server.listen()

  const socket = a.connect(server.address().publicKey)

  server.on('connection', (socket) => {
    t.pass('server connected')
    socket.end()

    socket.on('close', function () {
      t.pass('server socket closed')
    })
  })

  socket.on('open', () => {
    t.pass('client connected')
    socket.end()
  })

  socket.on('close', function () {
    t.pass('client socket closed')
  })
})

test('create raw stream from encrypted stream', async function (t) {
  const msg = t.test('message')
  msg.plan(1)

  const [a, b] = await swarm(t)

  const server = a.createServer()
  await server.listen()

  const socket = b.connect(server.address().publicKey)

  const aRawStream = a.createRawStream()
  const bRawStream = b.createRawStream()

  server.on('connection', (socket) => {
    socket.on('error', () => {})

    DHT.connectRawStream(socket, aRawStream, bRawStream.id)

    aRawStream.write('hello')
  })

  socket.on('open', () => {
    DHT.connectRawStream(socket, bRawStream, aRawStream.id)

    bRawStream.on('data', (data) => {
      msg.alike(data, Buffer.from('hello'))

      socket.destroy()
    })
  })

  await msg

  aRawStream.destroy()
  bRawStream.destroy()

  await server.close()
})

test('create many connections with reusable sockets', async function (t) {
  const [boot] = await swarm(t)

  const bootstrap = [{ host: '127.0.0.1', port: boot.address().port }]
  const a = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })
  const b = createDHT({ bootstrap, quickFirewall: false, ephemeral: true })

  await a.fullyBootstrapped()
  await b.fullyBootstrapped()

  const server = a.createServer({ reusableSocket: true })
  await server.listen()

  server.on('connection', function (socket) {
    socket.write('Hello, World!')
    socket.end()
  })

  let prev = null
  let same = 0

  for (let i = 0; i < 100; i++) {
    const socket = b.connect(server.address().publicKey, { reusableSocket: true, localConnection: false })

    socket.on('connect', function () {
      if (prev === socket.rawStream.socket) same++
      prev = socket.rawStream.socket
    })

    socket.resume()
    socket.end()
    await new Promise((resolve) => socket.once('end', resolve))
  }

  t.is(same, 99, 'reused socket')

  for (let i = 0; i < 100; i++) {
    const socket = b.connect(server.address().publicKey, { reusableSocket: false, localConnection: false })

    socket.on('connect', function () {
      if (prev === socket.rawStream.socket) same++
      prev = socket.rawStream.socket
    })

    socket.resume()
    socket.end()
    await new Promise((resolve) => socket.once('end', resolve))
  }

  t.is(same, 99, 'did not reuse socket')

  await server.close()
  await a.destroy()
  await b.destroy()
})

test('connect using specific key', async function (t) {
  const [a, b] = await swarm(t)

  const lc = t.test('socket lifecycle')
  lc.plan(4)

  const keyPair = DHT.keyPair(Buffer.alloc(32, 'hello world'))
  t.comment('publicKey', keyPair.publicKey)

  const server = a.createServer(function (socket) {
    lc.pass('server side opened')
    t.alike(socket.remotePublicKey, keyPair.publicKey)

    socket.once('end', function () {
      lc.pass('server side ended')
      socket.end()
    })
  })

  await server.listen()

  const socket = b.connect(server.publicKey, { keyPair })

  socket
    .once('open', function () {
      lc.pass('client side opened')
      t.alike(socket.publicKey, keyPair.publicKey)
    })
    .once('end', function () {
      lc.pass('client side ended')
    })
    .end()

  await lc

  server.on('close', function () {
    t.pass('server closed')
  })

  await server.close()
})

test('close connections on destroy', async function (t) {
  const [a, b] = await swarm(t)
  const open = t.test('open')
  const close = t.test('close')

  open.plan(2)
  close.plan(2)

  const server = a.createServer(function (socket) {
    open.pass('server side opened')

    socket
      .on('error', () => {})
      .once('close', function () {
        close.pass('server side closed')
      })
  })

  await server.listen()

  const socket = b.connect(server.publicKey)

  socket
    .on('error', () => {})
    .once('open', function () {
      open.pass('client side opened')
    })
    .once('close', function () {
      close.pass('client side closed')
    })

  server.on('close', function () {
    t.pass('server closed')
  })

  await open

  await a.destroy()
  await b.destroy()

  await close
})

test('connect using id instead of buffer', async function (t) {
  t.plan(2)

  const [a, b] = await swarm(t)
  const server = a.createServer()
  server.on('connection', conn => {
    conn.on('end', () => conn.end())
  })

  await server.listen()

  const id = encode(server.publicKey)
  const socket = b.connect(id)

  await once(socket, 'open')

  t.is(id.length, 52)
  t.pass('connects if id is given instead of buffer')

  await endAndCloseSocket(socket)
  await server.close()

  await a.destroy()
  await b.destroy()
})

test('exception if invalid id is used', async function (t) {
  t.plan(1)

  const [a] = await swarm(t)
  const id = 'wrong-id'

  try {
    a.connect(id)
    t.fail()
  } catch (err) {
    t.is(err.message, 'Invalid Spacecore key')
    await a.destroy()
  }
})

test('exception if null id is used', async function (t) {
  t.plan(1)

  const [a] = await swarm(t)

  try {
    a.connect(null)
    t.fail()
  } catch (err) {
    t.is(err.message, 'Invalid Spacecore key')
    await a.destroy()
  }
})

test('connectionKeepAlive defaults to 5000', async function (t) {
  t.plan(4)

  const [a, b] = await swarm(t)
  t.is(a.connectionKeepAlive, 5000, 'sanity check: connectionKeepAlive set to 5000')
  t.is(b.connectionKeepAlive, 5000, 'sanity check: connectionKeepAlive set to 5000')

  const server = a.createServer((socket) => {
    socket.on('error', () => {})
    t.is(socket.keepAlive, 5000, 'keepAlive set for server socket')
  })

  await server.listen()

  const socket = b.connect(server.publicKey)
  socket.on('error', () => {})

  t.is(socket.keepAlive, 5000, 'keepAlive set for client socket')
})

test('connectionKeepAlive can be turned off', async function (t) {
  t.plan(4)

  const { bootstrap } = await swarm(t)

  const a = createDHT({ bootstrap, connectionKeepAlive: false })
  const b = createDHT({ bootstrap, connectionKeepAlive: false })
  t.teardown(async () => {
    await a.destroy()
    await b.destroy()
  })

  t.is(a.connectionKeepAlive, 0, 'sanity check')
  t.is(b.connectionKeepAlive, 0, 'sanity check')

  const server = a.createServer((socket) => {
    socket.on('error', () => {})
    t.is(socket.keepAlive, 0, 'keepAlive not set for server socket')
  })

  await server.listen()

  const socket = b.connect(server.publicKey)
  socket.on('error', () => {})

  t.is(socket.keepAlive, 0, 'keepAlive not set for client socket')
})

test('connectionKeepAlive passed to server and connection', async function (t) {
  const allChecks = t.test('all') // hack so we can await plan
  allChecks.plan(2)

  const { bootstrap } = await swarm(t)

  const a = createDHT({ bootstrap, connectionKeepAlive: 10000 })
  const b = createDHT({ bootstrap, connectionKeepAlive: 20000 })

  const server = a.createServer((socket) => {
    socket.on('end', () => socket.end())
    allChecks.is(socket.keepAlive, 10000, 'keepAlive set for server')
  })

  await server.listen()

  const socket = b.connect(server.publicKey)

  allChecks.is(socket.keepAlive, 20000, 'keepAlive set for connection')

  await allChecks

  await endAndCloseSocket(socket)

  await server.close()

  await a.destroy()
  await b.destroy()
})

test('bootstrap with suggested-IP', async function (t) {
  const [boot] = await swarm(t, 1)
  const bootstrap = ['127.0.0.1@invalid:' + boot.address().port]
  const a = createDHT({ bootstrap, quickFirewall: false, ephemeral: false })
  await a.fullyBootstrapped()

  t.alike(boot.toArray(), [{ host: '127.0.0.1', port: a.address().port }])

  await a.destroy()
})

test('Populate DHT with options.nodes', async function (t) {
  const a = createDHT({ bootstrap: [] })
  await a.fullyBootstrapped()
  const nodes = [{ host: '127.0.0.1', port: a.address().port }]

  const b = createDHT({ nodes, bootstrap: [] })
  await b.fullyBootstrapped()

  t.alike(b.toArray(), [{ host: '127.0.0.1', port: a.address().port }])

  a.destroy()
  b.destroy()
})
