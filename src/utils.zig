const std = @import("std");
const config = @import("config");

pub fn eq(a: []const u8, b: []const u8) bool {
    return std.mem.eql(u8, a, b);
}

pub fn jsonEscape(b: *std.ArrayList(u8), s: []const u8) !void {
    for (s) |c| switch (c) {
        '"' => try b.appendSlice(config.allocator, "\\\""),
        '\\' => try b.appendSlice(config.allocator, "\\\\"),
        '\n' => try b.appendSlice(config.allocator, "\\n"),
        '\r' => try b.appendSlice(config.allocator, "\\r"),
        '\t' => try b.appendSlice(config.allocator, "\\t"),
        0x00...0x08, 0x0B, 0x0C, 0x0E...0x1F =>
            try b.writer(config.allocator).print("\\u00{x:0>2}", .{c}),
        else => try b.append(config.allocator, c),
    };
}

pub fn urlDecode(enc: []const u8) ![]u8 {
    var out = try config.allocator.alloc(u8, enc.len);
    var di: usize = 0;
    var si: usize = 0;
    while (si < enc.len) {
        if (enc[si] == '%' and si + 2 < enc.len) {
            out[di] = std.fmt.parseInt(u8, enc[si+1..si+3], 16) catch '?';
            si += 3;
        } else {
            out[di] = if (enc[si] == '+') ' ' else enc[si];
            si += 1;
        }
        di += 1;
    }
    return out[0..di];
}

pub fn qparam(q: []const u8, key: []const u8) ?[]const u8 {
    var it = std.mem.tokenizeAny(u8, q, "&");
    while (it.next()) |pair| {
        var kv = std.mem.tokenizeScalar(u8, pair, '=');
        const k = kv.next() orelse continue;
        if (!eq(k, key)) continue;
        return kv.next() orelse "";
    }
    return null;
}

pub fn getHeader(hdrs: []const u8, name: []const u8) ?[]const u8 {
    var it = std.mem.tokenizeSequence(u8, hdrs, "\r\n");
    while (it.next()) |line| {
        if (line.len <= name.len) continue;
        if (!std.ascii.startsWithIgnoreCase(line, name)) continue;
        if (line[name.len] != ':') continue;
        return std.mem.trim(u8, line[name.len+1..], " \t");
    }
    return null;
}

pub fn validatePath(p: []const u8) !?[]const u8 {
    if (p.len == 0) return try config.allocator.dupe(u8, config.PROJECT_DIR);
    if (std.mem.indexOf(u8, p, "..") != null) return null;
    const joined = try std.fs.path.join(config.allocator, &.{ config.PROJECT_DIR, p });
    defer config.allocator.free(joined);
    var buf: [std.fs.max_path_bytes]u8 = undefined;
    const resolved = std.fs.realpath(joined, &buf) catch return null;
    if (!std.mem.startsWith(u8, resolved, config.PROJECT_DIR)) return null;
    return try config.allocator.dupe(u8, resolved);
}

pub fn getAuthToken() ?[]u8 {
    return std.process.getEnvVarOwned(config.allocator, config.AUTH_TOKEN_ENV) catch null;
}

pub fn checkAuth(hdrs: []const u8, cookies: []const u8) bool {
    const tok = getAuthToken() orelse return true;
    defer config.allocator.free(tok);
    if (getHeader(hdrs, "Authorization")) |auth| {
        if (std.ascii.startsWithIgnoreCase(auth, "Bearer ") and
            eq(auth["Bearer ".len..], tok)) return true;
    }
    if (std.mem.indexOf(u8, cookies, "yuyu_token=")) |pos| {
        const s = pos + "yuyu_token=".len;
        var e = s;
        while (e < cookies.len and cookies[e] != ';') e += 1;
        if (eq(cookies[s..e], tok)) return true;
    }
    return false;
}
