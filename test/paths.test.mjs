// 部署路径配置纯函数测试：node test/paths.test.mjs
// 覆盖 normalizeBase / joinPath / withTrailingSlash / 运行时派生回落。
import assert from 'node:assert/strict'
import {
  normalizeBase,
  joinPath,
  withTrailingSlash,
  appBasePath,
  apiBasePath,
  apiUrl,
  wsBaseUrl,
} from '../src/config/paths.js'

// ---- normalizeBase：去重复斜杠 / 补前导斜杠 / 去尾斜杠 ----
assert.equal(normalizeBase(''), '/')
assert.equal(normalizeBase(null), '/')
assert.equal(normalizeBase('/'), '/')
assert.equal(normalizeBase('crosspilot'), '/crosspilot')
assert.equal(normalizeBase('/crosspilot/'), '/crosspilot')
assert.equal(normalizeBase('///a//b///'), '/a/b')

// ---- withTrailingSlash：目录形式 ----
assert.equal(withTrailingSlash('/'), '/')
assert.equal(withTrailingSlash('/crosspilot'), '/crosspilot/')

// ---- joinPath：空段过滤 + 去重复斜杠，绝不漏前缀/出双斜杠 ----
assert.equal(joinPath('/crosspilot/', '/api/', '/health'), '/crosspilot/api/health')
assert.equal(joinPath('', 'api', 'health'), '/api/health')
assert.equal(joinPath('/crosspilot', '', 'api'), '/crosspilot/api')
assert.equal(joinPath(), '/')
assert.equal(joinPath('/a', '/b', '/c'), '/a/b/c')

// ---- node 环境（无 window / 无 Vite 注入）：回落根路径派生 ----
assert.equal(appBasePath(), '/')
assert.equal(apiBasePath(), '/api')
assert.equal(apiUrl('/auth/login'), '/api/auth/login')
assert.equal(apiUrl('health'), '/api/health')
assert.ok(wsBaseUrl('ws').startsWith('ws://') || wsBaseUrl('ws') === '')

console.log('paths.test: all assertions passed')
