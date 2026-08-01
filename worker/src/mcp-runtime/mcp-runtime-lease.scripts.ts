const LUA_HELPERS = String.raw`
local function now_ms()
  local current = redis.call('TIME')
  return (tonumber(current[1]) * 1000) + math.floor(tonumber(current[2]) / 1000)
end

local function fence_matches(record, runtime_id, owner_id, owner_epoch, generation)
  local fence = record.ref.fence
  return fence.runtimeId == runtime_id
    and fence.ownerId == owner_id
    and fence.ownerEpoch == owner_epoch
    and tonumber(fence.leaseGeneration) == tonumber(generation)
end

local function refresh_owner_index(index_key, current_ms)
  redis.call('ZREMRANGEBYSCORE', index_key, '-inf', current_ms)
  local latest = redis.call('ZREVRANGE', index_key, 0, 0, 'WITHSCORES')
  if #latest == 0 then
    redis.call('DEL', index_key)
    return
  end
  redis.call('PEXPIREAT', index_key, math.ceil(tonumber(latest[2])))
end
`;

export const MCP_RUNTIME_RESERVE_LUA = `${LUA_HELPERS}
local existing = redis.call('GET', KEYS[1])
if existing then
  return { 0, existing }
end

local generation = redis.call('INCR', KEYS[2])
redis.call('PERSIST', KEYS[2])
local current_ms = now_ms()
local expires_at_ms = current_ms + tonumber(ARGV[7])
local record = {
  version = 1,
  runtimeKey = cjson.decode(ARGV[6]),
  retainedOwnerAddress = ARGV[5],
  ref = {
    fence = {
      runtimeId = ARGV[2],
      ownerId = ARGV[3],
      ownerEpoch = ARGV[4],
      leaseGeneration = generation
    },
    state = 'starting',
    leaseExpiresAtMs = expires_at_ms,
    protocolEra = cjson.null,
    protocolVersion = cjson.null,
    ownerAddress = cjson.null,
    capabilityFingerprint = cjson.null
  }
}
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'PX', ARGV[7])
redis.call('ZADD', KEYS[3], expires_at_ms, ARGV[1])
refresh_owner_index(KEYS[3], current_ms)
return { 1, encoded }
`;

export const MCP_RUNTIME_PUBLISH_READY_LUA = `${LUA_HELPERS}
local encoded = redis.call('GET', KEYS[1])
if not encoded then return { 0 } end
local record = cjson.decode(encoded)
if not fence_matches(record, ARGV[2], ARGV[3], ARGV[4], ARGV[5]) then return { 0 } end
if record.retainedOwnerAddress ~= ARGV[6] then return { -2 } end

if record.ref.state == 'ready' then
  if record.ref.ownerAddress == ARGV[6]
    and record.ref.protocolEra == ARGV[7]
    and record.ref.protocolVersion == ARGV[8]
    and record.ref.capabilityFingerprint == ARGV[9] then
    return { 1, encoded }
  end
  return { -3 }
end
if record.ref.state ~= 'starting' then return { 0 } end

local current_ms = now_ms()
local expires_at_ms = current_ms + tonumber(ARGV[10])
record.ref.state = 'ready'
record.ref.leaseExpiresAtMs = expires_at_ms
record.ref.ownerAddress = ARGV[6]
record.ref.protocolEra = ARGV[7]
record.ref.protocolVersion = ARGV[8]
record.ref.capabilityFingerprint = ARGV[9]
encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'PX', ARGV[10])
redis.call('ZADD', KEYS[2], expires_at_ms, ARGV[1])
refresh_owner_index(KEYS[2], current_ms)
return { 1, encoded }
`;

export const MCP_RUNTIME_RENEW_LUA = `${LUA_HELPERS}
local encoded = redis.call('GET', KEYS[1])
if not encoded then return { 0 } end
local record = cjson.decode(encoded)
if not fence_matches(record, ARGV[2], ARGV[3], ARGV[4], ARGV[5]) then return { 0 } end
if record.ref.state ~= 'ready' then return { 0 } end

local current_ms = now_ms()
local expires_at_ms = current_ms + tonumber(ARGV[6])
record.ref.leaseExpiresAtMs = expires_at_ms
encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'PX', ARGV[6])
redis.call('ZADD', KEYS[2], expires_at_ms, ARGV[1])
refresh_owner_index(KEYS[2], current_ms)
return { 1, encoded }
`;

export const MCP_RUNTIME_BEGIN_DRAIN_LUA = `${LUA_HELPERS}
local encoded = redis.call('GET', KEYS[1])
if not encoded then return { 0 } end
local record = cjson.decode(encoded)
if not fence_matches(record, ARGV[2], ARGV[3], ARGV[4], ARGV[5]) then return { 0 } end
if record.ref.state == 'draining' then return { 1, encoded } end
if record.ref.state ~= 'ready' then return { 0 } end

local remaining_ms = redis.call('PTTL', KEYS[1])
if remaining_ms <= 0 then return { 0 } end
local current_ms = now_ms()
local expires_at_ms = current_ms + remaining_ms
record.ref.state = 'draining'
record.ref.leaseExpiresAtMs = expires_at_ms
encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'PX', remaining_ms)
redis.call('ZADD', KEYS[2], expires_at_ms, ARGV[1])
refresh_owner_index(KEYS[2], current_ms)
return { 1, encoded }
`;

export const MCP_RUNTIME_COMPARE_AND_DELETE_LUA = `${LUA_HELPERS}
local encoded = redis.call('GET', KEYS[1])
if not encoded then return 0 end
local record = cjson.decode(encoded)
if not fence_matches(record, ARGV[2], ARGV[3], ARGV[4], ARGV[5]) then return 0 end

redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
refresh_owner_index(KEYS[2], now_ms())
return 1
`;
