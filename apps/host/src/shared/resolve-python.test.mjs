import assert from 'node:assert/strict'
import test from 'node:test'

import {
  augmentPipFailureMessage,
  detectPreferredPythonExe,
  getPythonReadiness,
  isPythonVersionSupported,
  isStorePythonPath,
  parsePythonVersionString,
  resolvePythonExecutable,
  resetResolvedPythonCache,
  SYLO_PYTHON_PREFERRED_MINOR,
} from './resolve-python.ts'

test('parsePythonVersionString', () => {
  assert.deepEqual(parsePythonVersionString('Python 3.12.4'), {
    major: 3,
    minor: 12,
    patch: 4,
    raw: 'Python 3.12.4',
  })
})

test('isPythonVersionSupported', () => {
  assert.equal(isPythonVersionSupported({ major: 3, minor: 12, patch: 0, raw: '' }), true)
  assert.equal(isPythonVersionSupported({ major: 3, minor: 13, patch: 2, raw: '' }), true)
  assert.equal(isPythonVersionSupported({ major: 3, minor: 14, patch: 6, raw: '' }), true)
  assert.equal(isPythonVersionSupported({ major: 3, minor: 15, patch: 0, raw: '' }), false)
  assert.equal(isPythonVersionSupported({ major: 3, minor: 10, patch: 0, raw: '' }), false)
})

test('SYLO_PYTHON_PREFERRED_MINOR is 3.12', () => {
  assert.equal(SYLO_PYTHON_PREFERRED_MINOR, 12)
})

test('isStorePythonPath detects Microsoft Store builds', () => {
  assert.equal(
    isStorePythonPath(
      'C:\\Users\\<user>\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\\python.exe',
    ),
    true,
  )
  assert.equal(
    isStorePythonPath(
      'C:\\Users\\<user>\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python312\\python.exe',
    ),
    true,
  )
  assert.equal(
    isStorePythonPath('C:\\Users\\<user>\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'),
    false,
  )
  assert.equal(isStorePythonPath('python'), false)
})

test('resolvePythonExecutable honors SYLO_PYTHON override first', () => {
  resetResolvedPythonCache()
  process.env.SYLO_PYTHON = 'C:\\custom\\python.exe'
  try {
    assert.equal(resolvePythonExecutable(), 'C:\\custom\\python.exe')
  } finally {
    delete process.env.SYLO_PYTHON
    resetResolvedPythonCache()
  }
})

test('resolvePythonExecutable caches its result', () => {
  resetResolvedPythonCache()
  delete process.env.SYLO_PYTHON
  const first = resolvePythonExecutable()
  const second = resolvePythonExecutable()
  assert.equal(first, second)
  resetResolvedPythonCache()
})

test('augmentPipFailureMessage mentions lxml + 3.14 + SYLO_PYTHON', () => {
  const out = augmentPipFailureMessage('Building wheel for lxml failed', 'python', {
    major: 3,
    minor: 14,
    patch: 6,
    raw: '',
  })
  assert.match(out, /3\.14/)
  assert.match(out, /SYLO_PYTHON/)
})

test('augmentPipFailureMessage flags Microsoft Store long-path failures', () => {
  const storeExe =
    'C:\\Users\\<user>\\AppData\\Local\\Microsoft\\WindowsApps\\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\\python.exe'
  const out = augmentPipFailureMessage(
    'ERROR: Could not install packages due to an OSError: [Errno 2] No such file or directory: ...litellm... HINT: long path support',
    storeExe,
    { major: 3, minor: 12, patch: 10, raw: '' },
  )
  assert.match(out, /long-path failure caused by the Microsoft Store/i)
  assert.match(out, /python\.org/)
  assert.match(out, /SYLO_PYTHON/)
})

test('augmentPipFailureMessage does not claim Store for python.org path', () => {
  const pyOrg = 'C:\\Users\\<user>\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
  const out = augmentPipFailureMessage(
    'ERROR: OSError [Errno 2] No such file or directory: ...litellm... HINT: long path support',
    pyOrg,
    { major: 3, minor: 12, patch: 10, raw: '' },
  )
  // python.org path: no Store-specific long-path hint appended (detail returned as-is)
  assert.doesNotMatch(out, /Microsoft Store/i)
})

test('detectPreferredPythonExe never returns a Store path', () => {
  const found = detectPreferredPythonExe()
  if (found) {
    assert.equal(isStorePythonPath(found), false, `expected non-Store path, got ${found}`)
  }
})

test('getPythonReadiness returns a structured status', async () => {
  const r = await getPythonReadiness()
  assert.ok(r.status === 'ok' || r.status === 'missing-preferred' || r.status === 'unusable')
  assert.equal(typeof r.preferredInstalled, 'boolean')
  assert.equal(typeof r.resolvedExe, 'string')
  assert.equal(typeof r.message, 'string')
  if (r.status === 'ok') assert.equal(r.preferredInstalled, true)
  if (r.status !== 'ok') assert.equal(r.preferredInstalled, false)
})