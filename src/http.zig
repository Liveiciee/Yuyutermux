const std = @import("std");
const config = @import("config");
const utils = @import("utils");

pub fn statusText(code: u16) []const u8 {
    return switch (code) {
        200 => "OK", 400 => "Bad Request", 401 => "Unauthorized",
        403 => "Forbidden", 404 => "Not Found", 409 => "Conflict",
        413 => "Payload Too Large", 500 => "Internal Server Error",
        else => "Error",
    };
}

pub fn writeRaw(c: std.net.Stream, status: u16, ct: []const u8,
                extra: []const u8, body: []const u8) !void {
    const head = try std.fmt.allocPrint(config.allocator,
        "HTTP/1.1 {d} {s}\r\nContent-Type: {s}\r\nContent-Length: {d}\r\n{s}\r\n",
        .{ status, statusText(status), ct, body.len, extra });
    defer config.allocator.free(head);
    try c.writeAll(head);
    try c.writeAll(body);
}

pub fn sendOkJson(c: std.net.Stream, json: []const u8) !void {
    try writeRaw(c, 200, "application/json", "", json);
}

pub fn sendJson(c: std.net.Stream, status: u16, json: []const u8) !void {
    try writeRaw(c, status, "application/json", "", json);
}

pub fn sendError(c: std.net.Stream, status: u16, msg: []const u8) !void {
    var b = std.ArrayList(u8).empty;
    defer b.deinit(config.allocator);
    try b.appendSlice(config.allocator, "{\"success\":false,\"error\":\"");
    try utils.jsonEscape(&b, msg);
    try b.appendSlice(config.allocator, "\"}");
    try sendJson(c, status, b.items);
}

pub fn sendText(c: std.net.Stream, status: u16, text: []const u8) !void {
    try writeRaw(c, status, "text/plain; charset=utf-8", "", text);
}

pub const Req = struct {
    method: []const u8, path: []const u8, query: []const u8,
    hdrs: []const u8, cookies: []const u8, body: []const u8,
    _buf: []u8, _extra: ?[]u8,

    pub fn deinit(self: *Req) void {
        config.allocator.free(self._buf);
        if (self._extra) |e| config.allocator.free(e);
    }
};

pub fn readReq(stream: std.net.Stream) !Req {
    var buf = try config.allocator.alloc(u8, config.INIT_BUF);
    errdefer config.allocator.free(buf);
    var total: usize = 0;
    while (total < buf.len) {
        const n = stream.read(buf[total..]) catch break;
        if (n == 0) break;
        total += n;
        if (std.mem.indexOf(u8, buf[0..total], "\r\n\r\n") != null) break;
    }
    if (total == 0) return error.EmptyRequest;
    const data = buf[0..total];
    const he = std.mem.indexOf(u8, data, "\r\n\r\n") orelse return error.BadRequest;
    const hdrs = data[0..he];
    const bs = he + 4;
    var cl: usize = 0;
    if (utils.getHeader(hdrs, "Content-Length")) |v|
        cl = std.fmt.parseInt(usize, v, 10) catch 0;
    if (cl > config.MAX_UPLOAD_SIZE) return error.TooLarge;
    var body = data[@min(bs, data.len)..];
    var extra: ?[]u8 = null;
    if (cl > 0 and body.len < cl) {
        const fb = try config.allocator.alloc(u8, cl);
        @memcpy(fb[0..body.len], body);
        var got = body.len;
        while (got < cl) {
            const n = stream.read(fb[got..]) catch break;
            if (n == 0) break;
            got += n;
        }
        extra = fb;
        body = fb[0..got];
    }
    const le = std.mem.indexOf(u8, hdrs, "\r\n") orelse hdrs.len;
    var tok = std.mem.tokenizeScalar(u8, hdrs[0..le], ' ');
    const method = tok.next() orelse "GET";
    const rawpath = tok.next() orelse "/";
    var path = rawpath;
    var query: []const u8 = "";
    if (std.mem.indexOf(u8, rawpath, "?")) |qi| {
        path = rawpath[0..qi];
        query = rawpath[qi+1..];
    }
    return .{
        .method = method, .path = path, .query = query,
        .hdrs = hdrs, .cookies = utils.getHeader(hdrs, "Cookie") orelse "",
        .body = body, ._buf = buf, ._extra = extra,
    };
}
