-- Kleiner JSON-Kodierer/-Dekodierer (Lightroom bringt keinen mit)
local M = {}

local ESC = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }
local function encStr(s)
  return '"' .. s:gsub('[%c"\\]', function(c) return ESC[c] or ("\\u%04x"):format(c:byte()) end) .. '"'
end

local function isArray(t)
  if next(t) == nil then return getmetatable(t) == M.ARRAY end
  local n = 0
  for k in pairs(t) do if type(k) ~= "number" then return false end n = n + 1 end
  return n == #t
end

M.ARRAY = {}
function M.array(t) return setmetatable(t or {}, M.ARRAY) end
M.null = setmetatable({}, { __tostring = function() return "null" end })

function M.encode(v, out)
  local top = out == nil
  out = out or {}
  local t = type(v)
  if v == nil or v == M.null then out[#out + 1] = "null"
  elseif t == "boolean" then out[#out + 1] = tostring(v)
  elseif t == "number" then out[#out + 1] = (v == math.floor(v) and math.abs(v) < 2^53) and ("%d"):format(v) or ("%.14g"):format(v)
  elseif t == "string" then out[#out + 1] = encStr(v)
  elseif t == "table" then
    if isArray(v) then
      out[#out + 1] = "["
      for i, x in ipairs(v) do if i > 1 then out[#out + 1] = "," end M.encode(x, out) end
      out[#out + 1] = "]"
    else
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      out[#out + 1] = "{"
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = "," end
        out[#out + 1] = encStr(k); out[#out + 1] = ":"; M.encode(v[k], out)
      end
      out[#out + 1] = "}"
    end
  else error("JSON: Typ " .. t .. " nicht kodierbar") end
  if top then return table.concat(out) end
end

local function utf8char(c)
  if c < 0x80 then return string.char(c)
  elseif c < 0x800 then return string.char(0xC0 + math.floor(c / 64), 0x80 + c % 64)
  elseif c < 0x10000 then return string.char(0xE0 + math.floor(c / 4096), 0x80 + math.floor(c / 64) % 64, 0x80 + c % 64)
  else return string.char(0xF0 + math.floor(c / 262144), 0x80 + math.floor(c / 4096) % 64, 0x80 + math.floor(c / 64) % 64, 0x80 + c % 64) end
end

function M.decode(s)
  local pos = 1
  local function ws() pos = s:find("[^ \t\r\n]", pos) or #s + 1 end
  local function err(m) error(("JSON: %s an Stelle %d"):format(m, pos)) end
  local value
  local function str()
    pos = pos + 1
    local buf = {}
    while true do
      local c = s:sub(pos, pos)
      if c == "" then err("Zeichenkette nicht beendet") end
      if c == '"' then pos = pos + 1; return table.concat(buf) end
      if c == "\\" then
        local e = s:sub(pos + 1, pos + 1)
        local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
        if map[e] then buf[#buf + 1] = map[e]; pos = pos + 2
        elseif e == "u" then
          local cp = tonumber(s:sub(pos + 2, pos + 5), 16) or err("\\u ungültig")
          pos = pos + 6
          if cp >= 0xD800 and cp <= 0xDBFF and s:sub(pos, pos + 1) == "\\u" then
            local lo = tonumber(s:sub(pos + 2, pos + 5), 16)
            if lo and lo >= 0xDC00 and lo <= 0xDFFF then cp = 0x10000 + (cp - 0xD800) * 1024 + (lo - 0xDC00); pos = pos + 6 end
          end
          buf[#buf + 1] = utf8char(cp)
        else err("Escape ungültig") end
      else
        local j = s:find('["\\]', pos) or #s + 1
        buf[#buf + 1] = s:sub(pos, j - 1); pos = j
      end
    end
  end
  function value()
    ws()
    local c = s:sub(pos, pos)
    if c == "{" then
      pos = pos + 1; local t = {}
      ws(); if s:sub(pos, pos) == "}" then pos = pos + 1; return t end
      while true do
        ws(); if s:sub(pos, pos) ~= '"' then err("Schlüssel erwartet") end
        local k = str(); ws()
        if s:sub(pos, pos) ~= ":" then err(": erwartet") end
        pos = pos + 1; t[k] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "}" then return t elseif d ~= "," then err(", oder } erwartet") end
      end
    elseif c == "[" then
      pos = pos + 1; local t = M.array()
      ws(); if s:sub(pos, pos) == "]" then pos = pos + 1; return t end
      while true do
        t[#t + 1] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == "]" then return t elseif d ~= "," then err(", oder ] erwartet") end
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == "true" then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == "false" then pos = pos + 5; return false
    elseif s:sub(pos, pos + 3) == "null" then pos = pos + 4; return M.null
    else
      local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
      if not num or num == "" then err("Wert erwartet") end
      pos = pos + #num; return tonumber(num)
    end
  end
  local v = value(); ws()
  return v
end

return M
