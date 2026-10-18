import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns'
import { get, isPublicAddress, publicLookup, publicUrl, MAX_REDIRECTS } from '../dist/checks.js'

/**
 * The local tools run on somebody's own machine, inside their own network. A
 * check of the URL as typed is not enough on its own: a public page can
 * redirect elsewhere, and a public-looking name can resolve to a private
 * address. These pin the three places the guard now stands — the address
 * judgement, the resolver the socket connects through, and every redirect
 * hop. None of them touches the network.
 */

/** A transport that answers from a script: url → { status, location, body }. */
function scripted(routes) {
  const seen = []
  const transport = async (url) => {
    seen.push(url.toString())
    const r = routes[url.toString()]
    if (!r) throw new Error(`unexpected fetch of ${url}`)
    return { status: r.status, location: r.location ?? null, body: r.body ?? '' }
  }
  return { transport, seen }
}

test('private, loopback, link-local and special IPv4 addresses are not public', () => {
  for (const ip of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.255.255.254',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '192.0.2.1', '198.18.0.1', '224.0.0.1', '239.255.255.250', '255.255.255.255',
  ]) {
    assert.equal(isPublicAddress(ip), false, `${ip} should not be public`)
  }
})

test('IPv6 loopback, unique-local, link-local, multicast and embedded IPv4 forms are not public', () => {
  for (const ip of [
    '::', '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1',
    '::127.0.0.1', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2001:db8::1',
    'not an address', '1.2.3', '::ffff:999.0.0.1', '1:2:3:4:5:6:7:8:9',
  ]) {
    assert.equal(isPublicAddress(ip), false, `${ip} should not be public`)
  }
})

test('public addresses, both families, are public', () => {
  for (const ip of ['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001:80b::200e']) {
    assert.equal(isPublicAddress(ip), true, `${ip} should be public`)
  }
})

test('an address literal in the URL is judged by the address, whatever its spelling', () => {
  // The URL parser normalises these to 127.0.0.1 / 0.0.0.0 / 100.64.0.1.
  for (const bad of ['http://2130706433/', 'http://0x7f.0.0.1/', 'http://0.0.0.0/', 'http://100.64.0.1/', 'http://224.0.0.1/']) {
    assert.equal(publicUrl(bad), null, `${bad} should be refused`)
  }
  assert.equal(publicUrl('https://user:pass@example.com/'), null, 'credentials in the URL are refused')
  assert.equal(publicUrl('http://8.8.8.8/')?.hostname, '8.8.8.8')
})

test('a public name that resolves to a private address is refused', (t) => {
  t.after(() => mock.restoreAll())
  mock.method(dns, 'lookup', (host, opts, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]))
  return new Promise((resolve) => {
    publicLookup('intranet.example.com', { all: true }, (err) => {
      assert.equal(err?.code, 'ENOTPUBLIC')
      resolve()
    })
  })
})

test('one private address among public ones refuses the whole name', (t) => {
  t.after(() => mock.restoreAll())
  mock.method(dns, 'lookup', (host, opts, cb) =>
    cb(null, [{ address: '93.184.215.14', family: 4 }, { address: '::ffff:169.254.169.254', family: 6 }]),
  )
  return new Promise((resolve) => {
    publicLookup('mixed.example.com', {}, (err) => {
      assert.equal(err?.code, 'ENOTPUBLIC')
      resolve()
    })
  })
})

test('a public name connects to exactly the addresses that were checked', (t) => {
  t.after(() => mock.restoreAll())
  mock.method(dns, 'lookup', (host, opts, cb) => cb(null, [{ address: '93.184.215.14', family: 4 }]))
  return new Promise((resolve) => {
    publicLookup('example.com', { all: true }, (err, list) => {
      assert.equal(err, null)
      assert.deepEqual(list, [{ address: '93.184.215.14', family: 4 }])
      publicLookup('example.com', {}, (err2, address, family) => {
        assert.equal(err2, null)
        assert.equal(address, '93.184.215.14')
        assert.equal(family, 4)
        resolve()
      })
    })
  })
})

test('the real fetch refuses a name that resolves privately, before connecting', async (t) => {
  t.after(() => mock.restoreAll())
  const lookup = mock.method(dns, 'lookup', (host, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]))
  assert.equal(await get('http://rebind.example.com/robots.txt'), null)
  assert.equal(lookup.mock.callCount() > 0, true, 'the socket resolved through the guard')
})

test('a redirect to a private address is not followed', async () => {
  for (const target of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://192.168.0.1/',
    'http://localhost/',
    'file:///etc/passwd',
  ]) {
    const { transport, seen } = scripted({
      'https://example.com/robots.txt': { status: 302, location: target },
    })
    assert.equal(await get('https://example.com/robots.txt', transport), null, `${target} should be refused`)
    assert.deepEqual(seen, ['https://example.com/robots.txt'], `${target} must never be fetched`)
  }
})

test('a redirect chain longer than the limit ends the fetch', async () => {
  const routes = {}
  for (let i = 0; i <= MAX_REDIRECTS + 1; i++) {
    routes[`https://example.com/${i}`] = { status: 301, location: `/${i + 1}` }
  }
  const { transport, seen } = scripted(routes)
  assert.equal(await get('https://example.com/0', transport), null)
  assert.equal(seen.length, MAX_REDIRECTS + 1, 'the first request plus MAX_REDIRECTS hops, no more')
})

test('an ordinary public redirect is still followed', async () => {
  const { transport, seen } = scripted({
    'http://example.com/robots.txt': { status: 301, location: 'https://example.com/robots.txt' },
    'https://example.com/robots.txt': { status: 302, location: 'https://www.example.com/robots.txt' },
    'https://www.example.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:' },
  })
  const res = await get('http://example.com/robots.txt', transport)
  assert.deepEqual(res, { status: 200, body: 'User-agent: *\nDisallow:' })
  assert.equal(seen.length, 3)
})

test('a redirect without a Location is the answer, not a hop', async () => {
  const { transport } = scripted({ 'https://example.com/': { status: 302 } })
  assert.deepEqual(await get('https://example.com/', transport), { status: 302, body: '' })
})
